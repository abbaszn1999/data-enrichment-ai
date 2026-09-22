export const MAX_TERMS_PER_GEMINI_BATCH = 10;
/** Stay under a comfortable Gemini request size when product cards are large. */
export const MAX_GEMINI_PAYLOAD_CHARS = 80_000;

export type GeminiCandidateCard = {
  id: string;
  title: string;
  price: string;
  shortDescription: string;
  /** Store-assigned product type (e.g. "Sunglasses") — a strong, cheap signal Gemini can use before reading tags/attributes. */
  productType: string;
  /** Store-assigned brand/vendor (e.g. "Gucci") — needed to reject a product that matches on words alone but is the wrong brand. */
  vendor: string;
  tags: string[];
  attributes: Array<{ name: string; value: string }>;
  similarityScore: number;
};

export type CollectionExclusionItem = {
  keywordId?: string;
  matchedProductIds?: string[];
  rationale?: string;
};

/**
 * Keep only verdicts for keyword ids in this request, and only product ids
 * that were actually sent for that keyword. A keyword the model omitted is
 * listed in `missingKeywordIds` so the caller can ask again. Extra keyword
 * ids are discarded and cannot attach products to a different collection.
 */
export function acceptCollectionExclusions(
  batch: Array<{ keywordId: string; candidateProducts: Array<{ id: string }> }>,
  collections: CollectionExclusionItem[] | undefined
): {
  accepted: Map<string, { matchedProductIds: string[]; rationale?: string }>;
  missingKeywordIds: string[];
} {
  const allowedProducts = new Map<string, Set<string>>();
  for (const term of batch) {
    const ids = allowedProducts.get(term.keywordId) ?? new Set<string>();
    for (const card of term.candidateProducts) ids.add(card.id);
    allowedProducts.set(term.keywordId, ids);
  }

  const accepted = new Map<string, { matchedProductIds: string[]; rationale?: string }>();
  for (const item of collections ?? []) {
    if (!item.keywordId || !allowedProducts.has(item.keywordId)) continue;
    if (!Array.isArray(item.matchedProductIds)) continue;
    const allowed = allowedProducts.get(item.keywordId)!;
    const ids = [...new Set(item.matchedProductIds.filter((id) => allowed.has(id)))];
    const existing = accepted.get(item.keywordId);
    accepted.set(item.keywordId, {
      matchedProductIds: [
        ...new Set([...(existing?.matchedProductIds ?? []), ...ids]),
      ],
      rationale: [existing?.rationale, item.rationale].filter(Boolean).join(" ") || undefined,
    });
  }

  const missingKeywordIds = [...allowedProducts.keys()].filter((id) => !accepted.has(id));
  return { accepted, missingKeywordIds };
}

export type GeminiTermPayload = {
  keywordId: string;
  keyword: string;
  collectionTitle: string;
  parentNiche: string;
  candidateProducts: GeminiCandidateCard[];
};

function payloadChars(terms: GeminiTermPayload[]): number {
  return JSON.stringify(terms).length;
}

/** Split one term's product cards so each piece fits in a single Gemini call. */
export function chunkTermPayload(
  term: GeminiTermPayload,
  maxChars = MAX_GEMINI_PAYLOAD_CHARS
): GeminiTermPayload[] {
  if (term.candidateProducts.length === 0) return [term];
  if (payloadChars([term]) <= maxChars) return [term];

  const chunks: GeminiTermPayload[] = [];
  let bucket: GeminiCandidateCard[] = [];
  for (const product of term.candidateProducts) {
    const trial = [...bucket, product];
    const next = { ...term, candidateProducts: trial };
    if (bucket.length > 0 && payloadChars([next]) > maxChars) {
      chunks.push({ ...term, candidateProducts: bucket });
      bucket = [product];
    } else {
      bucket = trial;
    }
  }
  if (bucket.length > 0) {
    chunks.push({ ...term, candidateProducts: bucket });
  }
  return chunks;
}

/**
 * Packs term payloads into Gemini batches: prefer up to `maxTerms` per call,
 * shrink when JSON would exceed `maxChars`, and split a single oversized
 * term's product list across calls rather than dropping candidates.
 */
export function packGeminiTermBatches(
  terms: GeminiTermPayload[],
  opts?: { maxTerms?: number; maxChars?: number }
): GeminiTermPayload[][] {
  const maxTerms = opts?.maxTerms ?? MAX_TERMS_PER_GEMINI_BATCH;
  const maxChars = opts?.maxChars ?? MAX_GEMINI_PAYLOAD_CHARS;
  const batches: GeminiTermPayload[][] = [];
  let current: GeminiTermPayload[] = [];

  const flush = () => {
    if (current.length === 0) return;
    batches.push(current);
    current = [];
  };

  for (const term of terms) {
    for (const piece of chunkTermPayload(term, maxChars)) {
      const next = [...current, piece];
      if (
        current.length > 0 &&
        (next.length > maxTerms || payloadChars(next) > maxChars)
      ) {
        flush();
      }
      current.push(piece);
      if (current.length >= maxTerms || payloadChars(current) > maxChars) {
        flush();
      }
    }
  }
  flush();
  return batches;
}
