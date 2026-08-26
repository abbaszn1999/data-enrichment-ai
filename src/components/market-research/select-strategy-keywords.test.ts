import { describe, expect, it } from "vitest";
import {
  selectStrategyKeywords,
  type ExtractedKeyword,
} from "./workspace-data";

function keyword(
  seedId: string,
  keyword: string,
  volume: number
): ExtractedKeyword {
  return {
    id: `${seedId}-${keyword}`,
    seedId,
    seed: seedId,
    keyword,
    volume,
    difficulty: 20,
    wordCount: keyword.split(" ").length,
    isQuestion: false,
    sheet: "informational",
    productMatches: 0,
    weight: 1,
  };
}

describe("selectStrategyKeywords", () => {
  it("keeps only informational rows", () => {
    const rows = [
      keyword("s1", "how to clean a cable", 100),
      { ...keyword("s1", "usb c cable", 900), sheet: "category" as const },
    ];
    expect(selectStrategyKeywords(rows).map((r) => r.keyword)).toEqual([
      "how to clean a cable",
    ]);
  });

  it("drops rows repeating the same text after normalization", () => {
    const rows = [
      keyword("s1", "how to store cables", 100),
      keyword("s2", "How to  store   cables", 90),
    ];
    expect(selectStrategyKeywords(rows)).toHaveLength(1);
  });

  it("returns everything untouched when the cap is not reached", () => {
    const rows = [keyword("s1", "a", 10), keyword("s1", "b", 5)];
    expect(selectStrategyKeywords(rows, 10)).toHaveLength(2);
  });

  it("gives every seed a share instead of letting the busiest one take the cap", () => {
    // Seed "loud" would win all four slots on volume alone.
    const rows = [
      keyword("loud", "loud one", 5000),
      keyword("loud", "loud two", 4000),
      keyword("loud", "loud three", 3000),
      keyword("loud", "loud four", 2000),
      keyword("quiet", "quiet one", 40),
      keyword("other", "other one", 30),
    ];

    const picked = selectStrategyKeywords(rows, 4);
    const seeds = picked.map((row) => row.seedId);

    expect(picked).toHaveLength(4);
    expect(seeds).toContain("quiet");
    expect(seeds).toContain("other");
    expect(seeds.filter((seed) => seed === "loud")).toHaveLength(2);
  });

  it("picks the highest volume keyword within each seed", () => {
    const rows = [
      keyword("s1", "s1 small", 10),
      keyword("s1", "s1 big", 900),
      keyword("s2", "s2 small", 20),
      keyword("s2", "s2 big", 800),
    ];
    expect(selectStrategyKeywords(rows, 2).map((r) => r.keyword)).toEqual([
      "s1 big",
      "s2 big",
    ]);
  });

  it("fills the cap from remaining seeds when a seed runs dry", () => {
    const rows = [
      keyword("s1", "s1 a", 100),
      keyword("s2", "s2 a", 90),
      keyword("s2", "s2 b", 80),
      keyword("s2", "s2 c", 70),
    ];
    expect(selectStrategyKeywords(rows, 3)).toHaveLength(3);
  });

  it("returns rows ordered by volume so the table reads sensibly", () => {
    const rows = [
      keyword("s1", "mid", 500),
      keyword("s2", "top", 900),
      keyword("s3", "low", 100),
    ];
    expect(selectStrategyKeywords(rows, 3).map((r) => r.volume)).toEqual([
      900, 500, 100,
    ]);
  });
});
