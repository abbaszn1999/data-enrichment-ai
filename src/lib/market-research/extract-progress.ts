/** Absolute row count for an extract run after one poll page. */
export function nextRowsReturned(
  existing: number,
  cursor: string | undefined,
  batchSize: number
): number {
  const offset = Math.max(0, Number.parseInt(cursor ?? "0", 10) || 0);
  const pageEnd = offset + Math.max(0, Math.floor(batchSize));
  return Math.max(Math.max(0, Math.floor(existing) || 0), pageEnd);
}
