import type { ColumnSpec } from "../types";
import { asTrimmedString, describeColumn, promptLine } from "../shared/helpers";

const MAX_SPECS = 40;

/** Collapse whitespace and make sure each entry reads "Attribute: Value". */
function normalizeSpec(item: unknown): string {
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const rec = item as Record<string, unknown>;
    const name = asTrimmedString(rec.attribute ?? rec.name ?? rec.key);
    const value = asTrimmedString(rec.value);
    return name && value ? `${name}: ${value}` : "";
  }
  return asTrimmedString(item).replace(/\s+/g, " ");
}

export const productSpecificationsSpec: ColumnSpec = {
  id: "productSpecifications",
  kinds: ["product"],
  needs: { search: true },
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
        "One string per specification, formatted exactly 'Attribute: Value' (e.g. 'Material: Stainless steel').",
        "Include only specifications supported by the row data, the images or search results; omit anything unknown instead of guessing.",
        "Use the manufacturer's units and wording. Put the most important specifications first.",
      ]
    );
  },
  parseValue(raw) {
    const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of list) {
      const text = normalizeSpec(item);
      // A bare value with no attribute is not a specification.
      if (!text || !text.includes(":")) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(text);
      if (out.length >= MAX_SPECS) break;
    }
    return out;
  },
};
