// Sync agent route — v3 orchestrator.
//
// Flow:
//   1. Authenticate + verify subscription + credits
//   2. Parse body (workspaceId, userMessage, mode, sheet, memory, etc.)
//   3. Load workspace integration (typed IntegrationRecord)
//   4. Run supervisor planner → AgentPlanV2 (server-side clamp + validation)
//   5. Stream NDJSON events as we execute each step via tool-handlers
//   6. Reflect after each step (rule-based evaluator)
//   7. Persist traces, update working memory, deduct credits
//
// The legacy route.ts was moved to route.legacy.txt for reference.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  getWorkspaceContext,
  isContextSubscriptionActive,
  updateCachedCredits,
} from "@/lib/workspace-context";

import type {
  AgentPlanV2,
  SyncSheet,
  SyncWorkingMemoryV2,
} from "@/lib/sync/core/types";
import { EMPTY_SYNC_WORKING_MEMORY_V2 } from "@/lib/sync/core/types";
import { runAgentLoop, type AgentLoopEvent } from "@/lib/sync/agent/agent-loop";
import { AgentTracer } from "@/lib/sync/agent/tracer";
import {
  validateInlineAttachments,
  type SyncInlineAttachment,
} from "@/lib/sync/agent/ai-helpers";
import type { SyncBillingTracker, SyncMode, SyncThinkingLevel } from "@/lib/sync/agent/ai-utils";

export const maxDuration = 300;

// ─── Request types ──────────────────────────────────────────────────────────

type AgentChatMessage = { role: "user" | "assistant"; content: string };

type RequestBody = {
  workspaceId?: string;
  userMessage?: string;
  mode?: SyncMode;
  thinkingLevel?: SyncThinkingLevel;
  webEnabled?: boolean;
  attachments?: unknown;
  currentSheet?: SyncSheet | null;
  originalSheet?: SyncSheet | null;
  messages?: AgentChatMessage[];
  sessionSummary?: string;
  workingMemory?: Partial<SyncWorkingMemoryV2> | null;
  planOnly?: boolean;
  preApprovedPlan?: AgentPlanV2;
};

// ─── Stream event types ─────────────────────────────────────────────────────

