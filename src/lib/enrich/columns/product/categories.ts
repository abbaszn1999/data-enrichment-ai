import { sanitizeCategoriesOutput, buildCategoryInstructions, resolveCategoryPlan } from "../../categories";
import type { ColumnSpec, SpecContext } from "../types";
import { describeColumn, promptLine } from "../shared/helpers";

function planFor(ctx: SpecContext) {
  return resolveCategoryPlan({
    cmsType: ctx.cmsType,
    workspaceCategories: ctx.workspaceCategories,
    maxCategories: ctx.col.maxCategories,
    categoryFormat: ctx.col.categoryFormat,
    useStoreCategories: ctx.col.useStoreCategories,
  });
}

/**
 * The Categories column when it is generated alongside other columns in one
 * combined call. Categories mode itself (this column alone) runs through
 * categories-agent.ts instead, with a fixed model and no web search; both
 * share the same rules and answer parsing from ../../categories.
 */
export const categoriesSpec: ColumnSpec = {
  id: "categories",
  kinds: ["product"],
  needs: { categoryAllowlist: true },
  buildSchemaProperty(ctx) {
    const plan = planFor(ctx);
    const base = describeColumn(
      ctx,
      `Assign up to ${plan.max} categories using the category rules provided.`
    );
    return {
      type: "string",
      description:
        plan.mode === "store" ? `${base} MUST be exact values from the allowed list, or empty string if none fit.` : base,
    };
  },
  buildPromptSection(ctx) {
    return promptLine(ctx, "Assign product categories.", [
      planFor(ctx).mode === "store"
        ? 'Use ONLY exact values from the allowed list below. If none fit, return "".'
        : "Follow the category rules below; do not invent unrelated taxonomies.",
    ]);
  },
  buildPromptAppendix(ctx) {
    return ["Category rules:", buildCategoryInstructions(planFor(ctx), { language: ctx.language })].join("\n");
  },
  parseValue(raw, ctx) {
    return sanitizeCategoriesOutput(raw, {
      workspaceCategories: ctx.workspaceCategories,
      cmsType: ctx.cmsType,
      maxCategories: ctx.col.maxCategories,
      categoryFormat: ctx.col.categoryFormat,
      useStoreCategories: ctx.col.useStoreCategories,
    });
  },
};
