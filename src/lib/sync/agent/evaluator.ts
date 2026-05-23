// Evaluator (reflection) — rule-based decision node run after each tool call.
// Returns one of: done | retry | narrow | split | ask | stop.
//
// Kept deterministic on purpose: fast, debuggable, and not subject to
// prompt injection since it doesn't call an LLM.

import type { ReflectionDecision } from "@/lib/sync/core/types";

export type ToolOutcomeSummary = {
  ok: boolean;
  userErrorCount: number;
  userErrorCodes: string[];
  throttleAvailable: number | null;
  elapsedMs: number;
  attemptCount: number;
  partialRowCount?: number;
  expectedRowCount?: number;
};

export function reflectOnToolOutcome(
  outcome: ToolOutcomeSummary,
  options: { maxRetries?: number } = {}
): ReflectionDecision {
  const maxRetries = options.maxRetries ?? 3;

  if (outcome.ok && outcome.userErrorCount === 0) {
    return { decision: "done", rationale: "Tool completed successfully." };
  }

  // All user errors are THROTTLED → retry with backoff
  if (
    outcome.userErrorCount > 0 &&
    outcome.userErrorCodes.every((c) => /throttl/i.test(c))
  ) {
    if (outcome.attemptCount >= maxRetries) {
      return {
        decision: "stop",
        rationale: "Throttled too many times; giving up this turn.",
      };
    }
    return {
      decision: "retry",
      rationale: "Shopify throttled the request; retrying with backoff.",
      delayMs: 1000 * Math.pow(2, outcome.attemptCount),
    };
  }

  // Mixed or other userErrors → ask user for intervention
  if (outcome.userErrorCount > 0) {
    return {
      decision: "ask",
      rationale: "Shopify returned validation errors; asking the user.",
      question: "Some rows failed to apply. Do you want to see the details and try a smaller batch?",
    };
  }

  // Bucket low → split next batch in half
  if (
    outcome.throttleAvailable != null &&
    outcome.throttleAvailable < 100 &&
    (outcome.expectedRowCount ?? 0) > 4
  ) {
    return {
      decision: "split",
      rationale: "Shopify bucket is low; splitting the next batch.",
      batchSize: Math.max(1, Math.floor((outcome.expectedRowCount ?? 4) / 2)),
    };
  }

  // Long-running incomplete step → narrow the scope
  if (
    outcome.elapsedMs > 60_000 &&
    (outcome.partialRowCount ?? 0) < (outcome.expectedRowCount ?? 0)
  ) {
    return {
      decision: "narrow",
      rationale: "Step is taking too long; narrowing scope.",
      nextScopeCap: Math.max(1, Math.floor((outcome.partialRowCount ?? 1) / 2) || 1),
    };
  }

  // Non-ok without user errors → retry once, else stop
  if (!outcome.ok && outcome.attemptCount < 1) {
    return {
      decision: "retry",
      rationale: "Transient failure; retrying once.",
      delayMs: 500,
    };
  }

  return { decision: "stop", rationale: "Unrecoverable condition." };
}
