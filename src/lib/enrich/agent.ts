import { resolveEnrichmentModel } from "@/types";
import type { EnrichAgentParams, EnrichAgentResult } from "./types";
import { buildEnrichToolPolicy } from "./policy";
import { buildEnrichJsonSchema } from "./schema";
import { buildEnrichPrompt } from "./prompt";
import { runEnrichOpenAiResponse } from "./openai";

/**
 * Enrich a single product row with one OpenAI Responses call
 * (hosted web_search + structured JSON for requested columns).
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
  if (!enabledColumns.length) {
    throw new Error("No enrichment columns selected");
  }

  const tier = resolveEnrichmentModel(settings?.enrichmentModel);
  const policy = buildEnrichToolPolicy(enabledColumns, enrichmentColumns);
  const catCol = enrichmentColumns?.find((c) => c.id === "categories");
  const maxCategories = catCol?.maxCategories ?? 3;
  const hasStoreCategoryAllowlist = (workspaceCategories?.length ?? 0) > 0;

  const { name: schemaName, schema } = buildEnrichJsonSchema(
    enabledColumns,
    enrichmentColumns,
    policy,
    { hasStoreCategoryAllowlist }
  );
  const { text, imageUrls } = buildEnrichPrompt({
    productData,
    enabledColumns,
    enrichmentColumns,
    settings: {
      enrichmentModel: tier,
      outputLanguage: settings?.outputLanguage || "English",
    },
    policy,
    cmsType,
    workspaceCategories,
    categoriesRawRows,
  });

  const result = await runEnrichOpenAiResponse({
    tier,
    promptText: text,
    imageUrls,
    policy,
    schemaName,
    schema,
    enabledColumns,
    workspaceCategories,
    cmsType,
    maxCategories,
  });

  return {
    data: result.data,
    costs: [result.cost],
  };
}
