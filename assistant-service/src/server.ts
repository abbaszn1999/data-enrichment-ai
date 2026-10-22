import { mkdirSync } from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { SqliteLocalAgentStore } from "@cursor/sdk/sqlite";
import { z } from "zod";
import { serviceRunRequestSchema, toolResultSchema } from "../../src/lib/assistant/protocol";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, USER_HEADER, verifyRequest } from "./auth";
import { RunLimitError, RunRegistry } from "./agent/bridge";
import { ConversationOwners, executeRun, type RunnerDeps } from "./agent/runner";
import { loadConfig, type ServiceConfig } from "./config";

const encoder = new TextEncoder();
const steerSchema = z.object({ runId: z.string().max(80), text: z.string().min(1).max(2000) });
const cancelSchema = z.object({ runId: z.string().max(80) });

export interface AppDeps {
  config: ServiceConfig;
  registry: RunRegistry;
  runner: RunnerDeps;
  /** Reports a finished run's credits to whoever bills it (the gateway reads the `done` event). */
  onRunFinished?: (info: { runId: string; userId: string; workspaceId: string; credits: number }) => void;
}

/** Verify the signature over the raw body. Returns the user id on success. */
async function authenticate(
  deps: AppDeps,
  request: Request,
  pathname: string
): Promise<{ ok: true; userId: string; body: string } | { ok: false; status: number; message: string }> {
  const body = await request.text();
  const userId = request.headers.get(USER_HEADER) ?? undefined;
  const verdict = verifyRequest({
    secret: deps.config.secret,
    timestamp: request.headers.get(TIMESTAMP_HEADER) ?? undefined,
    signature: request.headers.get(SIGNATURE_HEADER) ?? undefined,
    userId,
    method: request.method,
    path: pathname,
    body,
  });
  if (!verdict.ok || !userId) return { ok: false, status: 401, message: "unauthorized" };
  return { ok: true, userId, body };
}

export function createApp(deps: AppDeps) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true, runs: deps.registry.size }));

  app.post("/runs", async (c) => {
    const auth = await authenticate(deps, c.req.raw, "/runs");
    if (!auth.ok) return c.json({ error: auth.message }, auth.status as 401);
    let payload: ReturnType<typeof serviceRunRequestSchema.parse>;
    try {
      payload = serviceRunRequestSchema.parse(JSON.parse(auth.body));
    } catch {
      return c.json({ error: "bad request" }, 400);
    }
    if (payload.userId !== auth.userId) return c.json({ error: "unauthorized" }, 401);

    let run;
    try {
      run = deps.registry.create({
        id: payload.runId,
        userId: payload.userId,
        workspaceId: payload.workspaceId,
        context: payload.context,
      });
    } catch (error) {
      if (error instanceof RunLimitError) return c.json({ error: "busy" }, 429);
      throw error;
    }

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const close = () => {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed
          }
        };
        run.attachSink((event) => {
          if (closed) return;
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          if (event.type === "done") setTimeout(close, 0);
        });
        run.startDeadline(() => {
          run.cancel();
        });
        const keepAlive = setInterval(() => run.emit({ type: "ping" }), 10_000);
        keepAlive.unref?.();

        void executeRun(deps.runner, run, payload)
          .then((outcome) => {
            deps.onRunFinished?.({
              runId: run.id,
              userId: run.userId,
              workspaceId: run.workspaceId,
              credits: outcome.credits,
            });
          })
          .finally(() => {
            clearInterval(keepAlive);
            deps.registry.remove(run.id);
            close();
          });
      },
      cancel() {
        // The gateway dropped the connection: stop spending.
        run.cancel();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  });

  app.post("/runs/tool-result", async (c) => {
    const auth = await authenticate(deps, c.req.raw, "/runs/tool-result");
    if (!auth.ok) return c.json({ error: auth.message }, auth.status as 401);
    let result: ReturnType<typeof toolResultSchema.parse>;
    try {
      result = toolResultSchema.parse(JSON.parse(auth.body));
    } catch {
      return c.json({ error: "bad request" }, 400);
    }
    const run = deps.registry.get(result.runId);
    if (!run || run.userId !== auth.userId) return c.json({ error: "not found" }, 404);
    return c.json({ ok: run.resolve(result) });
  });

  app.post("/runs/cancel", async (c) => {
    const auth = await authenticate(deps, c.req.raw, "/runs/cancel");
    if (!auth.ok) return c.json({ error: auth.message }, auth.status as 401);
    const parsed = cancelSchema.safeParse(safeJson(auth.body));
    if (!parsed.success) return c.json({ error: "bad request" }, 400);
    const run = deps.registry.get(parsed.data.runId);
    if (!run || run.userId !== auth.userId) return c.json({ error: "not found" }, 404);
    run.cancel();
    return c.json({ ok: true });
  });

  app.post("/runs/steer", async (c) => {
    const auth = await authenticate(deps, c.req.raw, "/runs/steer");
    if (!auth.ok) return c.json({ error: auth.message }, auth.status as 401);
    const parsed = steerSchema.safeParse(safeJson(auth.body));
    if (!parsed.success) return c.json({ error: "bad request" }, 400);
    const run = deps.registry.get(parsed.data.runId);
    if (!run || run.userId !== auth.userId) return c.json({ error: "not found" }, 404);
    if (!run.steer) return c.json({ ok: false, reason: "not supported" });
    try {
      await run.steer(parsed.data.text);
      return c.json({ ok: true });
    } catch {
      return c.json({ ok: false });
    }
  });

  return app;
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export async function startServer(config: ServiceConfig = loadConfig()) {
  mkdirSync(config.storeDir, { recursive: true });
  // SQLite appends one row per token. The JSONL store rewrites the whole log
  // on every token, which makes the reply type about ten times slower.
  const store = await SqliteLocalAgentStore.open({
    workspaceRef: config.knowledgeRoot,
    stateRoot: config.storeDir,
  });
  const owners = new ConversationOwners(path.join(config.storeDir, "owners.json"));
  const registry = new RunRegistry();
  const app = createApp({
    config,
    registry,
    runner: { config, owners, store, log: (message, extra) => console.log(`[assistant] ${message}`, extra ?? "") },
  });
  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host });
  console.log(`[assistant] listening on ${config.host}:${config.port} (billing: ${config.billingMode}, store: ${config.storeDir})`);
  return server;
}