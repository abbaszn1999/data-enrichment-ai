import { buildCategoryAllowlist } from "../../categories";
import type { ColumnSpec, SpecContext } from "../types";
import {
  asStringList,
  boundedCount,
  buildSelfLabels,
  describeColumn,
  isSelfCategory,
  promptLine,
} from "../shared/helpers";

function limit(ctx: SpecContext): number {
  return boundedCount(ctx.col.itemCount, 5, 1, 12);
}

export const internalLinksSpec: ColumnSpec = {
  id: "internalLinks",
  kinds: ["plp"],
  needs: { categoryAllowlist: true },
  buildSchemaProperty(ctx) {
    const base = describeColumn(
      ctx,
      "Related categories to link to from this page."
    );
    return {
      type: "array",
      description: ctx.hasStoreAllowlist
        ? `${base} Every entry MUST be an exact value from the store allowlist.`
        : base,
      items: { type: "string" },
      maxItems: limit(ctx),
    };
  },
  buildPromptSection(ctx) {
    return promptLine(ctx, "Suggest related categories to link to.", [
      `Return up to ${limit(ctx)} categories.`,
      ctx.hasStoreAllowlist
        ? "Use ONLY exact values from the store allowlist below. Return an empty list rather than inventing a category."
        : "Suggest sibling or child categories a shopper on this page would plausibly want next.",
      "NEVER include this page itself.",
      "Prefer siblings and children that a browsing shopper would actually cross-shop, not distant categories.",
    ]);
  },
  parseValue(raw, ctx) {
    const self = buildSelfLabels(ctx.rowData);
    const allow = buildCategoryAllowlist(ctx.workspaceCategories);
    const candidates = asStringList(raw, limit(ctx) * 2);

    const out: string[] = [];
    for (const candidate of candidates) {
      if (isSelfCategory(candidate, self)) continue;
      let value = candidate;
      if (allow.size > 0) {
        const matched = allow.get(candidate.toLowerCase());
        if (!matched) continue;
        value = matched;
      }
      // The allowlist may resolve a name to a path that is in fact this page.
      if (isSelfCategory(value, self)) continue;
      out.push(value);
      if (out.length >= limit(ctx)) break;
    }
    return out;
  },
};
