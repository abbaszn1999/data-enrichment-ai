import { GoogleGenAI, ThinkingLevel, createUserContent } from "@google/genai";
import { buildSearchPrompt, buildEnrichmentPrompt } from "./prompts";
import type { PromptSettings } from "./prompts";
import type { EnrichedData, SourceUrl, ImageUrl, ThinkingLevelOption, EnrichmentModel, CategoryItem, CmsCategoryConfig } from "@/types";
import { CMS_CATEGORY_CONFIG, DEFAULT_CMS_CATEGORY_CONFIG } from "@/types";

export interface GeminiSettings {
  enrichmentModel: EnrichmentModel;
  thinkingLevel: ThinkingLevelOption;
  outputLanguage: string;
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

// Resolve Google Grounding API redirect URLs to actual destination URLs
async function resolveRedirectUrl(url: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; DataSheetAI/1.0)" },
    });
    clearTimeout(timeout);
    // After following redirects, res.url is the final destination
    return res.url || url;
  } catch {
    return url; // fallback to original if resolving fails
  }
}

// Resolve all source URLs in parallel — converts Google redirect URLs to real URLs
async function resolveSourceUrls(sources: SourceUrl[]): Promise<SourceUrl[]> {
  const resolved = await Promise.all(
    sources.map(async (s) => {
      if (s.uri.includes("vertexaisearch.cloud.google.com/grounding-api-redirect")) {
        const realUrl = await resolveRedirectUrl(s.uri);
        console.log(`[Resolve] ${s.title}: ${s.uri.slice(0, 60)}... → ${realUrl.slice(0, 80)}`);
        return { ...s, uri: realUrl };
      }
      return s;
    })
  );
  return resolved;
}

export async function searchProduct(
  productData: Record<string, string>,
  customInstruction?: string
): Promise<{ text: string; sources: SourceUrl[] }> {
  return withRetry(async () => {
    const ai = getClient();
    const { text: promptText, images } = buildSearchPrompt(productData, customInstruction);

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

    // Resolve Google redirect URLs to actual destination URLs
    const resolvedSources = await resolveSourceUrls(sources);
    console.log(`[Gemini] Resolved ${resolvedSources.length} source URLs`);

    return { text, sources: resolvedSources };
  }, 2, 2000);
}

// Validate image URL by sending a HEAD request to check it's accessible and is an image
async function validateImageUrl(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; DataSheetAI/1.0)" },
      redirect: "follow",
    });
    clearTimeout(timeout);
    if (!res.ok) return false;
    const ct = res.headers.get("content-type") || "";
    return ct.startsWith("image/");
  } catch {
    return false;
  }
}

// Validate a batch of image URLs in parallel, return only working ones
async function filterValidImages(images: ImageUrl[]): Promise<ImageUrl[]> {
  const results = await Promise.all(
    images.map(async (img) => {
      const ok = await validateImageUrl(img.imageUrl);
      if (!ok) console.log(`[ImageValidation] Broken: ${img.imageUrl}`);
      return ok ? img : null;
    })
  );
  return results.filter(Boolean) as ImageUrl[];
}

