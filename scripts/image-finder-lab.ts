/**
 * Image Finder lab: runs the production Image Finder path (processCatalogRow,
 * minus the credit charge) on real rows from a Catalog Intelligence session,
 * and logs every OpenAI search action, opened page, reported image and live
 * verification result.
 *
 * Usage:
 *   node --env-file=.env --import tsx scripts/image-finder-lab.ts \
 *     [--session=<id>] [--rows=3] [--tier=standard|premium] [--no-domains]
 *
 * Full raw responses are written to %TEMP%/image-finder-lab/<timestamp>/.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAdminClient } from "@/lib/supabase-admin";
import { loadProjectJsonAdmin } from "@/lib/jobs/project-json";
import { processCatalogRow } from "@/lib/jobs/enrich-row";
import { OPENAI_RESPONSES_URL } from "@/lib/enrich/openai";
import type { CatalogJobSettings } from "@/lib/jobs/types";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key, value ?? "true"];
  })
);
const sessionId = args.session || "6d7a8c3c-f455-4f8c-9bf4-896644e9632d";
const rowLimit = Number(args.rows || 3);

const logDir = path.join(os.tmpdir(), "image-finder-lab", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(logDir, { recursive: true });

type Captured = {
  request?: Record<string, unknown>;
  response?: Record<string, unknown>;
  verifications: Array<{ url: string; method: string; status: number | string; contentType: string }>;
};
let current: Captured = { verifications: [] };

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url === OPENAI_RESPONSES_URL) {
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (args.reasoning) body.reasoning = { ...body.reasoning, summary: "detailed" };
    if (args["text-only"]) {
      for (const tool of body.tools ?? []) {
        tool.search_content_types = ["text"];
        delete tool.image_settings;
      }
    }
    current.request = body;
    const response = await realFetch(input, { ...init, body: JSON.stringify(body) });
    const text = await response.clone().text();
    try {
      current.response = JSON.parse(text);
    } catch {
      current.response = { raw: text };
    }
    return response;
  }
  const method = (init?.method || "GET").toUpperCase();
  try {
    const response = await realFetch(input, init);
    current.verifications.push({
      url,
      method,
      status: response.status,
      contentType: response.headers.get("content-type") || "",
    });
    return response;
  } catch (error) {
    current.verifications.push({ url, method, status: `ERR ${(error as Error).message}`, contentType: "" });
    throw error;
  }
}) as typeof fetch;

function summarizeResponse(body: Record<string, unknown> | undefined) {
  const output = (body?.output as Array<Record<string, unknown>>) ?? [];
  const actions: string[] = [];
  let imageResults = 0;
  for (const item of output) {
    if (item.type === "reasoning") {
      for (const s of (item.summary as Array<{ text?: string }>) ?? []) {
        actions.push(`  · thinking: ${String(s.text ?? "").replace(/\s+/g, " ").slice(0, 400)}`);
      }
      continue;
    }
    if (item.type !== "web_search_call") continue;
    const action = (item.action as Record<string, unknown>) ?? {};
    const type = String(action.type ?? "?");
    const results = ((item.results as unknown[]) ?? (action.results as unknown[]) ?? []).length;
    imageResults += results;
    const detail =
      type === "search"
        ? JSON.stringify(action.queries ?? action.query ?? "")
        : String(action.url ?? action.pattern ?? "");
    const sources = ((action.sources as Array<{ url?: string }>) ?? []).map((s) => s.url).filter(Boolean);
    actions.push(
      `  ${type.padEnd(12)} ${detail}${results ? `  [${results} image results]` : ""}${
        sources.length ? `\n${sources.map((s) => `               source: ${s}`).join("\n")}` : ""
      }`
    );
  }
  const text = output
    .flatMap((item) => ((item.content as Array<{ type?: string; text?: string }>) ?? []))
    .filter((c) => c.type === "output_text")
    .map((c) => c.text)
    .join("\n");
  return { actions, imageResults, text, usage: body?.usage };
}

async function main() {
  const admin = createAdminClient();
  const { data: run } = await admin
    .from("job_runs")
    .select("id, workspace_id, settings, created_at")
    .eq("kind", "catalog")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(20);
  const imageRun = (run ?? []).find((r) =>
    ((r.settings as CatalogJobSettings)?.enabledColumns ?? []).includes("imageUrls")
  );
  if (!imageRun) throw new Error("No Image Finder run found for this session");

  const settings = structuredClone(imageRun.settings) as CatalogJobSettings;
  if (args.tier) settings.enrichmentModel = args.tier;
  if (args["no-domains"]) {
    settings.enrichmentColumns = settings.enrichmentColumns.map((c) =>
      c.id === "imageUrls" ? { ...c, allowedDomains: [], blockedDomains: [] } : c
    );
  }
  const imageCol = settings.enrichmentColumns.find((c) => c.id === "imageUrls");

  const project = await loadProjectJsonAdmin(imageRun.workspace_id, sessionId, admin);
  if (!project) throw new Error("Project not found");
  const only = args.only ? new Set(String(args.only).split(",").map(Number)) : null;
  const rows = [...project.rows]
    .sort((a, b) => a.rowIndex - b.rowIndex)
    .slice(0, rowLimit)
    .filter((row) => !only || only.has(row.rowIndex + 1));

  console.log("=== Image Finder lab ===");
  console.log(`session       ${sessionId}`);
  console.log(`settings from job run ${imageRun.id} (${imageRun.created_at})`);
  console.log(`tier          ${settings.enrichmentModel}`);
  console.log(`source cols   ${settings.sourceColumns.join(", ")}`);
  console.log(`image count   ${imageCol?.imageCount}`);
  console.log(`instruction   ${imageCol?.customInstruction ?? "(none)"}`);
  console.log(`allowed       ${(imageCol?.allowedDomains ?? []).join(", ") || "(any)"}`);
  console.log(`blocked       ${(imageCol?.blockedDomains ?? []).join(", ") || "(none)"}`);
  console.log(`logs          ${logDir}\n`);

  for (const row of rows) {
    current = { verifications: [] };
    const started = Date.now();
    const outcome = await processCatalogRow({
      sessionId,
      workspaceId: imageRun.workspace_id,
      row,
      settings,
    });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const summary = summarizeResponse(current.response);

    console.log(`--- Row ${row.rowIndex + 1}: ${JSON.stringify(row.originalData).slice(0, 160)}`);
    console.log(`time ${seconds}s   effort ${(current.request?.reasoning as { effort?: string })?.effort}`);
    console.log(`filters ${JSON.stringify((current.request?.tools as Array<{ filters?: unknown }>)?.[0]?.filters ?? null)}`);
    console.log("search actions:");
    console.log(summary.actions.join("\n") || "  (none)");
    console.log(`model answer: ${summary.text}`);
    console.log("our HTTP requests (store lookup + image checks):");
    console.log(
      current.verifications.map((v) => `  ${v.method} ${v.status} ${v.contentType} ${v.url}`).join("\n") ||
        "  (none)"
    );
    if (outcome.ok) {
      const images = (outcome.data.imageUrls as Array<{ imageUrl: string }>) ?? [];
      console.log(`RESULT: ${images.length} image(s), $${outcome.cost.toFixed(4)}`);
      images.forEach((img) => console.log(`  ${img.imageUrl}`));
      const reason = outcome.data.imageUrls__notFoundReason;
      if (reason) console.log(`  not found reason: ${reason}`);
    } else {
      console.log(`RESULT: failed — ${outcome.error}`);
    }
    console.log("");

    fs.writeFileSync(
      path.join(logDir, `row-${row.rowIndex + 1}.json`),
      JSON.stringify({ row: row.originalData, request: current.request, response: current.response, verifications: current.verifications, outcome }, null, 2)
    );
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
