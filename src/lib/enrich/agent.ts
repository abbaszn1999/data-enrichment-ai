import type { SessionKind } from "@/types";
import {
  ENRICH_MAX_OUTPUT_TOKENS,
  ENRICH_MODEL,
  ENRICH_REASONING_EFFORT,
  ENRICH_SEARCH_CONTEXT_SIZE,
} from "./models";
import type { EnrichAgentParams, EnrichAgentResult } from "./types";
import { buildEnrichToolPolicy } from "./policy";
import { buildEnrichJsonSchema } from "./schema";
import { buildEnrichPrompt } from "./prompt";
import type { AiCallCost } from "@/lib/ai-pricing";
import {
  billedCostsOf,
  EnrichBilledAttemptError,
  EnrichCancelledError,
  EnrichProviderUnavailableError,
  runEnrichOpenAiResponse,
} from "./openai";
import { findProductImages, isImageFinderRun } from "./image-finder/agent";
import { imageFinderNotFoundKey } from "./image-finder/not-found";
import { classifyProductCategories, isCategoriesModeRun } from "./categories-agent";
import { SOURCE_URLS_COLUMN_ID } from "@/types";
import { findSourceUrls, usesGoogleSourceUrls } from "./source-urls/agent";

/**
 * Enrich a single row with one OpenAI Responses call (hosted web_search +
 * structured JSON for the requested columns). Works for both session kinds;
 * `kind` selects which column specs, prompt framing, and tool policy apply.
 */
export async function enrichRow(
  params: EnrichAgentParams
): Promise<EnrichAgentResult> {
  const { enabledColumns } = params;
  const kind: SessionKind = params.kind ?? "product";

  if (!enabledColumns.length) {
    throw new Error("No enrichment columns selected");
  }
  if (isImageFinderRun(kind, enabledColumns)) {
    return findProductImages(params);
  }
  if (isCategoriesModeRun(kind, enabledColumns)) {
    return classifyProductCategories(params);
  }

  // Source URLs is answered by Google AI Mode, not by the OpenAI call. Alone it
  // needs no OpenAI call at all; next to other columns the two run side by
  // side, so the row takes as long as the slower of the two.
  if (usesGoogleSourceUrls(kind, enabledColumns)) {
    const others = enabledColumns.filter((id) => id !== SOURCE_URLS_COLUMN_ID);
    if (others.length === 0) return findSourceUrls(params);
    return enrichWithGoogleSourceUrls(params, others);
  }

  return enrichWithOpenAi(params, enabledColumns);
}

/** Adds costs the OpenAI side billed (or Google billed) to an error so the row is still charged for them. */
function withExtraCosts(error: unknown, extra: AiCallCost[]): unknown {
  if (extra.length === 0) return error;
  if (
    error instanceof EnrichBilledAttemptError ||
    error instanceof EnrichCancelledError ||
    error instanceof EnrichProviderUnavailableError
  ) {
    error.costs.push(...extra);
    return error;
  }
  return new EnrichBilledAttemptError(error instanceof Error ? error.message : String(error), extra);
}

async function enrichWithGoogleSourceUrls(
  params: EnrichAgentParams,
  otherColumns: string[]
): Promise<EnrichAgentResult> {
  const [openAi, sources] = await Promise.allSettled([
    enrichWithOpenAi(params, otherColumns),
    findSourceUrls(params),
  ]);

  if (openAi.status === "rejected") {
    // The OpenAI work decides the row. Whatever Google billed is still charged.
    const googleCosts = sources.status === "fulfilled" ? sources.value.costs : billedCostsOf(sources.reason);
    throw withExtraCosts(openAi.reason, googleCosts);
  }

  if (sources.status === "rejected") {
    // Stop was clicked: end the row like any other stopped row, charged for what both providers billed.
    if (sources.reason instanceof EnrichCancelledError) {
      throw withExtraCosts(sources.reason, openAi.value.costs);
    }
    // Any other Google failure must not throw away the columns OpenAI already
    // wrote (and billed): they are kept, and the Source URLs cell says why it is empty.
    const message = sources.reason instanceof Error ? sources.reason.message : String(sources.reason);
    console.error("[Enrich] Source URLs search failed; the other columns were kept", { message: message.slice(0, 300) });
    return {
      data: {
        ...openAi.value.data,
        [SOURCE_URLS_COLUMN_ID]: [],
        [imageFinderNotFoundKey(SOURCE_URLS_COLUMN_ID)]: `The Google AI Mode search failed, so no pages were found. Run this column again. (${message.slice(0, 200)})`,
      },
      costs: [...openAi.value.costs, ...billedCostsOf(sources.reason)],
    };
  }

  return {
    data: { ...openAi.value.data, ...sources.value.data },
    costs: [...openAi.value.costs, ...sources.value.costs],
  };
}

