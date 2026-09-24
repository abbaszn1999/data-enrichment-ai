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

/**
 * An attempt that OpenAI billed (the response carried `usage`) but whose
 * result could not be used. Callers that retry add `costs` to the row total.
 */
export class EnrichBilledAttemptError extends Error {
  readonly costs: AiCallCost[];

  constructor(message: string, costs: AiCallCost[]) {
    super(message);
    this.name = "EnrichBilledAttemptError";
    this.costs = costs;
  }
}

export function billedCostsOf(error: unknown): AiCallCost[] {
  return error instanceof EnrichBilledAttemptError ? error.costs : [];
}

export type EnrichResponseParser = (input: {
  selection: Record<string, unknown>;
  response: OpenAiResponse;
}) => Record<string, unknown>;

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
  /** Sent as the Responses `instructions` field (stable prefix, cache friendly). */
  instructions?: string;
  /** Replaces the column-spec parser for agents with their own output contract. */
  parse?: EnrichResponseParser;
  /** web_search `filters`: only / never search these domains (≤100 each). */
  webSearchFilters?: { allowedDomains?: string[]; blockedDomains?: string[] };
  /**
   * Overrides `image_settings.max_results` (raw candidates OpenAI's search
   * returns), independent of `policy.imageCount` (the final output cap in
   * the schema's `maxItems`). Defaults to `policy.imageCount` so callers that
   * don't set this keep today's exact behavior.
   */
  imageSearchPoolSize?: number;
}): Promise<{
  data: Record<string, unknown>;
  /** Every billed call for this result, including a failed first attempt. */
  costs: AiCallCost[];
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
      max_results: params.imageSearchPoolSize ?? params.policy.imageCount,
      caption: true,
    };
  } else {
    // Text-only search — omit image content types
    webSearchTool.search_content_types = ["text"];
  }

  const filters: Record<string, string[]> = {};
  if (params.webSearchFilters?.allowedDomains?.length) {
    filters.allowed_domains = params.webSearchFilters.allowedDomains;
  }
  if (params.webSearchFilters?.blockedDomains?.length) {
    filters.blocked_domains = params.webSearchFilters.blockedDomains;
  }
  const hasFilters = Object.keys(filters).length > 0;

  const include: string[] = [];
  if (params.policy.includeResults) include.push("web_search_call.results");
  if (params.policy.includeSources) include.push("web_search_call.action.sources");

  const postOnce = async (imageUrls: string[], withFilters: boolean) => {
    const tool = withFilters ? { ...webSearchTool, filters } : webSearchTool;
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
      domainFilters: withFilters ? filters : undefined,
    });

    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        ...(params.instructions ? { instructions: params.instructions } : {}),
        reasoning: { effort: reasoningEffort },
        tools: [tool],
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

    const searchCallCount = countWebSearchCalls(body);
    const cost = calculateOpenAiWebSearchCost(model, body.usage, searchCallCount);
    const fail = (message: string): never => {
      if (body.usage) throw new EnrichBilledAttemptError(message, [cost]);
      throw new Error(message);
    };

    if (!response.ok) {
      fail(body.error?.message || `OpenAI enrich failed (${response.status})`);
    }
    if (body.status && body.status !== "completed") {
      fail(`OpenAI enrich ended with status ${body.status}`);
    }

    const selection = parseJsonObject(responseOutputText(body));
    if (!selection) {
      return fail("OpenAI enrich returned no parseable JSON output");
    }

    let data: Record<string, unknown>;
    try {
      data = params.parse
        ? params.parse({ selection, response: body })
        : buildEnrichedData({
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
    } catch (error) {
      return fail(
        error instanceof Error ? error.message : "OpenAI enrich output could not be parsed"
      );
    }

    console.log(`[Enrich OpenAI] Finished`, {
      model,
      searchCallCount,
      totalCost: cost.totalCost,
      notes:
        typeof selection.notes === "string"
          ? selection.notes.slice(0, 200)
          : undefined,
    });

    return { data, costs: [cost], searchCallCount, model };
  };

  // Each recovery (dead source image, rejected domain filter) is tried once;
  // billed costs from every attempt carry into the result or the final error.
  let imageUrls = params.imageUrls;
  let withFilters = hasFilters;
  const priorCosts: AiCallCost[] = [];
  for (;;) {
    try {
      const result = await postOnce(imageUrls, withFilters);
      return { ...result, costs: [...priorCosts, ...result.costs] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      priorCosts.push(...billedCostsOf(error));
      if (inputImageParts(imageUrls).length > 0 && isOpenAiInputImageDownloadError(message)) {
        console.warn(
          `[Enrich OpenAI] Source image download failed; retrying without input_image`,
          { message }
        );
        imageUrls = [];
        continue;
      }
      if (withFilters && isOpenAiWebSearchFilterError(message)) {
        // Domain rules are still enforced on the results by the caller.
        console.warn(
          `[Enrich OpenAI] web_search filters rejected; retrying without them`,
          { message }
        );
        withFilters = false;
        continue;
      }
      if (priorCosts.length > 0) {
        throw new EnrichBilledAttemptError(message, priorCosts);
      }
      throw error;
    }
  }
}

/** OpenAI refused the web_search `filters` block (e.g. unsupported with image search). */
export function isOpenAiWebSearchFilterError(message: string): boolean {
  return /allowed_domains|blocked_domains|\bfilters\b/i.test(message);
}
