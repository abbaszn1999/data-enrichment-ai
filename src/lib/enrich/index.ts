/**
 * Import AI enrichment — OpenAI Responses agent (Terra / Sol).
 * Public surface for `/api/enrich` and related callers.
 */

export type { EnrichSettings, EnrichColumnConfig, EnrichAgentResult } from "./types";
export {
  ENRICHMENT_OPENAI_MODELS,
  resolveEnrichOpenAiModel,
  resolveEnrichReasoningEffort,
  resolveEnrichSearchContextSize,
  type EnrichOpenAiModelId,
  type EnrichReasoningEffort,
  type EnrichSearchContextSize,
} from "./models";
export { buildEnrichToolPolicy, type EnrichToolPolicy } from "./policy";
export {
  sanitizeCategoriesOutput,
  buildCategoryAllowlist,
} from "./categories";
export { enrichProductRow } from "./agent";
