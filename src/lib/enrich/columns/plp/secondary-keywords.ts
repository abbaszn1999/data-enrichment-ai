import type { ColumnSpec, SpecContext } from "../types";
import {
  asStringList,
  asTrimmedString,
  boundedCount,
  describeColumn,
  promptLine,
} from "../shared/helpers";

function limit(ctx: SpecContext): number {
  return boundedCount(ctx.col.itemCount, 5, 1, 12);
}

export const secondaryKeywordsSpec: ColumnSpec = {
  id: "secondaryKeywords",
  kinds: ["plp"],
  needs: { search: true },
  buildSchemaProperty(ctx) {
    return {
      type: "array",
      description: describeColumn(
        ctx,
        "Supporting keywords and close variants this page should also cover."
      ),
      items: { type: "string" },
      maxItems: limit(ctx),
    };
  },
  buildPromptSection(ctx) {
    return promptLine(
      ctx,
      "List supporting keywords this page should also cover.",
      [
        `Return 3-${limit(ctx)} phrases.`,
        "Each must be a genuine variant or long-tail phrase, not a restatement of the target keyword.",
        "Exclude brand names that the store does not stock and anything with no search demand.",
      ]
    );
  },
  parseValue(raw, ctx) {
    // The target keyword usually comes from this same answer, and only falls
    // back to the uploaded row when the file already carried one.
    const target = asTrimmedString(
      ctx.selection?.targetKeyword ?? ctx.rowData.targetKeyword
    ).toLowerCase();
    return asStringList(raw, limit(ctx)).filter(
      (kw) => !target || kw.toLowerCase() !== target
    );
  },
};
