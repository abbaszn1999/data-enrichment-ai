/**
 * Image Finder tier comparison: runs the same sheet through Standard,
 * Premium and Exact Match and writes one Excel workbook with a per-tier
 * results sheet plus a side-by-side comparison — found rate, images per
 * found row, images independently confirmed loading right now, cost per
 * row, and (Exact Match only) how many rows made a SearchApi call. This is
 * the evidence a decision about retiring Premium should be based on, not a
 * production path — it calls `enrichRow` directly (no credit charging, no
 * job/session plumbing) and spends real OpenAI + SearchApi credits.
 *
 * Usage:
 *   node --env-file=.env --import tsx scripts/image-finder-tier-compare-lab.ts \
 *     --file="C:\path\to\sheet.xlsx" [--rows=20] [--only=1,5] \
 *     [--concurrency=4] [--tiers=standard,premium,exact] [--images=7] [--out=<dir>]
 */
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { enrichRow } from "@/lib/enrich";
import { billedCostsOf } from "@/lib/enrich/openai";
import { imageFinderMatchBasisKey, imageFinderNotFoundKey } from "@/lib/enrich/image-finder/not-found";
import { verifyImageUrl } from "@/lib/enrich/image-finder/verify-images";
import { mapLimit } from "@/lib/async/map-limit";
import type { AiCallCost } from "@/lib/ai-pricing";
import { sumCosts } from "@/lib/ai-pricing";
import type { EnrichmentModel } from "@/types";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.length ? rest.join("=") : "true"];
  })
) as Record<string, string>;

const rowLimit = Number(args.rows || 20);
const concurrency = Number(args.concurrency || 4);
const imageCount = Number(args.images || 7);
const only = args.only ? new Set(args.only.split(",").map(Number)) : null;
const tiers = (args.tiers ? args.tiers.split(",") : ["standard", "premium", "exact"]) as EnrichmentModel[];
const outDir =
  args.out ||
  path.join("C:\\Users\\abbas\\Desktop\\image-finder-trial", `tier-compare-${new Date().toISOString().replace(/[:.]/g, "-")}`);

interface SheetRow {
  rowIndex: number;
  originalData: Record<string, string>;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const v = value as { text?: string; result?: unknown; richText?: Array<{ text: string }>; hyperlink?: string };
    return String(v.text ?? v.result ?? v.richText?.map((r) => r.text).join("") ?? v.hyperlink ?? "");
  }
  return String(value);
}

/** Reads the first worksheet of an .xlsx file as a sheet: header row = columns (same convention as image-finder-lab.ts). */
async function loadSheetFile(file: string): Promise<{ columns: string[]; rows: SheetRow[] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const sheet = workbook.worksheets[0]!;
  const header = (sheet.getRow(1).values as ExcelJS.CellValue[]).slice(1).map((v, i) => cellText(v).trim() || `Column ${i + 1}`);
  const rows: SheetRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r += 1) {
    const values = (sheet.getRow(r).values as ExcelJS.CellValue[]).slice(1);
    const originalData: Record<string, string> = {};
    header.forEach((column, index) => {
      const text = cellText(values[index]).trim();
      if (text) originalData[column] = text;
    });
    if (Object.keys(originalData).length === 0) continue;
    rows.push({ rowIndex: r - 2, originalData });
  }
  return { columns: header, rows };
}

interface RowResult {
  row: SheetRow;
  tier: EnrichmentModel;
  ok: boolean;
  images: Array<{ imageUrl: string; pageUrl: string }>;
  loadingNow: number;
  matchBasis: string;
  notFoundReason: string;
  errorMessage: string;
  costs: AiCallCost[];
  seconds: number;
}

