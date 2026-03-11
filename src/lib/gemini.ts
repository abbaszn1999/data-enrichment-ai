import { GoogleGenAI, ThinkingLevel, createUserContent } from "@google/genai";
import { buildSearchPrompt, buildEnrichmentPrompt } from "./prompts";
import type { PromptSettings } from "./prompts";
import type { EnrichedData, SourceUrl, ThinkingLevelOption, EnrichmentModel } from "@/types";

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
      model: "gemini-3-flash-preview",
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
  enrichmentColumns?: { id: string; label: string; description: string; type: string; enabled: boolean }[],
  settings?: GeminiSettings
): Promise<EnrichedData> {
  // Step 1: Search with Gemini 3 Flash + Google Search
  const { text: searchResults, sources } = await searchProduct(productData);

  // Step 2: Enrich with selected model
  const columnsToGenerate = enabledColumns.filter((c) => c !== "sourceUrls");
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

  return enrichedData;
}
