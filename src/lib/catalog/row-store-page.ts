/** PostgREST returns at most 1,000 rows unless the query pages with `.range()`. */
export const ROW_STORE_READ_PAGE = 1_000;

export async function loadAllOrderedRows<T>(params: {
  fetchPage: (from: number, to: number) => Promise<T[]>;
  pageSize?: number;
}): Promise<T[]> {
  const pageSize = params.pageSize ?? ROW_STORE_READ_PAGE;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const batch = await params.fetchPage(from, from + pageSize - 1);
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}