// AI-powered analysis: determines if product data is sufficient for image search
// and generates the optimal search query using the user's chosen model + thinking level
async function analyzeProductData(
  productData: Record<string, string>,
  settings?: GeminiSettings
): Promise<{ sufficient: boolean; searchQuery: string; productIdentity: string }> {
  const ai = getClient();
  const model = settings?.enrichmentModel || "gemini-3.1-pro-preview";
  const thinkingLevel = THINKING_LEVEL_MAP[settings?.thinkingLevel || "low"];

  // Prepare product data for analysis (exclude base64 images from text)
  const dataLines: string[] = [];
  for (const [key, value] of Object.entries(productData)) {
    if (!value || value.trim() === "") continue;
    if (value.startsWith("data:image/")) {
      dataLines.push(`- ${key}: [image attached]`);
    } else {
      dataLines.push(`- ${key}: ${value}`);
    }
  }

  const prompt = `Analyze the following product data and determine:
1. Can you clearly identify what this product is (brand, type, model)?
2. Is the data sufficient to search for product images on Google?
3. Generate the best possible English search query to find images of this EXACT product.

Product Data:
${dataLines.join("\n")}

Rules:
- If you can identify the product clearly (e.g. has description, name, or brand+model), mark as sufficient.
- If the data only has codes/numbers with no descriptive text, mark as NOT sufficient.
- The search query MUST be in English regardless of the input language.
- The search query should include brand, product type, and model number if available.
- Do NOT guess or fabricate product details. Only use what's in the data.

Respond ONLY with a valid JSON object:
{"sufficient": true/false, "searchQuery": "brand product-type model-number", "productIdentity": "brief description of what the product is"}`;

  console.log(`[AI Analysis] Analyzing product data with ${model}...`);

  try {
    const response = await ai.models.generateContent({
      model,
      contents: createUserContent([{ text: prompt }]),
      config: {
        responseMimeType: "application/json",
        ...(thinkingLevel != null ? { thinkingConfig: { thinkingLevel } } : {}),
      },
    });

    const text = response.text || "{}";
    const result = JSON.parse(text);
    console.log(`[AI Analysis] sufficient=${result.sufficient}, query="${result.searchQuery}", identity="${result.productIdentity}"`);
    return {
      sufficient: !!result.sufficient,
      searchQuery: result.searchQuery || "",
      productIdentity: result.productIdentity || "",
    };
  } catch (err: any) {
    console.warn(`[AI Analysis] Failed: ${err.message}, defaulting to insufficient`);
    return { sufficient: false, searchQuery: "", productIdentity: "" };
  }
}

