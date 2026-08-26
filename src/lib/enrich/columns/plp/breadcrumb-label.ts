import type { ColumnSpec } from "../types";
import {
  asTrimmedString,
  charBudgetRule,
  clampChars,
  describeColumn,
  promptLine,
} from "../shared/helpers";

const DEFAULT_MAX = 30;

export const breadcrumbLabelSpec: ColumnSpec = {
  id: "breadcrumbLabel",
  kinds: ["plp"],
  buildSchemaProperty(ctx) {
    return {
      type: "string",
      description: `${describeColumn(
        ctx,
        "Short label for this category in breadcrumb navigation."
      )} Maximum ${ctx.col.maxChars ?? DEFAULT_MAX} characters.`,
    };
  },
  buildPromptSection(ctx) {
    return promptLine(ctx, "Write the breadcrumb label for this category.", [
      "Very short — one or two words wherever possible, since it sits in a navigation trail.",
      "No parent path, no separators, no trailing punctuation.",
      charBudgetRule(ctx.col.maxChars ?? DEFAULT_MAX),
    ]);
  },
  parseValue(raw, ctx) {
    return clampChars(asTrimmedString(raw), ctx.col.maxChars ?? DEFAULT_MAX);
  },
};
