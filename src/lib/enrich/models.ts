import type { EnrichmentModel } from "@/types";

export type EnrichOpenAiModelId = "gpt-6-sol" | "gpt-5.6-sol";

/** Both tiers run GPT-6 Sol; they differ by reasoning effort and search context. */
export const ENRICHMENT_OPENAI_MODELS = {
  standard: "gpt-6-sol",
  premium: "gpt-6-sol",
} as const satisfies Record<EnrichmentModel, EnrichOpenAiModelId>;

export type EnrichReasoningEffort = "medium" | "high";

/**
 * Image Finder runs the configuration proven in the 30-row research trial on
 * both tiers; its multi-step research is what the tier pays for.
 */
export const IMAGE_FINDER_OPENAI_MODEL: EnrichOpenAiModelId = "gpt-5.6-sol";
export const IMAGE_FINDER_REASONING_EFFORT: EnrichReasoningEffort = "high";
export type EnrichSearchContextSize = "medium" | "high";

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
