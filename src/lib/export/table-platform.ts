import { OPTION_FIELD, buildPlatformCsv, isPlatformId, type PlatformId } from "@/lib/catalog/platforms";
import type { ExportMode, PlatformMapping } from "@/lib/catalog/platforms/types";
import { splitUrlList } from "@/lib/jobs/row-sources";
import type { TableExport } from "@/lib/export/table-file";

/** How long image links in a store import file stay valid (the store downloads them on import). */
export const PLATFORM_IMAGE_LINK_TTL_SEC = 7 * 24 * 60 * 60;

export type TablePlatformOptions = { platform: PlatformId; mode: ExportMode; mapping: PlatformMapping };

/** Reads `platform`, `mode` and `mapping` from an export request; null = a plain table export. */
export function parseTablePlatformOptions(body: {
  platform?: unknown;
  mode?: unknown;
  mapping?: unknown;
}): TablePlatformOptions | null {
  if (typeof body.platform !== "string" || !isPlatformId(body.platform)) return null;
  const mapping: PlatformMapping = {};
  if (body.mapping && typeof body.mapping === "object") {
    for (const [field, column] of Object.entries(body.mapping as Record<string, unknown>)) {
      if (typeof column === "string" && column) mapping[field] = column;
    }
  }
  return { platform: body.platform, mode: body.mode === "images" ? "images" : "products", mapping };
}

/**
 * Store import CSV from a flat export table: mapping values are table headers,
 * every row is one product, and image cells hold one link per line.
 */
export async function serializeTablePlatformExport(
  table: TableExport,
  options: TablePlatformOptions
): Promise<{ buffer: Buffer; contentType: string; extension: "csv" }> {
  const index = new Map(table.headers.map((header, i) => [header, i]));
  const cell = (row: string[], key: string) => row[index.get(key) ?? -1] ?? "";
  const csv = await buildPlatformCsv(
    options.platform,
    {
      products: table.rows.map((row) => [row]),
      mapping: options.mapping,
      // Table headers are the column names, so the mapped header names the option.
      optionName: options.mapping[OPTION_FIELD[options.platform]],
      text: cell,
      images: (row, key) => splitUrlList(cell(row, key)),
    },
    options.mode
  );
  return { buffer: Buffer.from(csv, "utf8"), contentType: "text/csv; charset=utf-8", extension: "csv" };
}
