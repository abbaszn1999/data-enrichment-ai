import { describe, expect, it } from "vitest";
import {
  MAX_GEMINI_PAYLOAD_CHARS,
  MAX_TERMS_PER_GEMINI_BATCH,
  chunkTermPayload,
  packGeminiTermBatches,
  type GeminiCandidateCard,
  type GeminiTermPayload,
} from "./gemini-term-batches";

function card(id: string, pad = 8): GeminiCandidateCard {
  return {
    id,
    title: "T".repeat(pad),
    price: "$1.00",
    shortDescription: "D".repeat(pad),
    tags: ["tag"],
    attributes: [{ name: "Color", value: "Black" }],
    similarityScore: 0.7,
  };
}

function term(
  keywordId: string,
  productCount: number,
  pad = 8
): GeminiTermPayload {
  return {
    keywordId,
    keyword: keywordId,
    collectionTitle: keywordId,
    parentNiche: "General",
    candidateProducts: Array.from({ length: productCount }, (_, i) =>
      card(`${keywordId}-p${i}`, pad)
    ),
  };
}

function allProductIds(batches: GeminiTermPayload[][]): string[] {
  return batches.flatMap((batch) =>
    batch.flatMap((piece) => piece.candidateProducts.map((c) => c.id))
  );
}

describe("chunkTermPayload", () => {
  it("keeps a small shortlist as a single piece", () => {
    const pieces = chunkTermPayload(term("k1", 5), 5_000);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].candidateProducts).toHaveLength(5);
  });

  it("splits an oversized shortlist without dropping products", () => {
    const source = term("k-huge", 40, 800);
    const pieces = chunkTermPayload(source, 8_000);
    expect(pieces.length).toBeGreaterThan(1);
    const ids = pieces.flatMap((p) => p.candidateProducts.map((c) => c.id));
    expect(ids).toEqual(source.candidateProducts.map((c) => c.id));
    expect(new Set(ids).size).toBe(40);
  });
});

describe("packGeminiTermBatches", () => {
  it(`packs up to ${MAX_TERMS_PER_GEMINI_BATCH} small terms in one batch`, () => {
    const terms = Array.from({ length: 10 }, (_, i) => term(`k${i}`, 2));
    const batches = packGeminiTermBatches(terms);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(10);
  });

  it("starts a new batch after the 10-term cap", () => {
    const terms = Array.from({ length: 11 }, (_, i) => term(`k${i}`, 1));
    const batches = packGeminiTermBatches(terms);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(10);
    expect(batches[1]).toHaveLength(1);
    expect(allProductIds(batches).length).toBe(11);
  });

  it("shrinks a batch when JSON would exceed the payload budget", () => {
    const terms = [term("a", 8, 400), term("b", 8, 400), term("c", 8, 400)];
    const batches = packGeminiTermBatches(terms, { maxChars: 6_000 });
    expect(batches.length).toBeGreaterThan(1);
    expect(Math.max(...batches.map((b) => b.length))).toBeLessThanOrEqual(10);
    expect(allProductIds(batches).sort()).toEqual(
      terms.flatMap((t) => t.candidateProducts.map((c) => c.id)).sort()
    );
  });

  it("chunks one huge term across calls and never drops candidates", () => {
    const huge = term("solo", 80, 600);
    const batches = packGeminiTermBatches([huge], {
      maxChars: 10_000,
    });
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every((b) => b.length >= 1)).toBe(true);
    const ids = allProductIds(batches);
    expect(ids).toEqual(huge.candidateProducts.map((c) => c.id));
    expect(ids).toHaveLength(80);
  });

  it("stays under the default payload budget except for a single oversized card", () => {
    const terms = Array.from({ length: 6 }, (_, i) => term(`k${i}`, 20, 40));
    const batches = packGeminiTermBatches(terms);
    for (const batch of batches) {
      expect(JSON.stringify(batch).length).toBeLessThanOrEqual(
        MAX_GEMINI_PAYLOAD_CHARS
      );
    }
  });
});
