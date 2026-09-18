import { describe, expect, it } from "vitest";
import {
  detectOutputLanguage,
  buildTaxonomyCandidates,
  foldDeepWooDescendants,
  batchCandidates,
  verifyAssignmentCoverage,
  routeMissingToUnresolved,
  normalizeAssignments,
  enforceWooParentPrimacy,
  computeSkuTotals,
  indexCandidatesById,
  type RawCandidateInput,
} from "./taxonomy-build";
import type { TaxonomyAssignment, TaxonomyCandidate } from "./taxonomy-types";

function raw(overrides: Partial<RawCandidateInput> & { id: string; name: string }): RawCandidateInput {
  return { productCount: 0, ...overrides };
}

describe("detectOutputLanguage", () => {
  it("defaults to English for a plain Latin-script catalog", () => {
    const candidates = [{ name: "Dresses" }, { name: "Shoes" }, { name: "Bags" }];
    expect(detectOutputLanguage(candidates)).toBe("en");
  });

  it("detects Arabic when most PLP names use Arabic script (multi-vertical Arabic store)", () => {
    const candidates = [
      { name: "قبعات" },
      { name: "قبعات أطفال" },
      { name: "أحذية" },
      { name: "حقائب" },
    ];
    expect(detectOutputLanguage(candidates)).toBe("ar");
  });

  it("does not flip to a non-Latin language from one stray non-Latin name in a large English catalog", () => {
    const candidates = [
      ...Array.from({ length: 30 }, (_, i) => ({ name: `Category ${i}` })),
      { name: "قبعات" }, // one stray Arabic name, e.g. a mistagged import
    ];
    expect(detectOutputLanguage(candidates)).toBe("en");
  });

  it("falls back to the market hint when there is no script signal at all", () => {
    const candidates = [{ name: "Hats" }, { name: "Shoes" }];
    expect(detectOutputLanguage(candidates, "Saudi Arabia storefront")).toBe("ar");
  });

  it("falls back to English when there is no script signal and no usable market hint", () => {
    const candidates = [{ name: "Hats" }, { name: "Shoes" }];
    expect(detectOutputLanguage(candidates, "United States")).toBe("en");
  });
});

