import {
  ENRICH_CHECKPOINT_MS,
  ENRICH_CHECKPOINT_ROWS,
  WORKSHEET_CHECKPOINT_MS,
  WORKSHEET_CHECKPOINT_ROWS,
} from "./config";

export type CheckpointPolicy = {
  everyRows: number;
  everyMs: number;
};

export const ENRICH_CHECKPOINT: CheckpointPolicy = {
  everyRows: ENRICH_CHECKPOINT_ROWS,
  everyMs: ENRICH_CHECKPOINT_MS,
};

export const WORKSHEET_CHECKPOINT: CheckpointPolicy = {
  everyRows: WORKSHEET_CHECKPOINT_ROWS,
  everyMs: WORKSHEET_CHECKPOINT_MS,
};

/**
 * Two-tier persistence gate: hot state (heartbeats) can fire every row;
 * cold state (the full storage artifact) flushes on a row/time budget or
 * on an explicit terminal force.
 */
export function createCheckpointGate(policy: CheckpointPolicy) {
  let rowsSinceFlush = 0;
  let lastFlushAt = Date.now();
  let dirty = false;

  return {
    markDirty() {
      dirty = true;
    },
    noteCompletedRow() {
      dirty = true;
      rowsSinceFlush += 1;
    },
    shouldFlush(force = false): boolean {
      if (!dirty) return false;
      if (force) return true;
      if (rowsSinceFlush >= policy.everyRows) return true;
      if (Date.now() - lastFlushAt >= policy.everyMs) return true;
      return false;
    },
    markFlushed() {
      rowsSinceFlush = 0;
      lastFlushAt = Date.now();
      dirty = false;
    },
  };
}