type StreamEvent =
  | { type: "ping" }
  | { type: "plan"; data: AgentPlanV2 }
  | { type: "progress"; progress: string[] }
  | {
      type: "step.start";
      data: { index: number; tool: string; args: Record<string, unknown> };
    }
  | {
      type: "step.end";
      data: {
        index: number;
        tool: string;
        output: unknown;
        warnings?: string[];
        userErrorCount?: number;
        elapsedMs: number;
      };
    }
  | { type: "reflection"; data: { stepIndex: number; decision: string; rationale: string } }
  | {
      /** Gemini thought-summary for the current turn. Emitted once per turn
       *  before tool calls or final answer. UI appends it to the collapsible
       *  thinking section of the assistant message bubble. */
      type: "thinking";
      data: { text: string; turn: number; partial?: boolean };
    }
  | {
      /** Live, mid-tool progress event so the UI can render partial values
       *  (one batch at a time) before the tool finishes. Emitted by
       *  long-running handlers like sync_columns_write_with_ai and
       *  sync_images_search. */
      type: "tool_progress";
      data: {
        index: number;
        tool: string;
        column?: string;
        processed: number;
        total: number;
        percent: number;
        partialValues?: Array<{ rowIndex: number; column: string; value: string }>;
        failedCount?: number;
      };
    }
  | { type: "working_memory"; data: SyncWorkingMemoryV2 }
  | { type: "needs_confirmation"; data: { plan: AgentPlanV2 } }
  | {
      type: "result";
      data: {
        assistantMessage: string;
        progress: string[];
        sessionSummary: string;
        sheet: SyncSheet | null;
        columnProfile: string;
        executedSteps: Array<{ tool: string }>;
        workingMemory: SyncWorkingMemoryV2;
        actionReceipt?: {
          toolsExecuted: string[];
          rowsAffected: number;
          columnsAffected: string[];
          sheetRowCount: number;
          warnings: string[];
        };
        remainingCount?: number | null;
      };
    }
  | { type: "error"; error: string };

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalizeWorkingMemory(
  raw: Partial<SyncWorkingMemoryV2> | null | undefined
): SyncWorkingMemoryV2 {
  if (!raw || typeof raw !== "object") return { ...EMPTY_SYNC_WORKING_MEMORY_V2 };
  const base = { ...EMPTY_SYNC_WORKING_MEMORY_V2 };
  const safeArray = <T>(v: unknown, filterFn: (x: unknown) => boolean): T[] =>
    Array.isArray(v) ? (v.filter(filterFn) as T[]) : [];

  return {
    ...base,
    lastTargetedRowIndexes: safeArray<number>(
      raw.lastTargetedRowIndexes,
      (x) => Number.isInteger(x) && (x as number) >= 0
    ),
    lastCreatedRowIndexes: safeArray<number>(
      raw.lastCreatedRowIndexes,
      (x) => Number.isInteger(x) && (x as number) >= 0
    ),
    lastTargetedProductIds: safeArray<string>(
      raw.lastTargetedProductIds,
      (x) => typeof x === "string" && x.length > 0
    ),
    lastServerFilter:
      raw.lastServerFilter && typeof raw.lastServerFilter === "object"
        ? raw.lastServerFilter
        : null,
    lastClientPredicates: Array.isArray(raw.lastClientPredicates)
      ? raw.lastClientPredicates
      : null,
    lastCursor: typeof raw.lastCursor === "string" ? raw.lastCursor : null,
    lastBulkOperationId:
      typeof raw.lastBulkOperationId === "string" ? raw.lastBulkOperationId : null,
    totalMatchCount:
      typeof raw.totalMatchCount === "number" ? raw.totalMatchCount : null,
    remainingCount:
      typeof raw.remainingCount === "number" ? raw.remainingCount : null,
    lastColumnProfile:
      typeof raw.lastColumnProfile === "string" ? raw.lastColumnProfile : null,
    lastEntity:
      raw.lastEntity === "products" || raw.lastEntity === "collections"
        ? raw.lastEntity
        : null,
    lastRelevantProfiles: Array.isArray(raw.lastRelevantProfiles)
      ? (raw.lastRelevantProfiles.filter((k) => typeof k === "string") as never)
      : null,
    lastTouchedColumns: safeArray<string>(
      raw.lastTouchedColumns,
      (x) => typeof x === "string" && x.length > 0
    ),
    lastResearchSummary:
      typeof raw.lastResearchSummary === "string"
        ? raw.lastResearchSummary
        : null,
    lastResearchSubject:
      typeof raw.lastResearchSubject === "string"
        ? raw.lastResearchSubject
        : null,
    collectionsByName:
      raw.collectionsByName && typeof raw.collectionsByName === "object"
        ? (raw.collectionsByName as Record<string, { id: string; handle: string }>)
        : {},
    lastApplyStats:
      raw.lastApplyStats && typeof raw.lastApplyStats === "object"
        ? raw.lastApplyStats
        : null,
    lastErrorRows: Array.isArray(raw.lastErrorRows) ? raw.lastErrorRows : [],
    lastActionType:
      raw.lastActionType === "append_row" ||
      raw.lastActionType === "target_rows" ||
      raw.lastActionType === "write_column" ||
      raw.lastActionType === "research_web" ||
      raw.lastActionType === "load_sheet" ||
      raw.lastActionType === "apply_to_shopify"
        ? raw.lastActionType
        : null,
    updatedAt:
      typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt)
        ? raw.updatedAt
        : null,
  };
}

function createNdjsonStream(
  executor: (push: (event: StreamEvent) => void) => Promise<void>
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const keepalive = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(
              encoder.encode(`${JSON.stringify({ type: "ping" })}\n`)
            );
          } catch {
            clearInterval(keepalive);
          }
        }
      }, 10_000);
      const push = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        await executor(push);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        push({ type: "error", error: message });
      } finally {
        closed = true;
        clearInterval(keepalive);
        controller.close();
      }
    },
  });
}

function buildSessionSummary(userMessage: string, executedTools: string[]): string {
  const toolList = executedTools.join(" → ") || "(no tools)";
  return `User: ${userMessage.slice(0, 200)}\nTools: ${toolList}`;
}

