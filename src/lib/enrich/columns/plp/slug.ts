import type { ColumnSpec } from "../types";
import {
  asTrimmedString,
  charBudgetRule,
  clampChars,
  describeColumn,
  promptLine,
} from "../shared/helpers";

const DEFAULT_MAX = 75;

/** Normalise to a URL-safe slug regardless of what the model returns. */
function toSlug(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['"']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

export const slugSpec: ColumnSpec = {
  id: "slug",
  kinds: ["plp"],
  buildSchemaProperty(ctx) {
    return {
      type: "string",
      description: `${describeColumn(
        ctx,
        "URL slug for this category page."
      )} Lowercase words separated by single hyphens, no spaces or punctuation.`,
    };
  },
  buildPromptSection(ctx) {
    return promptLine(ctx, "Write the URL slug for this category page.", [
      "Lowercase only, words separated by single hyphens, no spaces, accents, or punctuation.",
      "Keep it short and readable; drop filler words like 'and', 'the', 'our'.",
      "Do not include the full parent path — just this category.",
      charBudgetRule(ctx.col.maxChars ?? DEFAULT_MAX),
    ]);
  },
  parseValue(raw, ctx) {
    const slug = toSlug(asTrimmedString(raw));
    // Trim to the budget, then drop any partial trailing word.
    return clampChars(slug, ctx.col.maxChars ?? DEFAULT_MAX).replace(/-+$/, "");
  },
};