describe("foldDeepWooDescendants / buildTaxonomyCandidates", () => {
  it("keeps every item for a flat Shopify catalog (no hierarchy at all)", () => {
    const items = [
      raw({ id: "c1", name: "Dresses", productCount: 100 }),
      raw({ id: "c2", name: "Shoes", productCount: 50 }),
    ];
    const { kept, foldedInto } = foldDeepWooDescendants(items);
    expect(kept).toHaveLength(2);
    expect(foldedInto.size).toBe(0);
  });

  it("keeps depth 0 and depth 1 WooCommerce items but folds depth >= 2 into the nearest depth<=1 ancestor", () => {
    const items = [
      raw({ id: "top", name: "Electronics", depth: 0, productCount: 3000 }),
      raw({ id: "mid", name: "Laptops", depth: 1, parentId: "top", productCount: 1200 }),
      raw({ id: "leaf1", name: "Gaming Laptops", depth: 2, parentId: "mid", productCount: 400 }),
      raw({ id: "leaf2", name: "Ultrabooks", depth: 2, parentId: "mid", productCount: 200 }),
      raw({ id: "leafleaf", name: "17-inch Gaming Laptops", depth: 3, parentId: "leaf1", productCount: 90 }),
    ];
    const { kept, foldedInto } = foldDeepWooDescendants(items);
    const keptIds = kept.map((i) => i.id);
    expect(keptIds).toEqual(["top", "mid"]);
    expect(foldedInto.get("leaf1")).toBe("mid");
    expect(foldedInto.get("leaf2")).toBe("mid");
    // A depth-3 leaf's nearest ancestor with depth <= 1 is "mid" (depth 1), not "top".
    expect(foldedInto.get("leafleaf")).toBe("mid");
  });

  it("never folds brand PLPs even when they carry hierarchy-like fields", () => {
    const items = [
      raw({ id: "b1", name: "Ray-Ban", kind: "brand", depth: 2, productCount: 900 }),
    ];
    const { kept, foldedInto } = foldDeepWooDescendants(items);
    expect(kept.map((i) => i.id)).toEqual(["b1"]);
    expect(foldedInto.size).toBe(0);
  });

  it("builds a multi-level taxonomyPath breadcrumb for deep WooCommerce items", () => {
    const items = [
      raw({ id: "top", name: "Women", depth: 0, productCount: 5000 }),
      raw({ id: "mid", name: "Clothing", depth: 1, parentId: "top", productCount: 3000 }),
    ];
    const { candidates } = buildTaxonomyCandidates(items);
    const mid = candidates.find((c) => c.id === "mid");
    expect(mid?.taxonomyPath).toEqual(["Women", "Clothing"]);
    const top = candidates.find((c) => c.id === "top");
    expect(top?.taxonomyPath).toEqual(["Women"]);
  });

  it("gives Shopify collections and brand PLPs a single-entry taxonomyPath", () => {
    const items = [
      raw({ id: "c1", name: "Dresses", productCount: 100 }),
      raw({ id: "b1", name: "Maje", kind: "brand", productCount: 120 }),
    ];
    const { candidates } = buildTaxonomyCandidates(items);
    expect(candidates.find((c) => c.id === "c1")?.taxonomyPath).toEqual(["Dresses"]);
    expect(candidates.find((c) => c.id === "b1")?.taxonomyPath).toEqual(["Maje"]);
  });

  it("is cycle-safe when parentId chains loop back on themselves", () => {
    const items = [
      raw({ id: "a", name: "A", depth: 3, parentId: "b", productCount: 10 }),
      raw({ id: "b", name: "B", depth: 3, parentId: "a", productCount: 10 }),
    ];
    expect(() => buildTaxonomyCandidates(items)).not.toThrow();
  });

  it("micro store: 8 flat collections all become their own candidates with no folding", () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      raw({ id: `c${i}`, name: `Category ${i}`, productCount: 10 + i })
    );
    const { candidates, foldedItems } = buildTaxonomyCandidates(items);
    expect(candidates).toHaveLength(8);
    expect(foldedItems).toHaveLength(0);
  });
});

describe("batchCandidates", () => {
  it("returns an empty array for no items", () => {
    expect(batchCandidates([])).toEqual([]);
  });

  it("splits into batches of the given size, preserving every item exactly once", () => {
    const items = Array.from({ length: 650 }, (_, i) => i);
    const batches = batchCandidates(items, 300);
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(300);
    expect(batches[1]).toHaveLength(300);
    expect(batches[2]).toHaveLength(50);
    expect(batches.flat()).toEqual(items);
  });
});

describe("verifyAssignmentCoverage / routeMissingToUnresolved", () => {
  it("finds ids missing from both assignments and excluded", () => {
    const { missingIds } = verifyAssignmentCoverage(
      ["a", "b", "c"],
      [{ itemId: "a", subcategoryId: "sub", primary: true }],
      [{ itemId: "b", name: "B", reason: "promotional" }]
    );
    expect(missingIds).toEqual(["c"]);
  });

  it("routes missing ids to unresolved with their known display name", () => {
    const candidates: TaxonomyCandidate[] = [
      {
        id: "c",
        name: "Mystery Collection",
        productCount: 5,
        kind: "collection",
        depth: 0,
        taxonomyPath: ["Mystery Collection"],
      },
    ];
    const excluded = routeMissingToUnresolved(["c"], indexCandidatesById(candidates));
    expect(excluded).toEqual([{ itemId: "c", name: "Mystery Collection", reason: "unresolved" }]);
  });
});

