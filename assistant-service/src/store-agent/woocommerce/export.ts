import { wooRequest, type WooConnection } from "./client";

const PER_PAGE = 100;
const CONCURRENCY = 4;
export const MAX_EXPORT_RECORDS = 100_000;

/** Read every page of a list route, four pages at a time. */
export async function exportWooList(
  conn: WooConnection,
  path: string,
  query: Record<string, unknown>,
  signal?: AbortSignal
): Promise<{ records: Array<Record<string, unknown>>; total: number | null; truncated: boolean }> {
  const page = async (n: number) => {
    const res = await wooRequest(conn, { method: "GET", path, query: { ...query, per_page: PER_PAGE, page: n } }, signal);
    if (!res.ok) throw new Error(`Page ${n} failed: ${res.message ?? res.status}`);
    return res;
  };
  const first = await page(1);
  const records = [...((Array.isArray(first.data) ? first.data : []) as Array<Record<string, unknown>>)];
  const pages = Math.min(first.totalPages ?? 1, Math.ceil(MAX_EXPORT_RECORDS / PER_PAGE));
  const rest = Array.from({ length: Math.max(0, pages - 1) }, (_, i) => i + 2);
  const results = new Map<number, Array<Record<string, unknown>>>();
  let next = 0;
  const worker = async () => {
    while (next < rest.length) {
      const n = rest[next++]!;
      const res = await page(n);
      results.set(n, (Array.isArray(res.data) ? res.data : []) as Array<Record<string, unknown>>);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rest.length) }, worker));
  for (const n of rest) records.push(...(results.get(n) ?? []));
  return { records, total: first.total, truncated: (first.totalPages ?? 1) > pages };
}

/** Columns that are noise in a table. */
const SKIP = new Set(["_links", "price_html", "related_ids", "srcset", "sizes", "_embedded"]);
const FIRST = ["id", "parent_id", "name", "sku", "type", "status", "regular_price", "sale_price", "price", "stock_status", "stock_quantity"];

function cell(field: string, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) {
    if (field === "images") return value.map((i) => (i as { src?: string }).src ?? "").filter(Boolean).join(" | ");
    if (field === "attributes") {
      return value
        .map((a) => {
          const attr = a as { name?: string; option?: string; options?: string[] };
          return `${attr.name}: ${attr.option ?? (attr.options ?? []).join("/")}`;
        })
        .join("; ");
    }
    if (field === "meta_data") return value.map((m) => `${(m as { key: string }).key}=${JSON.stringify((m as { value: unknown }).value)}`).join("; ");
    if (value.every((v) => v && typeof v === "object" && "name" in (v as object))) return value.map((v) => (v as { name: string }).name).join(" | ");
    return value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(" | ");
  }
  if (field === "dimensions") {
    const d = value as { length?: string; width?: string; height?: string };
    return [d.length, d.width, d.height].some(Boolean) ? `${d.length || "-"}x${d.width || "-"}x${d.height || "-"}` : "";
  }
  if (field === "image") return (value as { src?: string }).src ?? "";
  return JSON.stringify(value);
}

const csvCell = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** One row per record, one column per top-level field (lists joined, links dropped). */
export function wooRecordsToCsv(records: Array<Record<string, unknown>>): { csv: string; columns: string[] } {
  const seen = new Set<string>();
  for (const r of records) for (const k of Object.keys(r)) if (!SKIP.has(k)) seen.add(k);
  const columns = [...FIRST.filter((c) => seen.has(c)), ...[...seen].filter((c) => !FIRST.includes(c))];
  const lines = [columns.join(",")];
  for (const r of records) lines.push(columns.map((c) => csvCell(cell(c, r[c]))).join(","));
  return { csv: lines.join("\n"), columns };
}
