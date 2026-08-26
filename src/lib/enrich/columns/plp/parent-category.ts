import { buildCategoryAllowlist } from "../../categories";
import type { ColumnSpec } from "../types";
import {
  asTrimmedString,
  buildSelfLabels,
  describeColumn,
  isSelfCategory,
  promptLine,
} from "../shared/helpers";

/** Category labels rendered for the model, capped to keep the prompt bounded. */
function allowlistBlock(
  ctx: Parameters<NonNullable<ColumnSpec["buildPromptAppendix"]>>[0]
): string | null {
  const cats = ctx.workspaceCategories ?? [];
  if (cats.length === 0) return null;
  return [
    "Store category allowlist (for parentCategory and internalLinks):",
    "Copy values EXACTLY as listed. Never invent a category that is not below.",
    ...cats.slice(0, 400).map((c) => `- ${c.fullPath || c.name}`),
  ].join("\n");
}

export const parentCategorySpec: ColumnSpec = {
  id: "parentCategory",
  kinds: ["plp"],
  needs: { categoryAllowlist: true },
  buildSchemaProperty(ctx) {
    const base = describeColumn(
      ctx,
      "The parent category this page sits under."
    );
    return {
      type: "string",
      description: ctx.hasStoreAllowlist
        ? `${base} MUST be an exact value from the store allowlist, or an empty string if none fit.`
        : base,
    };
  },
  buildPromptSection(ctx) {
    return promptLine(ctx, "Pick the parent category this page belongs under.", [
      ctx.hasStoreAllowlist
        ? 'Use ONLY an exact value from the store allowlist below. If nothing fits, return "".'
        : "No store list is available, so suggest a sensible parent using standard retail taxonomy.",
      "Never return this page itself as its own parent.",
    ]);
  },
  buildPromptAppendix(ctx) {
    return allowlistBlock(ctx);
  },
  parseValue(raw, ctx) {
    const value = asTrimmedString(raw);
    if (!value) return "";

    const self = buildSelfLabels(ctx.rowData);
    if (isSelfCategory(value, self)) return "";

    const allow = buildCategoryAllowlist(ctx.workspaceCategories);
    if (allow.size === 0) return value;

    const matched = allow.get(value.toLowerCase());
    if (!matched) return "";
    // The allowlist can resolve a bare name to a path that is this page itself.
    return isSelfCategory(matched, self) ? "" : matched;
  },
};
