import type { EnrichmentModel } from "@/types";

export type EnrichOpenAiModelId = "gpt-6.1-sol" | "gpt-6-sol" | "gpt-5.6-sol";

/**
 * Both tiers run GPT-6.1 Sol; they differ by reasoning effort and search context.
 * "exact" (Image Finder only) never reaches this map — it always uses
 * IMAGE_FINDER_OPENAI_MODEL directly, the same as Standard/Premium Image Finder.
 */
export const ENRICHMENT_OPENAI_MODELS = {
  standard: "gpt-6.1-sol",
  premium: "gpt-6.1-sol",
} as const satisfies Record<Exclude<EnrichmentModel, "exact">, EnrichOpenAiModelId>;

export type EnrichReasoningEffort = "medium" | "high";

/**
 * Enrich mode (and Categories mode) is ONE fixed agent: GPT-6.1 Sol, medium
 * reasoning. There is no tier choice any more; the older `enrichmentModel`
 * setting is still stored on runs but ignored.
 */
export const ENRICH_MODEL: EnrichOpenAiModelId = "gpt-6.1-sol";
export const ENRICH_REASONING_EFFORT: EnrichReasoningEffort = "medium";
export const ENRICH_SEARCH_CONTEXT_SIZE: EnrichSearchContextSize = "medium";
/**
 * GPT-6.1 Sol's maximum output (developers.openai.com/api/docs/models/gpt-6.1-sol:
 * 128,000). Reasoning tokens count against it. Setting it to the model
 * maximum means a row with many long columns is never cut off by a smaller
 * default; it is only a ceiling, you pay for tokens actually produced.
 */
export const ENRICH_MAX_OUTPUT_TOKENS = 128_000;

/**
 * Image Finder runs this model on both tiers; the tier instead pays for
 * round budget and the recheck pass (see image-finder/agent.ts). Switched
 * from gpt-5.6-sol to gpt-6-sol, then to gpt-6.1-sol (same $2 / $10 price as
 * gpt-6-sol, cached input $0.10). Same evidence-gated
 * guards on both tiers; watch quality on real runs after a model change.
 */
export const IMAGE_FINDER_OPENAI_MODEL: EnrichOpenAiModelId = "gpt-6.1-sol";
export const IMAGE_FINDER_REASONING_EFFORT: EnrichReasoningEffort = "high";
export type EnrichSearchContextSize = "medium" | "high";

/**
 * Products Gallery scraping mode is ONE fixed agent: GPT-6.1 Sol, medium
 * reasoning. Its research depth (Advanced settings) scales page, image-view
 * and round budgets, not the model.
 */
export const GALLERY_SCRAPING_OPENAI_MODEL: EnrichOpenAiModelId = "gpt-6.1-sol";
export const GALLERY_SCRAPING_REASONING_EFFORT: EnrichReasoningEffort = "medium";

export function resolveEnrichOpenAiModel(
  tier: EnrichmentModel | string | null | undefined
): EnrichOpenAiModelId {
  return tier === "premium"
    ? ENRICHMENT_OPENAI_MODELS.premium
    : ENRICHMENT_OPENAI_MODELS.standard;
}

export function resolveEnrichReasoningEffort(
  tier: EnrichmentModel | string | null | undefined
): EnrichReasoningEffort {
  return tier === "premium" ? "high" : "medium";
}

export function resolveEnrichSearchContextSize(
  tier: EnrichmentModel | string | null | undefined
): EnrichSearchContextSize {
  return tier === "premium" ? "high" : "medium";
}
