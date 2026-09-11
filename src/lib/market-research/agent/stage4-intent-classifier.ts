import { runGeminiMarketResearch } from "./gemini-runner";
import { runWithConcurrency, chunk } from "@/lib/sync/core/batch-executor";

export type ClassifiedSheetType = "category" | "informational" | "excluded";

export interface KeywordToClassify {
  id: string;
  keyword: string;
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

function indexGeminiClassifications(
  items: GeminiKeywordClassificationItem[]
): Map<string, GeminiKeywordClassificationItem> {
  const map = new Map<string, GeminiKeywordClassificationItem>();
  for (const item of items) {
    if (!item?.id) continue;
    map.set(item.id, item);
    map.set(item.id.trim().toLowerCase(), item);
  }
  return map;
}

function lookupGeminiClassification(
  map: Map<string, GeminiKeywordClassificationItem>,
  kw: KeywordToClassify
): GeminiKeywordClassificationItem | undefined {
  return (
    map.get(kw.id) ??
    map.get(kw.id.trim().toLowerCase()) ??
    map.get(kw.keyword.trim().toLowerCase())
  );
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
  keywords: KeywordToClassify[];
}): Promise<Stage4ClassificationResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || input.keywords.length === 0) {
    return runHeuristicStage4Classification(input);
  }

  const BATCH_SIZE = 100;
  const BATCH_CONCURRENCY = 5;
  const batches: KeywordToClassify[][] = chunk(input.keywords, BATCH_SIZE);

  const systemInstruction = `You are the Autommerce Intent Classification Agent powered by Gemini 3.7 Flash.
You receive bare keywords — no store name, no niche list, no collections, no volume, no
difficulty. Classify each one strictly into one of three sheets, using only ordinary world
knowledge of how shopping and search work — never store-specific context you were not given:

1. "category" (PLP suitable) -> A real shopper searching this exact phrase would expect to land on
   a page listing MULTIPLE different, comparable products to browse and compare (main categories,
   brand+category terms, audience/use-case/feature/style/material/compatibility/occasion/
   problem-solution collections). A commercial-sounding label alone is not enough — there must
   genuinely be multiple different products behind it.
2. "informational" -> A real shopper searching this exact phrase wants to learn or decide, not
   browse a product grid right now: questions, "vs" comparisons, buying guides, care/how-to
   content, single-product reviews with no browsing intent.
3. "excluded" -> The catch-all: fails BOTH tests above, for any reason. This is NOT limited to
   single-SKU/PDP terms (e.g. "iPhone 15 Pro Max 256GB") — it also covers navigational/brand-login
   queries, support/manuals/careers/jobs queries, and vague or malformed phrases too generic to
   represent any real purchasable product group. Never treat "excluded" as a synonym for "single
   product"; always name the actual applicable reason.

Batch consistency: this batch runs concurrently with other batches from the same job. Near-identical
or same-shape keywords must get the same verdict regardless of which batch they landed in — apply
the fixed rules only, never an impression based on this batch's specific mix of keywords.

There is no fourth "needs review" bucket. For a genuinely ambiguous keyword, pick the
best-supported sheet, lower "confidence" (below ~0.6), and name the ambiguity directly in "reason"
instead of guessing silently or forcing false confidence.

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

  /**
   * Calls Gemini for a single batch, with one retry (short backoff) before
   * giving up. A thrown error here means the WHOLE batch is undecided and
   * must fall back to heuristics — a single retry protects against
   * transient/rate-limit blips without silently downgrading quality.
   */
  async function classifyBatchWithGemini(
    batch: KeywordToClassify[]
  ): Promise<GeminiIntentClassificationResponse> {
    const userPrompt = JSON.stringify({
      keywordsToClassify: batch.map((kw) => ({
        id: kw.id,
        keyword: kw.keyword,
      })),
    });

    try {
      const aiResponse = await runGeminiMarketResearch<GeminiIntentClassificationResponse>({
        stage: 4,
        systemInstruction,
        userPrompt,
      });
      return aiResponse.data;
    } catch (err) {
      console.error("[runStage4IntentClassification] Batch call failed, retrying once:", err);
      await new Promise((resolve) => setTimeout(resolve, 800));
      const retryResponse = await runGeminiMarketResearch<GeminiIntentClassificationResponse>({
        stage: 4,
        systemInstruction,
        userPrompt,
      });
      return retryResponse.data;
    }
  }

  /**
   * Runs one batch end-to-end and returns its classified rows. Each batch
   * builds its own `responseMap` from ONLY its own Gemini response and
   * matches ONLY its own input keywords by `id` — this is what guarantees
   * no cross-batch data contamination, regardless of how many batches run
   * concurrently.
   */
  async function classifyOneBatch(
    batch: KeywordToClassify[]
  ): Promise<ClassifiedKeywordItem[]> {
    const data = await classifyBatchWithGemini(batch);

    const responseMap = indexGeminiClassifications(
      Array.isArray(data?.classifications) ? data.classifications : []
    );

    const results: ClassifiedKeywordItem[] = [];
    for (const kw of batch) {
      const item = lookupGeminiClassification(responseMap, kw);
      if (item) {
        results.push({
          id: kw.id,
          keyword: kw.keyword,
          sheet: normalizeSheet(item.sheet || "category"),
          confidence: Math.min(1, Math.max(0.1, item.confidence || 0.9)),
          reason: item.reason || "Classified by Gemini 3.7 Flash",
          plpConcept: item.plpConcept || undefined,
        });
      } else {
        // Fallback for individual items missing from an otherwise-valid response
        const heuristic = runHeuristicStage4Classification({ keywords: [kw] });
        if (heuristic.classified[0]) {
          results.push(heuristic.classified[0]);
        }
      }
    }
    return results;
  }

  const batchRun = await runWithConcurrency(batches, classifyOneBatch, {
    concurrency: BATCH_CONCURRENCY,
  });

  const allClassified: ClassifiedKeywordItem[] = [];
  for (const rows of batchRun.successes) {
    allClassified.push(...rows);
  }
  for (const { index } of batchRun.errors) {
    const failedBatch = batches[index];
    if (!failedBatch) continue;
    console.error(
      `[runStage4IntentClassification] Batch ${index + 1}/${batches.length} failed after retry, falling back to heuristics for ${failedBatch.length} keywords`
    );
    const heuristic = runHeuristicStage4Classification({ keywords: failedBatch });
    allClassified.push(...heuristic.classified);
  }

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
