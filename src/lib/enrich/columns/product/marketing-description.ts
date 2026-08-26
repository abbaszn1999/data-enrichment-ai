import type { ColumnSpec } from "../types";
import {
  asTrimmedString,
  charBudgetRule,
  clampChars,
  describeColumn,
  promptLine,
} from "../shared/helpers";

export const marketingDescriptionSpec: ColumnSpec = {
  id: "marketingDescription",
  kinds: ["product"],
  buildSchemaProperty(ctx) {
    return {
      type: "string",
      description: describeColumn(
        ctx,
        "Full, engaging marketing description for this product."
      ),
    };
  },
  buildPromptSection(ctx) {
    return promptLine(
      ctx,
      "Write a full, engaging marketing description for this product.",
      [
        "Only state specifications, materials, or certifications supported by the row data or search results.",
        charBudgetRule(ctx.col.maxChars),
      ]
    );
  },
  parseValue(raw, ctx) {
    return clampChars(asTrimmedString(raw), ctx.col.maxChars);
  },
};
