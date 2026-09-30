import type { SessionKind } from "@/types";
import type { EnrichAgentParams, EnrichAgentResult } from "./types";
import { buildEnrichToolPolicy } from "./policy";
import { runEnrichOpenAiResponse } from "./openai";
import { formatRowData } from "./prompts/shared";
import {
  buildCategoriesSchema,
  buildCategoryInstructions,
  parseCategoryAnswer,
  resolveCategoryPlan,
} from "./categories";

const CATEGORIES_COLUMN_ID = "categories";

/** Categories mode has one fixed model: GPT-6 Sol, medium reasoning, no web search. */
export const CATEGORIES_MODEL = "gpt-6-sol" as const;
export const CATEGORIES_REASONING_EFFORT = "medium" as const;

/** A Catalog Intelligence run whose only column is Categories (the Categories mode). */
export function isCategoriesModeRun(kind: SessionKind, enabledColumns: string[]): boolean {
  return kind === "product" && enabledColumns.length === 1 && enabledColumns[0] === CATEGORIES_COLUMN_ID;
}

/** notFoundReason sibling key, shown on the cell when nothing was assigned. */
export const categoriesNoteKey = `${CATEGORIES_COLUMN_ID}__notFoundReason`;

/** Row fields as text; image links and attachments say nothing about the category and cost tokens. */
function rowText(productData: Record<string, string>): string {
  const { textBlock } = formatRowData(productData);
  return textBlock
    .split("\n")
    .filter((line) => !line.includes("[attached image]") && !line.includes("[image URL]"))
    .join("\n")
    .trim();
}

/**
 * Categories mode, one row: a single GPT-6 Sol call (medium reasoning, no web
 * search) that either picks from the store's own categories or suggests them
 * in the chosen format. Costs are the call's tokens only.
 */
export async function classifyProductCategories(params: EnrichAgentParams): Promise<EnrichAgentResult> {
  const column = params.enrichmentColumns?.find((col) => col.id === CATEGORIES_COLUMN_ID);
  const plan = resolveCategoryPlan({
    cmsType: params.cmsType,
    workspaceCategories: params.workspaceCategories,
    maxCategories: column?.maxCategories,
    categoryFormat: column?.categoryFormat,
    useStoreCategories: column?.useStoreCategories,
  });

  const text = rowText(params.productData);
  if (!text || text === "(no fields)") {
    return {
      data: { [CATEGORIES_COLUMN_ID]: "", [categoriesNoteKey]: "This row has no product data to classify." },
      costs: [],
    };
  }

  const language = params.settings?.outputLanguage || "English";
  const kind: SessionKind = params.kind ?? "product";
  const result = await runEnrichOpenAiResponse({
    tier: "standard",
    modelOverride: CATEGORIES_MODEL,
    reasoningEffortOverride: CATEGORIES_REASONING_EFFORT,
    webSearch: false,
    promptText: `Product data:\n${text}`,
    instructions: buildCategoryInstructions(plan, { language, customInstruction: column?.customInstruction }),
    imageUrls: params.sourceImageUrls ?? [],
    policy: buildEnrichToolPolicy([CATEGORIES_COLUMN_ID], params.enrichmentColumns, kind),
    schemaName: "product_categories",
    schema: buildCategoriesSchema(plan),
    enabledColumns: [CATEGORIES_COLUMN_ID],
    enrichmentColumns: params.enrichmentColumns,
    kind,
    rowData: params.productData,
    language,
    shouldCancel: params.shouldCancel,
    parse: ({ selection }) => {
      const parsed = parseCategoryAnswer(selection.categories, plan, selection.reason);
      return { [CATEGORIES_COLUMN_ID]: parsed.value, [categoriesNoteKey]: parsed.note };
    },
  });

  return { data: result.data, costs: result.costs };
}
