import { NextRequest, NextResponse } from "next/server";
import { calculateCallCost, costToCredits } from "@/lib/ai-pricing";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { calculateCreditBalance, getOwnerSubscription, isSubscriptionActive } from "@/lib/stripe";
import { buildShopifyCoreProductsSheet, type SyncSheet as ShopifyCoreSyncSheet, type SyncSheetRow as ShopifyCoreSyncSheetRow } from "@/lib/sync/shopify-products";
import { searchProduct, searchProductImages } from "@/lib/gemini";
import { aiJsonParse } from "ai-json-safe-parse";
import type { AiCallCost } from "@/lib/ai-pricing";
import type { SourceUrl } from "@/types";

export const maxDuration = 300;

type SyncMode = "fast" | "pro";

type IntegrationContext = {
  provider: string;
  integration_name: string;
  base_url?: string;
} | null;

type SyncSheetRow = ShopifyCoreSyncSheetRow;

type SyncSheet = ShopifyCoreSyncSheet;

type SheetProgramPredicate =
  | { type: "is_empty"; field: string }
  | { type: "is_not_empty"; field: string }
  | { type: "equals"; field: string; value: string }
  | { type: "contains"; field: string; value: string }
  | { type: "greater_than"; field: string; value: number }
  | { type: "less_than"; field: string; value: number }
  | { type: "equals_field"; field: string; valueField: string }
  | { type: "before_date"; field: string; value: string }
  | { type: "after_date"; field: string; value: string }
  | { type: "greater_than_field"; field: string; valueField: string };

type SheetProgramStep =
  | { op: "filter"; predicates: SheetProgramPredicate[]; match: "all" | "any" }
  | { op: "sort"; field: string; direction: "asc" | "desc" }
  | { op: "count" }
  | { op: "detect_duplicates"; fields: string[] }
  | { op: "group_count"; field: string }
  | { op: "limit"; count: number }
  | { op: "select_columns"; columns: string[] };

type SheetProgram = {
  goal: "show_filtered_sheet" | "answer_only" | "target_rows";
  steps: SheetProgramStep[];
  answerTemplate?: string;
};

type AgentStep =
  | { tool: "load_products_from_shopify"; args?: { limit?: number } }
  | {
      tool: "append_row_from_ai";
      args?: {
        instruction?: string;
      };
    }
  | {
      tool: "write_sheet_column_with_ai";
      args?: {
        targetColumn?: string;
        instruction?: string;
        overwrite?: boolean;
      };
    }
  | {
      tool: "search_images_with_serper";
      args?: {
        instruction?: string;
        targetColumn?: string;
        overwrite?: boolean;
      };
    }
  | {
      tool: "delete_column";
      args?: {
        column?: string;
      };
    }
  | {
      tool: "answer_question_about_sheet";
      args?: {
        instruction?: string;
      };
    }
  | {
      tool: "run_sheet_program";
      args?: {
        instruction?: string;
      };
    }
  | {
      tool: "reply_only";
      args?: {
        message?: string;
      };
    }
  | {
      tool: "research_with_web";
      args?: {
        instruction?: string;
      };
    }
  | {
      tool: "analyze_attachments";
      args?: {
        instruction?: string;
      };
    };

type AgentPlan = {
  resultMode?: "answer_only" | "show_filtered_sheet" | "target_rows";
  useRememberedTargets?: boolean;
  steps: AgentStep[];
  assistantMessage?: string;
};

type AgentChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type SyncInlineAttachment = {
  name: string;
  mimeType: string;
  size: number;
  data: string;
};

type SyncWorkingMemory = {
  lastCreatedRowIndexes: number[];
  lastTargetedRowIndexes: number[];
  lastExplicitEntityLabel: string | null;
  lastResearchSummary: string | null;
  lastResearchSubject: string | null;
  lastTouchedColumns: string[];
  lastActionType: "append_row" | "target_rows" | "write_column" | "research_web" | "load_sheet" | null;
  updatedAt: number | null;
};

const EMPTY_SYNC_WORKING_MEMORY: SyncWorkingMemory = {
  lastCreatedRowIndexes: [],
  lastTargetedRowIndexes: [],
  lastExplicitEntityLabel: null,
  lastResearchSummary: null,
  lastResearchSubject: null,
  lastTouchedColumns: [],
  lastActionType: null,
  updatedAt: null,
};

type ActionReceipt = {
  toolsExecuted: string[];
  rowsAffected: number;
  columnsAffected: string[];
  sheetRowCount: number;
  warnings: string[];
};

type AgentResponse = {
  assistantMessage: string;
  progress: string[];
  sessionSummary: string;
  sheet: SyncSheet | null;
  executedSteps: AgentStep[];
  workingMemory: SyncWorkingMemory;
  actionReceipt?: ActionReceipt;
};

type AgentStreamEvent =
  | { type: "progress"; progress: string[] }
  | { type: "result"; data: AgentResponse }
  | { type: "error"; error: string };

const MODELS: Record<SyncMode, string> = {
  fast: "gemini-3-flash-preview",
  pro: "gemini-3.1-pro-preview",
};

type SyncBillingTracker = {
  totalCredits: number;
  totalCost: number;
  totalTokens: number;
};

function trackSyncAiUsage(tracker: SyncBillingTracker | undefined, mode: SyncMode, usageMetadata: unknown) {
  if (!tracker || !usageMetadata) {
    return;
  }

  const cost = calculateCallCost(MODELS[mode], usageMetadata, false);
  tracker.totalCost += cost.totalCost;
  tracker.totalTokens += cost.usage.totalTokens;
  tracker.totalCredits += costToCredits(cost.totalCost);
}

function trackSyncDirectCost(tracker: SyncBillingTracker | undefined, cost: AiCallCost | null | undefined) {
  if (!tracker || !cost) {
    return;
  }

  tracker.totalCost += cost.totalCost;
  tracker.totalTokens += cost.usage.totalTokens;
  tracker.totalCredits += costToCredits(cost.totalCost);
}

async function withAiRetry<T>(
  fn: () => Promise<T>,
  opts: { maxRetries?: number; baseDelay?: number; jitter?: number } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelay = 2000, jitter = 500 } = opts;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const status = err?.status ?? err?.httpStatusCode ?? 0;
      const isRetryable = status === 503 || status === 429 || status === 500 || status === 502 || status === 504;
      if (!isRetryable || attempt === maxRetries) {
        throw err;
      }
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * jitter;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

function safeParseAiJson<T>(text: string): T {
  const result = aiJsonParse<T>(text);
  if (result.success) {
    return result.data;
  }
  throw new SyntaxError(`AI JSON parse failed: ${result.error}`);
}

function mergeAssistantMessages(primary: string, secondary: string) {
  const first = primary.trim();
  const second = secondary.trim();

  if (!first) {
    return second;
  }

  if (!second) {
    return first;
  }

  if (first === second) {
    return first;
  }

  return `${first}\n\n${second}`;
}

function withSheetTitleSuffix(title: string, suffix: string) {
  const trimmedTitle = title.trim();
  const trimmedSuffix = suffix.trim();

  if (!trimmedTitle) {
    return trimmedSuffix;
  }

  if (!trimmedSuffix) {
    return trimmedTitle;
  }

  const escapedSuffix = trimmedSuffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const normalizedTitle = trimmedTitle.replace(new RegExp(`(?:\\s*·\\s*${escapedSuffix})+$`), "").trim();

  return `${normalizedTitle} · ${trimmedSuffix}`;
}

function buildInstructionWithWebContext(instruction: string, webResearchSummary: string) {
  const trimmedInstruction = instruction.trim();
  const trimmedResearch = webResearchSummary.trim();
  if (!trimmedResearch) {
    return trimmedInstruction;
  }

  return `${trimmedInstruction}\n\nGrounded web research context:\n${trimmedResearch}`;
}

function normalizeWorkingMemory(rawWorkingMemory: unknown): SyncWorkingMemory {
  const value = rawWorkingMemory as Partial<SyncWorkingMemory> | null | undefined;
  return {
    lastCreatedRowIndexes: Array.isArray(value?.lastCreatedRowIndexes)
      ? value.lastCreatedRowIndexes.filter((index): index is number => Number.isInteger(index) && index >= 0)
      : [],
    lastTargetedRowIndexes: Array.isArray(value?.lastTargetedRowIndexes)
      ? value.lastTargetedRowIndexes.filter((index): index is number => Number.isInteger(index) && index >= 0)
      : [],
    lastExplicitEntityLabel: typeof value?.lastExplicitEntityLabel === "string" ? value.lastExplicitEntityLabel.trim() || null : null,
    lastResearchSummary: typeof value?.lastResearchSummary === "string" ? value.lastResearchSummary.trim() || null : null,
    lastResearchSubject: typeof value?.lastResearchSubject === "string" ? value.lastResearchSubject.trim() || null : null,
    lastTouchedColumns: Array.isArray(value?.lastTouchedColumns)
      ? value.lastTouchedColumns
          .map((column) => String(column ?? "").trim())
          .filter(Boolean)
      : [],
    lastActionType:
      value?.lastActionType === "append_row" ||
      value?.lastActionType === "target_rows" ||
      value?.lastActionType === "write_column" ||
      value?.lastActionType === "research_web" ||
      value?.lastActionType === "load_sheet"
        ? value.lastActionType
        : null,
    updatedAt: typeof value?.updatedAt === "number" && Number.isFinite(value.updatedAt) ? value.updatedAt : null,
  };
}

