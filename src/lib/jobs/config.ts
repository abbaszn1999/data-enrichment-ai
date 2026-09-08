/**
 * Tunable knobs for background job orchestrators.
 * Scaling later is changing these numbers, not rewriting the architecture:
 * raise JOB_BATCH_SIZE (8 → 20+), switch JOB_TASK_PLAN if image tasks need
 * more CPU, or add a Pro workspace only when a second developer or 500
 * build minutes is the bottleneck.
 */
export const JOB_BATCH_SIZE = 8;
export const JOB_ROW_ATTEMPTS = 3;
export const JOB_HEARTBEAT_STALE_MINUTES = 10;
export const JOB_SWEEP_LIMIT = 5;

/** Cold-state blob flush cadence (Root Cause B / P0-3). */
export const ENRICH_CHECKPOINT_ROWS = 50;
export const ENRICH_CHECKPOINT_MS = 30_000;
export const WORKSHEET_CHECKPOINT_ROWS = 20;
export const WORKSHEET_CHECKPOINT_MS = 30_000;
export const ENRICH_ROW_TIMEOUT_SECONDS = 600;
export const SESSION_TIMEOUT_SECONDS = 86_400;
export const JOB_TASK_PLAN = "flex" as const;
