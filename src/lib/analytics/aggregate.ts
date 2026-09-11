import type { GscPageRow, GscTimeSeriesRow } from "./types";

export function totalsFromGscPages(pages: GscPageRow[]) {
  if (!pages.length) {
    return { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  }
  const clicks = pages.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = pages.reduce((sum, row) => sum + row.impressions, 0);
  const ctr = pages.reduce((sum, row) => sum + row.ctr, 0) / pages.length;
  const position = pages.reduce((sum, row) => sum + row.position, 0) / pages.length;
  return { clicks, impressions, ctr, position };
}

export function aggregateGscTimeSeriesByDate(
  rows: Array<{ date: string; clicks: number; impressions: number }>
): GscTimeSeriesRow[] {
  const byDate = new Map<string, { clicks: number; impressions: number }>();
  for (const row of rows) {
    if (!row.date) continue;
    const current = byDate.get(row.date) ?? { clicks: 0, impressions: 0 };
    current.clicks += row.clicks;
    current.impressions += row.impressions;
    byDate.set(row.date, current);
  }
  return [...byDate.entries()]
    .map(([date, metrics]) => ({
      date,
      clicks: metrics.clicks,
      impressions: metrics.impressions,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
