/**
 * Image Finder quality gate: runs the production Image Finder path
 * (processCatalogRow, minus the credit charge) on the first N rows of a
 * Catalog Intelligence session, with the same sheet learning and final
 * re-check the job runner uses, and writes an Excel report (Results +
 * Research log) plus one JSON trace per row. Every run spends real OpenAI
 * credits.
 *
 * Usage:
 *   node --env-file=.env --import tsx scripts/image-finder-lab.ts \
 *     [--session=<id>] [--rows=30] [--only=2,16] [--concurrency=6] \
 *     [--allow=toys4less.com] [--instruction="..."] [--images=3] [--out=<dir>]
 */
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { createAdminClient } from "@/lib/supabase-admin";
import { loadProjectJsonAdmin } from "@/lib/jobs/project-json";
import { processCatalogRow, type EnrichRowOutcome } from "@/lib/jobs/enrich-row";
import { OPENAI_RESPONSES_URL } from "@/lib/enrich/openai";
import { imageFinderMatchBasisKey, imageFinderMatchNoteKey } from "@/lib/enrich/image-finder/not-found";
import { rowsNeedingRecheck, SheetDomainLearner } from "@/lib/enrich/image-finder/sheet-learning";
import { extractRowIdentifiers, normalizeCode } from "@/lib/enrich/image-finder/tools/identifiers";
import type { CatalogJobSettings } from "@/lib/jobs/types";
import type { ProjectRow } from "@/lib/storage-helpers";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.length ? rest.join("=") : "true"];
  })
) as Record<string, string>;
const sessionId = args.session || "6d7a8c3c-f455-4f8c-9bf4-896644e9632d";
const rowLimit = Number(args.rows || 30);
const concurrency = Number(args.concurrency || 6);
const allowed = args.allow ? args.allow.split(",").map((d) => d.trim()).filter(Boolean) : [];
const label = allowed.length ? `allow-${allowed.join("+")}` : "open-web";
const outDir =
  args.out ||
  path.join("C:\\Users\\abbas\\Desktop\\image-finder-trial", `v2-${label}-${new Date().toISOString().replace(/[:.]/g, "-")}`);

type Item = Record<string, unknown>;
type Trace = { rounds: Array<{ request: Item; response?: Item }>; http: Array<{ method: string; url: string; status: number | string }> };
const traceStore = new AsyncLocalStorage<Trace>();

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const trace = traceStore.getStore();
  if (url === OPENAI_RESPONSES_URL) {
    const round = { request: JSON.parse(String(init?.body ?? "{}")) as Item, response: undefined as Item | undefined };
    trace?.rounds.push(round);
    const response = await realFetch(input, init);
    try {
      round.response = JSON.parse(await response.clone().text());
    } catch {
      round.response = { raw: "unparseable" };
    }
    return response;
  }
  try {
    const response = await realFetch(input, init);
    trace?.http.push({ method: (init?.method || "GET").toUpperCase(), url, status: response.status });
    return response;
  } catch (error) {
    trace?.http.push({ method: (init?.method || "GET").toUpperCase(), url, status: `ERR ${(error as Error).message}` });
    throw error;
  }
}) as typeof fetch;

