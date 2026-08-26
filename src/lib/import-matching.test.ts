import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchingRule } from "./matching";

const categories = [
  { id: "c1", name: "Running Shoes", slug: "running-shoes" },
  { id: "c2", name: "Trail Shoes", slug: "trail-shoes" },
];

const products = [
  { sku: "AAA-1", data: { CATEGORY: "Electronics > TVs", NAME: "TV" } },
  { sku: "BBB-2", data: { CATEGORY: "Home > Kitchen", NAME: "Kettle" } },
];

vi.mock("./storage-helpers", () => ({
  loadCategoriesJson: vi.fn(async () => categories),
  loadProductsJson: vi.fn(async () => products),
}));

const {
  applyMatchTypes,
  resolveTargetCategoryNames,
  PLP_MATCHING_RULES,
} = await import("./import-matching");
type MatchableRow = import("./import-matching").MatchableRow;

const PRODUCT_RULES: MatchingRule[] = [
  { type: "case_insensitive", enabled: true, label: "", description: "" },
];

describe("applyMatchTypes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("trims the source value even when the trim rule is off", async () => {
    const rows: MatchableRow[] = [{ originalData: { sku: "  aaa-1 " } }];
    const outcome = await applyMatchTypes({
      kind: "product",
      workspaceId: "w1",
      rows,
      sourceColumn: "sku",
      masterColumn: "sku",
      rules: PRODUCT_RULES,
    });

    expect(outcome).toEqual({ existingCount: 1, newCount: 0 });
    expect(rows[0]).toMatchObject({
      matchType: "existing",
      matchedProductSku: "AAA-1",
    });
  });

  it("honours the step-2 category filter so later steps agree", async () => {
    const rows: MatchableRow[] = [{ originalData: { sku: "AAA-1" } }];

    const unfiltered = await applyMatchTypes({
      kind: "product",
      workspaceId: "w1",
      rows,
      sourceColumn: "sku",
      masterColumn: "sku",
      rules: PRODUCT_RULES,
    });
    expect(unfiltered.existingCount).toBe(1);

    // The same row is "new" once the catalog is narrowed to another category.
    const filtered = await applyMatchTypes({
      kind: "product",
      workspaceId: "w1",
      rows,
      sourceColumn: "sku",
      masterColumn: "sku",
      rules: PRODUCT_RULES,
      targetCategoryNames: ["Kitchen"],
    });
    expect(filtered.existingCount).toBe(0);
    expect(rows[0].matchType).toBe("new");
    expect(rows[0].matchedProductSku).toBeUndefined();
  });

  it("matches PLP rows on name ignoring case and trailing slash", async () => {
    const rows: MatchableRow[] = [
      { originalData: { name: "running shoes/" } },
      { originalData: { name: "Winter Boots" } },
    ];
    const outcome = await applyMatchTypes({
      kind: "plp",
      workspaceId: "w1",
      rows,
      sourceColumn: "name",
      masterColumn: "name",
      rules: PLP_MATCHING_RULES,
    });

    expect(outcome).toEqual({ existingCount: 1, newCount: 1 });
    expect(rows[0].matchType).toBe("existing");
    // PLP has no SKU, so no master sku is attached.
    expect(rows[0].matchedProductSku).toBeUndefined();
    expect(rows[1].matchType).toBe("new");
  });

  it("never fuzzy-matches PLP rows on substrings", async () => {
    const rows: MatchableRow[] = [{ originalData: { name: "Shoes" } }];
    await applyMatchTypes({
      kind: "plp",
      workspaceId: "w1",
      rows,
      sourceColumn: "name",
      masterColumn: "name",
      rules: [
        ...PLP_MATCHING_RULES,
        { type: "contains", enabled: true, label: "", description: "" },
      ],
    });
    expect(rows[0].matchType).toBe("new");
  });
});

describe("resolveTargetCategoryNames", () => {
  it("maps stored ids to names and drops unknown ids", async () => {
    const names = await resolveTargetCategoryNames("w1", ["c2", "missing"]);
    expect(names).toEqual(["Trail Shoes"]);
  });

  it("returns nothing when no filter was saved", async () => {
    expect(await resolveTargetCategoryNames("w1", [])).toEqual([]);
    expect(await resolveTargetCategoryNames("w1", null)).toEqual([]);
  });
});
