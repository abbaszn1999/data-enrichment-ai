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
