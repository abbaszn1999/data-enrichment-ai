import { runGeminiMarketResearch } from "./gemini-runner";
import { mapLimit } from "@/lib/async/map-limit";

export type ClassifiedSheetType = "category" | "informational" | "excluded";

export interface KeywordToClassify {
  id: string;
  keyword: string;
  seed?: string;
  volume?: number;
  difficulty?: number;
  intents?: string[];
}

export interface ClassifiedKeywordItem {
  id: string;
  keyword: string;
  sheet: ClassifiedSheetType;
  confidence: number;
  reason: string;
  plpConcept?: string;
}

export interface Stage4ClassificationResult {
  classified: ClassifiedKeywordItem[];
  summary: {
    total: number;
    categoryCount: number;
    informationalCount: number;
    excludedCount: number;
  };
  isAiGenerated: boolean;
}

interface GeminiKeywordClassificationItem {
  id: string;
  sheet: string; // "category" | "informational" | "excluded"
  confidence?: number;
  reason: string;
  plpConcept?: string;
}

interface GeminiIntentClassificationResponse {
  classifications: GeminiKeywordClassificationItem[];
}

function normalizeSheet(val: string): ClassifiedSheetType {
  const clean = val.toLowerCase().trim();
  if (clean.includes("category") || clean.includes("plp") || clean === "commercial" || clean === "collection") {
    return "category";
  }
  if (clean.includes("info") || clean.includes("guide") || clean.includes("question") || clean.includes("blog")) {
    return "informational";
  }
  return "excluded";
}

/**
 * Heuristic fallback classifier in case AI API is unavailable.
 */
export function runHeuristicStage4Classification(input: {
  keywords: KeywordToClassify[];
}): Stage4ClassificationResult {
  const classified: ClassifiedKeywordItem[] = input.keywords.map((kw) => {
    const text = kw.keyword.toLowerCase().trim();

    // 1. Informational patterns
    if (
      /^(how|what|why|when|where|who|which|can|do|does|should|is|are)\b/i.test(text) ||
      /\b(vs|versus|guide|tutorial|review|reviews|ideas|tips|diy|how to|meaning|benefits)\b/i.test(text) ||
      text.includes("?")
    ) {
      return {
        id: kw.id,
        keyword: kw.keyword,
        sheet: "informational",
        confidence: 0.9,
        reason: "Informational guide or query suitable for blog/FAQ content",
      };
    }

    // 2. Excluded / PDP / Navigational patterns
    if (
      /\b(login|sign in|download|app|apk|pdf|driver|manual|warranty|support|customer care|careers|jobs|phone number|address|location|store locator|coupons|promo code|free|hack|crack)\b/i.test(text) ||
      // Specific SKU / Model patterns (e.g., iPhone 15 Pro Max 256GB, Sony WH-1000XM5)
      /\b\d{2,4}(gb|tb|mb|mah|hz|w|v|mm|cm)\b/i.test(text) ||
      /\b(v\d+|\b[a-z]{1,4}-\d{2,5}[a-z0-9]*)\b/i.test(text)
    ) {
      return {
        id: kw.id,
        keyword: kw.keyword,
        sheet: "excluded",
        confidence: 0.85,
        reason: "Excluded: Single product SKU, model, or non-commercial navigational term",
      };
    }

    // 3. Category / PLP suitable
    return {
      id: kw.id,
      keyword: kw.keyword,
      sheet: "category",
      confidence: 0.85,
      reason: "Commercial group concept with multiple browsable products (PLP suitable)",
      plpConcept: "Category collection",
    };
  });

  const categoryCount = classified.filter((c) => c.sheet === "category").length;
  const informationalCount = classified.filter((c) => c.sheet === "informational").length;
  const excludedCount = classified.filter((c) => c.sheet === "excluded").length;

  return {
    classified,
    summary: {
      total: classified.length,
      categoryCount,
      informationalCount,
      excludedCount,
    },
    isAiGenerated: false,
  };
}

