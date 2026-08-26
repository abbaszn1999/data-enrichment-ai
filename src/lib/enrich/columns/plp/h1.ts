import type { ColumnSpec } from "../types";
import {
  asTrimmedString,
  charBudgetRule,
  clampChars,
  describeColumn,
  promptLine,
} from "../shared/helpers";

const DEFAULT_MAX = 70;

export const h1Spec: ColumnSpec = {
  id: "h1",
  kinds: ["plp"],
  buildSchemaProperty(ctx) {
    return {
      type: "string",
      description: `${describeColumn(
        ctx,
        "On-page H1 heading for this category page."
      )} Maximum ${ctx.col.maxChars ?? DEFAULT_MAX} characters.`,
    };
  },
  buildPromptSection(ctx) {
    return promptLine(ctx, "Write the on-page H1 heading.", [
      "Write it for the shopper looking at the page, not for the search engine result.",
      "It should normally differ from the meta title rather than repeat it verbatim.",
      "No trailing punctuation and no store name.",
      charBudgetRule(ctx.col.maxChars ?? DEFAULT_MAX),
    ]);
  },
  parseValue(raw, ctx) {
    return clampChars(asTrimmedString(raw), ctx.col.maxChars ?? DEFAULT_MAX);
  },
};