function summarize(trace: Trace) {
  const searches: string[] = [];
  const calls = new Map<string, { name: string; args: string }>();
  const pages: string[] = [];
  const viewed: string[] = [];
  for (const [index, round] of trace.rounds.entries()) {
    if (index > 0) {
      for (const item of (round.request.input as Item[]) ?? []) {
        if (item.type !== "function_call_output") continue;
        const call = calls.get(String(item.call_id));
        if (!call) continue;
        const parsedArgs = JSON.parse(call.args || "{}");
        if (call.name === "fetch_page") {
          let seen = "";
          try {
            const output = JSON.parse(String(item.output));
            seen = output.error ? `error: ${output.error}` : `status ${output.status}, ids seen: ${(output.rowIdentifiersSeen ?? []).join(" ") || "-"}`;
          } catch {
            seen = "?";
          }
          pages.push(`${parsedArgs.url} → ${seen}`);
        } else if (call.name === "check_pages") {
          try {
            const output = JSON.parse(String(item.output)) as { pages?: Array<Record<string, unknown>> };
            for (const page of output.pages ?? []) {
              const ids = (page.rowIdentifiersSeen as string[] | undefined) ?? [];
              const near = (page.nearCodesSeen as string[] | undefined) ?? [];
              pages.push(
                `[check] ${page.url} → ${page.error ? `error: ${page.error}` : `status ${page.status}, ids seen: ${ids.join(" ") || "-"}${near.length ? `, near: ${near.join(" ")}` : ""}`}`
              );
            }
          } catch {
            pages.push(`[check] ${(parsedArgs.urls ?? []).join(" ")} → ?`);
          }
        } else if (call.name === "view_images") {
          viewed.push(...(parsedArgs.urls ?? []));
        }
      }
    }
    for (const item of (round.response?.output as Item[]) ?? []) {
      if (item.type === "web_search_call") {
        const action = (item.action as Item) ?? {};
        if (action.type === "search") searches.push(String(action.queries ? (action.queries as string[]).join(" | ") : action.query ?? ""));
      } else if (item.type === "function_call") {
        calls.set(String(item.call_id), { name: String(item.name), args: String(item.arguments) });
      }
    }
  }
  const last = trace.rounds.at(-1)?.response;
  const text = ((last?.output as Item[]) ?? [])
    .flatMap((item) => (item.content as Array<{ type?: string; text?: string }>) ?? [])
    .filter((c) => c.type === "output_text")
    .map((c) => c.text)
    .join("");
  let answer: Item = {};
  try {
    answer = JSON.parse(text);
  } catch {
    answer = {};
  }
  return { searches, pages, viewed, answer, rounds: trace.rounds.length };
}

interface RowRun {
  row: ProjectRow;
  pass: "first" | "recheck";
  outcome: EnrichRowOutcome;
  seconds: number;
  summary: ReturnType<typeof summarize>;
  learnedDomains: string[];
}

async function runRow(
  row: ProjectRow,
  settings: CatalogJobSettings,
  workspaceId: string,
  context: { learnedDomains?: string[]; recheck?: boolean }
): Promise<RowRun> {
  const trace: Trace = { rounds: [], http: [] };
  const started = Date.now();
  const outcome = await traceStore.run(trace, () =>
    processCatalogRow({ sessionId, workspaceId, row, settings, context })
  );
  const run: RowRun = {
    row,
    pass: context.recheck ? "recheck" : "first",
    outcome,
    seconds: Math.round((Date.now() - started) / 1000),
    summary: summarize(trace),
    learnedDomains: context.learnedDomains ?? [],
  };
  fs.writeFileSync(
    path.join(outDir, `row-${String(row.rowIndex + 1).padStart(2, "0")}${context.recheck ? "-recheck" : ""}.json`),
    JSON.stringify({ row: row.originalData, context, outcome, summary: run.summary, trace }, null, 2)
  );
  if (!outcome.ok && (outcome.providerUnavailable || /no credits remaining|insufficient_quota/i.test(outcome.error))) {
    outOfOpenAiCredits = true;
    console.log("OpenAI account is out of credits — stopping the run.");
  }
  const images = outcome.ok ? ((outcome.data.imageUrls as unknown[]) ?? []).length : 0;
  console.log(
    `row ${String(row.rowIndex + 1).padStart(2)} ${run.pass.padEnd(7)} ${outcome.ok ? (images ? `FOUND ${images} img` : "not found") : `ERROR ${outcome.error}`}  ${run.seconds}s  rounds=${run.summary.rounds} searches=${run.summary.searches.length} pages=${run.summary.pages.length}${outcome.ok ? ` $${outcome.cost.toFixed(3)}` : ""}`
  );
  return run;
}

let outOfOpenAiCredits = false;

async function pool<T>(items: T[], size: number, worker: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length && !outOfOpenAiCredits) {
        const item = items[next]!;
        next += 1;
        await worker(item);
      }
    })
  );
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

