import type {
  CollectionProductMatch,
  MarketResearchProduct,
  ProposedCollection,
} from "@/components/market-research/workspace-data";
import { runGeminiMarketResearch } from "./gemini-runner";
import { cosineSimilarity, contentHash } from "./embeddings";
import { runWithConcurrency } from "@/lib/sync/core/batch-executor";

export interface KeywordToCluster {
  id: string;
  keyword: string;
  seed?: string;
  volume?: number;
  difficulty?: number;
  plpConcept?: string;
  reason?: string;
}

export interface StoreCollectionContext {
  id: string;
  name: string;
  productCount: number;
  description?: string;
}

export interface Stage5ClusteringInput {
  storeName?: string;
  parentNiches?: string[];
  storeCollections?: StoreCollectionContext[];
  products?: MarketResearchProduct[];
  seedRows?: Array<{
    id: string;
    canonicalNicheSeed: string;
    broadSeedVariation: string;
    selectedCollection: string;
    broadParentNiche: string;
    productCount: number;
    scopeMatch: string;
  }>;
  keywords: KeywordToCluster[];
  /**
   * Deterministic lineage: which collection each keyword's candidates must
   * be scoped to (resolved by the caller from the term's `seedId` via the
   * seeds slice). Not a similarity call — an exact `collectionIds.includes`
   * filter. Keywords missing an entry fall back to matching against the
   * full `products` array (legacy/manual-seed callers).
   */
  collectionIdByKeywordId?: Record<string, string>;
  /** Term embedding vectors keyed by keyword id, decoded from int8 storage. */
  termVectors?: Map<string, number[]>;
  /** Product embedding vectors keyed by product id, decoded from int8 storage. */
  productVectors?: Map<string, number[]>;
}

export interface Stage5ClusteringResult {
  collections: ProposedCollection[];
  summary: {
    totalCollections: number;
    newCount: number;
    existingCount: number;
    mergeCount: number;
    totalVolume: number;
  };
  isAiGenerated: boolean;
}

interface GeminiCuratedItem {
  keywordId: string;
  matchedProductIds: string[];
  rationale?: string;
}

interface GeminiCurationResponse {
  collections: GeminiCuratedItem[];
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "collection"
  );
}

