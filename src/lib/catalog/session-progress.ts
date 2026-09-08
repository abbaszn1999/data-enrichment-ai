/**
 * True while Catalog Intelligence is actually working in the background.
 * Matching / Rules / Review drafts are unfinished, not processing.
 */
export function catalogSessionIsActivelyProcessing(
  session: { id?: string | null; status?: string | null },
  activeJobSessionIds?: Set<string>
): boolean {
  if (session.status === "enriching") return true;
  const id = session.id;
  return Boolean(id && activeJobSessionIds?.has(id));
}

/** Uploaded but not Ready — includes idle Rules/Review drafts. */
export function catalogSessionIsUnfinished(session: {
  status?: string | null;
}): boolean {
  return session.status !== "completed" && session.status !== "cancelled";
}

/**
 * Catalog Intelligence list cards: progress is how much of the sheet is
 * actually enriched, not whether the last enrich job finished.
 */
export function catalogSessionProgress(session: {
  status?: string | null;
  total_rows?: number | null;
  enriched_count?: number | null;
}): number {
  if (session.status === "cancelled") return 0;

  const totalRows = session.total_rows || 0;
  if (totalRows <= 0) {
    if (session.status === "enriching") return 40;
    if (session.status === "review") return 25;
    if (session.status === "rules" || session.status === "matching") return 10;
    return 0;
  }

  const enriched = session.enriched_count || 0;
  if (enriched >= totalRows) return 100;
  return Math.min(99, Math.round((enriched / totalRows) * 100));
}
