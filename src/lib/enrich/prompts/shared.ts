/**
 * Instructions that apply to every enrich run regardless of session kind:
 * output contract, language, and the anti-hallucination floor.
 */

export function outputContract(language: string): string[] {
  return [
    "Return ONLY the JSON schema fields requested.",
    `Write all user-facing text in: ${language}.`,
  ];
}

/**
 * The single agent every Enrich run uses. It is written once and sent in the
 * Responses `instructions`, so it is part of the cached prefix.
 */
export const AGENT_SKILLS: string[] = [
  "You combine three skills:",
  "- Senior e-commerce copywriter: clear, specific, persuasive copy that reads naturally and never pads.",
  "- SEO specialist: search intent, keyword placement, correct title/meta lengths, FAQ that matches real shopper questions.",
  "- Product data specialist: precise specifications, correct units, and no claim that the sources do not support.",
];

export const HOW_TO_READ_INPUT: string[] = [
  "How the input works:",
  "- The user message holds ONE row: its fields as '- name: value' lines, plus any product images attached to it.",
  "- The columns to fill are listed below. Fill EVERY column, each one independently. Do not merge or skip columns.",
  "- A column may carry a 'Custom instruction from the user'. Follow it for that column; it outranks the built-in brief but never the grounding rules.",
  "- Some fields may come from earlier AI work in this sheet (found images, categories, sources). Treat them as context about the product.",
];

export const GROUNDING_RULES: string[] = [
  "Never invent specifications, certifications, prices, or claims that are not supported by the row data or search results.",
  "Prefer manufacturer / official pages when sources conflict.",
];

/** A long description or spec sheet must reach the model whole. */
export const MAX_TEXT_FIELD_CHARS = 4000;
const MAX_INLINE_IMAGES = 8;

/** Row fields rendered for the model, with inline images pulled out. */
export function formatRowData(rowData: Record<string, string>): {
  textBlock: string;
  imageUrls: string[];
} {
  const lines: string[] = [];
  const imageRefs: string[] = [];

  for (const [key, raw] of Object.entries(rowData)) {
    const value = String(raw ?? "").trim();
    if (!value) continue;

    if (value.startsWith("data:image/")) {
      lines.push(`- ${key}: [attached image]`);
      imageRefs.push(value);
      continue;
    }
    if (/^https?:\/\//i.test(value) && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(value)) {
      lines.push(`- ${key}: [image URL] ${value.slice(0, 200)}`);
      imageRefs.push(value);
      continue;
    }
    lines.push(`- ${key}: ${value.slice(0, MAX_TEXT_FIELD_CHARS)}`);
  }

  return {
    textBlock: lines.join("\n") || "(no fields)",
    imageUrls: imageRefs.slice(0, MAX_INLINE_IMAGES),
  };
}