async function runOneRow(row: SheetRow, tier: EnrichmentModel, columns: string[]): Promise<RowResult> {
  const started = Date.now();
  const params = {
    productData: row.originalData,
    enabledColumns: ["imageUrls"],
    enrichmentColumns: [
      {
        id: "imageUrls",
        label: "Image URLs",
        description: "",
        type: "imageUrls" as const,
        enabled: true,
        imageCount,
      },
    ],
    settings: { enrichmentModel: tier, outputLanguage: "English" },
    kind: "product" as const,
    sourceColumns: columns,
  };

  let costs: AiCallCost[] = [];
  let images: Array<{ imageUrl: string; pageUrl: string }> = [];
  let matchBasis = "";
  let notFoundReason = "";
  let errorMessage = "";
  let ok = true;
  try {
    const result = await enrichRow(params);
    costs = result.costs;
    images = (result.data.imageUrls as Array<{ imageUrl: string; pageUrl: string }>) ?? [];
    matchBasis = String(result.data[imageFinderMatchBasisKey("imageUrls")] ?? "");
    notFoundReason = String(result.data[imageFinderNotFoundKey("imageUrls")] ?? "");
  } catch (error) {
    ok = false;
    costs = billedCostsOf(error);
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  const loadable = await mapLimit(images, 4, async (image): Promise<number> => ((await verifyImageUrl(image.imageUrl)) ? 1 : 0));
  const loadingNow = loadable.reduce((sum, value) => sum + value, 0);

  return {
    row,
    tier,
    ok,
    images,
    loadingNow,
    matchBasis,
    notFoundReason,
    errorMessage,
    costs,
    seconds: Math.round((Date.now() - started) / 1000),
  };
}

async function main() {
  if (!args.file) throw new Error("Usage: --file=<path to .xlsx sheet> is required");
  fs.mkdirSync(outDir, { recursive: true });

  const { columns, rows: allRows } = await loadSheetFile(args.file);
  const rows = allRows.slice(0, rowLimit).filter((row) => !only || only.has(row.rowIndex + 1));

  console.log(`=== Image Finder tier comparison: ${rows.length} rows, tiers [${tiers.join(", ")}], concurrency ${concurrency}`);
  console.log(`output: ${outDir}\n`);

  const byTier = new Map<EnrichmentModel, RowResult[]>();
  for (const tier of tiers) {
    console.log(`--- ${tier} ---`);
    const results = await mapLimit(rows, concurrency, async (row) => {
      const result = await runOneRow(row, tier, columns);
      const summary = sumCosts(result.costs);
      const searchApiTag = summary.breakdown.searchApiCost > 0 ? " +searchapi" : "";
      console.log(
        `row ${String(row.rowIndex + 1).padStart(3)} ${tier.padEnd(8)} ${
          result.ok ? (result.images.length ? `FOUND ${result.images.length} img (${result.loadingNow} load now)` : "not found") : `ERROR ${result.errorMessage}`
        } ${result.seconds}s $${summary.totalCost.toFixed(4)}${searchApiTag}`
      );
      return result;
    });
    byTier.set(tier, results);
  }

  await writeReport(rows, columns, byTier);
}

async function writeReport(rows: SheetRow[], columns: string[], byTier: Map<EnrichmentModel, RowResult[]>) {
  const workbook = new ExcelJS.Workbook();
  const summaryByTier = new Map<
    EnrichmentModel,
    { found: number; images: number; loadingNow: number; cost: number; searchApiCalls: number; errors: number }
  >();

  for (const [tier, results] of byTier) {
    const sheet = workbook.addWorksheet(tier);
    sheet.addRow(["Row", ...columns, "Status", "Images", "Loading now", "Match basis", "Notes / reason", "Seconds", "Cost $", "SearchApi"]);
    sheet.getRow(1).font = { bold: true };

    let found = 0;
    let images = 0;
    let loadingNow = 0;
    let cost = 0;
    let searchApiCalls = 0;
    let errors = 0;

    for (const result of results) {
      const summary = sumCosts(result.costs);
      const isFound = result.images.length > 0;
      if (isFound) found += 1;
      if (!result.ok) errors += 1;
      images += result.images.length;
      loadingNow += result.loadingNow;
      cost += summary.totalCost;
      const usedSearchApi = summary.breakdown.searchApiCost > 0;
      if (usedSearchApi) searchApiCalls += 1;

      const added = sheet.addRow([
        result.row.rowIndex + 1,
        ...columns.map((c) => result.row.originalData[c] ?? ""),
        !result.ok ? "Error" : isFound ? "Found" : "Not found",
        result.images.length,
        result.loadingNow,
        result.matchBasis,
        result.ok ? result.notFoundReason : result.errorMessage,
        result.seconds,
        Number(summary.totalCost.toFixed(4)),
        usedSearchApi ? "yes" : "",
      ]);
      const statusCell = added.getCell(columns.length + 2);
      const good = isFound && result.ok;
      statusCell.font = { bold: true, color: { argb: good ? "FF1B7F3B" : "FFC62828" } };
      statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: good ? "FFE6F4EA" : "FFFDECEA" } };
    }

    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.columns.forEach((column, index) => {
      column.width = index === 0 ? 6 : 20;
    });

    summaryByTier.set(tier, { found, images, loadingNow, cost, searchApiCalls, errors });
  }

  const comparison = workbook.addWorksheet("Comparison", { views: [{ state: "frozen", ySplit: 1 }] });
  comparison.addRow(["Tier", "Rows", "Found", "Found rate", "Images", "Avg images / found row", "Loading now", "Errors", "Total cost $", "Avg cost / row $", "SearchApi calls"]);
  comparison.getRow(1).font = { bold: true };
  for (const [tier, results] of byTier) {
    const s = summaryByTier.get(tier)!;
    comparison.addRow([
      tier,
      results.length,
      s.found,
      results.length ? `${((s.found / results.length) * 100).toFixed(0)}%` : "-",
      s.images,
      s.found ? (s.images / s.found).toFixed(2) : "-",
      s.loadingNow,
      s.errors,
      Number(s.cost.toFixed(4)),
      results.length ? Number((s.cost / results.length).toFixed(4)) : 0,
      s.searchApiCalls,
    ]);
  }
  comparison.columns.forEach((column, index) => {
    column.width = index === 0 ? 12 : 18;
  });

  const file = path.join(outDir, "image-finder-tier-compare.xlsx");
  await workbook.xlsx.writeFile(file);

  console.log(`\n=== COMPARISON`);
  for (const [tier, results] of byTier) {
    const s = summaryByTier.get(tier)!;
    console.log(
      `${tier.padEnd(8)} found ${s.found}/${results.length} (${results.length ? ((s.found / results.length) * 100).toFixed(0) : 0}%)  images ${s.images} (loading now ${s.loadingNow})  cost $${s.cost.toFixed(2)} ($${(s.cost / Math.max(1, results.length)).toFixed(4)}/row)  searchApi calls ${s.searchApiCalls}  errors ${s.errors}`
    );
  }
  console.log(`\nreport: ${file}`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
