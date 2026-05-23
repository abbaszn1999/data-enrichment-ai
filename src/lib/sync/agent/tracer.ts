// Batched tracer — writes agent steps to public.sync_agent_traces.
// Buffered to reduce DB round-trips; flushes on explicit flush() or on finish().
// Sampling: errors always 100%, successes 10% (env-configurable).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentTraceEvent } from "@/lib/sync/core/types";

type PendingRow = {
  workspace_id: string;
  user_id: string | null;
  run_id: string;
  step_index: number;
  step_kind: "planner" | "tool" | "reflection";
  tool_name: string | null;
  input_json: unknown;
  output_json: unknown;
  error: string | null;
  shopify_cost_requested: number | null;
  shopify_cost_actual: number | null;
  shopify_throttle_available: number | null;
  duration_ms: number;
};

const DEFAULT_SUCCESS_SAMPLE =
  Number(process.env.SYNC_TRACE_SUCCESS_SAMPLE ?? "0.1") || 0.1;

function clipJson(value: unknown, maxChars = 20_000): unknown {
  if (value == null) return value;
  try {
    const str = JSON.stringify(value);
    if (str.length <= maxChars) return value;
    return { __truncated: true, preview: str.slice(0, maxChars) };
  } catch {
    return { __unserializable: true };
  }
}

export class AgentTracer {
  private admin: SupabaseClient;
  private workspaceId: string;
  private userId: string | null;
  private runId: string;
  private stepCounter = 0;
  private buffer: PendingRow[] = [];
  private successSampleRate: number;
  private flushing: Promise<void> | null = null;

  constructor(params: {
    admin: SupabaseClient;
    workspaceId: string;
    userId: string | null;
    runId: string;
    successSampleRate?: number;
  }) {
    this.admin = params.admin;
    this.workspaceId = params.workspaceId;
    this.userId = params.userId;
    this.runId = params.runId;
    this.successSampleRate = params.successSampleRate ?? DEFAULT_SUCCESS_SAMPLE;
  }

  nextStepIndex(): number {
    const i = this.stepCounter;
    this.stepCounter += 1;
    return i;
  }

  record(event: Omit<AgentTraceEvent, "workspaceId" | "userId" | "runId">): void {
    const hasError = !!event.error;
    if (!hasError && Math.random() > this.successSampleRate) {
      return; // sampled out
    }

    this.buffer.push({
      workspace_id: this.workspaceId,
      user_id: this.userId,
      run_id: this.runId,
      step_index: event.stepIndex,
      step_kind: event.stepKind,
      tool_name: event.toolName,
      input_json: clipJson(event.input),
      output_json: clipJson(event.output),
      error: event.error,
      shopify_cost_requested: event.shopifyCostRequested,
      shopify_cost_actual: event.shopifyCostActual,
      shopify_throttle_available: event.shopifyThrottleAvailable,
      duration_ms: event.durationMs,
    });

    if (this.buffer.length >= 10) {
      // Fire-and-forget flush; don't block the hot path.
      void this.flush().catch(() => {});
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    // Serialize concurrent flushes
    if (this.flushing) {
      await this.flushing;
      if (this.buffer.length === 0) return;
    }
    const batch = this.buffer;
    this.buffer = [];
    this.flushing = (async () => {
      try {
        const { error } = await this.admin.from("sync_agent_traces").insert(batch);
        if (error) {
          // Put back at the end so we don't lose them, but cap retries by dropping if large.
          if (this.buffer.length < 100) this.buffer.push(...batch);
          console.warn("[tracer] insert failed:", error.message);
        }
      } catch (err) {
        console.warn("[tracer] flush error:", err);
      } finally {
        this.flushing = null;
      }
    })();
    await this.flushing;
  }

  async finalize(): Promise<void> {
    await this.flush();
  }
}
