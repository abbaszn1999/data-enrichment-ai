import type { ColumnSpec } from "../types";
import {
  asTrimmedString,
  charBudgetRule,
  clampChars,
  describeColumn,
  promptLine,
} from "../shared/helpers";

/** Word targets by the column's contentLength setting. */
const WORD_TARGETS: Record<string, string> = {
  short: "200-300 words",
  medium: "300-450 words",
  long: "450-600 words",
};

export const seoCopySpec: ColumnSpec = {
  id: "seoCopy",
  kinds: ["plp"],
  needs: { search: true },
  buildSchemaProperty(ctx) {
    return {
      type: "string",
      description: describeColumn(
        ctx,
        "Longer supporting copy shown below the product grid, in short paragraphs."
      ),
    };
  },
  buildPromptSection(ctx) {
    const target =
      WORD_TARGETS[ctx.col.contentLength || "long"] || WORD_TARGETS.long;
    return promptLine(
      ctx,
      "Write the longer supporting copy shown below the product grid.",
      [
        `Target ${target}, split into 3-5 short paragraphs separated by blank lines.`,
        "Cover: what the category includes, the main types or variations, how to choose between them, and practical buying or care considerations.",
        "Ground claims in search results rather than generic filler; if you cannot verify a detail, leave it out.",
        "Do not repeat the intro copy, and do not restate the same point in every paragraph.",
        charBudgetRule(ctx.col.maxChars),
      ]
    );
  },
  parseValue(raw, ctx) {
    return clampChars(asTrimmedString(raw), ctx.col.maxChars);
  },
};