/** Reads the first worksheet of an .xlsx file as a sheet: header row = columns. */
async function loadSheetFile(file: string): Promise<{ name: string; columns: string[]; rows: ProjectRow[] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const sheet = workbook.worksheets[0]!;
  const header = (sheet.getRow(1).values as ExcelJS.CellValue[]).slice(1).map((v, i) => cellText(v).trim() || `Column ${i + 1}`);
  const rows: ProjectRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r += 1) {
    const values = (sheet.getRow(r).values as ExcelJS.CellValue[]).slice(1);
    const originalData: Record<string, string> = {};
    header.forEach((column, index) => {
      const text = cellText(values[index]).trim();
      if (text) originalData[column] = text;
    });
    if (Object.keys(originalData).length === 0) continue;
    rows.push({ id: `row-${r - 1}`, rowIndex: r - 2, originalData, enrichedData: {}, status: "pending" } as unknown as ProjectRow);
  }
  return { name: path.basename(file), columns: header, rows };
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const admin = createAdminClient();
  const source = args.file
    ? await loadSheetFile(args.file)
    : await (async () => {
        const { data: session } = await admin.from("catalog_sessions").select("id, workspace_id, name").eq("id", sessionId).single();
        if (!session) throw new Error("Session not found");
        const project = await loadProjectJsonAdmin(session.workspace_id, sessionId, admin);
        if (!project) throw new Error("Project not found");
        return { name: session.name as string, columns: project.columns, rows: project.rows, workspaceId: session.workspace_id as string };
      })();
  const session = { name: source.name, workspace_id: ("workspaceId" in source ? source.workspaceId : "lab") as string };
  const project = { columns: source.columns, rows: source.rows };

  const only = args.only ? new Set(args.only.split(",").map(Number)) : null;
  const rows = [...project.rows]
    .sort((a, b) => a.rowIndex - b.rowIndex)
    .slice(0, rowLimit)
    .filter((row) => !only || only.has(row.rowIndex + 1));

  const settings: CatalogJobSettings = {
    kind: "product",
    enabledColumns: ["imageUrls"],
    enrichmentColumns: [
      {
        id: "imageUrls",
        label: "Image URLs",
        description: "",
        type: "imageUrls",
        imageCount: Number(args.images || 3),
        customInstruction: args.instruction || "",
        allowedDomains: allowed,
        blockedDomains: [],
      },
    ],
    enrichmentModel: "premium",
    sourceColumns: project.columns,
    ownerUserId: "lab",
    actorUserId: "lab",
  };

  console.log(`=== Image Finder quality gate: ${session.name}, ${rows.length} rows, ${label}, concurrency ${concurrency}`);
  console.log(`output: ${outDir}\n`);

  const learner = new SheetDomainLearner();
  const tried = new Map<string, string[]>();
  const results = new Map<string, RowRun>();
  await pool(rows, concurrency, async (row) => {
    const learnedDomains = learner.top();
    tried.set(row.id, learnedDomains);
    const run = await runRow(row, settings, session.workspace_id, learnedDomains.length ? { learnedDomains } : {});
    results.set(row.id, run);
    if (run.outcome.ok) learner.addRow(run.outcome.data);
  });

  const learnedDomains = learner.top();
  const recheckIds = rowsNeedingRecheck({
    rows: rows.map((row) => {
      const run = results.get(row.id);
      return { id: row.id, status: run?.outcome.ok ? "done" : "error", enrichedData: run?.outcome.ok ? run.outcome.data : {} };
    }),
    targetIds: rows.map((row) => row.id),
    rechecked: new Set(),
    learnedDomains,
    domainsTriedByRow: tried,
  });
  if (recheckIds.length > 0) {
    console.log(`\nFinal re-check of ${recheckIds.length} row(s) on: ${learnedDomains.join(", ")}`);
    await pool(recheckIds, concurrency, async (rowId) => {
      const row = rows.find((r) => r.id === rowId)!;
      const run = await runRow(row, settings, session.workspace_id, { learnedDomains, recheck: true });
      if (run.outcome.ok) {
        results.set(row.id, run);
        learner.addRow(run.outcome.data);
      }
    });
  }

  await writeReport(rows, project.columns, results);
}

