import { OPTION_FIELD, buildPlatformCsv, isPlatformId, type PlatformId } from "@/lib/catalog/platforms";
import type { ExportMode, PlatformMapping } from "@/lib/catalog/platforms/types";
import { splitUrlList } from "@/lib/jobs/row-sources";
import type { TableExport } from "@/lib/export/table-file";

/** How long image links in a store import file stay valid (the store downloads them on import). */
export const PLATFORM_IMAGE_LINK_TTL_SEC = 7 * 24 * 60 * 60;

export type TablePlatformOptions = {
  platform: PlatformId;
  mode: ExportMode;
  mapping: PlatformMapping;
  /** Typed wizard values, e.g. a store picture link (setting id → value). */
  settings: Record<string, string>;
};

const MODES: ExportMode[] = ["products", "images", "description"];

function stringRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (typeof item === "string" && item) out[key] = item;
    }
  }
  return out;
}

/** Reads `platform`, `mode`, `mapping` and `settings` from an export request; null = a plain table export. */
export function parseTablePlatformOptions(body: {
  platform?: unknown;
  mode?: unknown;
  mapping?: unknown;
  settings?: unknown;
}): TablePlatformOptions | null {
  if (typeof body.platform !== "string" || !isPlatformId(body.platform)) return null;
  const mode = MODES.find((item) => item === body.mode) ?? "products";
  return { platform: body.platform, mode, mapping: stringRecord(body.mapping), settings: stringRecord(body.settings) };
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
