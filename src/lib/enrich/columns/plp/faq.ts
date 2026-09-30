import type { FaqItem } from "@/types";
import type { ColumnSpec, SpecContext } from "../types";
import { boundedCount, describeColumn, promptLine } from "../shared/helpers";

function limit(ctx: SpecContext): number {
  return boundedCount(ctx.col.itemCount, 4, 1, 10);
}

export const faqSpec: ColumnSpec = {
  id: "faq",
  kinds: ["plp", "product"],
  needs: { search: true },
  buildSchemaProperty(ctx) {
    return {
      type: "array",
      description: describeColumn(
        ctx,
        ctx.kind === "product"
          ? "Frequently asked questions with answers about this product, suitable for FAQPage structured data."
          : "Frequently asked questions with answers, suitable for FAQPage structured data."
      ),
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
        },
        required: ["question", "answer"],
      },
      maxItems: limit(ctx),
    };
  },
  buildPromptSection(ctx) {
    if (ctx.kind === "product") {
      return promptLine(
        ctx,
        "Write frequently asked questions with answers about this product.",
        [
          `Return 3-${limit(ctx)} pairs.`,
          "Questions must be phrased the way a shopper would type them (fit, compatibility, materials, care, use, what is included) and be specific to this product.",
          "Answers: 1-3 sentences, self-contained, and supported by the row data, the images or search results. If a fact is unknown, do not write a question that needs it.",
          "No prices, no stock claims, no delivery promises. This output feeds FAQPage structured data.",
        ]
      );
    }
    return promptLine(
      ctx,
      "Write frequently asked questions with answers for this category.",
      [
        `Return 3-${limit(ctx)} pairs.`,
        "Use web_search to find what shoppers genuinely ask about this category; do not invent questions nobody asks.",
        "Each question must be phrased the way a shopper would type it, and must be answerable without knowing which product they picked.",
        "Answers: 2-4 sentences, self-contained, no prices, no stock claims, no delivery promises.",
        "This output feeds FAQPage structured data, so the answer must actually answer the question.",
      ]
    );
  },
  parseValue(raw) {
    if (!Array.isArray(raw)) return [] as FaqItem[];
    const out: FaqItem[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const question = String(rec.question ?? "").trim();
      const answer = String(rec.answer ?? "").trim();
      // A pair missing either half is unusable for structured data.
      if (!question || !answer) continue;
      const key = question.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ question, answer });
    }
    return out;
  },
};
