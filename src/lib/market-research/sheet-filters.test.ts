import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  filterKeywords,
  filtersEqual,
  normalizeKeywordFilters,
  type ExtractedKeyword,
} from "@/components/market-research/workspace-data";
import type { ArchiveKeywordRow } from "@/lib/market-research/storage-admin";
import type { ClassifiedShardItem } from "@/lib/market-research/storage-admin";
import {
  archiveRowsByPhrase,
  filterClassifiedTerms,
} from "./sheet-filters";

function kw(
  partial: Partial<ExtractedKeyword> & Pick<ExtractedKeyword, "keyword" | "sheet">
): ExtractedKeyword {
  return {
    id: partial.id ?? partial.keyword,
    seedId: "s1",
    seed: "sunglasses",
    volume: 100,
    difficulty: 20,
    wordCount: 2,
    isQuestion: false,
    productMatches: 0,
    ...partial,
  };
}

function archive(
  phrase: string,
  volume: number,
  difficulty = 20,
  intents: ArchiveKeywordRow["intents"] = []
): ArchiveKeywordRow {
  return {
    phrase,
    database: "us",
    volume,
    cpc: 0,
    competitionLevel: 0,
    difficulty,
    results: 0,
    intents,
    serpFeatures: [],
    trends: [],
    seed: "sunglasses",
    seedId: "s1",
  };
}

function term(
  keyword: string,
  sheet: ClassifiedShardItem["sheet"] = "category"
): ClassifiedShardItem {
  return {
    id: keyword,
    keyword,
    seedId: "s1",
    sheet,
    reason: "test",
  };
}

describe("keyword sheet filters", () => {
  it("keeps every term when filters are at defaults", () => {
    const rows = [
      kw({ keyword: "buy sunglasses", sheet: "category", volume: 5 }),
      kw({ keyword: "cheap sunglasses", sheet: "category", volume: 80 }),
    ];
    expect(filterKeywords(rows, DEFAULT_FILTERS, "category")).toHaveLength(2);
  });

  it("drops terms below min volume and above max KD", () => {
    const rows = [
      kw({ keyword: "low vol", sheet: "category", volume: 8, difficulty: 10 }),
      kw({ keyword: "ok", sheet: "category", volume: 40, difficulty: 30 }),
      kw({ keyword: "hard", sheet: "category", volume: 90, difficulty: 80 }),
    ];
    const filtered = filterKeywords(
      rows,
      { ...DEFAULT_FILTERS, minVolume: 10, maxKd: 50 },
      "category"
    );
    expect(filtered.map((row) => row.keyword)).toEqual(["ok"]);
  });

  it("does not treat unapplied draft values as equal to applied", () => {
    expect(
      filtersEqual(DEFAULT_FILTERS, { ...DEFAULT_FILTERS, minVolume: 10 })
    ).toBe(false);
    expect(normalizeKeywordFilters({ minVolume: 10 }).minVolume).toBe(10);
  });
});

describe("filterClassifiedTerms", () => {
  it("applies volume filters against the extract archive, not the classified shard", () => {
    const terms = [term("buy sunglasses"), term("cheap sunglasses")];
    const byPhrase = archiveRowsByPhrase([
      archive("buy sunglasses", 4),
      archive("cheap sunglasses", 120),
    ]);
    const kept = filterClassifiedTerms(terms, byPhrase, {
      ...DEFAULT_FILTERS,
      minVolume: 10,
    });
    expect(kept.map((row) => row.keyword)).toEqual(["cheap sunglasses"]);
  });

  it("keeps question terms when questionsOnly is on", () => {
    const terms = [
      term("how to clean sunglasses", "informational"),
      term("sunglasses guide", "informational"),
    ];
    const byPhrase = archiveRowsByPhrase([
      archive("how to clean sunglasses", 40),
      archive("sunglasses guide", 90),
    ]);
    const kept = filterClassifiedTerms(terms, byPhrase, {
      ...DEFAULT_FILTERS,
      questionsOnly: true,
    });
    expect(kept.map((row) => row.keyword)).toEqual(["how to clean sunglasses"]);
  });
});
