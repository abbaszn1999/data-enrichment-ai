import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { authorizeAssistant } from "@/lib/assistant/gateway-auth";
import { settleAssistantRun } from "@/lib/assistant/billing";
import {
  assistantEventSchema,
  chatRequestSchema,
  type AssistantEvent,
  type ServiceRunRequest,
} from "@/lib/assistant/protocol";
import { callAssistantService } from "@/lib/assistant/service-client";
import { hideProviderNames } from "@/lib/provider-names";
import { rateLimit } from "@/lib/simple-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Nothing from the service reaches the browser without passing through here. */
function publicEvent(event: AssistantEvent): AssistantEvent {
  switch (event.type) {
    case "text":
      return { ...event, text: hideProviderNames(event.text) };
    case "step":
      return { ...event, label: hideProviderNames(event.label) };
    case "thinking":
      return { ...event, text: hideProviderNames(event.text) };
    case "tool":
      return {
        ...event,
        title: hideProviderNames(event.title),
        ...(event.detail ? { detail: hideProviderNames(event.detail) } : {}),
        ...(event.summary ? { summary: hideProviderNames(event.summary) } : {}),
      };
    case "error":
      return { ...event, message: hideProviderNames(event.message) };
    case "confirmation":
      return {
        ...event,
        title: hideProviderNames(event.title),
        details: event.details.map((line) => hideProviderNames(line)),
      };
    default:
      return event;
  }
}

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = chatRequestSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const body = parsed.data;

  const access = await authorizeAssistant({
    workspaceId: body.context.workspaceId,
    workspaceSlug: body.context.workspaceSlug,
    requireCredits: true,
  });
  if (access instanceof NextResponse) return access;

  const limit = rateLimit(`assistant:${access.userId}`, 20, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  const runId = randomUUID();
  const payload: ServiceRunRequest = {
    runId,
    userId: access.userId,
    workspaceId: body.context.workspaceId,
    message: body.message,
    context: body.context,
    conversationId: body.conversationId,
    files: body.files,
  };

  let upstream: Response;
  try {
    upstream = await callAssistantService({ path: "/runs", userId: access.userId, body: payload });
  } catch {
    return NextResponse.json({ error: "The agent is not available right now." }, { status: 503 });
  }
  if (upstream.status === 429) {
    return NextResponse.json({ error: "The agent is already working on a request." }, { status: 429 });
  }
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "The agent is not available right now." }, { status: 503 });
  }

  const reader = upstream.body.getReader();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let clientOpen = true;
      const send = (event: AssistantEvent) => {
        if (!clientOpen) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          clientOpen = false;
        }
      };

      request.signal.addEventListener("abort", () => {
        clientOpen = false;
        // Stop the run; the service then finishes with a `done` event that we still read for billing.
        void callAssistantService({ path: "/runs/cancel", userId: access.userId, body: { runId } }).catch(() => {});
      });

      let credits = 0;
      let buffer = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline: number;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line) continue;
            let event: AssistantEvent;
            try {
              const result = assistantEventSchema.safeParse(JSON.parse(line));
              if (!result.success) continue;
              event = result.data;
            } catch {
              continue;
            }
            if (event.type === "done" && typeof event.credits === "number") credits = event.credits;
            send(publicEvent(event));
          }
        }
      } catch {
        send({ type: "error", message: "The agent connection was interrupted." });
      } finally {
        const settlement = await settleAssistantRun({
          runId,
          workspaceId: body.context.workspaceId,
          ownerUserId: access.ctx.subscription?.user_id ?? access.userId,
          actorUserId: access.userId,
          credits,
        });
        if (settlement.balanceExhausted) send({ type: "billing_blocked", reason: "no_credits" });
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      void callAssistantService({ path: "/runs/cancel", userId: access.userId, body: { runId } }).catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "X-Run-Id": runId,
    },
  });
}
