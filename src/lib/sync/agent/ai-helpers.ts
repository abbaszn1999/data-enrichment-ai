// AI helpers extracted/adapted from the legacy agent route.
// These are the per-tool AI operations: write column, append row, answer question,
// run a sheet program, analyze attachments, web research, image search.
//
// All helpers are pure functions that take sanitized inputs and return typed outputs.

import type { SyncSheet, SyncSheetRow } from "@/lib/sync/core/types";
import { searchProduct, searchProductImages } from "@/lib/gemini";
import type { AiCallCost } from "@/lib/ai-pricing";
import type { SourceUrl } from "@/types";
import {
  MODELS,
  requireGeminiApiKey,
  safeParseAiJson,
  trackAiUsage,
  withAiRetry,
  type SyncBillingTracker,
  type SyncMode,
} from "./ai-utils";
import { costToCredits } from "@/lib/ai-pricing";

export type IntegrationContext = {
  provider: string;
  integration_name: string;
  base_url?: string | null;
} | null;

export type SyncInlineAttachment = {
  name: string;
  mimeType: string;
  size: number;
  data: string;
};

function trackDirectCost(tracker: SyncBillingTracker | undefined, cost: AiCallCost | null | undefined) {
  if (!tracker || !cost) return;
  tracker.totalCost += cost.totalCost;
  tracker.totalTokens += cost.usage.totalTokens;
  tracker.totalCredits += costToCredits(cost.totalCost);
}

// ─── Write AI column values ──────────────────────────────────────────────────

