import type { ColumnSpec } from "../types";
import { collapseHtmlList } from "@/lib/html-detect";
import { asTrimmedString, describeColumn, promptLine } from "../shared/helpers";

const MAX_SPECS = 40;

/** An entry as text; an {attribute, value} object reads "Attribute: Value". */
function specText(item: unknown): string {
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const rec = item as Record<string, unknown>;
    const name = asTrimmedString(rec.attribute ?? rec.name ?? rec.key);
    const value = asTrimmedString(rec.value);
    return name && value ? `${name}: ${value}` : "";
  }
  return asTrimmedString(item);
}

export const productSpecificationsSpec: ColumnSpec = {
  id: "productSpecifications",
  kinds: ["product"],
  needs: { search: true },
  // A written answer is never discarded: see parseValue and buildEnrichedData.
  preserveRawAnswer: true,
  buildSchemaProperty(ctx) {
    return {
      type: "array",
      description: describeColumn(
        ctx,
        "Technical specifications, each written as 'Attribute: Value'."
      ),
      items: { type: "string" },
      maxItems: MAX_SPECS,
    };
  },
  buildPromptSection(ctx) {
    return promptLine(
      ctx,
      "List the product's technical specifications as Attribute: Value pairs.",
      [
        "By default write one string per specification, formatted 'Attribute: Value' (e.g. 'Material: Stainless steel').",
        "If the custom instruction asks for another layout (for example an HTML table), follow it and return that whole layout as ONE string in the list.",
        "Include only specifications supported by the row data, the images or search results; omit anything unknown instead of guessing.",
        "Use the manufacturer's units and wording. Put the most important specifications first.",
      ]
    );
  },
  /**
   * Every non-empty entry the model wrote is kept (deduplicated, capped), in
   * whatever format the column's instruction asked for. An HTML answer is stored
   * as one string so the sheet shows the HTML badge and the preview.
   */
  parseValue(raw) {
    const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of list) {
      const text = specText(item);
      if (!text) continue;
      // Plain entries are one line; markup keeps its own layout.
      const entry = /<[a-z!/]/i.test(text) ? text : text.replace(/\s+/g, " ");
      const key = entry.replace(/\s+/g, " ").toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(entry);
      if (out.length >= MAX_SPECS) break;
    }
    return collapseHtmlList(out);
  },
};
