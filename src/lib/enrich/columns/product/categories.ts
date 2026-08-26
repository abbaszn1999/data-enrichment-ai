import {
  CMS_CATEGORY_CONFIG,
  DEFAULT_CMS_CATEGORY_CONFIG,
  type CategoryItem,
} from "@/types";
import { sanitizeCategoriesOutput } from "../../categories";
import type { ColumnSpec, SpecContext } from "../types";
import { describeColumn, promptLine } from "../shared/helpers";

function maxCats(ctx: SpecContext): number {
  return Math.min(5, Math.max(1, ctx.col.maxCategories ?? 3));
}

/**
 * The CMS formatting contract plus the store allowlist. Emitted as a trailing
 * block because the allowlist can run to hundreds of lines.
 */
export function formatCategoryReference(
  workspaceCategories: CategoryItem[] | undefined,
  categoriesRawRows: Record<string, string>[] | undefined,
  cmsType: string | undefined,
  maxCategories: number
): string {
  const cmsKey = (cmsType || "").toLowerCase();
  const cms = CMS_CATEGORY_CONFIG[cmsKey] || DEFAULT_CMS_CATEGORY_CONFIG;

  const parts: string[] = [
    `CMS type: ${cmsType || "generic"}`,
    `Column name: ${cms.columnName}`,
    `Hierarchy separator: "${cms.hierarchySeparator}"`,
    `Multi separator: "${cms.multiCategorySeparator}"`,
    `Supports multiple: ${cms.supportsMultiple}`,
    `Supports hierarchy: ${cms.supportsHierarchy}`,
    `Notes: ${cms.notes}`,
    `Assign at most ${maxCategories} categories.`,
  ];

  if (workspaceCategories && workspaceCategories.length > 0) {
    const listed = workspaceCategories
      .slice(0, 400)
      .map((c) => `- ${c.fullPath || c.name}`)
      .join("\n");
    parts.push(
      [
        "STORE CATEGORY ALLOWLIST (mandatory):",
        "You MUST pick ONLY from the list below — copy the path/name EXACTLY.",
        "If nothing in the list is a reasonable match, return an EMPTY string for categories.",
        "Do NOT invent Shopify Standard Taxonomy, industry taxonomies, or any path not listed.",
        "Do NOT invent Baby/Electronics/etc. trees that are absent from the list.",
        "",
        listed,
      ].join("\n")
    );
  } else if (categoriesRawRows && categoriesRawRows.length > 0) {
    parts.push(
      [
        "Category sheet sample rows (JSON) — prefer values that appear here.",
        "If nothing fits, return an empty categories string.",
        JSON.stringify(categoriesRawRows.slice(0, 40)).slice(0, 6000),
      ].join("\n")
    );
  } else {
    parts.push(
      "No store category list provided — suggest industry-standard categories using CMS formatting."
    );
  }

  return parts.join("\n");
}

export const categoriesSpec: ColumnSpec = {
  id: "categories",
  kinds: ["product"],
  needs: { categoryAllowlist: true },
  buildSchemaProperty(ctx) {
    const max = maxCats(ctx);
    const base = describeColumn(
      ctx,
      `Assign up to ${max} categories using the CMS formatting rules provided.`
    );
    return {
      type: "string",
      description: ctx.hasStoreAllowlist
        ? `${base} MUST be an exact allowlist value, or empty string if none fit.`
        : base,
    };
  },
  buildPromptSection(ctx) {
    return promptLine(
      ctx,
      "Assign product categories based on available store categories.",
      [
        ctx.hasStoreAllowlist
          ? 'Use ONLY exact values from the store allowlist below. If none fit, return "".'
          : "Follow the CMS formatting rules; do not invent unrelated taxonomies.",
      ]
    );
  },
  buildPromptAppendix(ctx) {
    return [
      "Category rules:",
      formatCategoryReference(
        ctx.workspaceCategories,
        ctx.categoriesRawRows,
        ctx.cmsType,
        maxCats(ctx)
      ),
    ].join("\n");
  },
  parseValue(raw, ctx) {
    return sanitizeCategoriesOutput(raw, {
      workspaceCategories: ctx.workspaceCategories,
      cmsType: ctx.cmsType,
      maxCategories: ctx.col.maxCategories,
    });
  },
};