export async function writeSheetColumnWithAi(params: {
  rows: SyncSheetRow[];
  mode: SyncMode;
  instruction: string;
  integration: IntegrationContext;
  targetColumn: string;
  existingColumns: string[];
  rowIndexes?: number[];
  billingTracker?: SyncBillingTracker;
  /** Live progress callback — called after every batch completes with the
   *  values just produced. The UI uses this to render partial cells without
   *  waiting for the full operation to finish. */
  onChunk?: (chunk: {
    values: { rowIndex: number; value: string }[];
    processedCount: number;
    totalCount: number;
    failedCount: number;
  }) => void;
  /** Cancellation signal — checked between batches. When aborted, the loop
   *  exits gracefully and returns whatever values were already produced. */
  signal?: AbortSignal;
}): Promise<{
  values: { rowIndex: number; value: string }[];
  totalEligible: number;
  processedCount: number;
  batchWarnings: string[];
  failedRowIndexes: number[];
}> {
  const apiKey = requireGeminiApiKey();

  const allowed = new Set(
    Array.isArray(params.rowIndexes)
      ? params.rowIndexes.filter((i) => Number.isInteger(i) && i >= 0)
      : params.rows.map((_, i) => i)
  );

  const eligible = params.rows
    .map((row, rowIndex) => ({
      rowIndex,
      values: Object.fromEntries(Object.entries(row).map(([k, v]) => [k, String(v ?? "")])),
    }))
    .filter((r) => allowed.has(r.rowIndex));

  if (eligible.length === 0) {
    return {
      values: [],
      totalEligible: 0,
      processedCount: 0,
      batchWarnings: [],
      failedRowIndexes: [],
    };
  }

  const systemInstruction = `You generate values for a target sheet column in a connected ecommerce catalog.
Return JSON only.
Rules:
- Use only the provided product data.
- Do not invent specifications, materials, sizes, or features that are not present.
- Produce values appropriate for the requested target column.
- Keep descriptive text concise, professional, and useful for catalog publishing.
- Preserve the rowIndex exactly as provided.`;

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });

  // Tuning rationale (Gemini 3 / 2026):
  //   BATCH=5             → small enough that JSON output never truncates; ~2-4s
  //                          latency per batch so the user sees a chunk land
  //                          every few seconds in the UI.
  //   PARALLEL_BATCHES=3  → 3 batches in flight at once = ~15 rows per wave,
  //                          stays well under Gemini per-minute quotas.
  //   MAX_BATCH_RETRIES=2 → recoverable transient errors (5xx, JSON parse)
  //                          retry once before being recorded as failed.
  const BATCH = 5;
  const PARALLEL_BATCHES = 3;
  const MAX_BATCH_RETRIES = 2;

  const allValues: { rowIndex: number; value: string }[] = [];
  const warnings: string[] = [];
  const failedRowIndexes: number[] = [];
  let processed = 0;

  type BatchSlice = { batchIdx: number; rows: typeof eligible };

  const runOneBatch = async (slice: BatchSlice): Promise<{
    values: { rowIndex: number; value: string }[];
    failed: number[];
    warning?: string;
  }> => {
    const prompt = `Connected platform: ${params.integration?.provider ?? "unknown"}
Integration: ${params.integration?.integration_name ?? "unknown"}
Existing columns: ${JSON.stringify(params.existingColumns)}
Target column: ${params.targetColumn}
User instruction: ${params.instruction}

Sheet rows:
${JSON.stringify(slice.rows, null, 2)}

Return valid JSON:
{ "values": [ { "rowIndex": 0, "value": "..." } ] }`;

    let lastErr: string | null = null;
    for (let attempt = 0; attempt < MAX_BATCH_RETRIES; attempt++) {
      try {
        const res = await withAiRetry(() =>
          ai.models.generateContent({
            model: MODELS[params.mode],
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: {
              systemInstruction,
              responseMimeType: "application/json",
              temperature: params.mode === "pro" ? 0.6 : 0.3,
              maxOutputTokens: params.mode === "pro" ? 8192 : 4096,
            },
          })
        );
        trackAiUsage(params.billingTracker, MODELS[params.mode], res.usageMetadata);
        const text = res.text?.trim();
        if (!text) {
          lastErr = "empty response";
          continue;
        }
        const parsed = safeParseAiJson<{
          values?: { rowIndex: number; value: string }[];
        }>(text);
        const got = Array.isArray(parsed.values) ? parsed.values : [];
        // Track which input rows the model failed to return — they'll be
        // surfaced in the warnings so the user can re-try just those.
        const returned = new Set(got.map((v) => v.rowIndex));
        const missed = slice.rows
          .map((r) => r.rowIndex)
          .filter((i) => !returned.has(i));
        return { values: got, failed: missed };
      } catch (err) {
        lastErr = (err as Error).message;
      }
    }
    return {
      values: [],
      failed: slice.rows.map((r) => r.rowIndex),
      warning: `Batch ${slice.batchIdx + 1}: ${lastErr ?? "unknown error"}`,
    };
  };

  // Slice eligible rows into BATCHes, then process PARALLEL_BATCHES at a time.
  const slices: BatchSlice[] = [];
  for (let start = 0; start < eligible.length; start += BATCH) {
    slices.push({
      batchIdx: slices.length,
      rows: eligible.slice(start, start + BATCH),
    });
  }

  for (let i = 0; i < slices.length; i += PARALLEL_BATCHES) {
    if (params.signal?.aborted) {
      warnings.push(`Aborted by user after ${processed}/${eligible.length} rows.`);
      break;
    }
    const wave = slices.slice(i, i + PARALLEL_BATCHES);
    const results = await Promise.all(wave.map(runOneBatch));

    // Aggregate this wave's outputs and stream them out before kicking the
    // next wave so the UI sees rows fill in progressively.
    const waveValues: { rowIndex: number; value: string }[] = [];
    for (let w = 0; w < results.length; w++) {
      const r = results[w];
      const slice = wave[w];
      if (r.warning) warnings.push(r.warning);
      if (r.failed.length > 0) failedRowIndexes.push(...r.failed);
      waveValues.push(...r.values);
      allValues.push(...r.values);
      processed += slice.rows.length;
    }

    params.onChunk?.({
      values: waveValues,
      processedCount: processed,
      totalCount: eligible.length,
      failedCount: failedRowIndexes.length,
    });
  }

  return {
    values: allValues,
    totalEligible: eligible.length,
    processedCount: processed,
    batchWarnings: warnings,
    failedRowIndexes,
  };
}

// ─── Append new row from AI ─────────────────────────────────────────────────

