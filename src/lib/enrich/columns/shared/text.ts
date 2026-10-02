import type { ColumnSpec, SpecContext } from "../types";
import { collapseHtmlList } from "@/lib/html-detect";
import {
  asStringList,
  asTrimmedString,
  charBudgetRule,
  clampChars,
  describeColumn,
  promptLine,
} from "./helpers";

/**
 * Fallback spec for any column without a dedicated file — custom user columns
 * and plain text/list columns. Works for both session kinds.
 */
export const genericTextSpec: ColumnSpec = {
  id: "__generic__",
  kinds: ["product", "plp"],
  preserveRawAnswer: true,
  buildSchemaProperty(ctx) {
    const isList = ctx.col.type === "list" || ctx.col.type === "keywords";
    const description = describeColumn(
      ctx,
      isList ? `List values for ${ctx.col.label}` : `Value for ${ctx.col.label}`
    );
    if (isList) {
      return { type: "array", description, items: { type: "string" } };
    }
    return { type: "string", description };
  },
  buildPromptSection(ctx) {
    return promptLine(ctx, "Fill accurately from row data and search.", [
      charBudgetRule(ctx.col.maxChars),
    ]);
  },
  parseValue(raw, ctx: SpecContext) {
    if (ctx.col.type === "list" || ctx.col.type === "keywords") {
      // A list of HTML (a table, markup) is one document: stored as a single
      // string so the sheet previews it.
      return collapseHtmlList(asStringList(raw, ctx.col.itemCount));
    }
    return clampChars(asTrimmedString(raw), ctx.col.maxChars);
  },
};
