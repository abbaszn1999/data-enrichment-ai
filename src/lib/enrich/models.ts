import type { EnrichmentModel } from "@/types";

export type EnrichOpenAiModelId = "gpt-5.6-terra" | "gpt-5.6-sol";

/** Standard → Terra, Premium → Sol (official OpenAI model IDs). */
export const ENRICHMENT_OPENAI_MODELS = {
  standard: "gpt-5.6-terra",
  premium: "gpt-5.6-sol",
} as const satisfies Record<EnrichmentModel, EnrichOpenAiModelId>;

export type EnrichReasoningEffort = "medium" | "high";
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
