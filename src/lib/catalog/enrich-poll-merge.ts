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
  settings?: {
    processedRowIds?: string[] | null;
    enabledColumns?: string[] | null;
  } | null;
};

export function catalogEnrichingContextFromRun(run: CatalogPollRun | null | undefined): {
  tab: "new" | "existing";
  existingColumns: string[];
} {
  const enabled = (run?.settings?.enabledColumns ?? []).map(String);
  const existingColumns = enabled
    .filter((id) => id.startsWith("existing__"))
    .map((id) => id.slice("existing__".length));
  if (existingColumns.length > 0) {
    return { tab: "existing", existingColumns };
  }
  return { tab: "new", existingColumns: [] };
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