export async function runStage4IntentClassification(input: {
  storeName?: string;
  parentNiches?: string[];
  collections?: string[];
  keywords: KeywordToClassify[];
}): Promise<Stage4ClassificationResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || input.keywords.length === 0) {
    return runHeuristicStage4Classification(input);
  }

  const BATCH_SIZE = 60;
  const batches: KeywordToClassify[][] = [];
  for (let i = 0; i < input.keywords.length; i += BATCH_SIZE) {
    batches.push(input.keywords.slice(i, i + BATCH_SIZE));
  }

  const batchResults = await mapLimit(batches, 4, async (batch) => {
    try {
      const userPrompt = JSON.stringify({
        storeContext: {
          storeName: input.storeName || "Ecommerce Store",
          confirmedNiches: input.parentNiches || [],
          storeCollections: input.collections || [],
        },
        keywordsToClassify: batch.map((kw) => ({
          id: kw.id,
          keyword: kw.keyword,
          seed: kw.seed || "",
          volume: kw.volume || 0,
          difficulty: kw.difficulty || 0,
          semrushIntents: kw.intents || [],
        })),
      });

      const systemInstruction = `You are the Autommerce Collection Opportunity Agent powered by Gemini 3.7 Flash.
Analyze each provided keyword and classify it strictly into one of three sheets:

1. "category" (PLP suitable) -> Commercial/transactional product groups, styles, materials, features, use-cases, audiences where shoppers expect to browse and compare MULTIPLE products.
2. "informational" -> Educational questions, how-tos, vs comparisons, buying guides, tutorials, or informational search queries (suitable for Blog / Strategy).
3. "excluded" -> Single SKUs/models (PDP intent, e.g. "iPhone 15 Pro Max 256GB"), navigational brand logins/locations, support/manuals/drivers, jobs, or terms outside the confirmed store niches.

Output strictly valid JSON with this exact schema:
{
  "classifications": [
    {
      "id": "keyword-id-matching-input",
      "sheet": "category" | "informational" | "excluded",
      "confidence": 0.95,
      "reason": "Brief concise reason explaining why (e.g. 'Multiple products browsable category', 'Educational buying question', 'Specific single model / SKU (PDP)', 'Support / driver query')",
      "plpConcept": "Optional brief concept label if category (e.g. 'Audience collection', 'Feature collection', 'Style collection')"
    }
  ]
}`;

      const aiResponse = await runGeminiMarketResearch<GeminiIntentClassificationResponse>({
        stage: 4,
        systemInstruction,
        userPrompt,
      });

      const responseMap = new Map<string, GeminiKeywordClassificationItem>();
      if (Array.isArray(aiResponse.data?.classifications)) {
        for (const item of aiResponse.data.classifications) {
          if (item?.id) {
            responseMap.set(item.id, item);
          }
        }
      }

      const classified: ClassifiedKeywordItem[] = [];
      for (const kw of batch) {
        const item = responseMap.get(kw.id);
        if (item) {
          classified.push({
            id: kw.id,
            keyword: kw.keyword,
            sheet: normalizeSheet(item.sheet || "category"),
            confidence: Math.min(1, Math.max(0.1, item.confidence || 0.9)),
            reason: item.reason || "Classified by Gemini 3.7 Flash",
            plpConcept: item.plpConcept || undefined,
          });
        } else {
          const heuristic = runHeuristicStage4Classification({ keywords: [kw] });
          if (heuristic.classified[0]) {
            classified.push(heuristic.classified[0]);
          }
        }
      }
      return classified;
    } catch (err) {
      console.error("[runStage4IntentClassification] Batch failed, falling back to heuristics:", err);
      const heuristic = runHeuristicStage4Classification({ keywords: batch });
      return heuristic.classified;
    }
  });

  const allClassified = batchResults.flat();

  const categoryCount = allClassified.filter((c) => c.sheet === "category").length;
  const informationalCount = allClassified.filter((c) => c.sheet === "informational").length;
  const excludedCount = allClassified.filter((c) => c.sheet === "excluded").length;

  return {
    classified: allClassified,
    summary: {
      total: allClassified.length,
      categoryCount,
      informationalCount,
      excludedCount,
    },
    isAiGenerated: true,
  };
}