// ─── POST handler ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    workspaceId,
    userMessage,
    mode = "fast",
    thinkingLevel = "low",
    webEnabled = false,
    attachments: rawAttachments = [],
    currentSheet,
    originalSheet: rawOriginalSheet,
    messages = [],
    sessionSummary,
    workingMemory: rawWorkingMemory,
    planOnly = false,
    preApprovedPlan,
  } = body;

  if (!workspaceId || !userMessage || !userMessage.trim()) {
    return NextResponse.json(
      { error: "Missing workspaceId or userMessage" },
      { status: 400 }
    );
  }

  let attachments: SyncInlineAttachment[];
  try {
    attachments = validateInlineAttachments(rawAttachments);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Invalid attachments" },
      { status: 400 }
    );
  }

  const ctx = await getWorkspaceContext({ workspaceId, userId: user.id });
  const headers: Record<string, string> = {
    "X-Context-Source": ctx.source,
    "Server-Timing": `ctx;dur=${ctx.durationMs.toFixed(1)}`,
  };

  // Membership gate
  if (!ctx.membershipRole) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
  }
  if (ctx.membershipRole === "viewer") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
  }

  // Subscription + credits gate
  if (!ctx.subscription || !isContextSubscriptionActive(ctx)) {
    return NextResponse.json({ error: "NO_SUBSCRIPTION" }, { status: 402, headers });
  }
  if ((ctx.credits?.total ?? 0) <= 0) {
    return NextResponse.json({ error: "NO_CREDITS" }, { status: 402, headers });
  }

  // Admin client for downstream calls/tracing
  const admin = createAdminClient();
  const integration = ctx.integration;

  const sheet: SyncSheet | null =
    currentSheet && Array.isArray(currentSheet.columns) && Array.isArray(currentSheet.rows)
      ? {
          title: currentSheet.title || "Results Workspace",
          columns: currentSheet.columns,
          rows: currentSheet.rows,
        }
      : null;

  // The originalSheet is the snapshot of the sheet BEFORE any user/agent edits
  // in this session. It's used by handleApplyToShopify to compute a real diff
  // against the current (mutated) sheet. Without it, the diff compares the
  // sheet against itself and always finds zero changes.
  const parsedOriginalSheet: SyncSheet | null =
    rawOriginalSheet && Array.isArray(rawOriginalSheet.columns) && Array.isArray(rawOriginalSheet.rows)
      ? {
          title: rawOriginalSheet.title || "Results Workspace",
          columns: rawOriginalSheet.columns,
          rows: rawOriginalSheet.rows,
        }
      : null;

  const workingMemory = normalizeWorkingMemory(rawWorkingMemory);
  const billingTracker: SyncBillingTracker = {
    totalCredits: 0,
    totalCost: 0,
    totalTokens: 0,
  };

  // planOnly mode is deprecated under the new agent loop — confirmations are
  // surfaced dynamically during execution via `needs_confirmation` events.
  void planOnly; // intentionally unused
  void sessionSummary; // accepted for backward compat, not used by the loop

  // ─── Execute mode (streaming) ─────────────────────────────────────────────

  const runId = randomUUID();
  const tracer = new AgentTracer({
    admin,
    workspaceId,
    userId: user.id,
    runId,
  });

  const stream = createNdjsonStream(async (push) => {
    const progress: string[] = [];
    const emit = (m: string) => {
      progress.push(m);
      push({ type: "progress", progress: [...progress] });
    };

    emit("Analyzing your request");
    if (sheet) emit(`Using the current sheet with ${sheet.rows.length} rows`);
    if (attachments.length > 0) {
      emit(`Received ${attachments.length} attachment${attachments.length === 1 ? "" : "s"}`);
    }

    // ── Adapter: map agent-loop events to the legacy SSE contract ──────────
    // The UI consumes step.start / step.end / reflection / working_memory /
    // needs_confirmation / result events. The loop emits a slightly different
    // surface; we translate here so the UI doesn't change in v1.
    let stepIndex = 0;
    const stepIdByCallId = new Map<string, number>();
    let finalEmitted = false;
    const executedToolNames: string[] = [];

    const onLoopEvent = (event: AgentLoopEvent) => {
      switch (event.type) {
        case "progress":
          emit(event.message);
          return;
        case "tool_call": {
          const idx = stepIndex++;
          stepIdByCallId.set(event.toolCallId, idx);
          push({
            type: "step.start",
            data: { index: idx, tool: event.tool, args: event.args },
          });
          return;
        }
        case "tool_result": {
          const idx = stepIdByCallId.get(event.toolCallId) ?? stepIndex++;
          push({
            type: "step.end",
            data: {
              index: idx,
              tool: event.tool,
              output: event.output ?? null,
              warnings: event.warnings,
              userErrorCount: event.userErrorCount ?? 0,
              elapsedMs: event.elapsedMs,
            },
          });
          tracer.record({
            stepIndex: idx,
            stepKind: "tool",
            toolName: event.tool,
            input: null,
            output: event.output ?? null,
            error: event.error ?? null,
            shopifyCostRequested: null,
            shopifyCostActual: null,
            shopifyThrottleAvailable: null,
            durationMs: event.elapsedMs,
          });
          if (event.ok) executedToolNames.push(event.tool);
          return;
        }
        case "thinking":
          push({ type: "thinking", data: { text: event.text, turn: event.turn, partial: event.partial } });
          return;
        case "tool_progress": {
          const idx = stepIdByCallId.get(event.toolCallId) ?? -1;
          const percent = event.total > 0
            ? Math.min(100, Math.floor((event.processed / event.total) * 100))
            : 0;
          push({
            type: "tool_progress",
            data: {
              index: idx,
              tool: event.tool,
              column: event.column,
              processed: event.processed,
              total: event.total,
              percent,
              partialValues: event.partialValues,
              failedCount: event.failedCount,
            },
          });
          return;
        }
        case "working_memory":
          push({ type: "working_memory", data: event.memory });
          return;
        case "needs_confirmation": {
          // Build a minimal AgentPlanV2-shaped payload so the existing UI
          // confirm/cancel flow keeps working without changes.
          const pseudoPlan: AgentPlanV2 = {
            strategy:
              event.tool === "sync_apply_to_shopify"
                ? "apply_to_shopify"
                : "delete",
            scopeCap: 0,
            columnProfile: "core",
            relevantProfiles: null,
            serverFilter: null,
            clientPredicates: null,
            steps: [{ tool: event.tool, args: event.args }],
            requiresConfirmation: true,
            costEstimate: null,
            scopeRationale: "Destructive tool — confirmation required.",
            assistantMessage: "",
          };
          push({ type: "needs_confirmation", data: { plan: pseudoPlan } });
          finalEmitted = true;
          return;
        }
        case "final": {
          push({
            type: "result",
            data: {
              assistantMessage: event.assistantMessage,
              progress,
              sessionSummary: buildSessionSummary(userMessage, event.executedTools),
              sheet: event.sheet,
              columnProfile: event.memory.lastColumnProfile ?? "core",
              executedSteps: event.executedTools.map((tool) => ({ tool })),
              workingMemory: event.memory,
              actionReceipt: {
                toolsExecuted: event.executedTools,
                rowsAffected: event.rowsAffected,
                columnsAffected: event.columnsAffected,
                sheetRowCount: event.sheet?.rows.length ?? 0,
                warnings: event.warnings,
              },
              remainingCount: event.memory.remainingCount,
            },
          });
          finalEmitted = true;
          return;
        }
        default:
          return;
      }
    };

    // Note: previously this block wrapped the run in a Postgres advisory lock
    // (`withAdvisoryLock`) to serialize concurrent agent runs per workspace.
    // That lock is unreliable on top of Supabase's PgBouncer-style connection
    // pooling — `pg_advisory_lock` is session-scoped, so the lock and its
    // unlock can land on different backend connections; the unlock then no-ops
    // and the lock stays orphaned on the original session until idle-timeout,
    // blocking every subsequent request with "Another sync is in progress".
    // The UI naturally serializes a single user's requests, so we run without
    // the lock. A future migration can re-introduce serialization using a
    // row-based claim table if multi-tab abuse becomes a real concern.
    try {
      await runAgentLoop({
        userMessage: userMessage.trim(),
        mode,
        thinkingLevel,
        integration,
        sheet,
        originalSheet: parsedOriginalSheet,
        conversation: Array.isArray(messages) ? messages : [],
        workingMemory,
        webEnabled,
        attachments,
        billingTracker,
        admin,
        workspaceId,
        allowDestructive: !!preApprovedPlan,
        onEvent: onLoopEvent,
      });
    } catch (err) {
      push({ type: "error", error: (err as Error).message || "Agent failed" });
    }

    // Safety net: if the loop somehow exited without a final, push one so the
    // client never hangs.
    if (!finalEmitted) {
      push({ type: "working_memory", data: workingMemory });
      push({
        type: "result",
        data: {
          assistantMessage: "Done.",
          progress,
          sessionSummary: buildSessionSummary(userMessage, executedToolNames),
          sheet,
          columnProfile: workingMemory.lastColumnProfile ?? "core",
          executedSteps: executedToolNames.map((tool) => ({ tool })),
          workingMemory,
          actionReceipt: {
            toolsExecuted: executedToolNames,
            rowsAffected: 0,
            columnsAffected: [],
            sheetRowCount: sheet?.rows.length ?? 0,
            warnings: [],
          },
          remainingCount: workingMemory.remainingCount,
        },
      });
    }

    // Deduct credits (service-role RPC)
    try {
      const creditsToDeduct = Math.max(0, billingTracker.totalCredits);
      if (creditsToDeduct > 0) {
        await admin.rpc("deduct_user_credits", {
          p_user_id: ctx.subscription.user_id,
          p_amount: creditsToDeduct,
          p_workspace_id: workspaceId,
          p_operation: "ai_function",
          p_uid: user.id,
          p_entity_type: "sync_agent",
          p_entity_id: null,
          p_details: { runId, mode, steps: executedToolNames },
        });
        const remaining = Math.max(0, (ctx.credits?.total ?? 0) - creditsToDeduct);
        updateCachedCredits(workspaceId, remaining);
      }
    } catch (err) {
      console.warn("[sync agent] credit deduction failed:", (err as Error).message);
    }

    await tracer.finalize();
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
      // Disable buffering at proxies/CDNs (Nginx, Vercel) so streamed
      // `thinking` chunks reach the browser the instant they arrive
      // from Gemini — without this, chunks pile up until buffer fills.
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
      "X-Run-Id": runId,
      ...headers,
    },
  });
}