async function enrichWithOpenAi(
  params: EnrichAgentParams,
  enabledColumns: string[]
): Promise<EnrichAgentResult> {
  const {
    productData,
    enrichmentColumns,
    settings,
    cmsType,
    workspaceCategories,
    categoriesRawRows,
  } = params;
  const kind: SessionKind = params.kind ?? "product";

  // One fixed agent: GPT-6.1 Sol, medium reasoning, web search always required.
  // The stored `enrichmentModel` (standard / premium) no longer changes anything.
  const basePolicy = buildEnrichToolPolicy(enabledColumns, enrichmentColumns, kind);
  const policy = { ...basePolicy, toolChoice: "required" as const };
  const catCol = enrichmentColumns?.find(
    (c) => c.id === "categories" || c.id === "parentCategory"
  );
  const maxCategories = catCol?.maxCategories ?? 3;
  const hasStoreCategoryAllowlist = (workspaceCategories?.length ?? 0) > 0;
  const outputLanguage = settings?.outputLanguage || "English";

  const { name: schemaName, schema } = buildEnrichJsonSchema(
    enabledColumns,
    enrichmentColumns,
    policy,
    {
      hasStoreCategoryAllowlist,
      kind,
      workspaceCategories,
      cmsType,
      language: outputLanguage,
    }
  );
  const { instructions, text, imageUrls } = buildEnrichPrompt({
    productData,
    enabledColumns,
    enrichmentColumns,
    settings: { enrichmentModel: "standard", outputLanguage },
    policy,
    kind,
    cmsType,
    workspaceCategories,
    categoriesRawRows,
    sourceImageUrls: params.sourceImageUrls,
  });

  const result = await runEnrichOpenAiResponse({
    tier: "standard",
    modelOverride: ENRICH_MODEL,
    reasoningEffortOverride: ENRICH_REASONING_EFFORT,
    searchContextSizeOverride: ENRICH_SEARCH_CONTEXT_SIZE,
    maxOutputTokens: ENRICH_MAX_OUTPUT_TOKENS,
    instructions,
    promptText: text,
    imageUrls,
    policy,
    schemaName,
    schema,
    enabledColumns,
    enrichmentColumns,
    kind,
    rowData: productData,
    language: outputLanguage,
    workspaceCategories,
    categoriesRawRows,
    cmsType,
    maxCategories,
    shouldCancel: params.shouldCancel,
  });

  return {
    data: result.data,
    costs: result.costs,
  };
}

/**
 * Positional-argument product entry point kept for existing callers.
 * @deprecated Prefer `enrichRow` so the session kind can be passed.
 */
export async function enrichProductRow(
  productData: Record<string, string>,
  enabledColumns: string[],
  enrichmentColumns?: EnrichAgentParams["enrichmentColumns"],
  settings?: EnrichAgentParams["settings"],
  cmsType?: string,
  workspaceCategories?: EnrichAgentParams["workspaceCategories"],
  categoriesRawRows?: EnrichAgentParams["categoriesRawRows"]
): Promise<EnrichAgentResult> {
  return enrichRow({
    productData,
    enabledColumns,
    enrichmentColumns,
    settings,
    cmsType,
    workspaceCategories,
    categoriesRawRows,
    kind: "product",
  });
}
