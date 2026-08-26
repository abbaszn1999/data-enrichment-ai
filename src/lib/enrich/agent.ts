import { resolveEnrichmentModel, type SessionKind } from "@/types";
import type { EnrichAgentParams, EnrichAgentResult } from "./types";
import { buildEnrichToolPolicy } from "./policy";
import { buildEnrichJsonSchema } from "./schema";
import { buildEnrichPrompt } from "./prompt";
import { runEnrichOpenAiResponse } from "./openai";

/**
 * Enrich a single row with one OpenAI Responses call (hosted web_search +
 * structured JSON for the requested columns). Works for both session kinds;
 * `kind` selects which column specs, prompt framing, and tool policy apply.
 */
export async function enrichRow(
  params: EnrichAgentParams
): Promise<EnrichAgentResult> {
  const {
    productData,
    enabledColumns,
    enrichmentColumns,
    settings,
    cmsType,
    workspaceCategories,
    categoriesRawRows,
  } = params;
  const kind: SessionKind = params.kind ?? "product";

  if (!enabledColumns.length) {
    throw new Error("No enrichment columns selected");
  }

  const tier = resolveEnrichmentModel(settings?.enrichmentModel);
  const policy = buildEnrichToolPolicy(enabledColumns, enrichmentColumns, kind);
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
  const { text, imageUrls } = buildEnrichPrompt({
    productData,
    enabledColumns,
    enrichmentColumns,
    settings: { enrichmentModel: tier, outputLanguage },
    policy,
    kind,
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
    enrichmentColumns,
    kind,
    rowData: productData,
    language: outputLanguage,
    workspaceCategories,
    categoriesRawRows,
    cmsType,
    maxCategories,
  });

  return {
    data: result.data,
    costs: [result.cost],
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
