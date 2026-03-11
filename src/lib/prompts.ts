export type ImagePart = {
  inlineData: {
    mimeType: string;
    data: string;
  };
};

export function extractImages(productData: Record<string, string>): {
  textEntries: string;
  images: ImagePart[];
} {
  const images: ImagePart[] = [];
  const lines: string[] = [];

  for (const [key, value] of Object.entries(productData)) {
    if (!value || value.trim() === "") continue;

    if (value.startsWith("data:image/")) {
      const match = value.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (match) {
        images.push({
          inlineData: {
            mimeType: match[1],
            data: match[2],
          },
        });
        lines.push(`- ${key}: [See attached image]`);
        continue;
      }
    }
    lines.push(`- ${key}: ${value}`);
  }

  return { textEntries: lines.join("\n"), images };
}

export function buildSearchPrompt(productData: Record<string, string>): {
  text: string;
  images: ImagePart[];
} {
  const { textEntries, images } = extractImages(productData);

  const text = `You are a product research assistant. Search the web to find detailed information about this product.
${images.length > 0 ? "\nIMPORTANT: I have attached product image(s). Please analyze the image(s) carefully to identify the product, brand, model, and any visible text or features before searching.\n" : ""}
Product Data:
${textEntries}

Search for this exact product and find:
1. The full official product name and model
2. Detailed technical specifications
3. Key features and selling points
4. Product category and subcategory
5. Any marketing descriptions from official sources or retailers

Return your findings as a detailed summary. Include all technical specs, features, and marketing angles you find. Be thorough and accurate.`;

  return { text, images };
}

type ColumnDef = {
  id: string;
  label: string;
  description: string;
  type: string;
};

export interface PromptSettings {
  outputLanguage: string;
  writingTone: string;
  customTone: string;
  contentLength: "short" | "medium" | "long";
}

const TONE_INSTRUCTIONS: Record<string, string> = {
  professional: "Use a professional, formal, and business-appropriate tone suitable for e-commerce product listings.",
  persuasive: "Use a persuasive, sales-focused tone that highlights benefits and creates urgency to buy. Be compelling and conversion-driven.",
  simple: "Use a simple, clear, and straightforward tone. Avoid jargon and complex sentences. Be easy to understand for all audiences.",
  technical: "Use a technical, detailed, and precise tone. Focus on specifications, performance metrics, and engineering details.",
};

const LENGTH_INSTRUCTIONS: Record<string, { description: string; title: string; features: string }> = {
  short: { description: "50-100 words", title: "max 80 chars", features: "3-5" },
  medium: { description: "150-300 words", title: "max 150 chars", features: "5-8" },
  long: { description: "300-500 words", title: "max 200 chars", features: "8-12" },
};

function getBuiltinColumnInstructions(lengthConfig: { description: string; title: string; features: string }): Record<string, string> {
  return {
    enhancedTitle: `"enhancedTitle": (string) A professional, SEO-optimized product title (${lengthConfig.title}). Include brand, model, key spec.`,
    marketingDescription: `"marketingDescription": (string) A compelling marketing description (${lengthConfig.description}). Highlight benefits, use cases, and key specs.`,
    keyFeatures: `"keyFeatures": (array of strings) ${lengthConfig.features} key features as short strings. Each is a concise benefit statement.`,
    category: `"category": (string) Product category path like "Electronics > Personal Care > Hair Dryers". Use standard e-commerce categories.`,
    seoKeywords: `"seoKeywords": (array of strings) 8-12 relevant SEO keywords/phrases that shoppers would search for.`,
    marketplaceBullets: `"marketplaceBullets": (array of strings) 5-7 marketplace-style bullet points (Amazon/Noon format). Each starts with a CAPITALIZED key benefit followed by details.`,
  };
}

export function buildEnrichmentPrompt(
  productData: Record<string, string>,
  searchResults: string,
  enabledColumns: string[],
  enrichmentColumns?: ColumnDef[],
  settings?: PromptSettings
): { text: string; images: ImagePart[] } {
  const { textEntries, images } = extractImages(productData);

  const contentLength = settings?.contentLength || "medium";
  const lengthConfig = LENGTH_INSTRUCTIONS[contentLength];
  const builtinInstructions = getBuiltinColumnInstructions(lengthConfig);

  const columnInstructions = enabledColumns
    .map((colId) => {
      // Check if it's a known builtin
      if (builtinInstructions[colId]) {
        return builtinInstructions[colId];
      }
      // Look up in enrichmentColumns for custom prompt
      const colDef = enrichmentColumns?.find((c) => c.id === colId);
      if (colDef) {
        const typeHint = colDef.type === "list" ? "(array of strings)" : "(string)";
        return `"${colId}": ${typeHint} ${colDef.description}`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");

  // Build language instruction
  const language = settings?.outputLanguage || "English";
  const languageInstruction = `- Write ALL content in ${language}. Every single field value MUST be in ${language}.`;

  // Build tone instruction
  const toneKey = settings?.writingTone || "professional";
  const toneInstruction = toneKey === "custom" && settings?.customTone
    ? `- Writing style: ${settings.customTone}`
    : `- ${TONE_INSTRUCTIONS[toneKey] || TONE_INSTRUCTIONS.professional}`;

  const text = `You are an expert e-commerce copywriter and product data specialist. Based on the original product data and research findings below, generate enriched product content.
${images.length > 0 ? "\nIMPORTANT: Product image(s) are attached. Use them to identify the product accurately.\n" : ""}
Original Product Data:
${textEntries}

Research Findings:
${searchResults}

Generate a JSON object with ONLY these fields (use exact key names):
${columnInstructions}

Important rules:
- Use the research findings to ensure accuracy
${languageInstruction}
${toneInstruction}
- Be specific with technical specs (watts, dimensions, materials, etc.)
- For array fields, return a JSON array of strings
- For string fields, return a plain string
- Return ONLY valid JSON, no markdown code blocks, no extra text`;

  return { text, images };
}