describe("normalizeAssignments", () => {
  it("leaves a single well-formed primary assignment untouched", () => {
    const assignments: TaxonomyAssignment[] = [
      { itemId: "a", subcategoryId: "sub", primary: true },
    ];
    expect(normalizeAssignments(assignments)).toEqual(assignments);
  });

  it("promotes the first assignment to primary when the model gave zero primaries", () => {
    const assignments: TaxonomyAssignment[] = [
      { itemId: "a", subcategoryId: "sub1", primary: false },
      { itemId: "a", subcategoryId: "sub2", primary: false },
    ];
    const result = normalizeAssignments(assignments);
    const primaries = result.filter((a) => a.primary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].subcategoryId).toBe("sub1");
  });

  it("collapses multiple primaries down to the first one", () => {
    const assignments: TaxonomyAssignment[] = [
      { itemId: "a", subcategoryId: "sub1", primary: true },
      { itemId: "a", subcategoryId: "sub2", primary: true },
    ];
    const result = normalizeAssignments(assignments);
    const primaries = result.filter((a) => a.primary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].subcategoryId).toBe("sub1");
  });
});

describe("enforceWooParentPrimacy", () => {
  it("forces a WooCommerce child non-primary when it shares a subcategory with its real parent", () => {
    const candidates: TaxonomyCandidate[] = [
      { id: "parent", name: "Dresses", productCount: 620, kind: "collection", depth: 0, taxonomyPath: ["Dresses"] },
      { id: "child", name: "Long Dresses", productCount: 240, kind: "collection", depth: 1, parentId: "parent", taxonomyPath: ["Dresses", "Long Dresses"] },
    ];
    // Model incorrectly marked the child primary and the parent non-primary.
    const assignments: TaxonomyAssignment[] = [
      { itemId: "parent", subcategoryId: "dresses", primary: false },
      { itemId: "child", subcategoryId: "dresses", primary: true },
    ];
    const result = enforceWooParentPrimacy(assignments, indexCandidatesById(candidates));
    const byItem = new Map(result.map((a) => [a.itemId, a]));
    expect(byItem.get("parent")?.primary).toBe(true);
    expect(byItem.get("child")?.primary).toBe(false);
  });

  it("does not touch a parent/child pair placed in different subcategories (genuine split)", () => {
    const candidates: TaxonomyCandidate[] = [
      { id: "parent", name: "Dresses", productCount: 620, kind: "collection", depth: 0, taxonomyPath: ["Dresses"] },
      { id: "child", name: "Wedding Dresses", productCount: 300, kind: "collection", depth: 1, parentId: "parent", taxonomyPath: ["Dresses", "Wedding Dresses"] },
    ];
    const assignments: TaxonomyAssignment[] = [
      { itemId: "parent", subcategoryId: "dresses", primary: true },
      { itemId: "child", subcategoryId: "wedding-dresses", primary: true },
    ];
    const result = enforceWooParentPrimacy(assignments, indexCandidatesById(candidates));
    const byItem = new Map(result.map((a) => [a.itemId, a]));
    expect(byItem.get("parent")?.primary).toBe(true);
    expect(byItem.get("child")?.primary).toBe(true);
  });

  it("leaves items with no parentId untouched", () => {
    const candidates: TaxonomyCandidate[] = [
      { id: "a", name: "A", productCount: 10, kind: "collection", depth: 0, taxonomyPath: ["A"] },
      { id: "b", name: "B", productCount: 10, kind: "collection", depth: 0, taxonomyPath: ["B"] },
    ];
    const assignments: TaxonomyAssignment[] = [
      { itemId: "a", subcategoryId: "sub", primary: true },
      { itemId: "b", subcategoryId: "sub", primary: true },
    ];
    const result = enforceWooParentPrimacy(assignments, indexCandidatesById(candidates));
    expect(result.every((a) => a.primary)).toBe(true);
  });
});