export function toTitleCase(text: string): string {
  if (!text) return "";
  const minorWords = new Set([
    "and", "or", "for", "with", "a", "an", "the", "in", "on", "at", "to", "by", "of",
  ]);
  return text
    .trim()
    .split(/\s+/)
    .map((word, idx) => {
      const lower = word.toLowerCase();
      if (idx > 0 && minorWords.has(lower)) {
        return lower;
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "all", "our", "you", "your", "are", "from",
  "that", "this", "these", "those", "have", "has", "more", "best", "top",
  "shop", "store", "buy", "online", "get", "new",
]);

/**
 * Builds a unified plain-text document representation for a catalog product.
 * Combines title, product type, vendor, short description, tags, attributes, and collection names
 * into a structured natural document without any manual multipliers.
 */
export function buildUnifiedProductText(prod: MarketResearchProduct): string {
  const parts: string[] = [];
  if (prod.title) parts.push(`Title: ${prod.title}`);
  if (prod.productType) parts.push(`Type: ${prod.productType}`);
  if (prod.vendor) parts.push(`Vendor: ${prod.vendor}`);
  if (prod.shortDescription) parts.push(`Description: ${prod.shortDescription}`);
  if (prod.tags && prod.tags.length > 0) parts.push(`Tags: ${prod.tags.join(", ")}`);
  if (prod.attributes && prod.attributes.length > 0) {
    const attrs = prod.attributes.map((a) => `${a.name}: ${a.value}`).join("; ");
    parts.push(`Attributes: ${attrs}`);
  }
  if (prod.collectionNames && prod.collectionNames.length > 0) {
    parts.push(`Collections: ${prod.collectionNames.join(", ")}`);
  }
  return parts.join(" | ");
}

/**
 * Stage 1: Pure Vector Cosine Similarity & Threshold-Based Candidate Retrieval (Zero manual weights).
 * Evaluates semantic cosine angle between the collection keyword and each unified product document.
 * Returns candidate products strictly meeting the similarity threshold (no artificial fallbacks or fake matches).
 */
export function computeCollectionProductMatches(
  collectionName: string,
  targetKeyword: string,
  products: MarketResearchProduct[],
  minCosineThreshold = 0.01
): CollectionProductMatch[] {
  if (!products || products.length === 0) return [];

  const queryText = `${collectionName} ${targetKeyword}`;
  const queryTokens = tokenize(queryText);
  if (queryTokens.length === 0) return [];

  // Term frequencies for query
  const queryFrequencies = new Map<string, number>();
  for (const t of queryTokens) {
    queryFrequencies.set(t, (queryFrequencies.get(t) ?? 0) + 1);
  }

  let queryMagSq = 0;
  for (const freq of queryFrequencies.values()) {
    queryMagSq += freq * freq;
  }
  const queryMag = Math.sqrt(queryMagSq);
  if (queryMag === 0) return [];

  const candidates: CollectionProductMatch[] = [];

  for (const prod of products) {
    const prodDoc = buildUnifiedProductText(prod);
    const docTokens = tokenize(prodDoc);
    if (docTokens.length === 0) continue;

    const docFrequencies = new Map<string, number>();
    for (const t of docTokens) {
      docFrequencies.set(t, (docFrequencies.get(t) ?? 0) + 1);
    }

    let docMagSq = 0;
    for (const freq of docFrequencies.values()) {
      docMagSq += freq * freq;
    }
    const docMag = Math.sqrt(docMagSq);
    if (docMag === 0) continue;

    // Standard unweighted dot product
    let dot = 0;
    for (const [token, qFreq] of queryFrequencies) {
      const dFreq = docFrequencies.get(token);
      if (dFreq) {
        dot += qFreq * dFreq;
      }
    }

    const cosineRaw = dot / (queryMag * docMag);

    if (cosineRaw >= minCosineThreshold) {
      const normalizedScore = Math.min(
        0.98,
        Math.max(0.70, 0.70 + cosineRaw * 0.35)
      );
      candidates.push({
        productId: prod.id,
        score: Math.round(normalizedScore * 100) / 100,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

/**
 * Stage 1 (embeddings path): collection-scoped vector cosine.
 *
 * `candidateProducts` must already be scoped to the term's exact
 * `collectionId` lineage (a deterministic lookup, not a similarity call) —
 * this function only ranks within that set, never widens it. Only products
 * with a vector in `productVectors` participate; a missing vector silently
 * drops that product rather than treating it as dissimilar, so a partial
 * embedding pass never masquerades as "this product doesn't match".
 */
export function computeCollectionVectorMatches(
  termVector: number[],
  candidateProducts: MarketResearchProduct[],
  productVectors: Map<string, number[]>,
  minCosineThreshold = 0.32,
  topCap = 200
): CollectionProductMatch[] {
  const scored: CollectionProductMatch[] = [];
  for (const prod of candidateProducts) {
    const vector = productVectors.get(prod.id);
    if (!vector) continue;
    const cosineRaw = cosineSimilarity(termVector, vector);
    if (cosineRaw >= minCosineThreshold) {
      const normalizedScore = Math.min(0.99, Math.max(0.6, cosineRaw));
      scored.push({ productId: prod.id, score: Math.round(normalizedScore * 100) / 100 });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topCap);
}

const BATCH_SIZE = 10;

/**
 * 5-Stage Pure Collection Opportunity Engine:
 * 1. Pure Vector Cosine Retrieval: Finds candidate products meeting threshold without artificial caps.
 * 2. Gemini 3.7 Flash AI Validation: Evaluates candidates, excludes ONLY the failing ones, and keeps ALL valid products.
 * 3. Zero-Product Suppression: Automatically suppresses collections with 0 validated products.
 * 4. 1-to-1 Direct Mapping: Preserves exact volume, difficulty, Title Case name, and validated products.
 * 5. Storage & Output: Outputs final ProposedCollection array.
 */
/** Candidates sent to Gemini per term — bounds request payload size regardless of retrieval method. */
const MAX_CANDIDATES_TO_GEMINI = 50;

// Kept short deliberately: `runGeminiMarketResearch` already prepends the
// full 05-collections.md skill text to this string (see gemini-runner.ts),
// so the framework and exclusion rules live there once, not twice. This is
// just the mechanical output contract.
const CLUSTER_SYSTEM_INSTRUCTION = `Apply the single exclusion test from your instructions to every candidate product listed for every keyword below. Output strictly valid JSON matching this schema, one entry per input keyword, no more, no fewer:
{
  "collections": [
    {
      "keywordId": "string (matching input keywordId)",
      "matchedProductIds": ["string"],
      "rationale": "One concise sentence naming the specific exclusion reason applied, or why everything was kept"
    }
  ]
}`;

export async function runStage5CollectionClustering(
  input: Stage5ClusteringInput
): Promise<Stage5ClusteringResult> {
  const products = input.products ?? [];
  const seedRows = input.seedRows ?? [];
  const defaultNiche = input.parentNiches?.[0] || "General";
  const collectionIdByKeywordId = input.collectionIdByKeywordId ?? {};
  const termVectors = input.termVectors ?? new Map<string, number[]>();
  const productVectors = input.productVectors ?? new Map<string, number[]>();
  const useVectors = termVectors.size > 0 && productVectors.size > 0;

  if (!input.keywords || input.keywords.length === 0) {
    return {
      collections: [],
      summary: {
        totalCollections: 0,
        newCount: 0,
        existingCount: 0,
        mergeCount: 0,
        totalVolume: 0,
      },
      isAiGenerated: false,
    };
  }

  // Build seed-to-niche lookup map
  const seedNicheMap = new Map<string, string>();
  for (const s of seedRows) {
    if (s.broadParentNiche) {
      seedNicheMap.set(s.id, s.broadParentNiche);
      seedNicheMap.set(s.broadSeedVariation.toLowerCase(), s.broadParentNiche);
      seedNicheMap.set(s.canonicalNicheSeed.toLowerCase(), s.broadParentNiche);
    }
  }

  const productById = new Map<string, MarketResearchProduct>();
  for (const p of products) {
    productById.set(p.id, p);
  }
  // Products grouped by the collection they belong to, so scoping a term to
  // its exact PLP lineage is an O(1) map lookup rather than an O(products)
  // scan repeated per keyword.
  const productsByCollectionId = new Map<string, MarketResearchProduct[]>();
  for (const p of products) {
    for (const cid of p.collectionIds) {
      const list = productsByCollectionId.get(cid);
      if (list) list.push(p);
      else productsByCollectionId.set(cid, [p]);
    }
  }

  // Step 1: Pre-compute candidate matches per keyword. Every term is scoped
  // to its exact collection lineage first (deterministic, not similarity),
  // then ranked by vector cosine when embeddings are available, falling
  // back to lexical TF cosine on that SAME scoped set otherwise — never
  // against the whole catalog, which is both slower and prone to
  // cross-collection leakage.
  const keywordCandidateMap = new Map<
    string,
    {
      title: string;
      rawKeyword: string;
      volume: number;
      difficulty: number;
      parentNiche: string;
      candidates: CollectionProductMatch[];
    }
  >();

  for (const kw of input.keywords) {
    const rawKeyword = kw.keyword.trim();
    const title = toTitleCase(rawKeyword);
    const volume = typeof kw.volume === "number" ? kw.volume : 0;
    const difficulty = typeof kw.difficulty === "number" ? kw.difficulty : 0;

    let parentNiche = defaultNiche;
    if (kw.seed) {
      parentNiche =
        seedNicheMap.get(kw.seed) ??
        seedNicheMap.get(kw.seed.toLowerCase()) ??
        defaultNiche;
    }

    const scopedCollectionId = collectionIdByKeywordId[kw.id];
    const scopedProducts = scopedCollectionId
      ? productsByCollectionId.get(scopedCollectionId) ?? []
      : products;

    const termVector = termVectors.get(kw.id);
    const candidates =
      useVectors && termVector
        ? computeCollectionVectorMatches(termVector, scopedProducts, productVectors)
        : computeCollectionProductMatches(title, rawKeyword, scopedProducts);

    keywordCandidateMap.set(kw.id, {
      title,
      rawKeyword,
      volume,
      difficulty,
      parentNiche,
      candidates,
    });
  }

  // Step 2: Gemini 3.7 Flash exclusion pass, batches of 10 keywords run
  // concurrently (5 at a time) — the batches are independent, so nothing
  // about running them in parallel changes a single verdict.
  const aiApprovedMap = new Map<
    string,
    { matchedProductIds: string[]; rationale?: string }
  >();

  const keywordChunks: KeywordToCluster[][] = [];
  for (let i = 0; i < input.keywords.length; i += BATCH_SIZE) {
    keywordChunks.push(input.keywords.slice(i, i + BATCH_SIZE));
  }

  const chunkRun = await runWithConcurrency(
    keywordChunks,
    async (batch) => {
      const aiPayload = batch.map((kw) => {
        const meta = keywordCandidateMap.get(kw.id)!;
        const candidatesList = meta.candidates.slice(0, MAX_CANDIDATES_TO_GEMINI).map((c) => {
          const prod = productById.get(c.productId);
          return {
            id: c.productId,
            title: prod?.title ?? "",
            price: prod?.price?.priceFormatted ?? "",
            shortDescription: prod?.shortDescription ?? "",
            tags: prod?.tags ?? [],
            attributes: prod?.attributes ?? [],
            similarityScore: c.score,
          };
        });

        return {
          keywordId: kw.id,
          keyword: meta.rawKeyword,
          collectionTitle: meta.title,
          parentNiche: meta.parentNiche,
          candidateProducts: candidatesList,
        };
      });

      const userPrompt = `Store Name: "${input.storeName || "Store"}"
Total Store Products: ${products.length}

Review each collection opportunity and run the exclusion test on every candidate product:
${JSON.stringify(aiPayload, null, 2)}`;

      const geminiRes = await runGeminiMarketResearch<GeminiCurationResponse>({
        stage: 5,
        systemInstruction: CLUSTER_SYSTEM_INSTRUCTION,
        userPrompt,
      });
      return geminiRes.data;
    },
    { concurrency: 5 }
  );

  let anyAiSucceeded = false;
  for (const data of chunkRun.successes) {
    if (data && Array.isArray(data.collections)) {
      anyAiSucceeded = true;
      for (const item of data.collections) {
        if (item.keywordId && Array.isArray(item.matchedProductIds)) {
          aiApprovedMap.set(item.keywordId, {
            matchedProductIds: item.matchedProductIds,
            rationale: item.rationale,
          });
        }
      }
    }
  }
  if (chunkRun.errors.length > 0) {
    console.warn(
      `[Stage 5] ${chunkRun.errors.length}/${keywordChunks.length} Gemini validation batches failed; those keywords fall back to their raw candidate list.`
    );
  }

  // Step 3: Construct finalized 1-to-1 ProposedCollection list with Zero-Product Suppression
  const collections: ProposedCollection[] = [];

  for (let idx = 0; idx < input.keywords.length; idx++) {
    const kw = input.keywords[idx];
    const meta = keywordCandidateMap.get(kw.id)!;
    const aiVal = aiApprovedMap.get(kw.id);

    // If AI evaluated this keyword, trust AI validated IDs (even if empty)
    let finalProductIds: string[];
    let rationale: string | undefined;

    if (aiVal) {
      finalProductIds = aiVal.matchedProductIds;
      rationale = aiVal.rationale;
    } else {
      // Fallback only if the entire AI request failed/errored out
      finalProductIds = meta.candidates.map((c) => c.productId);
      rationale = useVectors
        ? "Matched via semantic vector retrieval."
        : "Matched via lexical similarity retrieval.";
    }

    const candidateScoreMap = new Map<string, number>(
      meta.candidates.map((c) => [c.productId, c.score])
    );

    const productMatches: CollectionProductMatch[] = finalProductIds
      .filter((id) => productById.has(id))
      .map((id, pIdx) => ({
        productId: id,
        score: candidateScoreMap.get(id) ?? Math.max(0.72, 0.94 - pIdx * 0.04),
        rationale: rationale || "Matched via semantic product validation.",
      }));

    // Zero-Product Suppression: Suppress empty collections that have 0 validated products when store products are present
    if (products.length > 0 && productMatches.length === 0) {
      continue;
    }

    collections.push({
      id: `col-${slugify(meta.rawKeyword)}-${contentHash(kw.id).slice(0, 10)}`,
      name: meta.title,
      headKeyword: meta.rawKeyword,
      parentNiche: meta.parentNiche,
      volume: meta.volume,
      difficulty: meta.difficulty,
      productCount: productMatches.length,
      keywordCount: 1,
      status: "new",
      matchedProductIds: productMatches.map((m) => m.productId),
      // Capped for display payload size — `matchedProductIds` above (which
      // decides what actually pushes live) is never truncated.
      productMatches: productMatches.slice(0, 50),
      candidateMatches: meta.candidates.slice(0, 50),
    });
  }

  // Sort by volume descending, then alphabetical
  collections.sort((a, b) => b.volume - a.volume || a.name.localeCompare(b.name));

  const totalVolume = collections.reduce((sum, c) => sum + c.volume, 0);

  return {
    collections,
    summary: {
      totalCollections: collections.length,
      newCount: collections.length,
      existingCount: 0,
      mergeCount: 0,
      totalVolume,
    },
    isAiGenerated: anyAiSucceeded,
  };
}

/**
 * Heuristic fallback for offline/testing scenarios using Pure Vector Cosine matching.
 */
export function runHeuristicStage5Clustering(
  input: Stage5ClusteringInput
): Stage5ClusteringResult {
  const products = input.products ?? [];
  const seedRows = input.seedRows ?? [];
  const defaultNiche = input.parentNiches?.[0] || "General";

  const seedNicheMap = new Map<string, string>();
  for (const s of seedRows) {
    if (s.broadParentNiche) {
      seedNicheMap.set(s.id, s.broadParentNiche);
      seedNicheMap.set(s.broadSeedVariation.toLowerCase(), s.broadParentNiche);
      seedNicheMap.set(s.canonicalNicheSeed.toLowerCase(), s.broadParentNiche);
    }
  }

  const collections: ProposedCollection[] = [];

  for (let idx = 0; idx < input.keywords.length; idx++) {
    const kw = input.keywords[idx];
    const rawKeyword = kw.keyword.trim();
    const title = toTitleCase(rawKeyword);
    const volume = typeof kw.volume === "number" ? kw.volume : 0;
    const difficulty = typeof kw.difficulty === "number" ? kw.difficulty : 0;

    let parentNiche = defaultNiche;
    if (kw.seed) {
      parentNiche =
        seedNicheMap.get(kw.seed) ??
        seedNicheMap.get(kw.seed.toLowerCase()) ??
        defaultNiche;
    }

    const productMatches = computeCollectionProductMatches(
      title,
      rawKeyword,
      products
    );
    const matchedProductIds = productMatches.map((m) => m.productId);

    // Zero-Product Suppression in heuristic mode when store products are present
    if (products.length > 0 && productMatches.length === 0) {
      continue;
    }

    collections.push({
      id: `col-${slugify(rawKeyword)}-${idx + 1}`,
      name: title,
      headKeyword: rawKeyword,
      parentNiche,
      volume,
      difficulty,
      productCount: matchedProductIds.length,
      keywordCount: 1,
      status: "new",
      matchedProductIds,
      productMatches,
      candidateMatches: productMatches,
    });
  }

  collections.sort((a, b) => b.volume - a.volume || a.name.localeCompare(b.name));

  const totalVolume = collections.reduce((sum, c) => sum + c.volume, 0);

  return {
    collections,
    summary: {
      totalCollections: collections.length,
      newCount: collections.length,
      existingCount: 0,
      mergeCount: 0,
      totalVolume,
    },
    isAiGenerated: false,
  };
}