export async function createRowWithAi(params: {
  mode: SyncMode;
  instruction: string;
  integration: IntegrationContext;
  existingColumns: string[];
  sheet: SyncSheet | null;
  billingTracker?: SyncBillingTracker;
}): Promise<Record<string, unknown>> {
  const apiKey = requireGeminiApiKey();
  const systemInstruction = `You create one new sheet row for an ecommerce catalog. Return JSON only.
Rules:
- Produce a single row object matching the existing sheet columns.
- Use only information the user requested plus conservative defaults.
- Do not invent platform IDs.
- If a value is unknown, return an empty string.`;

  const prompt = `Connected platform: ${params.integration?.provider ?? "unknown"}
Existing columns: ${JSON.stringify(params.existingColumns)}
Sheet summary: ${JSON.stringify(
    params.sheet
      ? {
          title: params.sheet.title,
          rowCount: params.sheet.rows.length,
          sampleRows: params.sheet.rows.slice(0, 2),
        }
      : null
  )}
User instruction: ${params.instruction}

Return valid JSON: { "row": { "title": "..." } }`;

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });
  const res = await withAiRetry(() =>
    ai.models.generateContent({
      model: MODELS[params.mode],
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        temperature: 0.2,
        maxOutputTokens: 4096,
      },
    })
  );
  trackAiUsage(params.billingTracker, MODELS[params.mode], res.usageMetadata);

  const text = res.text?.trim();
  if (!text) throw new Error("Empty AI row-creation response");
  const parsed = safeParseAiJson<{ row?: Record<string, unknown> }>(text);
  return parsed.row && typeof parsed.row === "object" ? parsed.row : {};
}

// ─── Generate a JS filter function for sheet rows ────────────────────────────

/**
 * Ask AI to generate a JavaScript filter function body based on a natural-language
 * instruction. The generated function receives a `row` object (column → string value)
 * and must return `true` for matching rows. This enables filtering ALL rows locally
 * without sending the entire sheet to the AI (only sample rows + columns are sent).
 */
export async function generateSheetFilterFn(params: {
  mode: SyncMode;
  instruction: string;
  integration: IntegrationContext;
  existingColumns: string[];
  sampleRows: SyncSheetRow[];
  billingTracker?: SyncBillingTracker;
}): Promise<{ filterFnBody: string; description: string }> {
  const apiKey = requireGeminiApiKey();

  const systemInstruction = `You generate a JavaScript function body that filters ecommerce sheet rows.
The function receives a single argument \`row\` which is an object mapping column names to string values.
Return ONLY the function body (no \`function\` keyword, no wrapping braces).
The body must return \`true\` for rows that MATCH the user's filter intent, \`false\` otherwise.

Rules:
- All column values are strings. An empty string "" means the field is missing/empty.
- Compare case-insensitively when checking text values.
- Be defensive: check for null/undefined before calling string methods.
- For "missing" / "empty" / "without" / "no" checks: test \`!row[col] || row[col].trim() === ""\`
- For "has" / "with" / "contains" checks: test \`row[col] && row[col].trim() !== ""\`
- For numeric comparisons: use \`Number(row[col] || 0)\`
- Use only standard JavaScript (no imports, no async, no DOM).
- The function body must start with \`return\`.

Return JSON: { "filterFnBody": "return !row.featured_image || row.featured_image.trim() === \\"\\";", "description": "Products without a featured image" }`;

  const sampleNormalized = params.sampleRows.slice(0, 3).map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, String(v ?? "")]))
  );

  const prompt = `Platform: ${params.integration?.provider ?? "unknown"}
Columns: ${JSON.stringify(params.existingColumns)}
Sample rows (for reference only):
${JSON.stringify(sampleNormalized, null, 2)}

User's filter request: "${params.instruction}"

Return valid JSON with filterFnBody and description.`;

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });
  const res = await withAiRetry(() =>
    ai.models.generateContent({
      model: MODELS[params.mode],
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        temperature: 0.1,
        maxOutputTokens: 1024,
      },
    })
  );
  trackAiUsage(params.billingTracker, MODELS[params.mode], res.usageMetadata);

  const text = res.text?.trim();
  if (!text) throw new Error("Empty filter-function response");
  const parsed = safeParseAiJson<{ filterFnBody?: string; description?: string }>(text);
  const body = typeof parsed.filterFnBody === "string" ? parsed.filterFnBody.trim() : "";
  if (!body) throw new Error("AI returned empty filter function body");
  return {
    filterFnBody: body,
    description: typeof parsed.description === "string" ? parsed.description : "",
  };
}

// ─── Answer a question about the sheet ──────────────────────────────────────

