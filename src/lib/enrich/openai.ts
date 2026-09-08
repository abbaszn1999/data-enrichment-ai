import { calculateOpenAiWebSearchCost, type AiCallCost } from "@/lib/ai-pricing";
import type { CategoryItem, SessionKind } from "@/types";
import {
  resolveEnrichOpenAiModel,
  resolveEnrichReasoningEffort,
  resolveEnrichSearchContextSize,
  type EnrichOpenAiModelId,
} from "./models";
import type { EnrichToolPolicy } from "./policy";
import type {
  EnrichColumnConfig,
  EnrichSettings,
  OpenAiResponse,
} from "./types";
import {
  buildEnrichedData,
  countWebSearchCalls,
  parseJsonObject,
  responseOutputText,
} from "./parse";

export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export function requireOpenAiApiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  return key;
}

/** OpenAI failed to fetch a source `input_image` URL (dead dummy/CDN links). */
export function isOpenAiInputImageDownloadError(message: string): boolean {
  const text = message.toLowerCase();
  if (text.includes("error while downloading file")) return true;
  if (
    text.includes("upstream status code") &&
    /\b(401|403|404|410)\b/.test(text)
  ) {
    return true;
  }
  if (
    text.includes("invalid_image_url") ||
    text.includes("unable to download") ||
    text.includes("could not download") ||
    text.includes("error downloading")
  ) {
    return true;
  }
  return false;
}

function inputImageParts(imageUrls: string[]): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [];
  for (const url of imageUrls) {
    if (!url) continue;
    const imageUrl =
      url.startsWith("data:image/") || /^https?:\/\//i.test(url) ? url : null;
    if (!imageUrl) continue;
    parts.push({
      type: "input_image",
      image_url: imageUrl,
      detail: "high",
    });
  }
  return parts;
}

export async function runEnrichOpenAiResponse(params: {
  tier: EnrichSettings["enrichmentModel"];
  promptText: string;
  imageUrls: string[];
  policy: EnrichToolPolicy;
  schemaName: string;
  schema: Record<string, unknown>;
  enabledColumns: string[];
  enrichmentColumns?: EnrichColumnConfig[];
  kind?: SessionKind;
  rowData?: Record<string, string>;
  language?: string;
  workspaceCategories?: CategoryItem[];
  categoriesRawRows?: Record<string, string>[];
  cmsType?: string;
  maxCategories?: number;
}): Promise<{
  data: Record<string, unknown>;
  cost: AiCallCost;
  searchCallCount: number;
  model: EnrichOpenAiModelId;
}> {
  const apiKey = requireOpenAiApiKey();
  const model = resolveEnrichOpenAiModel(params.tier);
  const reasoningEffort = resolveEnrichReasoningEffort(params.tier);
  const searchContextSize = resolveEnrichSearchContextSize(params.tier);

  const webSearchTool: Record<string, unknown> = {
    type: "web_search",
    search_context_size: searchContextSize,
    external_web_access: true,
  };

  if (params.policy.searchContentTypes.includes("image")) {
    webSearchTool.search_content_types = params.policy.searchContentTypes;
    webSearchTool.image_settings = {
      max_results: params.policy.imageCount,
      caption: true,
    };
  } else {
    // Text-only search — omit image content types
    webSearchTool.search_content_types = ["text"];
  }

  const include: string[] = [];
  if (params.policy.includeResults) include.push("web_search_call.results");
  if (params.policy.includeSources) include.push("web_search_call.action.sources");

  const postOnce = async (imageUrls: string[]) => {
    const content: Array<Record<string, unknown>> = [
      ...inputImageParts(imageUrls),
      { type: "input_text", text: params.promptText },
    ];

    console.log(`[Enrich OpenAI] Starting row enrichment`, {
      model,
      reasoningEffort,
      searchContextSize,
      toolChoice: params.policy.toolChoice,
      columns: params.enabledColumns,
      needsImages: params.policy.needsImages,
      needsSources: params.policy.needsSources,
      attachedSourceImages: imageUrls.length,
    });

    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        reasoning: { effort: reasoningEffort },
        tools: [webSearchTool],
        tool_choice: params.policy.toolChoice,
        ...(include.length > 0 ? { include } : {}),
        input: [{ role: "user", content }],
        text: {
          format: {
            type: "json_schema",
            name: params.schemaName,
            strict: true,
            schema: params.schema,
          },
        },
        store: true,
      }),
      signal: AbortSignal.timeout(180_000),
    });

    const rawText = await response.text();
    let body: OpenAiResponse;
    try {
      body = JSON.parse(rawText) as OpenAiResponse;
    } catch {
      throw new Error(`OpenAI enrich returned invalid JSON (${response.status})`);
    }
    if (!response.ok) {
      throw new Error(
        body.error?.message || `OpenAI enrich failed (${response.status})`
      );
    }
    if (body.status && body.status !== "completed") {
      throw new Error(`OpenAI enrich ended with status ${body.status}`);
    }

    const selection = parseJsonObject(responseOutputText(body));
    if (!selection) {
      throw new Error("OpenAI enrich returned no parseable JSON output");
    }

    const data = buildEnrichedData({
      selection,
      response: body,
      enabledColumns: params.enabledColumns,
      enrichmentColumns: params.enrichmentColumns,
      kind: params.kind,
      rowData: params.rowData,
      language: params.language,
      workspaceCategories: params.workspaceCategories,
      categoriesRawRows: params.categoriesRawRows,
      cmsType: params.cmsType,
      maxCategories: params.maxCategories,
    });

    const searchCallCount = countWebSearchCalls(body);
    const cost = calculateOpenAiWebSearchCost(model, body.usage, searchCallCount);

    console.log(`[Enrich OpenAI] Finished`, {
      model,
      searchCallCount,
      totalCost: cost.totalCost,
      notes:
        typeof selection.notes === "string"
          ? selection.notes.slice(0, 200)
          : undefined,
    });

    return { data, cost, searchCallCount, model };
  };

  try {
    return await postOnce(params.imageUrls);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attachedSourceImages = inputImageParts(params.imageUrls).length;
    if (!attachedSourceImages || !isOpenAiInputImageDownloadError(message)) {
      throw error;
    }
    console.warn(
      `[Enrich OpenAI] Source image download failed; retrying without input_image`,
      { message }
    );
    return postOnce([]);
  }
}
