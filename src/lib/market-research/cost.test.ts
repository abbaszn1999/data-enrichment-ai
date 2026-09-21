import { describe, expect, it } from "vitest";
import {
  actualExtractCostUsd,
  actualProbeCostUsd,
  cappedKeywordEstimate,
  collectionPushCostUsd,
  estimateExtractCostUsd,
  estimateProbeCostUsd,
} from "./cost";
import { applyKeywordFilters, splitKeywordSheets } from "./filters";
import { decodeIntents, sheetForIntents } from "./providers/semrush-codes";
import { marketToSemrushDb } from "./providers/keyword-provider";
import { parseKeywordExpanderItem } from "./providers/apify-keyword-expander";
import { parseSeedMetricsItem } from "./providers/parse-seed-metrics";
import type { KeywordRow } from "./providers/keyword-provider";

describe("market-research cost", () => {
  it("prices probe at $0.002/seed and extract at $5 per 1,000 keyword rows", () => {
    expect(estimateProbeCostUsd(1)).toBe(0.002);
    expect(estimateProbeCostUsd(20)).toBe(0.04);
    expect(actualProbeCostUsd(3)).toBe(0.006);
    expect(estimateExtractCostUsd(2400)).toBe(12);
    expect(actualExtractCostUsd(1)).toBe(0.005);
    expect(actualExtractCostUsd(1850)).toBe(9.25);
    expect(collectionPushCostUsd(3)).toBe(15);
  });

  it("caps extract rows at 20,000 keywords per seed", () => {
    expect(cappedKeywordEstimate(48_000)).toBe(20_000);
    expect(cappedKeywordEstimate(18_000)).toBe(18_000);
    expect(cappedKeywordEstimate(0)).toBe(0);
  });
});

describe("semrush intent decoding", () => {
  it("maps numeric Actor 4 flags and decoded Actor 3 strings", () => {
    expect(decodeIntents([1, 3])).toEqual(["informational", "commercial"]);
    expect(decodeIntents("transactional")).toEqual(["transactional"]);
    expect(sheetForIntents(["commercial"])).toBe("category");
    expect(sheetForIntents(["informational"])).toBe("informational");
    expect(sheetForIntents(["navigational"])).toBe("informational");
  });
});

describe("keyword split and filters", () => {
  const rows: KeywordRow[] = [
    {
      phrase: "buy sunglasses",
      database: "us",
      volume: 1200,
      cpc: 1.2,
      competitionLevel: 0.4,
      difficulty: 28,
      results: 1,
      intents: ["transactional"],
      serpFeatures: [],
      trends: [],
      seed: "Sunglasses",
    },
    {
      phrase: "how to choose sunglasses",
      database: "us",
      volume: 80,
      cpc: 0.2,
      competitionLevel: 0.1,
      difficulty: 12,
      results: 1,
      intents: ["informational"],
      serpFeatures: [],
      trends: [],
      seed: "Sunglasses",
    },
    {
      phrase: "cheap sunglasses",
      database: "us",
      volume: 40,
      cpc: 0.4,
      competitionLevel: 0.2,
      difficulty: 90,
      results: 1,
      intents: ["commercial"],
      serpFeatures: [],
      trends: [],
      seed: "Sunglasses",
    },
  ];

  it("filters after fetch and splits commercial vs informational", () => {
    const filtered = applyKeywordFilters(rows, {
      minVolume: 50,
      maxKd: 80,
      excludedTerms: ["cheap"],
    });
    expect(filtered.map((row) => row.phrase)).toEqual([
      "buy sunglasses",
      "how to choose sunglasses",
    ]);
    const split = splitKeywordSheets(filtered);
    expect(split.commercial).toHaveLength(1);
    expect(split.informational).toHaveLength(1);
  });
});

describe("provider parsers", () => {
  it("maps market codes onto Semrush databases", () => {
    expect(marketToSemrushDb("us-en")).toBe("us");
    expect(marketToSemrushDb("gb-en")).toBe("uk");
    expect(marketToSemrushDb("de-de")).toBe("de");
  });

  it("parses Actor 3 seed metrics including keyword_ideas_total", () => {
    const parsed = parseSeedMetricsItem(
      {
        keyword: "Sunglasses",
        volume: 33100,
        cpc_usd: 1.4,
        keyword_difficulty: 49,
        keyword_ideas_total: 2400,
        keyword_ideas_total_volume: 88000,
        related_keywords: [{ keyword: "best sunglasses", volume: 1200 }],
      },
      "Sunglasses",
      "us"
    );
    expect(parsed?.keywordIdeasTotal).toBe(2400);
    expect(parsed?.relatedKeywords[0]?.keyword).toBe("best sunglasses");
  });

  it("parses amassuo/semrush-keyword-expander keyword rows", () => {
    const parsed = parseKeywordExpanderItem(
      {
        keyword: "polarized sunglasses",
        volume: 18100,
        difficulty: 44,
        cpc: 2.1,
        competition: 0.4,
        results: 92000,
        seed: "Sunglasses",
        sources: "broad",
        database: "us",
      },
      "Sunglasses",
      "us"
    );
    expect(parsed?.phrase).toBe("polarized sunglasses");
    expect(parsed?.volume).toBe(18100);
    expect(parsed?.difficulty).toBe(44);
    expect(parsed?.intents).toEqual([]);
    expect(parsed?.serpFeatures).toEqual([]);
  });
});