export async function answerQuestionAboutSheet(params: {
  rows: SyncSheetRow[];
  mode: SyncMode;
  instruction: string;
  integration: IntegrationContext;
  existingColumns: string[];
  billingTracker?: SyncBillingTracker;
}): Promise<string> {
  const apiKey = requireGeminiApiKey();
  const normalizedRows = params.rows.slice(0, 100).map((row, rowIndex) => ({
    rowIndex,
    values: Object.fromEntries(Object.entries(row).map(([k, v]) => [k, String(v ?? "")])),
  }));

  const systemInstruction = `You answer questions about the current ecommerce sheet. Return JSON only.
- Use only the provided sheet data.
- Be concise. Mention row counts or indexes when useful.
- Do not claim a platform change was made.`;

  const prompt = `Platform: ${params.integration?.provider ?? "unknown"}
Columns: ${JSON.stringify(params.existingColumns)}
User question: ${params.instruction}

Sheet rows:
${JSON.stringify(normalizedRows, null, 2)}

Return: { "answer": "..." }`;

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });
  const res = await withAiRetry(() =>
    ai.models.generateContent({
      model: MODELS[params.mode],
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        temperature: 0.1,
        maxOutputTokens: 2048,
      },
    })
  );
  trackAiUsage(params.billingTracker, MODELS[params.mode], res.usageMetadata);

  const text = res.text?.trim();
  if (!text) throw new Error("Empty sheet-answer response");
  const parsed = safeParseAiJson<{ answer?: string }>(text);
  return typeof parsed.answer === "string" ? parsed.answer.trim() : "";
}

// ─── Attachment analysis (images/PDFs) ──────────────────────────────────────

export async function analyzeAttachments(params: {
  mode: SyncMode;
  instruction: string;
  integration: IntegrationContext;
  existingColumns: string[];
  attachments: SyncInlineAttachment[];
  billingTracker?: SyncBillingTracker;
}): Promise<string> {
  const apiKey = requireGeminiApiKey();
  if (params.attachments.length === 0) return "No supported attachments were provided.";

  const systemInstruction = `You analyze attached files for an ecommerce sheet assistant. Return JSON only.
- Use the attached files as the primary source of truth.
- Extract details faithfully from PDFs; describe what you can see in images.
- Mention uncertainty clearly.
- Do not claim platform changes were made.`;

  const prompt = `Platform: ${params.integration?.provider ?? "unknown"}
Columns: ${JSON.stringify(params.existingColumns)}
Files: ${params.attachments.map((a) => `${a.name} (${a.mimeType})`).join(", ")}
User request: ${params.instruction}

Return: { "answer": "..." }`;

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });

  const contents = [
    {
      role: "user" as const,
      parts: [
        { text: prompt },
        ...params.attachments.map((a) => ({
          inlineData: { mimeType: a.mimeType, data: a.data },
        })),
      ],
    },
  ];

  const res = await withAiRetry(() =>
    ai.models.generateContent({
      model: MODELS[params.mode],
      contents,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        temperature: 0.1,
        maxOutputTokens: params.mode === "pro" ? 4096 : 2048,
      },
    })
  );
  trackAiUsage(params.billingTracker, MODELS[params.mode], res.usageMetadata);

  const text = res.text?.trim();
  if (!text) throw new Error("Empty attachment-analysis response");
  const parsed = safeParseAiJson<{ answer?: string }>(text);
  return typeof parsed.answer === "string" ? parsed.answer.trim() : "";
}

// ─── Web research (grounded) ────────────────────────────────────────────────

export async function researchWithWeb(params: {
  instruction: string;
  integration: IntegrationContext;
  sheet: SyncSheet | null;
  rowIndexes?: number[] | null;
  billingTracker?: SyncBillingTracker;
}): Promise<{ summary: string; sources: SourceUrl[] }> {
  const sheet = params.sheet;
  const scopedRows = sheet
    ? (params.rowIndexes?.length
        ? params.rowIndexes.map((i) => sheet.rows[i]).filter(Boolean)
        : sheet.rows
      ).slice(0, 3)
    : [];

  const rowSummaries = scopedRows.map((row, rowIndex) => ({
    rowIndex,
    fields: Object.fromEntries(
      Object.entries(row ?? {})
        .filter(([, v]) => String(v ?? "").trim())
        .slice(0, 8)
        .map(([k, v]) => [k, String(v)])
    ),
  }));

  const result = await searchProduct({
    request: String(params.instruction ?? ""),
    provider: String(params.integration?.provider ?? ""),
    integrationName: String(params.integration?.integration_name ?? ""),
    baseUrl: String(params.integration?.base_url ?? ""),
    sheetTitle: String(sheet?.title ?? ""),
    sheetColumns: JSON.stringify(sheet?.columns.slice(0, 30) ?? []),
    sheetRowCount: String(sheet?.rows.length ?? 0),
    targetedRows: JSON.stringify(rowSummaries ?? []),
  });
  trackDirectCost(params.billingTracker, result.cost);

  return {
    summary: (result.text ?? "").trim(),
    sources: result.sources ?? [],
  };
}