function extractEntityLabelFromInstruction(instruction: string) {
  const trimmed = instruction.trim();
  if (!trimmed) {
    return null;
  }

  const lowered = trimmed.toLowerCase();
  const markerPatterns = ["product", "item", "row", "sku"];
  for (const marker of markerPatterns) {
    const index = lowered.lastIndexOf(marker);
    if (index >= 0) {
      const candidate = trimmed.slice(index + marker.length).replace(/^[:\s-]+/, "").trim();
      if (candidate.length >= 2) {
        return candidate;
      }
    }
  }

  return trimmed.length <= 120 ? trimmed : trimmed.slice(0, 120).trim();
}

function normalizeComparableText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/["'`”“‘’]+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function extractQuotedPhrases(text: string) {
  return Array.from(text.matchAll(/["“”'‘’]([^"“”'‘’]{2,})["“”'‘’]/g)).map((match) => match[1].trim());
}

function resolveDeterministicTargetRowIndexes(userMessage: string, sheet: SyncSheet | null) {
  if (!sheet || sheet.rows.length === 0) {
    return null;
  }

  const trimmed = userMessage.trim();
  const lowered = trimmed.toLowerCase();

  if (/\b(first|first product|first item|top row|first row)\b|\b(اول|أول)\s+(منتج|صف|عنصر)\b/.test(lowered)) {
    return [0];
  }

  const rowNumberMatch = lowered.match(/\brow\s*(number\s*)?(\d+)\b|\bproduct\s*(number\s*)?(\d+)\b|\b(?:الصف|منتج رقم|المنتج رقم)\s*(\d+)\b/);
  const parsedRowNumber = Number(rowNumberMatch?.[2] ?? rowNumberMatch?.[4] ?? rowNumberMatch?.[5] ?? NaN);
  if (Number.isInteger(parsedRowNumber) && parsedRowNumber >= 1 && parsedRowNumber <= sheet.rows.length) {
    return [parsedRowNumber - 1];
  }

  const candidatePhrases = [
    ...extractQuotedPhrases(trimmed),
    ...Object.values(sheet.rows[0] ?? {})
      .filter(() => false),
  ];

  const titleLikeFields = sheet.columns.filter((column) => /title|name|handle|sku/i.test(column));
  const rowCandidates = sheet.rows.map((row, index) => ({
    index,
    titleValues: titleLikeFields
      .map((field) => String(row[field] ?? "").trim())
      .filter(Boolean),
  }));

  for (const phrase of candidatePhrases) {
    const normalizedPhrase = normalizeComparableText(phrase);
    if (!normalizedPhrase) {
      continue;
    }

    const exactMatches = rowCandidates.filter((row) => row.titleValues.some((value) => normalizeComparableText(value) === normalizedPhrase));
    if (exactMatches.length === 1) {
      return [exactMatches[0].index];
    }
  }

  const normalizedMessage = normalizeComparableText(trimmed);
  if (!normalizedMessage) {
    return null;
  }

  const strongMatches = rowCandidates.filter((row) =>
    row.titleValues.some((value) => {
      const normalizedValue = normalizeComparableText(value);
      return normalizedValue.length >= 4 && (normalizedMessage.includes(normalizedValue) || normalizedValue.includes(normalizedMessage));
    })
  );

  if (strongMatches.length === 1) {
    return [strongMatches[0].index];
  }

  return null;
}

function formatWebSources(sources: SourceUrl[]) {
  if (!sources.length) {
    return "";
  }

  return sources
    .slice(0, 5)
    .map((source) => `- ${source.title}: ${source.uri}`)
    .join("\n");
}

function formatAttachmentNames(attachments: SyncInlineAttachment[]) {
  return attachments.map((attachment) => attachment.name).join(", ");
}

function validateInlineAttachments(rawAttachments: unknown) {
  if (!Array.isArray(rawAttachments)) {
    return [] as SyncInlineAttachment[];
  }

  const allowedMimeTypes = new Set([
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/bmp",
  ]);

  const maxImageBytes = 10 * 1024 * 1024;
  const maxPdfBytes = 20 * 1024 * 1024;

  return rawAttachments.slice(0, 4).map((item, index) => {
    const attachment = item as Partial<SyncInlineAttachment>;
    const name = String(attachment?.name ?? "attachment").trim() || `attachment-${index + 1}`;
    const mimeType = String(attachment?.mimeType ?? "").trim();
    const size = Number(attachment?.size ?? 0);
    const data = String(attachment?.data ?? "").trim();

    if (!allowedMimeTypes.has(mimeType)) {
      throw new Error(`Unsupported attachment format: ${name}`);
    }

    const maxSize = mimeType === "application/pdf" ? maxPdfBytes : maxImageBytes;
    if (!Number.isFinite(size) || size <= 0 || size > maxSize) {
      throw new Error(`Attachment too large or invalid: ${name}`);
    }

    if (!data) {
      throw new Error(`Attachment data missing: ${name}`);
    }

    return { name, mimeType, size, data } satisfies SyncInlineAttachment;
  });
}

async function analyzeAttachments(params: {
  mode: SyncMode;
  instruction: string;
  integration: IntegrationContext;
  existingColumns: string[];
  attachments: SyncInlineAttachment[];
  billingTracker?: SyncBillingTracker;
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("AI service not configured");
  }

  if (params.attachments.length === 0) {
    return "No supported attachments were provided.";
  }

  const systemInstruction = `You analyze attached files for an ecommerce sheet assistant.
Return JSON only.
Rules:
- Use the attached files as the primary source of truth.
- If the user asks for identification, describe only what you can support from the file.
- If the file is a PDF, extract the relevant details faithfully.
- If the file is an image, identify the product, visible text, packaging, and notable details.
- Mention uncertainty clearly when needed.
- Do not claim platform changes were made.`;

  const prompt = `Connected platform: ${params.integration?.provider || "unknown"}
Integration name: ${params.integration?.integration_name || "unknown"}
Current columns: ${JSON.stringify(params.existingColumns)}
Attached files: ${formatAttachmentNames(params.attachments)}
User request: ${params.instruction}

Return valid JSON with this exact shape:
{
  "answer": "..."
}`;

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });

  const contents = [{ role: "user" as const, parts: [
    { text: prompt },
    ...params.attachments.map((attachment) => ({
      inlineData: {
        mimeType: attachment.mimeType,
        data: attachment.data,
      },
    })),
  ] }];

  const response = await withAiRetry(() =>
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

  trackSyncAiUsage(params.billingTracker, params.mode, response.usageMetadata);

  const text = response.text?.trim();
  if (!text) {
    throw new Error("Empty attachment analysis response");
  }

  const parsed = safeParseAiJson<{ answer?: string }>(text);
  return typeof parsed.answer === "string" ? parsed.answer.trim() : "";
}

function buildWebResearchPayload(params: {
  instruction: string;
  integration: IntegrationContext;
  sheet: SyncSheet | null;
  rowIndexes?: number[] | null;
}) {
  const sheet = params.sheet;
  const scopedRows = sheet
    ? (params.rowIndexes?.length
        ? params.rowIndexes.map((index) => sheet.rows[index]).filter(Boolean)
        : sheet.rows
      ).slice(0, 3)
    : [];

  const rowSummaries = scopedRows.map((row, index) => {
    const entries = Object.entries(row ?? {})
      .filter(([, value]) => String(value ?? "").trim())
      .slice(0, 8)
      .map(([key, value]) => [key, String(value)]);
    return { rowIndex: index, fields: Object.fromEntries(entries) };
  });

  return {
    request: params.instruction,
    provider: params.integration?.provider || "unknown",
    integrationName: params.integration?.integration_name || "unknown",
    baseUrl: params.integration?.base_url || "",
    sheetTitle: sheet?.title || "",
    sheetColumns: sheet?.columns.slice(0, 30) || [],
    sheetRowCount: sheet?.rows.length || 0,
    targetedRows: rowSummaries,
  } satisfies Record<string, string | number | string[] | { rowIndex: number; fields: Record<string, string> }[]>;
}

async function researchWithWeb(params: {
  instruction: string;
  integration: IntegrationContext;
  sheet: SyncSheet | null;
  rowIndexes?: number[] | null;
  billingTracker?: SyncBillingTracker;
}) {
  const payload = buildWebResearchPayload(params);
  const result = await searchProduct({
    request: String(payload.request ?? ""),
    provider: String(payload.provider ?? ""),
    integrationName: String(payload.integrationName ?? ""),
    baseUrl: String(payload.baseUrl ?? ""),
    sheetTitle: String(payload.sheetTitle ?? ""),
    sheetColumns: JSON.stringify(payload.sheetColumns ?? []),
    sheetRowCount: String(payload.sheetRowCount ?? 0),
    targetedRows: JSON.stringify(payload.targetedRows ?? []),
  });

  trackSyncDirectCost(params.billingTracker, result.cost);

  return {
    summary: result.text.trim(),
    sources: result.sources,
  };
}

