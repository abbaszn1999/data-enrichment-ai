import { GoogleGenAI, ThinkingLevel, createUserContent } from "@google/genai";
import { buildSearchPrompt, buildEnrichmentPrompt } from "./prompts";
import type { PromptSettings } from "./prompts";
import type { EnrichedData, SourceUrl, ImageUrl, ThinkingLevelOption, EnrichmentModel } from "@/types";

export interface GeminiSettings {
  enrichmentModel: EnrichmentModel;
  thinkingLevel: ThinkingLevelOption;
  maxRetries: number;
  promptSettings: PromptSettings;
}

const THINKING_LEVEL_MAP: Record<ThinkingLevelOption, ThinkingLevel | undefined> = {
  none: undefined,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  console.log("[Gemini] API Key present:", !!apiKey, "| Length:", apiKey?.length ?? 0);
  if (!apiKey) {
    console.error("[Gemini] All env keys:", Object.keys(process.env).filter(k => k.includes("GEMINI")));
    throw new Error("GEMINI_API_KEY environment variable is not set");
  }
  return new GoogleGenAI({ 
    apiKey,
    httpOptions: {
      timeout: 180000, // 3 minutes timeout
    }
  });
}

// Helper function to retry async operations
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 2,
  delayMs: number = 2000
): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      console.warn(`[Gemini] Attempt ${attempt} failed: ${error.message || error}`);
      
      if (attempt < maxRetries) {
        console.log(`[Gemini] Waiting ${delayMs}ms before retry ${attempt + 1}...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

export async function searchProduct(
  productData: Record<string, string>
): Promise<{ text: string; sources: SourceUrl[] }> {
  return withRetry(async () => {
    const ai = getClient();
    const { text: promptText, images } = buildSearchPrompt(productData);

    // Build multimodal content: text + images
    const parts: any[] = [{ text: promptText }];
    for (const img of images) {
      parts.push(img);
    }

    console.log(`[Gemini] Search request: ${images.length} image(s) attached`);

    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: createUserContent(parts),
      config: {
        tools: [{ googleSearch: {} }],
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.LOW,
        },
      },
    });

    const text = response.text || "";

    const sources: SourceUrl[] = [];
    const chunks =
      response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (chunks) {
      for (const chunk of chunks) {
        if (chunk.web?.uri && chunk.web?.title) {
          sources.push({
            title: chunk.web.title,
            uri: chunk.web.uri,
          });
        }
      }
    }

    return { text, sources };
  }, 2, 2000);
}

export async function searchProductImages(
  productData: Record<string, string>,
  imageCount: number = 3,
  customInstruction: string = ""
): Promise<ImageUrl[]> {
  return withRetry(async () => {
    const ai = getClient();
    const { textEntries, images: productImages } = extractImagesFromData(productData);

    const instruction = customInstruction
      ? `\nAdditional instruction: ${customInstruction}`
      : "";

    // Step 1: Search Google for product images and get source pages
    const searchPrompt = `Search Google to find high-quality product images for this exact product. Look for this product on e-commerce sites, manufacturer sites, and image hosting sites.

Product Data:
${textEntries}
${instruction}

IMPORTANT: I need you to find DIRECT IMAGE FILE URLs - the actual .jpg, .png, .webp image file links, NOT product page URLs.

Search for this product and find ${imageCount} actual product image URLs. For each image found, extract:
1. The DIRECT image file URL (the src attribute of the <img> tag, the actual file URL ending in .jpg/.png/.webp or containing /images/ in the path). NOT the product page URL.
2. The source webpage URL where you found the image.
3. A short title/description.

Look for image URLs from sources like:
- Amazon product images (e.g., https://m.media-amazon.com/images/I/...)
- eBay images (e.g., https://i.ebayimg.com/images/g/...)
- Manufacturer/brand CDN image URLs
- Any direct image hosting URLs

Return your response as a valid JSON array with exactly this format:
[{"imageUrl": "https://direct-link-to-image-file.jpg", "pageUrl": "https://source-page.com/product", "title": "description"}]

Return ONLY the JSON array. No markdown code blocks, no explanation.`;

    const parts: any[] = [{ text: searchPrompt }];
    for (const img of productImages) {
      parts.push(img);
    }

    console.log(`[Gemini] Image search: requesting ${imageCount} direct image URLs using gemini-3.1-pro-preview`);

    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: createUserContent(parts),
      config: {
        tools: [{ googleSearch: {} }, { urlContext: {} }],
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.MEDIUM,
        },
      },
    });

    const text = response.text || "[]";
    console.log(`[Gemini] Image search raw response length: ${text.length}`);

    // Parse the model's JSON response
    let parsedImages: ImageUrl[] = [];
    try {
      // Try to extract JSON array from response
      const jsonMatch = text.match(/\[\s*\{[\s\S]*?\}\s*\]/);
      if (jsonMatch) {
        parsedImages = JSON.parse(jsonMatch[0]) as ImageUrl[];
      } else {
        parsedImages = JSON.parse(text) as ImageUrl[];
      }
    } catch {
      console.warn("[Gemini] Could not parse image search response as JSON");
      console.warn("[Gemini] Response text:", text.slice(0, 500));
    }

    // Filter: only keep entries that look like actual image URLs
    const imageExtensions = /\.(jpg|jpeg|png|webp|gif|bmp|svg|avif|tiff)(\?|$|#)/i;
    const imagePathPatterns = /(\/images\/|\/img\/|media-amazon\.com|ebayimg\.com|cloudinary\.com|imgix\.net|shopify\.com\/.*\/files\/|walmartimages\.com|target\.scene7\.com|i\d?\.wp\.com)/i;

    const validImages = parsedImages.filter((img) => {
      if (!img.imageUrl || typeof img.imageUrl !== "string") return false;
      // Must look like a direct image URL
      return imageExtensions.test(img.imageUrl) || imagePathPatterns.test(img.imageUrl);
    });

    // If we got valid filtered images, use them; otherwise fall back to all parsed
    const resultImages = validImages.length > 0 ? validImages : parsedImages;

    // Deduplicate by imageUrl
    const seen = new Set<string>();
    const unique: ImageUrl[] = [];
    for (const img of resultImages) {
      if (img.imageUrl && !seen.has(img.imageUrl)) {
        seen.add(img.imageUrl);
        unique.push({
          imageUrl: img.imageUrl,
          pageUrl: img.pageUrl || "",
          title: img.title || "Product image",
        });
      }
    }

    console.log(`[Gemini] Image search: found ${unique.length} valid image URLs out of ${parsedImages.length} parsed`);
    return unique.slice(0, imageCount);
  }, 2, 3000);
}

function extractImagesFromData(productData: Record<string, string>): {
  textEntries: string;
  images: any[];
} {
  const images: any[] = [];
  const lines: string[] = [];
  for (const [key, value] of Object.entries(productData)) {
    if (!value || value.trim() === "") continue;
    if (value.startsWith("data:image/")) {
      const match = value.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (match) {
        images.push({ inlineData: { mimeType: match[1], data: match[2] } });
        lines.push(`- ${key}: [See attached image]`);
        continue;
      }
    }
    lines.push(`- ${key}: ${value}`);
  }
  return { textEntries: lines.join("\n"), images };
}

export async function enrichProduct(
  productData: Record<string, string>,
  searchResults: string,
  enabledColumns: string[],
  enrichmentColumns?: { id: string; label: string; description: string; type: string }[],
  settings?: GeminiSettings
): Promise<EnrichedData> {
  const maxRetries = settings?.maxRetries ?? 2;
  return withRetry(async () => {
    const ai = getClient();
    const { text: promptText, images } = buildEnrichmentPrompt(
      productData,
      searchResults,
      enabledColumns,
      enrichmentColumns,
      settings?.promptSettings
    );

    // Build multimodal content: text + images
    const parts: any[] = [{ text: promptText }];
    for (const img of images) {
      parts.push(img);
    }

    const model = settings?.enrichmentModel || "gemini-3-flash-preview";
    const thinkingLevel = THINKING_LEVEL_MAP[settings?.thinkingLevel || "low"];

    const response = await ai.models.generateContent({
      model,
      contents: createUserContent(parts),
      config: {
        responseMimeType: "application/json",
        ...(thinkingLevel != null ? { thinkingConfig: { thinkingLevel } } : {}),
      },
    });

    const text = response.text || "{}";

    try {
      return JSON.parse(text) as EnrichedData;
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]) as EnrichedData;
        } catch {
          throw new Error(`Failed to parse AI response as JSON: ${text.slice(0, 200)}`);
        }
      }
      throw new Error(`Failed to parse AI response as JSON: ${text.slice(0, 200)}`);
    }
  }, maxRetries, 3000);
}

export async function enrichProductRow(
  productData: Record<string, string>,
  enabledColumns: string[],
  enrichmentColumns?: { id: string; label: string; description: string; type: string; enabled: boolean; imageCount?: number; customInstruction?: string }[],
  settings?: GeminiSettings
): Promise<EnrichedData> {
  // Step 1: Search with Gemini 3.1 Pro + Google Search
  const { text: searchResults, sources } = await searchProduct(productData);

  // Step 2: Enrich with selected model (exclude special columns)
  const specialColumns = ["sourceUrls", "imageUrls"];
  const columnsToGenerate = enabledColumns.filter((c) => !specialColumns.includes(c));
  const enrichedData = await enrichProduct(
    productData,
    searchResults,
    columnsToGenerate,
    enrichmentColumns,
    settings
  );

  // Step 3: Attach sources if requested
  if (enabledColumns.includes("sourceUrls")) {
    enrichedData.sourceUrls = sources;
  }

  // Step 4: Search for product images if imageUrls column is enabled
  if (enabledColumns.includes("imageUrls")) {
    const imageCol = enrichmentColumns?.find((c) => c.id === "imageUrls");
    const imageCount = imageCol?.imageCount ?? 3;
    const customInstruction = imageCol?.customInstruction ?? "";
    try {
      const imageResults = await searchProductImages(productData, imageCount, customInstruction);
      enrichedData.imageUrls = imageResults;
    } catch (error: any) {
      console.warn(`[Gemini] Image search failed: ${error.message}`);
      enrichedData.imageUrls = [];
    }
  }

  return enrichedData;
}
