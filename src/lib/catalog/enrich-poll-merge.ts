/**
 * Merge a polled catalog snapshot with an in-flight enrich run.
 *
 * Same class of bug Gallery/Visualizer already guard: a background refetch
 * of durable storage must not clobber local "this row is working" UI.
 * Storage never persists `processing` — only pending/done/error — so the
 * job run (target_ids minus checkpointed processedRowIds) is the overlay.
 *
 * processedRowIds is written only on cold checkpoints together with the
 * blob, so a row leaves the overlay only when the new text is actually
 * on disk. See TanStack Query cancelQueries / stale-refetch guidance and
 * mergePolledGenerationRow.
 */

export type CatalogPollRun = {
  id?: string;
  status?: string | null;
  completed_count?: number;
  failed_count?: number;
  target_ids?: string[] | null;
  last_error?: string | null;
  /** Stop was pressed; in-flight rows are finishing before the run ends. */
  cancel_requested?: boolean;
  settings?: {
    processedRowIds?: string[] | null;
    enabledColumns?: string[] | null;
  } | null;
};

export function catalogEnrichingContextFromRun(run: CatalogPollRun | null | undefined): {
  tab: "new" | "existing";
  existingColumns: string[];
  newColumns: string[];
} {
  const enabled = (run?.settings?.enabledColumns ?? []).map(String);
  const existingColumns = enabled
    .filter((id) => id.startsWith("existing__"))
    .map((id) => id.slice("existing__".length));
  if (existingColumns.length > 0) {
    return { tab: "existing", existingColumns, newColumns: [] };
  }
  return { tab: "new", existingColumns: [], newColumns: enabled };
}

/**
 * How many of this run's rows are actually finished, from persisted row
 * statuses: rows the run recorded as processed (it records each one right
 * after that row's result is saved) that are now done or failed. Rows that
 * were already done before this run started — e.g. a Premium retry of
 * Not-found rows — only count once this run has processed them again.
 */
export function catalogRunFinishedCounts(
  rows: Array<{ id: string; status: string }>,
  run: CatalogPollRun | null | undefined
): { done: number; failed: number } {
  const processed = run?.settings?.processedRowIds;
  if (!run || !Array.isArray(processed)) {
    return { done: run?.completed_count ?? 0, failed: run?.failed_count ?? 0 };
  }
  const statusById = new Map(rows.map((row) => [row.id, row.status]));
  let done = 0;
  let failed = 0;
  for (const id of new Set(processed.map(String))) {
    const status = statusById.get(id);
    if (status === "done") done += 1;
    else if (status === "error") failed += 1;
  }
  return { done, failed };
}

/**
 * How long to wait before asking the server about a running enrichment again.
 * Every open tab with a running job asks, so the interval is the platform's
 * request load: a fresh run (or a tab just brought back to the front) checks
 * often, and a long run settles into a slower rhythm. A failed check backs
 * off further, up to 20 seconds.
 */
export function enrichPollDelayMs(elapsedMs: number, failures: number): number {
  const base = elapsedMs < 120_000 ? 5_000 : elapsedMs < 600_000 ? 8_000 : 12_000;
  return failures === 0 ? base : Math.min(base * 2 ** failures, 20_000);
}

export function isCatalogEnrichRunActive(
  status: string | null | undefined
): boolean {
  return status === "queued" || status === "running";
}

export function catalogPollShouldApplySnapshot(params: {
  epoch: number;
  currentEpoch: number;
  localRunId: string | null;
  locallyEnriching: boolean;
  run: Pick<CatalogPollRun, "id" | "status"> | null | undefined;
}): "apply" | "ignore" {
  if (params.epoch !== params.currentEpoch) return "ignore";

  if (isCatalogEnrichRunActive(params.run?.status)) return "apply";

  const incomingId = params.run?.id ?? null;
  if (params.localRunId) {
    return incomingId === params.localRunId ? "apply" : "ignore";
  }
  if (params.locallyEnriching) return "ignore";
  return "apply";
}

export function overlayCatalogRowsForActiveRun<
  T extends { id: string; status: string },
>(rows: T[], run: CatalogPollRun | null | undefined): T[] {
  if (!run || !isCatalogEnrichRunActive(run.status)) return rows;

  const targets = new Set((run.target_ids ?? []).map(String));
  if (targets.size === 0) return rows;

  const processed = new Set(
    (run.settings?.processedRowIds ?? []).map(String)
  );

  let changed = false;
  const next = rows.map((row) => {
    if (!targets.has(row.id) || processed.has(row.id)) return row;
    if (row.status === "processing") return row;
    changed = true;
    return { ...row, status: "processing" as T["status"] };
  });
  return changed ? next : rows;
}
