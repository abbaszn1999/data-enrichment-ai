import { buildSearchPrompt } from "./prompts";
import type { SourceUrl, ImageUrl, ThinkingLevelOption } from "@/types";
import {
  calculateCallCost,
  calculateGroundedCallCost,
  type AiCallCost,
} from "./ai-pricing";

/**
 * Gemini helpers retained for Sync (web research + Serper image search).
 * Import AI enrichment uses `@/lib/enrich` (OpenAI Responses) — do not call
 * removed enrichProductRow from this module.
 */

/** Settings for Gemini helpers still used by Sync (not Import enrich). */
export interface GeminiSettings {
  enrichmentModel?: string;
  thinkingLevel?: ThinkingLevelOption;
  outputLanguage?: string;
}

async function getThinkingLevel(level: ThinkingLevelOption | undefined): Promise<any> {
  const { ThinkingLevel } = await import("@google/genai");
  const map: Record<string, any> = {
    none: undefined,
    low: ThinkingLevel.LOW,
    medium: ThinkingLevel.MEDIUM,
    high: ThinkingLevel.HIGH,
  };
  return map[level ?? "low"];
}

async function getClient() {
  const { GoogleGenAI } = await import("@google/genai");
  const apiKey = process.env.GEMINI_API_KEY;
  console.log("[Gemini] API Key present:", !!apiKey, "| Length:", apiKey?.length ?? 0);
  if (!apiKey) {
    console.error("[Gemini] All env keys:", Object.keys(process.env).filter(k => k.includes("GEMINI")));
    throw new Error("GEMINI_API_KEY environment variable is not set");
  }
  return new GoogleGenAI({ 
    apiKey,
    httpOptions: {
      timeout: 180000,
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
): Promise<{ text: string; sources: SourceUrl[]; cost: AiCallCost }> {
  return withRetry(async () => {
    const { createUserContent, ThinkingLevel } = await import("@google/genai");
    const ai = await getClient();
    const { text: promptText, images } = buildSearchPrompt(productData, customInstruction);

    // Build multimodal content: text + images
    const parts: any[] = [{ text: promptText }];
    for (const img of images) {
      parts.push(img);
    }

    console.log(`[Gemini] Search request: ${images.length} image(s) attached`);

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: createUserContent(parts),
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const text = response.text || "";

    // Gemini 3 bills grounding per executed search query, not per prompt.
    // groundingMetadata.webSearchQueries lists the queries the model ran;
    // when it's absent (older shapes / no search executed) fall back to 1
    // because the tool was enabled for this call.
    const executedQueries =
      response.candidates?.[0]?.groundingMetadata?.webSearchQueries?.filter(
        (q) => typeof q === "string" && q.trim()
      ).length;
    const queryCount =
      typeof executedQueries === "number" ? Math.max(executedQueries, 1) : 1;
    const cost = calculateGroundedCallCost(
      "gemini-3.6-flash",
      response.usageMetadata,
      queryCount
    );
    console.log(
      `[Gemini] Search cost: $${cost.totalCost.toFixed(6)} (${cost.usage.totalTokens} tokens, ${queryCount} search queries)`
    );

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

    return { text, sources: resolvedSources, cost };
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
): Promise<{ sufficient: boolean; searchQuery: string; productIdentity: string; cost: AiCallCost | null }> {
  const ai = await getClient();
  const model = settings?.enrichmentModel || "gemini-3.6-flash";
  const thinkingLevel = await getThinkingLevel(settings?.thinkingLevel);

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
    const { createUserContent } = await import("@google/genai");
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

    // Calculate cost from usageMetadata
    const cost = calculateCallCost(model, response.usageMetadata, false);
    console.log(`[AI Analysis] sufficient=${result.sufficient}, query="${result.searchQuery}", identity="${result.productIdentity}"`);
    console.log(`[AI Analysis] Cost: $${cost.totalCost.toFixed(6)} (${cost.usage.totalTokens} tokens)`);
    return {
      sufficient: !!result.sufficient,
      searchQuery: result.searchQuery || "",
      productIdentity: result.productIdentity || "",
      cost,
    };
  } catch (err: any) {
    console.warn(`[AI Analysis] Failed: ${err.message}, defaulting to insufficient`);
    return { sufficient: false, searchQuery: "", productIdentity: "", cost: null };
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