async function requireWorkspaceMember(workspaceId: string, userId: string) {
  const admin = createAdminClient();
  const { data: member, error } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .single();

  if (error || !member) {
    throw new Error("Forbidden");
  }

  return admin;
}

async function fetchShopifyProductsSheet(workspaceId: string, userId: string, limit = 50): Promise<SyncSheet> {
  const admin = await requireWorkspaceMember(workspaceId, userId);

  const { data: integration, error: integrationError } = await admin
    .from("workspace_integrations")
    .select("provider, integration_name, base_url, config")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (integrationError) {
    throw new Error(integrationError.message);
  }

  if (!integration) {
    throw new Error("No connected integration found");
  }

  if (integration.provider !== "shopify") {
    throw new Error(`${integration.provider} is not supported yet in Sync actions`);
  }

  const adminApiToken = String(integration.config?.admin_api_token ?? "").trim();
  if (!adminApiToken) {
    throw new Error("Missing Shopify admin token in integration config");
  }

  const allProducts: any[] = [];
  const shouldLoadAll = limit <= 0;
  let nextUrl = new URL(`${integration.base_url}/admin/api/2024-10/products.json`);
  nextUrl.searchParams.set("limit", shouldLoadAll ? "250" : String(Math.min(Math.max(limit, 1), 250)));
  nextUrl.searchParams.set(
    "fields",
    "id,title,handle,status,vendor,product_type,tags,body_html,seo_title,seo_description,published_at,created_at,updated_at,variants,image,images"
  );

  while (nextUrl) {
    const response = await fetch(nextUrl.toString(), {
      method: "GET",
      headers: {
        "X-Shopify-Access-Token": adminApiToken,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Shopify products request failed (${response.status})${text ? `: ${text}` : ""}`);
    }

    const data = await response.json();
    const products = Array.isArray(data?.products) ? data.products : [];
    allProducts.push(...products);

    if (!shouldLoadAll || products.length < 250) {
      break;
    }

    const linkHeader = response.headers.get("link") || response.headers.get("Link") || "";
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/i);
    if (!nextMatch?.[1]) {
      break;
    }

    nextUrl = new URL(nextMatch[1]);
  }

  return buildShopifyCoreProductsSheet({
    integrationName: integration.integration_name,
    products: allProducts,
  });
}

async function writeSheetColumnWithAi(params: {
  rows: SyncSheetRow[];
  mode: SyncMode;
  instruction: string;
  integration: IntegrationContext;
  targetColumn: string;
  existingColumns: string[];
  rowIndexes?: number[];
  billingTracker?: SyncBillingTracker;
  onBatchProgress?: (processed: number, total: number) => void;
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("AI service not configured");
  }

  const allowedIndexes = new Set(
    Array.isArray(params.rowIndexes)
      ? params.rowIndexes.filter((index) => Number.isInteger(index) && index >= 0)
      : params.rows.map((_, index) => index)
  );

  const WRITE_BATCH_LIMIT = 50;

  const eligibleRows = params.rows
    .map((row, index) => ({
      rowIndex: index,
      values: Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, String(value ?? "")])
      ),
    }))
    .filter((row) => allowedIndexes.has(row.rowIndex));

  const totalEligible = eligibleRows.length;

  if (eligibleRows.length === 0) {
    return { values: [] as { rowIndex: number; value: string }[], totalEligible, processedCount: 0 };
  }

  const systemInstruction = `You generate values for a target sheet column in a connected ecommerce catalog.
Return JSON only.
You will receive real rows from the user's connected platform and current sheet.
Write one distinct value for the requested target column for each row.
Rules:
- Use only the provided product data.
- Do not invent specifications, materials, sizes, or features that are not present.
- Produce values appropriate for the requested target column.
- If the target column is descriptive text, keep it concise, professional, and useful for catalog publishing.
- If the target column is sparse or data is limited, generate conservative values from existing row values only.
- Preserve the rowIndex exactly as provided.`;

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });

  // Process in batches with partial recovery
  const allValues: { rowIndex: number; value: string }[] = [];
  let processedCount = 0;
  const batchWarnings: string[] = [];

  for (let batchStart = 0; batchStart < eligibleRows.length; batchStart += WRITE_BATCH_LIMIT) {
    const batch = eligibleRows.slice(batchStart, batchStart + WRITE_BATCH_LIMIT);
    const batchNumber = Math.floor(batchStart / WRITE_BATCH_LIMIT) + 1;

    const prompt = `Connected platform: ${params.integration?.provider || "unknown"}
Integration name: ${params.integration?.integration_name || "unknown"}
Current columns: ${JSON.stringify(params.existingColumns)}
Target column: ${params.targetColumn}
User instruction: ${params.instruction}

Sheet rows:
${JSON.stringify(batch, null, 2)}

Return valid JSON with this exact shape:
{
  "values": [
    {
      "rowIndex": 0,
      "value": "..."
    }
  ]
}`;

    try {
      const response = await withAiRetry(() =>
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

      trackSyncAiUsage(params.billingTracker, params.mode, response.usageMetadata);

      const text = response.text?.trim();
      if (!text) {
        batchWarnings.push(`Batch ${batchNumber}: empty AI response`);
        continue;
      }

      const parsed = safeParseAiJson<{
        values?: { rowIndex: number; value: string }[];
      }>(text);

      const batchValues = Array.isArray(parsed.values) ? parsed.values : [];
      allValues.push(...batchValues);
    } catch (err: any) {
      batchWarnings.push(`Batch ${batchNumber}: ${err?.message || "unknown error"}`);
    }

    processedCount += batch.length;
    params.onBatchProgress?.(processedCount, totalEligible);
  }

  return { values: allValues, totalEligible, processedCount, batchWarnings };
}

async function createRowWithAi(params: {
  mode: SyncMode;
  instruction: string;
  integration: IntegrationContext;
  existingColumns: string[];
  sheet: SyncSheet | null;
  billingTracker?: SyncBillingTracker;
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("AI service not configured");
  }

  const systemInstruction = `You create one new sheet row for an ecommerce catalog.
Return JSON only.
Rules:
- Produce a single row object matching the existing sheet columns as closely as possible.
- Use only information explicitly requested by the user plus conservative defaults.
- Do not invent IDs from the real platform.
- If a value is unknown, return an empty string.
- Keep the row compatible with the current sheet schema.`;

  const prompt = `Connected platform: ${params.integration?.provider || "unknown"}
Integration name: ${params.integration?.integration_name || "unknown"}
Existing columns: ${JSON.stringify(params.existingColumns)}
Current sheet summary: ${JSON.stringify(
    params.sheet
      ? {
          title: params.sheet.title,
          rowCount: params.sheet.rows.length,
          sampleRows: params.sheet.rows.slice(0, 2),
        }
      : null,
    null,
    2
  )}
User instruction: ${params.instruction}

Return valid JSON with this exact shape:
{
  "row": {
    "title": "..."
  }
}`;

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });

  const response = await withAiRetry(() =>
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

  trackSyncAiUsage(params.billingTracker, params.mode, response.usageMetadata);

  const text = response.text?.trim();
  if (!text) {
    throw new Error("Empty AI row creation response");
  }

  const parsed = safeParseAiJson<{ row?: Record<string, unknown> }>(text);
  return parsed.row && typeof parsed.row === "object" ? parsed.row : {};
}

async function searchImagesWithSerper(params: {
  rows: SyncSheetRow[];
  rowIndexes?: number[];
  instruction: string;
}) {
  const targetIndexes = Array.isArray(params.rowIndexes)
    ? params.rowIndexes.filter((index) => Number.isInteger(index) && index >= 0 && index < params.rows.length)
    : params.rows.map((_, index) => index);

  const IMAGE_SEARCH_LIMIT = 200;
  const IMAGE_SEARCH_CONCURRENCY = 8;

  const results: Array<{
    rowIndex: number;
    imageUrl: string;
    sourcePageUrl: string;
    query: string;
  }> = [];

  const capped = targetIndexes.slice(0, IMAGE_SEARCH_LIMIT);

  for (let i = 0; i < capped.length; i += IMAGE_SEARCH_CONCURRENCY) {
    const chunk = capped.slice(i, i + IMAGE_SEARCH_CONCURRENCY);

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

    for (const result of chunkResults) {
      if (result.status === "fulfilled" && result.value) {
        results.push(result.value);
      }
    }
  }

  return results;
}

async function answerQuestionAboutSheet(params: {
  rows: SyncSheetRow[];
  mode: SyncMode;
  instruction: string;
  integration: IntegrationContext;
  existingColumns: string[];
  billingTracker?: SyncBillingTracker;
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("AI service not configured");
  }

  const normalizedRows = params.rows.slice(0, 100).map((row, index) => ({
    rowIndex: index,
    values: Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, String(value ?? "")])
    ),
  }));

  const systemInstruction = `You answer questions about the current ecommerce sheet.
Return JSON only.
Rules:
- Use only the provided sheet data.
- Answer directly and clearly.
- If the user asks about duplicates, compare likely identifying fields such as title, handle, sku, vendor, and other visible row values.
- If there is uncertainty, say what you could confirm from the sheet and what remains uncertain.
- Mention row counts or row indexes when useful.
- Do not claim that a platform change was made.
- Keep the answer concise and helpful.`;

  const prompt = `Connected platform: ${params.integration?.provider || "unknown"}
Integration name: ${params.integration?.integration_name || "unknown"}
Current columns: ${JSON.stringify(params.existingColumns)}
User question: ${params.instruction}

Sheet rows:
${JSON.stringify(normalizedRows, null, 2)}

Return valid JSON with this exact shape:
{
  "answer": "..."
}`;

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });

  const response = await withAiRetry(() =>
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

  trackSyncAiUsage(params.billingTracker, params.mode, response.usageMetadata);

  const text = response.text?.trim();
  if (!text) {
    throw new Error("Empty AI sheet answer response");
  }

  const parsed = safeParseAiJson<{ answer?: string }>(text);
  return typeof parsed.answer === "string" ? parsed.answer.trim() : "";
}

async function generateSheetProgram(params: {
  rows: SyncSheetRow[];
  mode: SyncMode;
  instruction: string;
  integration: IntegrationContext;
  existingColumns: string[];
  billingTracker?: SyncBillingTracker;
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("AI service not configured");
  }

  const normalizedRows = params.rows.slice(0, 25).map((row, index) => ({
    rowIndex: index,
    values: Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, String(value ?? "")])
    ),
  }));

  const systemInstruction = `You generate a safe sheet program for an ecommerce table assistant.
Return JSON only.
Use only the allowed goals and step formats.
Prefer deterministic field-based logic over vague reasoning.
Allowed goals:
- show_filtered_sheet
- answer_only
- target_rows
Allowed step ops:
- filter
- sort
- count
- detect_duplicates
- group_count
- limit
- select_columns
Allowed predicate types:
- is_empty
- is_not_empty
- equals
- contains
- greater_than
- less_than
- equals_field
- before_date
- after_date
- greater_than_field
Rules:
- Use only existing columns.
- If the user asks for products without images, use featured_image with is_empty.
- If the user asks for products on sale or discounted, compare compare_at_price greater_than_field price.
- If the user asks for a numeric range like price between 20 and 25, use one filter step with match all and both greater_than and less_than predicates on the same field.
- If the user asks for counts by vendor, status, product type, or similar dimensions, use group_count.
- If the user asks for only certain fields to be shown, use select_columns.
- If the user asks for top 5, first 10, or a maximum number of results, use limit.
- If the user asks for recently updated, newer than, before a date, or after a date, use before_date or after_date on date columns.
- If the user compares two fields for equality, use equals_field.
- If the user asks for duplicates, use detect_duplicates.
- If the user asks for a count or asks whether matching rows exist, prefer goal answer_only and include count.
- If the user asks to show, get, list, bring, or display matching rows in the sheet, prefer goal show_filtered_sheet.
- If the user asks to use matching rows for a follow-up edit, prefer goal target_rows.
- If no valid structured program can be formed, return an empty steps array and goal answer_only.`;

  const prompt = `Connected platform: ${params.integration?.provider || "unknown"}
Integration name: ${params.integration?.integration_name || "unknown"}
Current columns: ${JSON.stringify(params.existingColumns)}
User request: ${params.instruction}

Sample rows:
${JSON.stringify(normalizedRows, null, 2)}

Return valid JSON with this exact shape:
{
  "goal": "show_filtered_sheet",
  "steps": [
    {
      "op": "filter",
      "match": "all",
      "predicates": [
        { "type": "is_empty", "field": "featured_image" }
      ]
    }
  ],
  "answerTemplate": "optional short answer"
}`;

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });

  const response = await withAiRetry(() =>
    ai.models.generateContent({
      model: MODELS[params.mode],
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        temperature: 0.1,
        maxOutputTokens: 4096,
      },
    })
  );

  trackSyncAiUsage(params.billingTracker, params.mode, response.usageMetadata);

  const text = response.text?.trim();
  if (!text) {
    throw new Error("Empty sheet program response");
  }

  return safeParseAiJson<Partial<SheetProgram>>(text);
}

function toNumericValue(value: unknown) {
  const text = String(value ?? "").replace(/,/g, "").trim();
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

function toTimestampValue(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }

  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function validateSheetProgram(program: Partial<SheetProgram>, existingColumns: string[]): SheetProgram | null {
  const allowedColumns = new Set(existingColumns);
  const goal =
    program.goal === "show_filtered_sheet" || program.goal === "target_rows" || program.goal === "answer_only"
      ? program.goal
      : "answer_only";

  if (!Array.isArray(program.steps)) {
    return { goal, steps: [], answerTemplate: typeof program.answerTemplate === "string" ? program.answerTemplate : undefined };
  }

  const steps = program.steps.flatMap((step): SheetProgramStep[] => {
    if (!step || typeof step !== "object" || !("op" in step)) {
      return [];
    }

    if (step.op === "filter") {
      const predicates = Array.isArray((step as any).predicates)
        ? (step as any).predicates.flatMap((predicate: any) => {
            if (!predicate || typeof predicate !== "object" || typeof predicate.type !== "string") {
              return [];
            }

            if (!["is_empty", "is_not_empty", "equals", "contains", "greater_than", "less_than", "equals_field", "before_date", "after_date", "greater_than_field"].includes(predicate.type)) {
              return [];
            }

            const field = String(predicate.field ?? "");
            if (!allowedColumns.has(field)) {
              return [];
            }

            if (["greater_than_field", "equals_field"].includes(predicate.type)) {
              const valueField = String(predicate.valueField ?? "");
              if (!allowedColumns.has(valueField)) {
                return [];
              }

              return [{
                type: predicate.type,
                field,
                valueField,
              } satisfies SheetProgramPredicate];
            }

            if (["greater_than", "less_than"].includes(predicate.type)) {
              const value = toNumericValue(predicate.value);
              if (value === null) {
                return [];
              }

              return [{
                type: predicate.type,
                field,
                value,
              } satisfies SheetProgramPredicate];
            }

            if (["before_date", "after_date"].includes(predicate.type)) {
              const value = String(predicate.value ?? "").trim();
              if (!value) {
                return [];
              }

              return [{
                type: predicate.type,
                field,
                value,
              } satisfies SheetProgramPredicate];
            }

            if (["equals", "contains"].includes(predicate.type)) {
              return [{
                type: predicate.type,
                field,
                value: String(predicate.value ?? ""),
              } satisfies SheetProgramPredicate];
            }

            return [{
              type: predicate.type,
              field,
            } satisfies SheetProgramPredicate];
          })
        : [];

      if (predicates.length === 0) {
        return [];
      }

      return [{
        op: "filter",
        predicates,
        match: (step as any).match === "any" ? "any" : "all",
      }];
    }

    if (step.op === "sort" && allowedColumns.has(String((step as any).field ?? ""))) {
      return [{
        op: "sort",
        field: String((step as any).field),
        direction: (step as any).direction === "desc" ? "desc" : "asc",
      }];
    }

    if (step.op === "count") {
      return [{ op: "count" }];
    }

    if (step.op === "group_count" && allowedColumns.has(String((step as any).field ?? ""))) {
      return [{
        op: "group_count",
        field: String((step as any).field),
      }];
    }

    if (step.op === "limit") {
      const count = Number((step as any).count);
      if (!Number.isInteger(count) || count <= 0) {
        return [];
      }

      return [{ op: "limit", count }];
    }

    if (step.op === "select_columns") {
      const columns = Array.isArray((step as any).columns)
        ? (step as any).columns
            .map((column: unknown) => String(column ?? ""))
            .filter((column: string) => allowedColumns.has(column))
        : [];

      if (columns.length === 0) {
        return [];
      }

      return [{ op: "select_columns", columns }];
    }

    if (step.op === "detect_duplicates") {
      const fields = Array.isArray((step as any).fields)
        ? (step as any).fields
            .map((field: unknown) => String(field ?? ""))
            .filter((field: string) => allowedColumns.has(field))
        : [];

      if (fields.length === 0) {
        return [];
      }

      return [{ op: "detect_duplicates", fields }];
    }

    return [];
  });

  return {
    goal,
    steps,
    answerTemplate: typeof program.answerTemplate === "string" ? program.answerTemplate : undefined,
  };
}

function executeSheetProgram(program: SheetProgram, sheet: SyncSheet) {
  let workingRows = [...sheet.rows];
  let workingColumns = [...sheet.columns];
  let counted = false;
  let countValue = 0;

  const evaluatePredicate = (row: SyncSheetRow, predicate: SheetProgramPredicate) => {
    const fieldValue = String(row[predicate.field] ?? "").trim();

    if (predicate.type === "is_empty") {
      return fieldValue.length === 0;
    }

    if (predicate.type === "is_not_empty") {
      return fieldValue.length > 0;
    }

    if (predicate.type === "equals") {
      return fieldValue.toLowerCase() === String(predicate.value ?? "").trim().toLowerCase();
    }

    if (predicate.type === "contains") {
      return fieldValue.toLowerCase().includes(String(predicate.value ?? "").trim().toLowerCase());
    }

    if (predicate.type === "greater_than") {
      const fieldNumber = toNumericValue(row[predicate.field]);
      return fieldNumber !== null && fieldNumber > predicate.value;
    }

    if (predicate.type === "less_than") {
      const fieldNumber = toNumericValue(row[predicate.field]);
      return fieldNumber !== null && fieldNumber < predicate.value;
    }

    if (predicate.type === "equals_field") {
      const compareValue = String(row[predicate.valueField] ?? "").trim();
      return fieldValue.toLowerCase() === compareValue.toLowerCase();
    }

    if (predicate.type === "before_date") {
      const fieldTimestamp = toTimestampValue(row[predicate.field]);
      const compareTimestamp = toTimestampValue(predicate.value);
      return fieldTimestamp !== null && compareTimestamp !== null && fieldTimestamp < compareTimestamp;
    }

    if (predicate.type === "after_date") {
      const fieldTimestamp = toTimestampValue(row[predicate.field]);
      const compareTimestamp = toTimestampValue(predicate.value);
      return fieldTimestamp !== null && compareTimestamp !== null && fieldTimestamp > compareTimestamp;
    }

    if (predicate.type === "greater_than_field") {
      const left = toNumericValue(row[predicate.field]);
      const right = toNumericValue(row[predicate.valueField]);
      return left !== null && right !== null && left > right;
    }

    return false;
  };

  for (const step of program.steps) {
    if (step.op === "filter") {
      workingRows = workingRows.filter((row) => {
        const results = step.predicates.map((predicate) => evaluatePredicate(row, predicate));
        return step.match === "any" ? results.some(Boolean) : results.every(Boolean);
      });
      continue;
    }

    if (step.op === "sort") {
      workingRows = [...workingRows].sort((a, b) => {
        const left = String(a[step.field] ?? "").trim();
        const right = String(b[step.field] ?? "").trim();
        return step.direction === "desc" ? right.localeCompare(left) : left.localeCompare(right);
      });
      continue;
    }

    if (step.op === "count") {
      counted = true;
      countValue = workingRows.length;
      continue;
    }

    if (step.op === "group_count") {
      const groups = new Map<string, number>();

      for (const row of workingRows) {
        const key = String(row[step.field] ?? "").trim() || "—";
        groups.set(key, (groups.get(key) ?? 0) + 1);
      }

      workingRows = Array.from(groups.entries())
        .map(([value, count]) => ({ [step.field]: value, count }))
        .sort((a, b) => Number(b.count ?? 0) - Number(a.count ?? 0));
      workingColumns = [step.field, "count"];
      countValue = workingRows.length;
      continue;
    }

    if (step.op === "limit") {
      workingRows = workingRows.slice(0, step.count);
      countValue = workingRows.length;
      continue;
    }

    if (step.op === "select_columns") {
      workingColumns = step.columns;
      workingRows = workingRows.map((row) => Object.fromEntries(step.columns.map((column) => [column, row[column] ?? ""])));
      continue;
    }

    if (step.op === "detect_duplicates") {
      const groups = new Map<string, SyncSheetRow[]>();

      for (const row of workingRows) {
        const key = step.fields.map((field) => String(row[field] ?? "").trim().toLowerCase()).join("||");
        if (!key.replace(/\|/g, "").trim()) {
          continue;
        }

        const existing = groups.get(key) ?? [];
        existing.push(row);
        groups.set(key, existing);
      }

      workingRows = Array.from(groups.values()).filter((group) => group.length > 1).flat();
      continue;
    }
  }

  return {
    columns: workingColumns,
    rows: workingRows,
    countValue: counted ? countValue : workingRows.length,
  };
}

async function createPlan(params: {
  userMessage: string;
  mode: SyncMode;
  integration: IntegrationContext;
  sheet: SyncSheet | null;
  messages: AgentChatMessage[];
  sessionSummary?: string;
  billingTracker?: SyncBillingTracker;
  webEnabled?: boolean;
  attachments?: SyncInlineAttachment[];
  workingMemory?: SyncWorkingMemory;
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("AI service not configured");
  }

  const sheetSummary = params.sheet
    ? {
        title: params.sheet.title,
        columns: params.sheet.columns,
        rowCount: params.sheet.rows.length,
        sampleRows: params.sheet.rows.slice(0, 5),
      }
    : null;

  const conversationSummary = params.messages.slice(-8).map((message) => ({
    role: message.role,
    content: message.content,
  }));

  const systemInstruction = `You are a planning agent for DataSheet AI, an ecommerce sheet assistant.
Your job is to select the right tools and produce a structured JSON execution plan.

Available tools:
1. load_products_from_shopify(limit?) — Load products into the sheet. Use limit 0 for all products.
2. append_row_from_ai(instruction) — Add a new row based on the current sheet schema.
3. write_sheet_column_with_ai(targetColumn, instruction, overwrite) — Create or rewrite a column for targeted rows. Includes descriptions, titles, SEO, translations, etc.
4. search_images_with_serper(instruction, targetColumn, overwrite) — Search product images. Default targetColumn is "featured_image".
5. delete_column(column) — Remove a column from the sheet.
6. run_sheet_program(instruction) — Structured filtering, counting, sorting, and analysis over the current sheet. Use for tabular queries.
7. answer_question_about_sheet(instruction) — Answer analytical questions about the current sheet data.
8. reply_only(message) — Respond without changing the sheet. Use for ambiguous requests or clarification.
9. research_with_web(instruction) — ${params.webEnabled ? "Search external web sources for grounded facts, specs, or official product details." : "UNAVAILABLE (Web mode is off)."}
10. analyze_attachments(instruction) — ${(params.attachments?.length ?? 0) > 0 ? "Analyze uploaded images or PDFs for extraction, identification, or reading." : "UNAVAILABLE (no attachments included)."}

Rules:
- Prefer operating on the current sheet if it exists.
- Result modes: answer_only (no sheet change), show_filtered_sheet (show matching rows only), target_rows (keep full sheet, select rows for follow-up edit).
- If the user asks to add/create a product or row, use append_row_from_ai.
- If writing content but no sheet exists, first load_products_from_shopify, then write.
- For tabular filter/query/count, prefer run_sheet_program.
- For analytical questions expecting an answer, use answer_question_about_sheet.
- For showing rows matching a condition, prefer show_filtered_sheet.
- For targeting rows before a mutation, prefer target_rows.
- For images, use search_images_with_serper. If targeting specific rows first, use run_sheet_program with goal target_rows, then search_images.
- Only use research_with_web when external information is truly needed. Never use it if Web mode is off.
- For grounded web content, first research_with_web, then write.
- If the user references uploaded files, prefer analyze_attachments first.
- Set useRememberedTargets to true when the user's message is a follow-up referring to previously targeted or created rows (e.g. pronouns like "it", "this", "them", implicit references like "translate it", "add a description", "عدله", "ترجمها", or any continuation of the previous action). The working memory contains lastTargetedRowIndexes and lastCreatedRowIndexes — when useRememberedTargets is true, those saved row indexes will be reused.
- Set useRememberedTargets to false when the user is making a new independent request that doesn't reference previous rows.
- If working memory has a recent research summary and the user asks to write content for the same item, reuse that context.
- Infer the target column from the user's message and existing schema. Create columns that don't exist.
- If a language name is mentioned alone (e.g. English, Arabic), infer the most likely text column to rewrite.
- If the request is ambiguous, use reply_only and ask for clarification.
- Never claim to apply changes to Shopify directly.
- Maximum 5 steps per plan.`;

  const prompt = `Connected platform: ${params.integration ? `${params.integration.provider} (${params.integration.integration_name})` : "none"}

Current sheet: ${sheetSummary ? `"${sheetSummary.title}" with ${sheetSummary.rowCount} rows and columns: ${sheetSummary.columns.join(", ")}` : "No sheet loaded"}
${sheetSummary ? `Sample rows:\n${JSON.stringify(sheetSummary.sampleRows, null, 2)}` : ""}

Session summary: ${params.sessionSummary || "None"}

Recent conversation:
${JSON.stringify(conversationSummary, null, 2)}

Working memory:
${JSON.stringify(params.workingMemory ?? EMPTY_SYNC_WORKING_MEMORY, null, 2)}

${(params.attachments?.length ?? 0) > 0 ? `Attachments: ${params.attachments!.map((a) => `${a.name} (${a.mimeType})`).join(", ")}` : ""}

User message: ${params.userMessage}`;

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });

  const planJsonSchema = {
    type: "OBJECT" as const,
    properties: {
      resultMode: {
        type: "STRING" as const,
        description: "How results should be displayed",
        enum: ["answer_only", "show_filtered_sheet", "target_rows"],
      },
      useRememberedTargets: {
        type: "BOOLEAN" as const,
        description: "True if the user message is a follow-up referencing previously targeted or created rows from working memory. False for independent requests.",
      },
      assistantMessage: {
        type: "STRING" as const,
        description: "Short plain-language summary of the plan",
      },
      steps: {
        type: "ARRAY" as const,
        description: "Ordered list of tool calls to execute",
        items: {
          type: "OBJECT" as const,
          properties: {
            tool: {
              type: "STRING" as const,
              description: "Tool name",
              enum: [
                "load_products_from_shopify",
                "append_row_from_ai",
                "write_sheet_column_with_ai",
                "search_images_with_serper",
                "delete_column",
                "run_sheet_program",
                "answer_question_about_sheet",
                "reply_only",
                "research_with_web",
                "analyze_attachments",
              ],
            },
            args: {
              type: "OBJECT" as const,
              description: "Arguments for the tool call",
              properties: {
                limit: { type: "INTEGER" as const, description: "Row limit for loading" },
                instruction: { type: "STRING" as const, description: "Instruction text for the tool" },
                targetColumn: { type: "STRING" as const, description: "Target column name" },
                overwrite: { type: "BOOLEAN" as const, description: "Whether to overwrite existing values" },
                column: { type: "STRING" as const, description: "Column name for delete_column" },
                message: { type: "STRING" as const, description: "Message text for reply_only" },
              },
            },
          },
          required: ["tool"],
        },
      },
    },
    required: ["resultMode", "assistantMessage", "steps"],
  };

  const response = await withAiRetry(
    () =>
      ai.models.generateContent({
        model: MODELS[params.mode],
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseJsonSchema: planJsonSchema,
          maxOutputTokens: 4096,
        },
      }),
    { maxRetries: 4, baseDelay: 2000, jitter: 800 }
  );

  trackSyncAiUsage(params.billingTracker, params.mode, response.usageMetadata);

  const text = response.text?.trim();
  if (!text) {
    throw new Error("Empty planner response");
  }

  const parsed = safeParseAiJson<AgentPlan>(text);
  return {
    resultMode:
      parsed.resultMode === "show_filtered_sheet" || parsed.resultMode === "target_rows" || parsed.resultMode === "answer_only"
        ? parsed.resultMode
        : "target_rows",
    useRememberedTargets: parsed.useRememberedTargets === true,
    assistantMessage: typeof parsed.assistantMessage === "string" ? parsed.assistantMessage : "",
    steps: Array.isArray(parsed.steps) ? parsed.steps.slice(0, 5) : [],
  } satisfies AgentPlan;
}

function ensureColumn(sheet: SyncSheet, column: string) {
  if (sheet.columns.includes(column)) {
    return sheet.columns;
  }
  return [...sheet.columns, column];
}

function createNdjsonStream(executor: (push: (event: AgentStreamEvent) => void) => Promise<void>) {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (event: AgentStreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        await executor(push);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        push({ type: "error", error: message });
      } finally {
        controller.close();
      }
    },
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await request.json()) as {
    workspaceId?: string;
    userMessage?: string;
    mode?: SyncMode;
    webEnabled?: boolean;
    attachments?: SyncInlineAttachment[];
    integration?: IntegrationContext;
    currentSheet?: SyncSheet | null;
    messages?: AgentChatMessage[];
    sessionSummary?: string;
    workingMemory?: SyncWorkingMemory;
    planOnly?: boolean;
    preApprovedPlan?: AgentPlan;
  };

  const {
    workspaceId,
    userMessage,
    mode = "fast",
    webEnabled = false,
    attachments: rawAttachments = [],
    integration,
    currentSheet,
    messages = [],
    sessionSummary,
    workingMemory: rawWorkingMemory,
    planOnly = false,
    preApprovedPlan,
  } = body;

  const attachments = validateInlineAttachments(rawAttachments);
  const incomingWorkingMemory = normalizeWorkingMemory(rawWorkingMemory);

  if (!workspaceId || !userMessage?.trim()) {
    return NextResponse.json({ error: "Missing workspaceId or userMessage" }, { status: 400 });
  }

  const ownerSub = await getOwnerSubscription(workspaceId);
  if (!ownerSub || !ownerSub.subscription) {
    return NextResponse.json({ error: "NO_SUBSCRIPTION" }, { status: 402 });
  }

  if (!isSubscriptionActive(ownerSub.subscription.status)) {
    return NextResponse.json({ error: "NO_SUBSCRIPTION" }, { status: 402 });
  }

  const balance = calculateCreditBalance(ownerSub.subscription);
  if (balance.total <= 0) {
    return NextResponse.json({ error: "NO_CREDITS" }, { status: 402 });
  }

  // ── Plan-only mode: return the plan without executing ──
  if (planOnly) {
    const billingTracker: SyncBillingTracker = { totalCredits: 0, totalCost: 0, totalTokens: 0 };
    const sheet: SyncSheet | null = currentSheet && Array.isArray(currentSheet.columns) && Array.isArray(currentSheet.rows)
      ? { title: currentSheet.title || "Results Workspace", columns: currentSheet.columns, rows: currentSheet.rows }
      : null;

    const plan = await createPlan({
      userMessage: userMessage.trim(),
      mode,
      integration: integration ?? null,
      sheet,
      messages: Array.isArray(messages) ? messages : [],
      sessionSummary,
      billingTracker,
      webEnabled,
      attachments,
      workingMemory: incomingWorkingMemory,
    });

    // Heuristic credit estimation per tool
    const rowCount = sheet?.rows.length ?? 0;
    const perRowCost = mode === "pro" ? 0.15 : 0.05;
    let estimatedCredits = billingTracker.totalCredits; // planning cost already tracked
    for (const step of plan.steps) {
      switch (step.tool) {
        case "write_sheet_column_with_ai":
          estimatedCredits += Math.max(1, Math.ceil(rowCount * perRowCost));
          break;
        case "append_row_from_ai":
          estimatedCredits += mode === "pro" ? 2 : 1;
          break;
        case "research_with_web":
          estimatedCredits += mode === "pro" ? 3 : 2;
          break;
        case "search_images_with_serper":
          estimatedCredits += 1;
          break;
        case "run_sheet_program":
          estimatedCredits += mode === "pro" ? 2 : 1;
          break;
        case "analyze_attachments":
          estimatedCredits += mode === "pro" ? 3 : 2;
          break;
        case "answer_question_about_sheet":
          estimatedCredits += mode === "pro" ? 2 : 1;
          break;
        default:
          estimatedCredits += 1;
          break;
      }
    }

    return NextResponse.json({ plan, estimatedCredits: Math.ceil(estimatedCredits) });
  }

  const stream = createNdjsonStream(async (push) => {
    const billingTracker: SyncBillingTracker = {
      totalCredits: 0,
      totalCost: 0,
      totalTokens: 0,
    };

    let sheet: SyncSheet | null = currentSheet && Array.isArray(currentSheet.columns) && Array.isArray(currentSheet.rows)
      ? {
          title: currentSheet.title || "Results Workspace",
          columns: currentSheet.columns,
          rows: currentSheet.rows,
        }
      : null;

    const progress: string[] = [];
    const emitProgress = (step: string) => {
      progress.push(step);
      push({ type: "progress", progress: [...progress] });
    };

    emitProgress("Analyzing your request");
    emitProgress(
      sheet
        ? `Using the current sheet with ${sheet.rows.length} rows and ${sheet.columns.length} columns`
        : "No current sheet loaded yet"
    );
    if (attachments.length > 0) {
      emitProgress(`Received ${attachments.length} supported attachment${attachments.length === 1 ? "" : "s"}`);
    }

    let workingMemory = normalizeWorkingMemory(incomingWorkingMemory);

    // Use pre-approved plan if provided, otherwise create a new plan
    const plan = preApprovedPlan && Array.isArray(preApprovedPlan.steps) && preApprovedPlan.steps.length > 0
      ? {
          resultMode: preApprovedPlan.resultMode === "show_filtered_sheet" || preApprovedPlan.resultMode === "target_rows" || preApprovedPlan.resultMode === "answer_only"
            ? preApprovedPlan.resultMode
            : "target_rows" as const,
          useRememberedTargets: preApprovedPlan.useRememberedTargets === true,
          assistantMessage: typeof preApprovedPlan.assistantMessage === "string" ? preApprovedPlan.assistantMessage : "",
          steps: preApprovedPlan.steps.slice(0, 5),
        }
      : await createPlan({
          userMessage: userMessage.trim(),
          mode,
          integration: integration ?? null,
          sheet,
          messages: Array.isArray(messages) ? messages : [],
          sessionSummary,
          billingTracker,
          webEnabled,
          attachments,
          workingMemory,
        });

    const plannerMessage = plan.assistantMessage?.trim() || "";
    let assistantMessage = plannerMessage || "Done.";
    let selectedRowIndexes: number[] | null = plan.useRememberedTargets
      ? (incomingWorkingMemory.lastTargetedRowIndexes.length > 0
          ? incomingWorkingMemory.lastTargetedRowIndexes
          : incomingWorkingMemory.lastCreatedRowIndexes.length > 0
            ? incomingWorkingMemory.lastCreatedRowIndexes
            : null)
      : null;
    let webResearchSummary = incomingWorkingMemory.lastResearchSummary || "";
    let webResearchSources: SourceUrl[] = [];
    let targetRowsStepAttempted = false;
    let targetRowsStepResolvedEmpty = false;
    const resultMode = plan.resultMode || "target_rows";
    emitProgress(`Planned ${plan.steps.length} step${plan.steps.length === 1 ? "" : "s"}`);

    for (const step of plan.steps) {
      if (step.tool === "load_products_from_shopify") {
        emitProgress("Loading products from the connected Shopify integration");
        sheet = await fetchShopifyProductsSheet(workspaceId, user.id, step.args?.limit ?? 50);
        workingMemory = {
          ...workingMemory,
          lastCreatedRowIndexes: [],
          lastTargetedRowIndexes: [],
          lastTouchedColumns: [],
          lastActionType: "load_sheet",
          updatedAt: Date.now(),
        };
        assistantMessage = mergeAssistantMessages(
          plannerMessage,
          `Loaded ${sheet.rows.length} products from ${integration?.integration_name || "the connected platform"} into the results workspace.`
        );
        emitProgress(`Loaded ${sheet.rows.length} products into the sheet workspace`);
        continue;
      }

      if (step.tool === "analyze_attachments") {
        if (attachments.length === 0) {
          throw new Error("No supported attachments available for analysis");
        }

        emitProgress("Reading the attached files");
        emitProgress("Analyzing the uploaded image or PDF with Gemini");

        const attachmentAnswer = await analyzeAttachments({
          mode,
          instruction: step.args?.instruction?.trim() || userMessage.trim(),
          integration: integration ?? null,
          existingColumns: sheet?.columns ?? [],
          attachments,
          billingTracker,
        });

        assistantMessage = mergeAssistantMessages(
          plannerMessage,
          attachmentAnswer || "I could not extract a reliable result from the uploaded files."
        );
        emitProgress("Prepared an answer from the uploaded files");
        continue;
      }

      if (step.tool === "append_row_from_ai") {
        if (!sheet) {
          throw new Error("No current sheet available for row creation");
        }

        emitProgress("Preparing a new row using the current sheet schema");
        const aiRow = await createRowWithAi({
          mode,
          instruction: buildInstructionWithWebContext(step.args?.instruction?.trim() || userMessage.trim(), webResearchSummary),
          integration: integration ?? null,
          existingColumns: sheet.columns,
          sheet,
          billingTracker,
        });

        const normalizedRow = sheet.columns.reduce<Record<string, unknown>>((acc, column) => {
          acc[column] = aiRow[column] ?? "";
          return acc;
        }, {});

        sheet = {
          title: sheet.title,
          columns: sheet.columns,
          rows: [...sheet.rows, normalizedRow],
        };

        const newRowIndex = sheet.rows.length - 1;
        selectedRowIndexes = [newRowIndex];
        workingMemory = {
          ...workingMemory,
          lastCreatedRowIndexes: [newRowIndex],
          lastTargetedRowIndexes: [newRowIndex],
          lastExplicitEntityLabel: String(normalizedRow.title ?? "").trim() || extractEntityLabelFromInstruction(step.args?.instruction?.trim() || userMessage.trim()),
          lastActionType: "append_row",
          updatedAt: Date.now(),
        };

        assistantMessage = mergeAssistantMessages(
          plannerMessage,
          "I added a new row to the current sheet based on your product request."
        );
        emitProgress("Added one new row to the current sheet");
        continue;
      }

      if (step.tool === "run_sheet_program") {
        if (!sheet) {
          throw new Error("No current sheet available for sheet program execution");
        }

        selectedRowIndexes = null;
        const deterministicTargets = resolveDeterministicTargetRowIndexes(step.args?.instruction?.trim() || userMessage.trim(), sheet);
        if (deterministicTargets?.length) {
          selectedRowIndexes = deterministicTargets;
          targetRowsStepAttempted = true;
          targetRowsStepResolvedEmpty = false;
          workingMemory = {
            ...workingMemory,
            lastCreatedRowIndexes: [],
            lastTargetedRowIndexes: deterministicTargets,
            lastActionType: "target_rows",
            updatedAt: Date.now(),
          };
          assistantMessage = mergeAssistantMessages(
            plannerMessage,
            deterministicTargets.length === 1
              ? `I targeted row ${deterministicTargets[0] + 1} from the current sheet.`
              : `I targeted ${deterministicTargets.length} rows from the current sheet.`
          );
          emitProgress(
            deterministicTargets.length === 1
              ? `Targeted row ${deterministicTargets[0] + 1} directly from the sheet`
              : `Targeted ${deterministicTargets.length} rows directly from the sheet`
          );
          continue;
        }
        emitProgress("Generating a structured sheet program from your request");
        const generatedProgram = await generateSheetProgram({
          rows: sheet.rows,
          mode,
          instruction: buildInstructionWithWebContext(step.args?.instruction?.trim() || userMessage.trim(), webResearchSummary),
          integration: integration ?? null,
          existingColumns: sheet.columns,
          billingTracker,
        });

        const program = validateSheetProgram(generatedProgram, sheet.columns);
        if (!program || program.steps.length === 0) {
          assistantMessage = "I could not build a reliable sheet program for that request.";
          emitProgress("No valid structured sheet program could be formed");
          continue;
        }

        emitProgress(`Executing sheet program with ${program.steps.length} step${program.steps.length === 1 ? "" : "s"}`);
        const execution = executeSheetProgram(program, sheet);

        if (program.goal === "show_filtered_sheet") {
          sheet = {
            title: withSheetTitleSuffix(sheet.title, "Program results"),
            columns: execution.columns,
            rows: execution.rows,
          };
          workingMemory = {
            ...workingMemory,
            lastCreatedRowIndexes: [],
            lastTargetedRowIndexes: [],
            lastTouchedColumns: [],
            lastActionType: "load_sheet",
            updatedAt: Date.now(),
          };
          assistantMessage = mergeAssistantMessages(
            plannerMessage,
            program.answerTemplate?.trim() || `I found ${sheet.rows.length} matching row${sheet.rows.length === 1 ? "" : "s"} and displayed them in the sheet.`
          );
          emitProgress(`Displayed ${sheet.rows.length} row${sheet.rows.length === 1 ? "" : "s"} from the sheet program`);
          continue;
        }

        if (program.goal === "target_rows") {
          targetRowsStepAttempted = true;
          const allowedRows = new Set(execution.rows);
          selectedRowIndexes = sheet.rows
            .map((row, index) => (allowedRows.has(row) ? index : -1))
            .filter((index) => index >= 0);
          targetRowsStepResolvedEmpty = selectedRowIndexes.length === 0;

          workingMemory = {
            ...workingMemory,
            lastCreatedRowIndexes: [],
            lastTargetedRowIndexes: selectedRowIndexes,
            lastActionType: "target_rows",
            updatedAt: Date.now(),
          };

          assistantMessage = mergeAssistantMessages(
            plannerMessage,
            program.answerTemplate?.trim() || `I targeted ${selectedRowIndexes.length} row${selectedRowIndexes.length === 1 ? "" : "s"} from the current sheet.`
          );
          emitProgress(`Targeted ${selectedRowIndexes.length} row${selectedRowIndexes.length === 1 ? "" : "s"} from the sheet program`);
          continue;
        }

        assistantMessage = mergeAssistantMessages(
          plannerMessage,
          program.answerTemplate?.trim() || `I found ${execution.countValue} matching row${execution.countValue === 1 ? "" : "s"} in the current sheet.`
        );
        emitProgress("Prepared an answer from the structured sheet program");
        continue;
      }

      if (step.tool === "write_sheet_column_with_ai") {
        if (!sheet) {
          throw new Error("No current sheet available for column writing");
        }

        const targetColumn = step.args?.targetColumn?.trim() || "description";
        const overwrite = step.args?.overwrite ?? true;
        const columnExists = sheet.columns.includes(targetColumn);
        const rememberedTargets = plan.useRememberedTargets
          ? (selectedRowIndexes?.length
              ? selectedRowIndexes
              : workingMemory.lastTargetedRowIndexes.length > 0
                ? workingMemory.lastTargetedRowIndexes
                : workingMemory.lastCreatedRowIndexes.length > 0
                  ? workingMemory.lastCreatedRowIndexes
                  : null)
          : selectedRowIndexes;

        if (targetRowsStepAttempted && targetRowsStepResolvedEmpty) {
          assistantMessage = mergeAssistantMessages(
            plannerMessage,
            "I could not find any matching rows to update, so I stopped before changing the sheet."
          );
          emitProgress("Stopped the write because the targeting step returned 0 matching rows");
          continue;
        }

        const effectiveRowIndexes = rememberedTargets?.length ? rememberedTargets : undefined;
        const targetRowCount = effectiveRowIndexes?.length ?? sheet.rows.length;
        emitProgress(
          columnExists
            ? `Writing into existing column: ${targetColumn}`
            : `Creating and writing new column: ${targetColumn}`
        );

        const writeResult = await writeSheetColumnWithAi({
          rows: sheet.rows,
          mode,
          instruction: buildInstructionWithWebContext(step.args?.instruction?.trim() || userMessage.trim(), webResearchSummary),
          integration: integration ?? null,
          targetColumn,
          existingColumns: sheet.columns,
          rowIndexes: effectiveRowIndexes,
          billingTracker,
          onBatchProgress: (processed, total) => {
            if (total > 50) {
              emitProgress(`Writing ${targetColumn}: ${processed}/${total} rows processed`);
            }
          },
        });

        const valueMap = new Map<number, string>();
        for (const item of writeResult.values) {
          if (typeof item?.rowIndex === "number" && typeof item?.value === "string") {
            valueMap.set(item.rowIndex, item.value.trim());
          }
        }

        sheet = {
          title: sheet.title,
          columns: ensureColumn(sheet, targetColumn),
          rows: sheet.rows.map((row, index) => {
            const nextValue = valueMap.get(index);
            if (!nextValue) {
              return row;
            }
            if (!overwrite && String(row[targetColumn] ?? "").trim()) {
              return row;
            }
            return {
              ...row,
              [targetColumn]: nextValue,
            };
          }),
        };

        const wasLimited = writeResult.totalEligible > writeResult.processedCount;
        const batchFailures = writeResult.batchWarnings?.length ?? 0;
        const writeSummary = columnExists
          ? `I updated the ${targetColumn} column for ${writeResult.processedCount} row${writeResult.processedCount === 1 ? "" : "s"} in the current sheet.`
          : `I created the ${targetColumn} column and filled it for ${writeResult.processedCount} row${writeResult.processedCount === 1 ? "" : "s"} in the current sheet.`;
        const limitWarning = wasLimited
          ? `\n\n⚠️ Note: ${writeResult.totalEligible} rows were eligible but only ${writeResult.processedCount} were processed in this batch. Use row targeting to process specific rows, or repeat the request to continue.`
          : "";
        const batchFailWarning = batchFailures > 0
          ? `\n\n⚠️ ${batchFailures} batch${batchFailures === 1 ? "" : "es"} failed but ${writeResult.values.length} values were still saved successfully.`
          : "";
        assistantMessage = mergeAssistantMessages(plannerMessage, writeSummary + limitWarning + batchFailWarning);
        emitProgress(
          wasLimited
            ? `Wrote ${targetColumn} for ${writeResult.processedCount} of ${writeResult.totalEligible} eligible rows (batch limit reached)`
            : `Finished writing ${targetColumn} values for ${writeResult.processedCount} row${writeResult.processedCount === 1 ? "" : "s"}`
        );
        selectedRowIndexes = effectiveRowIndexes ?? null;
        workingMemory = {
          ...workingMemory,
          lastTargetedRowIndexes: effectiveRowIndexes ?? [],
          lastTouchedColumns: [targetColumn],
          lastActionType: "write_column",
          updatedAt: Date.now(),
        };
        continue;
      }

      if (step.tool === "search_images_with_serper") {
        if (!sheet) {
          throw new Error("No current sheet available for image search");
        }

        const targetColumn = step.args?.targetColumn?.trim() || "featured_image";
        const overwrite = step.args?.overwrite ?? true;
        const targetRowCount = selectedRowIndexes?.length ?? sheet.rows.length;

        emitProgress(`Searching product images with Serper for ${targetRowCount} row${targetRowCount === 1 ? "" : "s"}`);

        const imageResults = await searchImagesWithSerper({
          rows: sheet.rows,
          rowIndexes: selectedRowIndexes ?? undefined,
          instruction: step.args?.instruction?.trim() || userMessage.trim(),
        });

        const imageMap = new Map(imageResults.map((item) => [item.rowIndex, item]));
        const nextColumns = [targetColumn, "image_source_page", "image_search_query"].reduce(
          (columns, column) => (columns.includes(column) ? columns : [...columns, column]),
          sheet.columns
        );

        sheet = {
          title: sheet.title,
          columns: nextColumns,
          rows: sheet.rows.map((row, index) => {
            const match = imageMap.get(index);
            if (!match) {
              return row;
            }

            if (!overwrite && String(row[targetColumn] ?? "").trim()) {
              return row;
            }

            return {
              ...row,
              [targetColumn]: match.imageUrl,
              image_source_page: match.sourcePageUrl,
              image_search_query: match.query,
            };
          }),
        };

        assistantMessage = mergeAssistantMessages(
          plannerMessage,
          imageResults.length > 0
            ? `I found image results for ${imageResults.length} row${imageResults.length === 1 ? "" : "s"} and wrote them into ${targetColumn}.`
            : "I could not find suitable image results for the targeted rows."
        );
        emitProgress(
          imageResults.length > 0
            ? `Stored image results for ${imageResults.length} row${imageResults.length === 1 ? "" : "s"}`
            : "No suitable image results were found"
        );
        selectedRowIndexes = null;
        continue;
      }

      if (step.tool === "research_with_web") {
        const researchInstruction = step.args?.instruction?.trim() || userMessage.trim();
        emitProgress("Searching the web for external sources");
        emitProgress("Reviewing grounded sources and building a research summary");

        const research = await researchWithWeb({
          instruction: researchInstruction,
          integration: integration ?? null,
          sheet,
          rowIndexes: selectedRowIndexes,
          billingTracker,
        });

        webResearchSummary = research.summary;
        webResearchSources = research.sources;
        workingMemory = {
          ...workingMemory,
          lastResearchSummary: research.summary || null,
          lastResearchSubject: extractEntityLabelFromInstruction(researchInstruction),
          lastActionType: "research_web",
          updatedAt: Date.now(),
        };

        assistantMessage = mergeAssistantMessages(plannerMessage, research.summary || "I searched the web but could not gather a strong grounded summary.");
        emitProgress(
          research.sources.length > 0
            ? `Finished reviewing ${research.sources.length} web source${research.sources.length === 1 ? "" : "s"}`
            : "Finished the web search with limited source grounding"
        );
        continue;
      }

      if (step.tool === "delete_column") {
        if (!sheet) {
          throw new Error("No current sheet available for deleting a column");
        }

        selectedRowIndexes = null;

        const column = String(step.args?.column ?? "").trim();
        if (!column) {
          throw new Error("Missing column name for delete_column");
        }

        emitProgress(`Deleting column: ${column}`);

        sheet = {
          title: sheet.title,
          columns: sheet.columns.filter((item) => item !== column),
          rows: sheet.rows.map((row) => {
            const nextRow = { ...row };
            delete nextRow[column];
            return nextRow;
          }),
        };

        assistantMessage = mergeAssistantMessages(
          plannerMessage,
          `I deleted the ${column} column from the current sheet.`
        );
        emitProgress(`Deleted the ${column} column from the sheet schema`);
        continue;
      }

      if (step.tool === "answer_question_about_sheet") {
        if (!sheet) {
          throw new Error("No current sheet available for answering sheet questions");
        }

        selectedRowIndexes = null;
        emitProgress("Reviewing the current sheet to answer your question");
        const answer = await answerQuestionAboutSheet({
          rows: sheet.rows,
          mode,
          instruction: buildInstructionWithWebContext(step.args?.instruction?.trim() || userMessage.trim(), webResearchSummary),
          integration: integration ?? null,
          existingColumns: sheet.columns,
          billingTracker,
        });

        assistantMessage = mergeAssistantMessages(
          plannerMessage,
          answer || "I could not determine a reliable answer from the current sheet."
        );
        emitProgress("Prepared an answer from the current sheet");
        continue;
      }

      if (step.tool === "reply_only") {
        selectedRowIndexes = null;
        emitProgress("No sheet change was needed for this request");
        assistantMessage = mergeAssistantMessages(plannerMessage, step.args?.message?.trim() || assistantMessage);
      }
    }

    const formattedWebSources = formatWebSources(webResearchSources);
    if (formattedWebSources) {
      assistantMessage = mergeAssistantMessages(assistantMessage, `Web sources:\n${formattedWebSources}`);
    }

    if (billingTracker.totalCredits > 0) {
      const admin = createAdminClient();
      const creditsToDeduct = Math.min(balance.total, billingTracker.totalCredits);
      const { data: deductionResult, error: deductionError } = await admin.rpc("deduct_user_credits", {
        p_user_id: ownerSub.ownerId,
        p_amount: creditsToDeduct,
        p_workspace_id: workspaceId,
        p_operation: "ai_function",
        p_uid: user.id,
        p_details: {
          mode,
          source: "sync_agent",
          userMessage: userMessage.slice(0, 200),
          totalCost: Number(billingTracker.totalCost.toFixed(6)),
          totalTokens: billingTracker.totalTokens,
          totalCredits: billingTracker.totalCredits,
        },
      });

      if (deductionError) {
        console.warn(`[Sync Agent] Credit deduction failed: ${deductionError.message}`);
      } else if (!deductionResult?.success) {
        console.warn(`[Sync Agent] Credit deduction rejected: ${deductionResult?.error || "unknown"}`);
      }
    }

    const nextSessionSummary = [
      `Last user request: ${userMessage.trim()}`,
      `Last outcome: ${assistantMessage}`,
      sheet
        ? `Current sheet: ${sheet.title} (${sheet.rows.length} rows, columns: ${sheet.columns.join(", ")})`
        : "Current sheet: none",
    ].join("\n");

    const actionReceipt: ActionReceipt = {
      toolsExecuted: plan.steps.map((s) => s.tool),
      rowsAffected: workingMemory.lastTargetedRowIndexes.length || workingMemory.lastCreatedRowIndexes.length || 0,
      columnsAffected: workingMemory.lastTouchedColumns,
      sheetRowCount: sheet?.rows.length ?? 0,
      warnings: [],
    };

    const response: AgentResponse = {
      assistantMessage,
      progress,
      sessionSummary: nextSessionSummary,
      sheet,
      executedSteps: plan.steps,
      workingMemory,
      actionReceipt,
    };

    push({ type: "result", data: response });
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
    status: 200,
  });
}
