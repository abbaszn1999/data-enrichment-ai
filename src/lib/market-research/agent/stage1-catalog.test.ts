import { describe, expect, it } from "vitest";
import { prepareStage1Catalog, STAGE1_PASSB_BATCH_SIZE } from "./stage1-catalog";

function col(id: string, productCount: number) {
  return {
    id,
    name: id,
    handle: id,
    description: "",
    productCount,
    plpPath: `/${id}`,
  };
}

describe("prepareStage1Catalog", () => {
  it("keeps every collection — no cap, no dropped tail", () => {
    const total = STAGE1_PASSB_BATCH_SIZE + 20;
    const collections = Array.from({ length: total }, (_, i) => col(`c${i}`, i));
    const result = prepareStage1Catalog(collections);
    expect(result.candidates).toHaveLength(total);
    expect(result.foldedItems).toHaveLength(0);
  });

  it("splits candidates into Pass-B-sized batches covering every item exactly once", () => {
    const total = STAGE1_PASSB_BATCH_SIZE * 2 + 20;
    const collections = Array.from({ length: total }, (_, i) => col(`c${i}`, i));
    const result = prepareStage1Catalog(collections);
    expect(result.batches).toHaveLength(3);
    expect(result.batches[0]).toHaveLength(STAGE1_PASSB_BATCH_SIZE);
    expect(result.batches[1]).toHaveLength(STAGE1_PASSB_BATCH_SIZE);
    expect(result.batches[2]).toHaveLength(20);

    const batchedIds = result.batches.flat().map((c) => c.id);
    expect(new Set(batchedIds).size).toBe(total);
  });

  it("folds deep WooCommerce descendants (depth >= 2) rather than sending them to the model", () => {
    const collections = [
      { ...col("top", 620), depth: 0 },
      { ...col("mid", 240), depth: 1, parentId: "top" },
      { ...col("leaf", 90), depth: 2, parentId: "mid" },
    ];
    const result = prepareStage1Catalog(collections);
    const candidateIds = result.candidates.map((c) => c.id);
    expect(candidateIds).toContain("top");
    expect(candidateIds).toContain("mid");
    expect(candidateIds).not.toContain("leaf");
    expect(result.foldedInto.get("leaf")).toBe("mid");
    expect(result.foldedItems.map((c) => c.id)).toEqual(["leaf"]);
  });
});
