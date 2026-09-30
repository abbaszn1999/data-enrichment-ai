/**
 * Tunable knobs for background job orchestrators.
 * Scaling later is changing these numbers, not rewriting the architecture:
 * raise JOB_BATCH_SIZE (8 → 20+), switch JOB_TASK_PLAN if image tasks need
 * more CPU, or add a Pro workspace only when a second developer or 500
 * build minutes is the bottleneck.
 */
export const JOB_BATCH_SIZE = 8;
/**
 * 2, not 3: a single OpenAI call can run up to ENRICH_CALL_TIMEOUT_MS (420s,
 * see src/lib/enrich/openai.ts; a row with many columns writes a long answer
 * on top of a required web search), so 3 full attempts could exceed
 * ENRICH_ROW_TIMEOUT_SECONDS below in the worst case. 2 attempts x 420s stays
 * safely inside the 900s row budget.
 */
export const JOB_ROW_ATTEMPTS = 2;
export const JOB_HEARTBEAT_STALE_MINUTES = 10;
export const JOB_SWEEP_LIMIT = 5;
/**
 * A catalog orchestrator pings its heartbeat on this interval for as long as
 * its process is alive, independent of how long any one row takes.
 */
export const CATALOG_HEARTBEAT_INTERVAL_MS = 30_000;
/**
 * No heartbeat for this long (five missed pings) means the orchestrator's
 * process is gone — a deploy, restart or crash — not just a slow row. The run
 * is then resumed, or finished if Stop was already pressed.
 */
export const CATALOG_WORKER_STALE_MS = 150_000;
/**
 * A run Render accepted (it has a task_run_id) but has not started yet is
 * waiting for a free concurrency slot, not dead: it has no heartbeat to send
 * until its task begins. Restarting it every few minutes would only add
 * duplicate entries to an already full queue, so it gets this much longer —
 * long enough for a busy queue, short enough that a task Render lost is
 * eventually dispatched again.
 */
export const CATALOG_QUEUE_WAIT_MS = 30 * 60_000;

/** Cold-state blob flush cadence (Root Cause B / P0-3). */
export const ENRICH_CHECKPOINT_ROWS = 50;
export const ENRICH_CHECKPOINT_MS = 30_000;
export const WORKSHEET_CHECKPOINT_ROWS = 20;
export const WORKSHEET_CHECKPOINT_MS = 30_000;
export const ENRICH_ROW_TIMEOUT_SECONDS = 900;
/**
 * Gallery AI Full = planner (≤180s) + 1 Main (≤90s) + up to 8 Gallery (≤90s
 * each) plus uploads. 600s would kill a slow Full row on Render.
 */
export const GALLERY_ROW_TIMEOUT_SECONDS = 1_500;
/**
 * An Image Finder row runs the automatic Standard → Exact → Premium chain
 * once. The chain stops starting tiers when 2100s of its own row deadline
 * (IMAGE_FINDER_CHAIN_BUDGET_MS) have passed and each tier has its own worst
 * case budget inside that, so this is the hard backstop above it, leaving
 * room for the image checks and the charge.
 */
export const IMAGE_FINDER_ROW_TIMEOUT_SECONDS = 2_400;
export const SESSION_TIMEOUT_SECONDS = 86_400;
export const JOB_TASK_PLAN = "flex" as const;
