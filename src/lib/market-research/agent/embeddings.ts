import { createHash } from "node:crypto";

/**
 * Dense text embeddings used as the first-pass retrieval filter.
 *
 * Lexical overlap cannot tell that "Laptop Sleeve" and "Notebook Case" are the
 * same shopper intent, so semantic recall has to come from vectors. Vectors are
 * only ever used to *shortlist* candidates — relationship typing and final
 * selection happen downstream.
 */

export const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 512;
const MAX_BATCH_SIZE = 256;
const MAX_CHARS_PER_INPUT = 2000;
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Keyed by content hash, so re-running a project only pays for collections
 * whose text actually changed. Lives for the process lifetime.
 */
const vectorCache = new Map<string, number[]>();

function cacheKey(text: string): string {
  return createHash("sha256")
    .update(`${EMBEDDING_MODEL}:${EMBEDDING_DIMENSIONS}:${text}`)
    .digest("hex");
}

export function embeddingsAvailable(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

async function requestEmbeddings(inputs: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIMENSIONS,
        input: inputs,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Embeddings request failed (${response.status}): ${detail.slice(0, 200)}`
      );
    }

    const payload = (await response.json()) as {
      data?: Array<{ index: number; embedding: number[] }>;
    };

    const items = payload.data ?? [];
    const ordered: number[][] = new Array(inputs.length);
    for (const item of items) {
      if (typeof item.index === "number" && Array.isArray(item.embedding)) {
        ordered[item.index] = item.embedding;
      }
    }
    return ordered;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Embeds every text, returning vectors positionally aligned with the input.
 * A null slot means that text has no vector and callers must fall back to
 * lexical scoring for it rather than treating it as dissimilar.
 */
export async function embedTexts(
  texts: string[]
): Promise<Array<number[] | null>> {
  const result: Array<number[] | null> = new Array(texts.length).fill(null);
  if (texts.length === 0 || !embeddingsAvailable()) return result;

  const pending: Array<{ index: number; key: string; text: string }> = [];
  const seenKeys = new Map<string, number[]>();

  texts.forEach((raw, index) => {
    const text = (raw || "").slice(0, MAX_CHARS_PER_INPUT).trim();
    if (!text) return;
    const key = cacheKey(text);
    const cached = vectorCache.get(key);
    if (cached) {
      result[index] = cached;
      return;
    }
    pending.push({ index, key, text });
  });

  // Collapse duplicate texts within this call so we never pay twice.
  const uniquePending: Array<{ key: string; text: string }> = [];
  const keyToUniqueIndex = new Map<string, number>();
  for (const item of pending) {
    if (!keyToUniqueIndex.has(item.key)) {
      keyToUniqueIndex.set(item.key, uniquePending.length);
      uniquePending.push({ key: item.key, text: item.text });
    }
  }

  for (let offset = 0; offset < uniquePending.length; offset += MAX_BATCH_SIZE) {
    const batch = uniquePending.slice(offset, offset + MAX_BATCH_SIZE);
    try {
      const vectors = await requestEmbeddings(batch.map((b) => b.text));
      batch.forEach((item, i) => {
        const vector = vectors[i];
        if (Array.isArray(vector) && vector.length > 0) {
          vectorCache.set(item.key, vector);
          seenKeys.set(item.key, vector);
        }
      });
    } catch (error) {
      console.error("[embeddings] Batch failed, falling back to lexical:", error);
      // Leave these slots null; downstream degrades to lexical scoring.
    }
  }

  for (const item of pending) {
    const vector = vectorCache.get(item.key) ?? seenKeys.get(item.key);
    if (vector) result[item.index] = vector;
  }

  return result;
}

/** Cosine similarity for two equal-length dense vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length !== a.length) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;

  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