// ─── Image search (Serper via gemini module) ────────────────────────────────

export async function searchImagesForRows(params: {
  rows: SyncSheetRow[];
  rowIndexes?: number[];
  instruction: string;
  /** Target column name to report in the streaming chunks (defaults to
   *  "featured_image" — the handler may override). */
  targetColumn?: string;
  /** Live progress callback — called after each parallel wave of image
   *  lookups completes. Lets the UI render thumbnails as they arrive. */
  onChunk?: (chunk: {
    values: Array<{ rowIndex: number; imageUrl: string; sourcePageUrl: string; query: string }>;
    processedCount: number;
    totalCount: number;
    failedCount: number;
  }) => void;
  signal?: AbortSignal;
}): Promise<Array<{ rowIndex: number; imageUrl: string; sourcePageUrl: string; query: string }>> {
  const targetIndexes = Array.isArray(params.rowIndexes)
    ? params.rowIndexes.filter((i) => Number.isInteger(i) && i >= 0 && i < params.rows.length)
    : params.rows.map((_, i) => i);

  // Removed the previous LIMIT=25 hard cap — the handler/agent now decides
  // scope via rowIndexes/scopeCap. We still bound concurrency to be a good
  // citizen with Serper rate limits.
  const CONCURRENCY = 5;

  const results: Array<{ rowIndex: number; imageUrl: string; sourcePageUrl: string; query: string }> = [];
  let failedCount = 0;
  let processed = 0;

  for (let i = 0; i < targetIndexes.length; i += CONCURRENCY) {
    if (params.signal?.aborted) break;
    const chunk = targetIndexes.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.allSettled(
      chunk.map(async (rowIndex) => {
        const row = params.rows[rowIndex];
        const title = String(row.title ?? "").trim();
        const vendor = String(row.vendor ?? "").trim();
        const productType = String(row.product_type ?? "").trim();
        const tags = String(row.tags ?? "").trim();

        const query = [title, vendor, productType, tags, params.instruction]
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

        if (!query) return null;

        const images = await searchProductImages(
          { title, vendor, product_type: productType, tags },
          1,
          params.instruction,
          undefined,
          query
        );
        const best = images[0];
        if (!best?.imageUrl) return null;
        return {
          rowIndex,
          imageUrl: best.imageUrl,
          sourcePageUrl: best.pageUrl || "",
          query,
        };
      })
    );

    const waveValues: typeof results = [];
    for (const r of chunkResults) {
      if (r.status === "fulfilled" && r.value) {
        waveValues.push(r.value);
        results.push(r.value);
      } else {
        failedCount += 1;
      }
    }
    processed += chunk.length;
    params.onChunk?.({
      values: waveValues,
      processedCount: processed,
      totalCount: targetIndexes.length,
      failedCount,
    });
  }
  return results;
}

// ─── Attachment validation helper ───────────────────────────────────────────

export function validateInlineAttachments(rawAttachments: unknown): SyncInlineAttachment[] {
  if (!Array.isArray(rawAttachments)) return [];

  const allowedMime = new Set([
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/bmp",
    "text/csv",
    "text/plain",
    "application/json",
  ]);
  const maxImageBytes = 10 * 1024 * 1024;
  const maxPdfBytes = 20 * 1024 * 1024;
  const maxTextBytes = 5 * 1024 * 1024;

  return rawAttachments.slice(0, 4).map((item, i) => {
    const att = item as Partial<SyncInlineAttachment>;
    const name = String(att?.name ?? "attachment").trim() || `attachment-${i + 1}`;
    const mimeType = String(att?.mimeType ?? "").trim();
    const size = Number(att?.size ?? 0);
    const data = String(att?.data ?? "").trim();

    if (!allowedMime.has(mimeType)) throw new Error(`Unsupported attachment: ${name}`);
    const isText = mimeType.startsWith("text/") || mimeType === "application/json";
    const maxSize = mimeType === "application/pdf"
      ? maxPdfBytes
      : isText
      ? maxTextBytes
      : maxImageBytes;
    if (!Number.isFinite(size) || size <= 0 || size > maxSize) {
      throw new Error(`Attachment too large or invalid: ${name}`);
    }
    if (!data) throw new Error(`Attachment data missing: ${name}`);
    return { name, mimeType, size, data };
  });
}
