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
import { hideProviderNames } from "@/lib/provider-names";
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
    // The "Source & Image Finder" tab can run Source URLs next to Images. The
    // two agents are untouched and run side by side. The final re-check of
    // Not-found rows only re-runs the image search, never the Google search.
    if (enabledColumns.includes(SOURCE_URLS_COLUMN_ID) && !params.recheck) {
      return withGoogleSourceUrls(params, () => findProductImages(params));
    }
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
    return withGoogleSourceUrls(params, () => enrichWithOpenAi(params, others));
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

/**
 * Runs the Source URLs search (Google AI Mode) next to the row's other work
 * (`runMain`: the OpenAI enrichment call, or the Image Finder) and merges both.
 * The main work decides the row; a Google failure never throws away what the
 * main work produced and billed.
 */
async function withGoogleSourceUrls(
  params: EnrichAgentParams,
  runMain: () => Promise<EnrichAgentResult>
): Promise<EnrichAgentResult> {
  const memo = params.sourceUrlsMemo;
  const cached = memo?.result;
  const googleTask: Promise<EnrichAgentResult> = cached
    ? // Charged with the earlier attempt that produced it: never charge it twice.
      Promise.resolve({ data: cached.data, costs: [] })
    : findSourceUrls(params).then((result) => {
        if (memo) memo.result = result;
        return result;
      });
  const [main, sources] = await Promise.allSettled([runMain(), googleTask]);

  if (main.status === "rejected") {
    // The main work decides the row. Whatever Google billed is still charged.
    const googleCosts = sources.status === "fulfilled" ? sources.value.costs : billedCostsOf(sources.reason);
    throw withExtraCosts(main.reason, googleCosts);
  }

  if (sources.status === "rejected") {
    // Stop was clicked: end the row like any other stopped row, charged for what both providers billed.
    if (sources.reason instanceof EnrichCancelledError) {
      throw withExtraCosts(sources.reason, main.value.costs);
    }
    // Any other Google failure must not throw away the columns the main work
    // already wrote (and billed): they are kept, and the Source URLs cell says why it is empty.
    const message = sources.reason instanceof Error ? sources.reason.message : String(sources.reason);
    console.error("[Enrich] Source URLs search failed; the other columns were kept", { message: message.slice(0, 300) });
    return {
      ...main.value,
      data: {
        ...main.value.data,
        [SOURCE_URLS_COLUMN_ID]: [],
        [imageFinderNotFoundKey(SOURCE_URLS_COLUMN_ID)]: `The web search failed, so no pages were found. Run this column again. (${hideProviderNames(message.slice(0, 200))})`,
      },
      costs: [...main.value.costs, ...billedCostsOf(sources.reason)],
    };
  }

  return {
    // `meta` (Image Finder tiers) belongs to the main work and is kept for the charge details.
    ...main.value,
    data: { ...main.value.data, ...sources.value.data },
    costs: [...main.value.costs, ...sources.value.costs],
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
  const { instructions, text, imageUrls, textWithoutImages } = buildEnrichPrompt({
    productData,
    enabledColumns,
    enrichmentColumns,
    settings: { enrichmentModel: "standard", outputLanguage, globalInstruction: settings?.globalInstruction },
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
    promptTextWithoutImages: textWithoutImages,
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
