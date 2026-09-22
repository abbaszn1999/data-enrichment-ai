import { describe, expect, it } from "vitest";
import {
  clusterByLeaders,
  collapseExactCopies,
  dropsFromGroups,
  exactIntentKey,
  judgePackedClusters,
  packClusters,
  type IntentTerm,
} from "./same-intent";

function term(id: string, volume: number): IntentTerm {
  return { id, keyword: id, volume };
}

describe("exact intent collapse", () => {
  it("keeps the highest volume among identical wording", () => {
    const result = collapseExactCopies([
      term("pools for boys", 100),
      { id: "spaced", keyword: "pools   for boys", volume: 400 },
      { id: "cased", keyword: "Pools For Boys", volume: 50 },
    ]);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0]?.keyword).toBe("pools   for boys");
    expect(result.drops.map((drop) => drop.droppedKeyword).sort()).toEqual([
      "Pools For Boys",
      "pools for boys",
    ]);
    expect(result.drops.every((drop) => drop.keptKeyword === "pools   for boys")).toBe(
      true
    );
  });

  it("does not collapse an Arabic pair that is not the same wording", () => {
    const result = collapseExactCopies([
      { id: "a", keyword: "مسبح للأولاد", volume: 80 },
      { id: "b", keyword: "مسابح أولاد", volume: 200 },
    ]);
    expect(result.drops).toEqual([]);
    expect(result.kept.map((row) => row.keyword)).toEqual([
      "مسابح أولاد",
      "مسبح للأولاد",
    ]);
    expect(exactIntentKey("مسبح للأولاد")).not.toBe(exactIntentKey("مسابح أولاد"));
  });
});

describe("leader clusters and packing", () => {
  it("groups only vectors at or above the threshold", () => {
    const clusters = clusterByLeaders([
      { ...term("boys pools", 500), vector: [1, 0] },
      { ...term("pools for boys", 100), vector: [0.99, 0.01] },
      { ...term("girls pools", 400), vector: [0, 1] },
    ]);
    const grouped = clusters.find((cluster) => cluster.length > 1);
    expect(grouped?.map((row) => row.id)).toEqual(["boys pools", "pools for boys"]);
    expect(clusters.some((cluster) => cluster[0]?.id === "girls pools")).toBe(true);
  });

  it("sends each candidate cluster as its own request", () => {
    const clusters = [
      [term("a1", 1), term("a2", 1), term("a3", 1)],
      [term("b1", 1), term("b2", 1)],
      [term("c1", 1)],
    ];
    const bins = packClusters(clusters, 1000);
    expect(bins).toHaveLength(2);
    expect(bins[0]?.map((cluster) => cluster.map((row) => row.id))).toEqual([
      ["a1", "a2", "a3"],
    ]);
    expect(bins[1]?.map((cluster) => cluster.map((row) => row.id))).toEqual([["b1", "b2"]]);
  });
});

describe("model groups", () => {
  it("keeps only the highest volume in a confirmed group", () => {
    const drops = dropsFromGroups(
      [term("pools for boys", 100), term("boys pools", 900), term("pools boys", 40)],
      [["pools for boys", "boys pools", "pools boys"]]
    );
    expect(drops).toEqual([
      { droppedKeyword: "pools for boys", keptKeyword: "boys pools" },
      { droppedKeyword: "pools boys", keptKeyword: "boys pools" },
    ]);
  });

  it("keeps every term when the model splits gender, brand, or price", () => {
    const members = [
      term("boys pools", 100),
      term("girls pools", 90),
      term("Nike pools", 80),
      term("cheap pools", 70),
    ];
    expect(dropsFromGroups(members, [])).toEqual([]);
    expect(
      dropsFromGroups(members, [["boys pools"], ["girls pools"], ["Nike pools"]])
    ).toEqual([]);
  });

  it("keeps a batch when the judgement fails", async () => {
    const bins = [[[term("boys pools", 10), term("pools for boys", 4)]]];
    const failed = await judgePackedClusters(bins, async () => null);
    expect(failed.drops).toEqual([]);
    const thrown = await judgePackedClusters(bins, async () => {
      throw new Error("gemini down");
    });
    expect(thrown.drops).toEqual([]);
  });
});