// Serper.dev Google Images API — returns real, direct image URLs
async function serperImageSearch(
  searchQuery: string,
  imageCount: number
): Promise<ImageUrl[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    console.warn("[Serper] SERPER_API_KEY not set, skipping Serper image search");
    return [];
  }
  if (!searchQuery.trim()) return [];

  console.log(`[Serper] Image search query: "${searchQuery}"`);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const res = await fetch("https://google.serper.dev/images", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: searchQuery,
        num: Math.min(imageCount + 5, 20),
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[Serper] API returned ${res.status}: ${await res.text().catch(() => "")}`);
      return [];
    }

    const data = await res.json();
    const images: ImageUrl[] = [];
    const seen = new Set<string>();

    if (data.images && Array.isArray(data.images)) {
      for (const img of data.images) {
        if (!img.imageUrl || seen.has(img.imageUrl)) continue;
        
        // Filter: skip small images (icons, thumbnails)
        const w = img.imageWidth || 0;
        const h = img.imageHeight || 0;
        if (w > 0 && w < 150) continue;
        if (h > 0 && h < 150) continue;
        
        seen.add(img.imageUrl);
        images.push({
          imageUrl: img.imageUrl,
          pageUrl: img.link || "",
          title: img.title || "Product image",
        });
      }
    }

    console.log(`[Serper] Found ${images.length} product images from Google Images`);
    return images.slice(0, imageCount + 3);
  } catch (err: any) {
    console.warn(`[Serper] Image search failed: ${err.message}`);
    return [];
  }
}

// Search for product images with smart AI-driven query building
export async function searchProductImages(
  productData: Record<string, string>,
  imageCount: number = 3,
  customInstruction: string = "",
  settings?: GeminiSettings,
  preBuiltQuery?: string
): Promise<ImageUrl[]> {
  return withRetry(async () => {
    // Determine the search query
    let searchQuery = preBuiltQuery || "";

    if (!searchQuery) {
      // Use AI to generate the optimal search query
      const analysis = await analyzeProductData(productData, settings);
      searchQuery = analysis.searchQuery;
    }

    if (!searchQuery) {
      console.warn(`[ImageSearch] No search query could be determined`);
      return [];
    }

    // Add custom instruction context if relevant
    if (customInstruction) {
      searchQuery = `${searchQuery} ${customInstruction}`.trim();
    }

    // Fetch images from Serper
    console.log(`[ImageSearch] Searching with query: "${searchQuery}"`);
    const candidates = await serperImageSearch(searchQuery, imageCount);
    console.log(`[ImageSearch] Serper returned ${candidates.length} candidates`);

    if (candidates.length === 0) {
      console.warn(`[ImageSearch] No candidates found`);
      return [];
    }

    // Validate all candidate URLs with HEAD requests
    console.log(`[ImageSearch] Validating ${candidates.length} image URLs...`);
    const validated = await filterValidImages(candidates);
    console.log(`[ImageSearch] Validation: ${validated.length}/${candidates.length} images are accessible`);
    return validated.slice(0, imageCount);
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

function repairTruncatedJson(text: string): string | null {
  // Attempt to fix truncated JSON by closing open strings, arrays, and objects
  let repaired = text.trim();

  // If it ends mid-string, close the string
  const quoteCount = (repaired.match(/(?<!\\)"/g) || []).length;
  if (quoteCount % 2 !== 0) {
    // Truncate to last complete key-value and close
    const lastCompleteComma = repaired.lastIndexOf('",');
    if (lastCompleteComma > 0) {
      repaired = repaired.slice(0, lastCompleteComma + 1);
    } else {
      repaired += '"';
    }
  }

  // Remove trailing comma if present
  repaired = repaired.replace(/,\s*$/, "");

  // Count open/close braces and brackets
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  for (let i = 0; i < repaired.length; i++) {
    const ch = repaired[i];
    if (ch === '"' && (i === 0 || repaired[i - 1] !== "\\")) {
      inString = !inString;
    }
    if (!inString) {
      if (ch === "{") openBraces++;
      else if (ch === "}") openBraces--;
      else if (ch === "[") openBrackets++;
      else if (ch === "]") openBrackets--;
    }
  }

  // Close any open brackets and braces
  for (let i = 0; i < openBrackets; i++) repaired += "]";
  for (let i = 0; i < openBraces; i++) repaired += "}";

  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    return null;
  }
}

export async function enrichProduct(
  productData: Record<string, string>,
  searchResults: string,
  enabledColumns: string[],
  enrichmentColumns?: { id: string; label: string; description: string; type: string; customInstruction?: string; writingTone?: string; contentLength?: string }[],
  settings?: GeminiSettings
): Promise<EnrichedData> {
  return withRetry(async () => {
    const ai = getClient();

    // Build per-column prompt settings from column configs
    const promptSettings: PromptSettings = {
      outputLanguage: settings?.outputLanguage || "English",
      writingTone: "professional",
      customTone: "",
      contentLength: "medium",
      columnSettings: enrichmentColumns?.reduce((acc, col) => {
        if (col.writingTone || col.contentLength) {
          acc[col.id] = { writingTone: col.writingTone, contentLength: col.contentLength };
        }
        return acc;
      }, {} as Record<string, { writingTone?: string; contentLength?: string }>) || {},
    };

    const { text: promptText, images } = buildEnrichmentPrompt(
      productData,
      searchResults,
      enabledColumns,
      enrichmentColumns,
      promptSettings
    );

    // Build multimodal content: text + images
    const parts: any[] = [{ text: promptText }];
    for (const img of images) {
      parts.push(img);
    }

    const model = settings?.enrichmentModel || "gemini-3.1-pro-preview";
    const thinkingLevel = THINKING_LEVEL_MAP[settings?.thinkingLevel || "low"];

    const response = await ai.models.generateContent({
      model,
      contents: createUserContent(parts),
      config: {
        responseMimeType: "application/json",
        maxOutputTokens: 65536,
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
          // Try to repair truncated JSON
          const repaired = repairTruncatedJson(jsonMatch[0]);
          if (repaired) {
            try {
              console.warn("[Gemini] Repaired truncated JSON response");
              return JSON.parse(repaired) as EnrichedData;
            } catch {
              // Fall through to error
            }
          }
          throw new Error(`Failed to parse AI response as JSON: ${text.slice(0, 200)}`);
        }
      }
      throw new Error(`Failed to parse AI response as JSON: ${text.slice(0, 200)}`);
    }
  }, 2, 3000);
}

// AI-powered product categorization: picks from existing categories or generates new ones
// Formats output according to the CMS platform rules
async function categorizeProduct(
  productData: Record<string, string>,
  searchResults: string,
  settings?: GeminiSettings,
  cmsType?: string,
  workspaceCategories?: CategoryItem[],
  maxCategories: number = 3,
  customInstruction: string = ""
): Promise<string> {
  const ai = getClient();
  const model = settings?.enrichmentModel || "gemini-3.1-pro-preview";
  const thinkingLevel = THINKING_LEVEL_MAP[settings?.thinkingLevel || "low"];
  const cmsConfig: CmsCategoryConfig = cmsType && CMS_CATEGORY_CONFIG[cmsType]
    ? CMS_CATEGORY_CONFIG[cmsType]
    : DEFAULT_CMS_CATEGORY_CONFIG;

  // Build product data summary
  const { textEntries } = extractImagesFromData(productData);

  // Build categories section for the prompt
  let categoriesSection = "";
  const hasCategories = workspaceCategories && workspaceCategories.length > 0;

  if (hasCategories) {
    const categoryList = workspaceCategories.map((c) => `- ${c.fullPath}`).join("\n");
    categoriesSection = `\nAVAILABLE CATEGORIES (you MUST pick ONLY from this list):\n${categoryList}\n\nIMPORTANT: You can ONLY use categories from the list above. Do NOT invent new categories.`;
  } else {
    categoriesSection = `\nNo predefined categories are available. You should suggest the most appropriate product categories based on the product data and industry standards.`;
  }

  // Build CMS formatting instructions
  const maxCats = cmsConfig.supportsMultiple ? maxCategories : 1;
  let formattingRules = `\nCMS Platform: ${cmsType || "generic"}
Column Name: ${cmsConfig.columnName}
${cmsConfig.notes}

FORMATTING RULES:
- ${cmsConfig.supportsMultiple ? `You may assign up to ${maxCats} categories` : "You must assign exactly 1 category"}
- ${cmsConfig.supportsHierarchy ? `Use "${cmsConfig.hierarchySeparator}" to show parent/child hierarchy` : "Use only leaf category names, no hierarchy paths"}
- ${cmsConfig.supportsMultiple ? `Separate multiple categories with "${cmsConfig.multiCategorySeparator}"` : "Only one category allowed"}`;

  const instruction = customInstruction ? `\nAdditional instruction: ${customInstruction}` : "";

  const prompt = `You are a product categorization expert. Assign the most relevant categories to this product.

Product Data:
${textEntries}

${searchResults ? `Product Research Results:\n${searchResults.slice(0, 800)}\n` : ""}
${categoriesSection}
${formattingRules}
${instruction}

Respond ONLY with a valid JSON object:
{"categories": "formatted category string ready for CSV import", "reasoning": "brief explanation of why these categories were chosen"}`;

  console.log(`[Categories] Categorizing product with ${model} (CMS: ${cmsType || "generic"}, available: ${hasCategories ? workspaceCategories!.length : 0} categories)`);

  try {
    const response = await ai.models.generateContent({
      model,
      contents: createUserContent([{ text: prompt }]),
      config: {
        responseMimeType: "application/json",
        ...(thinkingLevel != null ? { thinkingConfig: { thinkingLevel } } : {}),
      },
    });

    const text = response.text || "{}";
    const result = JSON.parse(text);
    console.log(`[Categories] Result: "${result.categories}" | Reason: ${result.reasoning}`);
    return result.categories || "";
  } catch (err: any) {
    console.warn(`[Categories] Categorization failed: ${err.message}`);
    return "";
  }
}

export async function enrichProductRow(
  productData: Record<string, string>,
  enabledColumns: string[],
  enrichmentColumns?: { id: string; label: string; description: string; type: string; enabled: boolean; imageCount?: number; sourceCount?: number; maxCategories?: number; customInstruction?: string; writingTone?: string; contentLength?: string }[],
  settings?: GeminiSettings,
  cmsType?: string,
  workspaceCategories?: CategoryItem[]
): Promise<EnrichedData> {
  // Determine what's needed
  const specialColumns = ["sourceUrls", "imageUrls", "categories"];
  const columnsToGenerate = enabledColumns.filter((c) => !specialColumns.includes(c));
  const needsEnrich = columnsToGenerate.length > 0;
  const needsSources = enabledColumns.includes("sourceUrls");
  const needsImages = enabledColumns.includes("imageUrls");
  const needsCategories = enabledColumns.includes("categories");

  // Smart flow: determine if we need Gemini Search (Step 1)
  // We need search if: text columns need enriching OR sources are requested
  // For images/categories-only: AI analyzes if data is sufficient
  let needsSearch = needsEnrich || needsSources;
  let imageSearchQuery = ""; // AI-generated query for Serper

  // If only special columns (images/categories) are needed, check if data is sufficient
  if (!needsSearch && (needsImages || needsCategories)) {
    console.log(`[Smart Flow] Special-columns-only mode — analyzing product data with AI...`);
    const analysis = await analyzeProductData(productData, settings);

    if (analysis.sufficient) {
      console.log(`[Smart Flow] Data sufficient ✓ — skipping web search, AI query: "${analysis.searchQuery}"`);
      imageSearchQuery = analysis.searchQuery;
    } else {
      console.log(`[Smart Flow] Data insufficient ✗ — will search web first to identify product`);
      needsSearch = true;
    }
  }

  let searchResults = "";
  let sources: SourceUrl[] = [];

  // Step 1: Search with Gemini + Google Search (only if needed)
  if (needsSearch) {
    const reasons = [
      needsEnrich && "enrichment",
      needsSources && "sources",
      (!imageSearchQuery && needsImages) && "image identification",
      needsCategories && "categorization",
    ].filter(Boolean).join(", ");
    console.log(`[Smart Flow] Step 1: Web search (needed for: ${reasons})`);
    const sourceCol = enrichmentColumns?.find((c) => c.id === "sourceUrls");
    const searchInstruction = sourceCol?.customInstruction;
    const result = await searchProduct(productData, searchInstruction);
    searchResults = result.text;
    sources = result.sources;

    // If we needed search for images, now generate a better query from search results
    if (needsImages && !imageSearchQuery) {
      console.log(`[Smart Flow] Product identified via search — generating image query with AI...`);
      const enrichedProductData = { ...productData, "__searchResults": searchResults.slice(0, 500) };
      const analysis = await analyzeProductData(enrichedProductData, settings);
      imageSearchQuery = analysis.searchQuery;
      console.log(`[Smart Flow] AI image query from search: "${imageSearchQuery}"`);
    }
  } else {
    console.log(`[Smart Flow] Step 1: SKIPPED (not needed)`);
  }

  // Step 2: Enrich with selected model (only if text columns are enabled)
  let enrichedData: EnrichedData = {};
  if (needsEnrich) {
    console.log(`[Smart Flow] Step 2: Enriching ${columnsToGenerate.length} columns`);
    enrichedData = await enrichProduct(
      productData,
      searchResults,
      columnsToGenerate,
      enrichmentColumns,
      settings
    );
  } else {
    console.log(`[Smart Flow] Step 2: SKIPPED (no text columns)`);
  }

  // Step 3: Attach sources if requested
  if (needsSources) {
    const sourceCol = enrichmentColumns?.find((c) => c.id === "sourceUrls");
    const sourceCount = sourceCol?.sourceCount ?? 3;
    enrichedData.sourceUrls = sources.slice(0, sourceCount);
  }

  // Step 4: Categorize product if categories column is enabled
  if (needsCategories) {
    const catCol = enrichmentColumns?.find((c) => c.id === "categories");
    const maxCategories = catCol?.maxCategories ?? 3;
    const customInstruction = catCol?.customInstruction ?? "";
    try {
      console.log(`[Smart Flow] Step 4: Categorizing product (CMS: ${cmsType || "generic"})`);
      const categoryResult = await categorizeProduct(
        productData,
        searchResults,
        settings,
        cmsType,
        workspaceCategories,
        maxCategories,
        customInstruction
      );
      enrichedData.categories = categoryResult;
    } catch (error: any) {
      console.warn(`[Categories] Categorization failed: ${error.message}`);
      enrichedData.categories = "";
    }
  }

  // Step 5: Search for product images if enabled
  if (needsImages) {
    const imageCol = enrichmentColumns?.find((c) => c.id === "imageUrls");
    const imageCount = imageCol?.imageCount ?? 3;
    const customInstruction = imageCol?.customInstruction ?? "";
    try {
      console.log(`[Smart Flow] Step 5: Fetching images via Serper`);
      const imageResults = await searchProductImages(
        productData,
        imageCount,
        customInstruction,
        settings,
        imageSearchQuery || undefined
      );
      enrichedData.imageUrls = imageResults;
    } catch (error: any) {
      console.warn(`[ImageSearch] Image search failed: ${error.message}`);
      enrichedData.imageUrls = [];
    }
  }

  return enrichedData;
}