describe("computeSkuTotals", () => {
  const categories = [
    {
      id: "womens-clothing",
      name: "Women's Clothing",
      subcategories: [
        { id: "dresses", name: "Dresses" },
        { id: "wedding-dresses", name: "Wedding Dresses" },
      ],
    },
    {
      id: "women-brands",
      name: "Women Brands",
      overlapping: true,
      subcategories: [{ id: "brand-maje", name: "Maje" }],
    },
  ];

  const candidates: TaxonomyCandidate[] = [
    { id: "dresses-plp", name: "Dresses", productCount: 620, kind: "collection", depth: 0, taxonomyPath: ["Dresses"] },
    { id: "wedding-plp", name: "Wedding Dresses", productCount: 300, kind: "collection", depth: 0, taxonomyPath: ["Wedding Dresses"] },
    { id: "maje-plp", name: "Maje", productCount: 120, kind: "brand", depth: 0, taxonomyPath: ["Maje"] },
  ];

  it("sums only primary assignments per subcategory and rolls up to the category", () => {
    const assignments: TaxonomyAssignment[] = [
      { itemId: "dresses-plp", subcategoryId: "dresses", primary: true },
      { itemId: "wedding-plp", subcategoryId: "wedding-dresses", primary: true },
      { itemId: "maje-plp", subcategoryId: "brand-maje", primary: true },
    ];
    const { categories: result, totalUniqueProducts } = computeSkuTotals({
      categories,
      assignments,
      candidates,
    });

    const womensClothing = result.find((c) => c.id === "womens-clothing")!;
    expect(womensClothing.productCount).toBe(920); // 620 + 300
    expect(womensClothing.subcategories.find((s) => s.id === "dresses")?.productCount).toBe(620);

    const brandCategory = result.find((c) => c.id === "women-brands")!;
    expect(brandCategory.productCount).toBe(120);

    // The overlapping brand category's 120 is excluded from the store-wide total.
    expect(totalUniqueProducts).toBe(920);
  });

  it("non-primary assignments contribute zero to any total", () => {
    const assignments: TaxonomyAssignment[] = [
      { itemId: "dresses-plp", subcategoryId: "dresses", primary: true },
      { itemId: "wedding-plp", subcategoryId: "dresses", primary: false }, // duplicate, non-primary
    ];
    const { categories: result } = computeSkuTotals({
      categories: [categories[0]],
      assignments,
      candidates,
    });
    expect(result[0].subcategories.find((s) => s.id === "dresses")?.productCount).toBe(620);
  });

  it("rolls a folded deep-WooCommerce descendant's count additively onto its kept ancestor's subcategory", () => {
    const wooCategories = [
      {
        id: "electronics",
        name: "Electronics",
        subcategories: [{ id: "laptops", name: "Laptops" }],
      },
    ];
    const wooCandidates: TaxonomyCandidate[] = [
      { id: "mid", name: "Laptops", productCount: 1200, kind: "collection", depth: 1, taxonomyPath: ["Electronics", "Laptops"] },
    ];
    const assignments: TaxonomyAssignment[] = [
      { itemId: "mid", subcategoryId: "laptops", primary: true },
    ];
    const foldedItems: RawCandidateInput[] = [
      raw({ id: "leaf", name: "Gaming Laptops", productCount: 400 }),
    ];
    const foldedInto = new Map([["leaf", "mid"]]);

    const { categories: result } = computeSkuTotals({
      categories: wooCategories,
      assignments,
      candidates: wooCandidates,
      foldedItems,
      foldedInto,
    });

    expect(result[0].subcategories[0].productCount).toBe(1600); // 1200 + 400
  });

  it("excludes a folded descendant's count when its ancestor itself has no primary assignment", () => {
    const wooCategories = [
      { id: "electronics", name: "Electronics", subcategories: [{ id: "laptops", name: "Laptops" }] },
    ];
    const wooCandidates: TaxonomyCandidate[] = [
      { id: "mid", name: "Laptops", productCount: 1200, kind: "collection", depth: 1, taxonomyPath: ["Electronics", "Laptops"] },
    ];
    // "mid" was excluded entirely — no assignment at all.
    const assignments: TaxonomyAssignment[] = [];
    const foldedItems: RawCandidateInput[] = [raw({ id: "leaf", name: "Gaming Laptops", productCount: 400 })];
    const foldedInto = new Map([["leaf", "mid"]]);

    const { categories: result, totalUniqueProducts } = computeSkuTotals({
      categories: wooCategories,
      assignments,
      candidates: wooCandidates,
      foldedItems,
      foldedInto,
    });

    expect(result[0].subcategories[0].productCount).toBe(0);
    expect(totalUniqueProducts).toBe(0);
  });
});
