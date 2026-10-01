import { describe, expect, it } from "vitest";
import {
  clusterByLeaders,
  nearestQuantLeader,
  PREFIX_DIMS,
  quantFromInt8,
  quantizeVector,
  SAME_INTENT_COSINE,
  type QuantVec,
} from "./same-intent";
import { cosineSimilarity, decodeVectorInt8, encodeVectorInt8 } from "./embeddings";

const DIMS = 1536;

/** Small seeded generator so the vectors, and any failure, are repeatable. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function gaussian(next: () => number): number {
  const u = Math.max(next(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
}

function randomVector(next: () => number): number[] {
  return Array.from({ length: DIMS }, () => gaussian(next));
}

/** `base` plus noise; larger `noise` gives a lower cosine to `base`. */
function variant(base: number[], noise: number, next: () => number): number[] {
  return base.map((v) => v + noise * gaussian(next));
}

describe("compact vectors", () => {
  it("round-trips through int8 storage with under 1% cosine error", () => {
    const next = rng(1);
    const original = randomVector(next);
    const decoded = decodeVectorInt8(encodeVectorInt8(original), DIMS);
    expect(decoded).toBeInstanceOf(Int8Array);
    expect(decoded.length).toBe(DIMS);
    expect(cosineSimilarity(original, decoded)).toBeGreaterThan(0.99);
  });

  it("uses one byte per dimension instead of eight", () => {
    const decoded = decodeVectorInt8(encodeVectorInt8(randomVector(rng(2))), DIMS);
    expect(decoded.byteLength).toBe(DIMS);
  });

  it("compares a float vector with a stored int8 vector", () => {
    const next = rng(3);
    const base = randomVector(next);
    const near = variant(base, 0.3, next);
    const stored = decodeVectorInt8(encodeVectorInt8(near), DIMS);
    expect(cosineSimilarity(base, stored)).toBeCloseTo(cosineSimilarity(base, near), 2);
  });

  it("wraps a stored vector without changing it", () => {
    const stored = decodeVectorInt8(encodeVectorInt8(randomVector(rng(4))), DIMS);
    const wrapped = quantFromInt8(stored);
    expect(wrapped.values).toBe(stored);
    expect(wrapped.norm).toBeGreaterThan(0);
    expect(wrapped.prefixNorm).toBeGreaterThan(0);
  });
});

describe("nearestQuantLeader", () => {
  it("never accepts a pair below the threshold, with or without the prefilter", () => {
    const next = rng(5);
    const base = randomVector(next);
    // Noise picked so the full cosine lands near 0.7, below the 0.84 cutoff.
    const far = variant(base, 1, next);
    const a = quantizeVector(base);
    const b = quantizeVector(far);
    expect(cosineSimilarity(base, far)).toBeLessThan(SAME_INTENT_COSINE);
    expect(nearestQuantLeader(b, [a], SAME_INTENT_COSINE, true)).toBe(-1);
    expect(nearestQuantLeader(b, [a], SAME_INTENT_COSINE, false)).toBe(-1);
  });

  it("picks the nearest of several qualifying leaders", () => {
    const next = rng(6);
    const base = randomVector(next);
    const close = quantizeVector(variant(base, 0.15, next));
    const closer = quantizeVector(variant(base, 0.05, next));
    const query = quantizeVector(base);
    expect(nearestQuantLeader(query, [close, closer])).toBe(1);
  });

  it("returns -1 with no leaders", () => {
    expect(nearestQuantLeader(quantizeVector(randomVector(rng(7))), [])).toBe(-1);
  });

  it("prefilters on the leading dimensions only", () => {
    const next = rng(8);
    const v = quantizeVector(randomVector(next));
    expect(v.prefixNorm).toBeLessThan(v.norm);
    expect(PREFIX_DIMS).toBeLessThan(DIMS);
  });

  it("finds exactly the same clusters as an exhaustive search", () => {
    const next = rng(9);
    // 60 topics, each with a handful of close variants and some looser ones.
    const topics = Array.from({ length: 60 }, () => randomVector(next));
    const vectors: number[][] = [];
    for (const topic of topics) {
      vectors.push(topic);
      for (let i = 0; i < 4; i += 1) vectors.push(variant(topic, 0.12 + i * 0.05, next));
    }

    const cluster = (prefilter: boolean): number[] => {
      const leaders: QuantVec[] = [];
      const owner: number[] = [];
      return vectors.map((vector) => {
        const q = quantizeVector(vector);
        const best = nearestQuantLeader(q, leaders, SAME_INTENT_COSINE, prefilter);
        if (best === -1) {
          leaders.push(q);
          owner.push(leaders.length - 1);
          return leaders.length - 1;
        }
        return best;
      });
    };

    const exhaustive = cluster(false);
    const filtered = cluster(true);
    expect(filtered).toEqual(exhaustive);
    // Sanity: the data really forms groups, so the comparison means something.
    expect(new Set(exhaustive).size).toBeLessThan(vectors.length);
    expect(new Set(exhaustive).size).toBeGreaterThanOrEqual(60);
  });
});

describe("clusterByLeaders with compact vectors", () => {
  it("accepts int8 vectors and keeps a term with no vector as a singleton", () => {
    const next = rng(10);
    const base = randomVector(next);
    const enc = (v: number[]) => decodeVectorInt8(encodeVectorInt8(v), DIMS);
    const clusters = clusterByLeaders([
      { id: "a", keyword: "red sofa", volume: 100, vector: enc(base) },
      { id: "b", keyword: "sofa red", volume: 50, vector: enc(variant(base, 0.1, next)) },
      { id: "c", keyword: "garden hose", volume: 40, vector: enc(randomVector(next)) },
      { id: "d", keyword: "no vector", volume: 10, vector: null },
    ]);
    expect(clusters.map((c) => c.map((t) => t.id))).toEqual([["a", "b"], ["c"], ["d"]]);
  });
});
