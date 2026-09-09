import { describe, expect, it } from "vitest";
import {
  selectStrategyKeywords,
  type ExtractedKeyword,
} from "./workspace-data";

function keyword(
  seedId: string,
  keyword: string,
  volume: number,
  difficulty = 20
): ExtractedKeyword {
  return {
    id: `${seedId}-${keyword}`,
    seedId,
    seed: seedId,
    keyword,
    volume,
    difficulty,
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

  it("ranks purely by opportunity score, with no guaranteed spread across seeds", () => {
    // Seed "loud" wins every slot because it has the best volume-vs-difficulty
    // score, even though that means "quiet" and "other" get nothing.
    const rows = [
      keyword("loud", "loud one", 5000, 20),
      keyword("loud", "loud two", 4000, 20),
      keyword("loud", "loud three", 3000, 20),
      keyword("loud", "loud four", 2000, 20),
      keyword("quiet", "quiet one", 40, 20),
      keyword("other", "other one", 30, 20),
    ];

    const picked = selectStrategyKeywords(rows, 4);
    const seeds = picked.map((row) => row.seedId);

    expect(picked).toHaveLength(4);
    expect(seeds.filter((seed) => seed === "loud")).toHaveLength(4);
    expect(seeds).not.toContain("quiet");
    expect(seeds).not.toContain("other");
  });

  it("prefers lower-difficulty keywords over a higher-volume, much harder one", () => {
    const rows = [
      // Highest volume, but opportunity = 10000 / 500 = 20 — the worst score.
      keyword("s1", "hard high volume", 10000, 500),
      // opportunity = 5000 / 12 = 416.7
      keyword("s2", "easy top", 5000, 10),
      // opportunity = 4000 / 12 = 333.3
      keyword("s3", "easy second", 4000, 10),
    ];

    const picked = selectStrategyKeywords(rows, 2).map((r) => r.keyword);
    expect(picked).toEqual(["easy top", "easy second"]);
    expect(picked).not.toContain("hard high volume");
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
