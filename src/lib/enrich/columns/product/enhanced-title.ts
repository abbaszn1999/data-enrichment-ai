import type { ColumnSpec } from "../types";
import {
  asTrimmedString,
  charBudgetRule,
  clampChars,
  describeColumn,
  promptLine,
} from "../shared/helpers";

export const enhancedTitleSpec: ColumnSpec = {
  id: "enhancedTitle",
  kinds: ["product"],
  buildSchemaProperty(ctx) {
    return {
      type: "string",
      description: describeColumn(
        ctx,
        "SEO-optimized, compelling product title."
      ),
    };
  },
  buildPromptSection(ctx) {
    return promptLine(
      ctx,
      "Write an SEO-optimized and compelling product title.",
      [
        "Lead with brand and model when they are known; never invent either.",
        charBudgetRule(ctx.col.maxChars),
      ]
    );
  },
  parseValue(raw, ctx) {
    return clampChars(asTrimmedString(raw), ctx.col.maxChars);
  },
};
