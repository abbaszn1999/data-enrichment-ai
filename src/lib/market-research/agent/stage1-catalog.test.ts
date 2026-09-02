import { describe, expect, it } from "vitest";
import { compressCollectionsForStage1, STAGE1_MAX_COLLECTIONS } from "./stage1-catalog";

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

describe("compressCollectionsForStage1", () => {
  it("keeps the highest-count collections and reports overflow", () => {
    const collections = Array.from({ length: STAGE1_MAX_COLLECTIONS + 20 }, (_, i) =>
      col(`c${i}`, i)
    );
    const result = compressCollectionsForStage1(collections);
    expect(result.kept).toHaveLength(STAGE1_MAX_COLLECTIONS);
    expect(result.overflowCount).toBe(20);
    expect(result.kept[0]?.productCount).toBe(STAGE1_MAX_COLLECTIONS + 19);
  });
});