async function writeReport(rows: ProjectRow[], columns: string[], results: Map<string, RowRun>) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Results");
  sheet.addRow(["Row", ...columns, "Status", "Identifier seen", "Match basis", "Match note", "Images", "Product page", "Image 1", "Image 2", "Image 3", "Notes / reason", "Pass", "Rounds", "Seconds", "Cost $", "Check"]);
  sheet.getRow(1).font = { bold: true };
  let found = 0;
  let exact = 0;
  let totalCost = 0;
  let totalImages = 0;
  for (const row of rows) {
    const run = results.get(row.id);
    const ok = run?.outcome.ok ? run.outcome : null;
    const images = ((ok?.data.imageUrls as Array<{ imageUrl: string; pageUrl: string }>) ?? []);
    const answer = run?.summary.answer ?? {};
    const verification = (answer.verification as Item) ?? {};
    const identifierSeen = String(verification.identifierSeen ?? "");
    const rowCodes = extractRowIdentifiers(row.originalData).map((identifier) => identifier.key);
    const isFound = images.length > 0;
    const matchBasis = String(ok?.data[imageFinderMatchBasisKey("imageUrls")] ?? "");
    const matchNote = String(ok?.data[imageFinderMatchNoteKey("imageUrls")] ?? "");
    const codeMatches = isFound && rowCodes.some((code) => normalizeCode(identifierSeen).includes(code));
    const check = !isFound
      ? "Review: not found"
      : matchBasis === "best_match"
        ? "Review: best match (row has no code)"
        : matchBasis === "near_identifier"
          ? "Review: near code"
          : codeMatches
            ? "OK: row identifier matches"
            : "Review: identifier differs from row";
    if (isFound) found += 1;
    if (codeMatches) exact += 1;
    totalImages += images.length;
    totalCost += ok?.cost ?? 0;
    const status = !run ? "Not run" : !ok ? "Error" : isFound ? "Found" : "Not found";
    const added = sheet.addRow([
      row.rowIndex + 1,
      ...columns.map((c) => row.originalData[c] ?? ""),
      status,
      identifierSeen,
      matchBasis || String(verification.matchBasis ?? ""),
      matchNote,
      images.length,
      images[0]?.pageUrl ?? "",
      images[0]?.imageUrl ?? "",
      images[1]?.imageUrl ?? "",
      images[2]?.imageUrl ?? "",
      isFound ? String(answer.notes ?? "") : String(ok?.data.imageUrls__notFoundReason ?? (run && !run.outcome.ok ? run.outcome.error : "")),
      run?.pass ?? "",
      run?.summary.rounds ?? 0,
      run?.seconds ?? 0,
      Number((ok?.cost ?? 0).toFixed(4)),
      check,
    ]);
    const statusCell = added.getCell(columns.length + 2);
    const good = status === "Found";
    statusCell.font = { bold: true, color: { argb: good ? "FF1B7F3B" : "FFC62828" } };
    statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: good ? "FFE6F4EA" : "FFFDECEA" } };
  }
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.columns.forEach((column, index) => {
    column.width = index === 0 ? 6 : 22;
  });

  const log = workbook.addWorksheet("Research log");
  log.addRow(["Row", "Code", "Pass", "Learned websites given", "Searches", "Pages opened (→ result)", "Images viewed"]);
  log.getRow(1).font = { bold: true };
  for (const row of rows) {
    const run = results.get(row.id);
    if (!run) continue;
    log.addRow([
      row.rowIndex + 1,
      extractRowIdentifiers(row.originalData)[0]?.value ?? "(no code)",
      run.pass,
      run.learnedDomains.join(", "),
      run.summary.searches.join("\n"),
      run.summary.pages.join("\n"),
      run.summary.viewed.join("\n"),
    ]);
  }
  log.columns.forEach((column, index) => {
    column.width = [6, 14, 9, 24, 60, 90, 60][index];
    column.alignment = { wrapText: true, vertical: "top" };
  });

  const file = path.join(outDir, `image-finder-v2-${label}.xlsx`);
  await workbook.xlsx.writeFile(file);
  console.log(`\n=== SUMMARY (${label})`);
  console.log(`found ${found}/${rows.length}, identifier matches a row identifier on ${exact}/${found} found rows`);
  console.log(`images ${totalImages} (avg ${(totalImages / Math.max(1, found)).toFixed(2)} per found row), OpenAI cost $${totalCost.toFixed(2)}`);
  console.log(`report: ${file}`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
