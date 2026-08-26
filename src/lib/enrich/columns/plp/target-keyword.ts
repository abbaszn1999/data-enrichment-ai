import type { ColumnSpec } from "../types";
import {
  asTrimmedString,
  charBudgetRule,
  clampChars,
  describeColumn,
  promptLine,
} from "../shared/helpers";

const DEFAULT_MAX = 80;

export const targetKeywordSpec: ColumnSpec = {
  id: "targetKeyword",
  kinds: ["plp"],
  needs: { search: true },
  buildSchemaProperty(ctx) {
    return {
      type: "string",
      description: `${describeColumn(
        ctx,
        "The single primary search keyword for this category page."
      )} A single phrase, no separators or alternatives.`,
    };
  },
  buildPromptSection(ctx) {
    return promptLine(
      ctx,
      "Identify the single primary search keyword for this category page.",
      [
        "Use web_search to check how shoppers actually phrase this, then return ONE phrase only.",
        "Do not return a list, comma-separated variants, or a keyword joined by slashes.",
        "Prefer the commercial browse phrase (for example 'running shoes') over a single broad noun.",
        charBudgetRule(ctx.col.maxChars ?? DEFAULT_MAX),
      ]
    );
  },
  parseValue(raw, ctx) {
    // Guard against the model returning a list despite the instruction.
    const first = Array.isArray(raw)
      ? asTrimmedString(raw[0])
      : asTrimmedString(raw).split(/[,;|]|\s\/\s/)[0].trim();
    return clampChars(first, ctx.col.maxChars ?? DEFAULT_MAX);
  },
};
