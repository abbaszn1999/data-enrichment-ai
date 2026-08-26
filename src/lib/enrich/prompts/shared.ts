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

export const GROUNDING_RULES: string[] = [
  "Never invent specifications, certifications, prices, or claims that are not supported by the row data or search results.",
  "Prefer manufacturer / official pages when sources conflict.",
];

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
    lines.push(`- ${key}: ${value.slice(0, 1200)}`);
  }

  return {
    textBlock: lines.join("\n") || "(no fields)",
    imageUrls: imageRefs.slice(0, 4),
  };
}
