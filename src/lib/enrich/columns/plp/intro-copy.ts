import type { ColumnSpec } from "../types";
import {
  asTrimmedString,
  charBudgetRule,
  clampChars,
  describeColumn,
  promptLine,
} from "../shared/helpers";

export const introCopySpec: ColumnSpec = {
  id: "introCopy",
  kinds: ["plp"],
  buildSchemaProperty(ctx) {
    return {
      type: "string",
      description: describeColumn(
        ctx,
        "Short introduction shown above the product grid (about 40-80 words)."
      ),
    };
  },
  buildPromptSection(ctx) {
    return promptLine(
      ctx,
      "Write the short introduction shown above the product grid.",
      [
        "About 40-80 words, one short paragraph — it sits above the products so it must not push them down the page.",
        "Say what the shopper will find here and what makes the selection worth browsing.",
        charBudgetRule(ctx.col.maxChars),
      ]
    );
  },
  parseValue(raw, ctx) {
    return clampChars(asTrimmedString(raw), ctx.col.maxChars);
  },
};
