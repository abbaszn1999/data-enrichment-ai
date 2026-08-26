import type { ColumnSpec } from "../types";
import {
  asTrimmedString,
  charBudgetRule,
  clampChars,
  describeColumn,
  promptLine,
} from "../shared/helpers";

const DEFAULT_MAX = 60;

export const seoTitleSpec: ColumnSpec = {
  id: "seoTitle",
  kinds: ["plp"],
  buildSchemaProperty(ctx) {
    return {
      type: "string",
      description: `${describeColumn(
        ctx,
        "Meta title (title tag) for this category page."
      )} Maximum ${ctx.col.maxChars ?? DEFAULT_MAX} characters.`,
    };
  },
  buildPromptSection(ctx) {
    return promptLine(ctx, "Write the meta title for this category page.", [
      "Lead with the category term a shopper would search for.",
      "Do not pad with the store name unless it still fits comfortably.",
      charBudgetRule(ctx.col.maxChars ?? DEFAULT_MAX),
    ]);
  },
  parseValue(raw, ctx) {
    return clampChars(asTrimmedString(raw), ctx.col.maxChars ?? DEFAULT_MAX);
  },
};
