import type { ColumnSpec } from "../types";
import {
  asTrimmedString,
  charBudgetRule,
  clampChars,
  describeColumn,
  promptLine,
} from "../shared/helpers";

const DEFAULT_MAX = 160;

export const metaDescriptionSpec: ColumnSpec = {
  id: "metaDescription",
  kinds: ["plp"],
  buildSchemaProperty(ctx) {
    return {
      type: "string",
      description: `${describeColumn(
        ctx,
        "Meta description for this category page."
      )} Maximum ${ctx.col.maxChars ?? DEFAULT_MAX} characters.`,
    };
  },
  buildPromptSection(ctx) {
    return promptLine(
      ctx,
      "Write the meta description for this category page.",
      [
        "One or two sentences summarising the range, ending with a soft call to action.",
        "This is ad copy for the search result, so make it distinct from the meta title.",
        charBudgetRule(ctx.col.maxChars ?? DEFAULT_MAX),
      ]
    );
  },
  parseValue(raw, ctx) {
    return clampChars(asTrimmedString(raw), ctx.col.maxChars ?? DEFAULT_MAX);
  },
};
