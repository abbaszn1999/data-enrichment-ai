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
  /**
   * True only when THIS keyword's verdict came from a real Gemini response
   * (initial batch or the targeted re-request below). False means it used
   * the regex heuristic — it must be flagged everywhere downstream (shard
   * storage, API response, Extract table) and never presented as if Gemini
   * classified it.
   */
  isAiGenerated: boolean;
}

export interface Stage4ClassificationResult {
  classified: ClassifiedKeywordItem[];
  summary: {
    total: number;
    categoryCount: number;
    informationalCount: number;
    excludedCount: number;
  };
  /** True only when every keyword in this call was actually verdicted by Gemini. */
  isAiGenerated: boolean;
  /** Keywords in this call that fell back to the regex heuristic because Gemini's batch failed or omitted them. */
  degradedCount: number;
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

/**
 * Gemini structured-output schema for the classification response. This
 * constrains the SHAPE Gemini is allowed to emit (types, required fields,
 * the fixed sheet enum) on top of the plain `responseMimeType: "json"` the
 * runner already sets — it catches malformed/missing-field output, but it
 * cannot guarantee coverage of every requested id; that's handled by the
 * missing-id detection and targeted re-request below.
 */
const STAGE4_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    classifications: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          sheet: {
            type: "STRING",
            format: "enum",
            enum: ["category", "informational", "excluded"],
          },
          confidence: { type: "NUMBER" },
          reason: { type: "STRING" },
          plpConcept: { type: "STRING" },
        },
        required: ["id", "sheet", "reason"],
      },
    },
  },
  required: ["classifications"],
};

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

/** Builds a verdicted (real AI) classified item from a matched Gemini response row. */
function toAiClassifiedItem(
  kw: KeywordToClassify,
  item: GeminiKeywordClassificationItem
): ClassifiedKeywordItem {
  return {
    id: kw.id,
    keyword: kw.keyword,
    sheet: normalizeSheet(item.sheet || "category"),
    confidence: Math.min(1, Math.max(0.1, item.confidence || 0.9)),
    reason: item.reason || "Classified by Gemini 3.7 Flash",
    plpConcept: item.plpConcept || undefined,
    isAiGenerated: true,
  };
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
        isAiGenerated: false,
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
        isAiGenerated: false,
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
      isAiGenerated: false,
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
    degradedCount: classified.length,
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
  const BATCH_MAX_ATTEMPTS = 3;
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

Every keyword you were given an "id" for MUST get exactly one entry in "classifications" —
never skip or merge entries, even for near-duplicate or ambiguous keywords.

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
   * Calls Gemini for one batch, retrying up to `BATCH_MAX_ATTEMPTS` times
   * total with a growing backoff before giving up. A thrown error here
   * means every keyword in `batch` is undecided and must fall back to
   * heuristics — the retry budget protects against transient/rate-limit
   * blips without silently downgrading quality on the first hiccup.
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

    let lastError: unknown;
    for (let attempt = 1; attempt <= BATCH_MAX_ATTEMPTS; attempt += 1) {
      try {
        const aiResponse = await runGeminiMarketResearch<GeminiIntentClassificationResponse>({
          stage: 4,
          systemInstruction,
          userPrompt,
          responseSchema: STAGE4_RESPONSE_SCHEMA,
        });
        return aiResponse.data;
      } catch (err) {
        lastError = err;
        console.error(
          `[runStage4IntentClassification] Batch call failed (attempt ${attempt}/${BATCH_MAX_ATTEMPTS}):`,
          err
        );
        if (attempt < BATCH_MAX_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Gemini batch call failed after retries");
  }

  /**
   * Runs one batch end-to-end and returns its classified rows. Each batch
   * builds its own `responseMap` from ONLY its own Gemini response and
   * matches ONLY its own input keywords by `id` — this is what guarantees
   * no cross-batch data contamination, regardless of how many batches run
   * concurrently.
   *
   * If the batch call itself succeeds but Gemini's array is missing a
   * handful of ids (a known LLM list-completion gap, not a capacity issue
   * — 100 short JSON rows is nowhere near this model's output budget), we
   * do one cheap targeted re-request containing only those missing
   * keywords before ever falling back to the regex heuristic for them.
   */
  async function classifyOneBatch(
    batch: KeywordToClassify[]
  ): Promise<{ items: ClassifiedKeywordItem[]; degraded: number }> {
    const data = await classifyBatchWithGemini(batch);

    const responseMap = indexGeminiClassifications(
      Array.isArray(data?.classifications) ? data.classifications : []
    );

    const results: ClassifiedKeywordItem[] = [];
    const missing: KeywordToClassify[] = [];
    for (const kw of batch) {
      const item = lookupGeminiClassification(responseMap, kw);
      if (item) {
        results.push(toAiClassifiedItem(kw, item));
      } else {
        missing.push(kw);
      }
    }

    let degraded = 0;
    if (missing.length > 0) {
      let recoveredMap = new Map<string, GeminiKeywordClassificationItem>();
      try {
        const recovered = await classifyBatchWithGemini(missing);
        recoveredMap = indexGeminiClassifications(
          Array.isArray(recovered?.classifications) ? recovered.classifications : []
        );
      } catch (err) {
        console.error(
          `[runStage4IntentClassification] Targeted re-request for ${missing.length} missing id(s) failed after retries:`,
          err
        );
      }

      for (const kw of missing) {
        const item = lookupGeminiClassification(recoveredMap, kw);
        if (item) {
          results.push(toAiClassifiedItem(kw, item));
        } else {
          // Truly unrecoverable for this keyword — fall back for just this
          // one item, clearly flagged as not a real Gemini verdict.
          const heuristic = runHeuristicStage4Classification({ keywords: [kw] });
          if (heuristic.classified[0]) {
            results.push(heuristic.classified[0]);
            degraded += 1;
          }
        }
      }
    }

    return { items: results, degraded };
  }

  const batchRun = await runWithConcurrency(batches, classifyOneBatch, {
    concurrency: BATCH_CONCURRENCY,
  });

  const allClassified: ClassifiedKeywordItem[] = [];
  let degradedCount = 0;
  for (const { items, degraded } of batchRun.successes) {
    allClassified.push(...items);
    degradedCount += degraded;
  }
  for (const { index } of batchRun.errors) {
    const failedBatch = batches[index];
    if (!failedBatch) continue;
    console.error(
      `[runStage4IntentClassification] Batch ${index + 1}/${batches.length} failed after ${BATCH_MAX_ATTEMPTS} attempts, falling back to heuristics for ${failedBatch.length} keywords`
    );
    const heuristic = runHeuristicStage4Classification({ keywords: failedBatch });
    allClassified.push(...heuristic.classified);
    degradedCount += failedBatch.length;
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
    // Only claim full AI verdicting when nothing in this call fell back to
    // the regex heuristic — a partially-degraded page must not be reported
    // as "the agent classified this" the same way the Extract-tab display
    // bug used to lie about verdicts that were never actually produced.
    isAiGenerated: degradedCount === 0,
    degradedCount,
  };
}
