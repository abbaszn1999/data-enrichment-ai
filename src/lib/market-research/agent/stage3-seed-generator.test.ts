import { describe, expect, it } from "vitest";
import {
  formatSelectionForPrompt,
  type SelectedScopeCollectionInput,
} from "./stage3-seed-generator";

function plp(
  overrides: Partial<SelectedScopeCollectionInput> &
    Pick<SelectedScopeCollectionInput, "id" | "name">
): SelectedScopeCollectionInput {
  return {
    productCount: 100,
    parentNicheName: "Clothing",
    ...overrides,
  };
}

describe("formatSelectionForPrompt", () => {
  it("groups by subcategory, not just category, when subcategoryName is present", () => {
    const out = formatSelectionForPrompt([
      plp({ id: "hats", name: "Hats", subcategoryName: "Kids Hats" }),
      plp({ id: "tshirts", name: "Men's T-Shirts", subcategoryName: "T-Shirts" }),
    ]);
    expect(out).toContain("Category: Clothing\nSubcategory: Kids Hats");
    expect(out).toContain("Category: Clothing\nSubcategory: T-Shirts");
    // Two distinct groups, not one collapsed "Clothing" block.
    expect(out.split("Category: Clothing").length - 1).toBe(2);
  });

  it("labels a fully-selected subcategory using subcategoryFullySelected, ignoring the parent category's flag", () => {
    const out = formatSelectionForPrompt([
      plp({
        id: "hats",
        name: "Hats",
        subcategoryName: "Kids Hats",
        subcategoryFullySelected: true,
        // The wider category was NOT fully selected (a sibling subcategory
        // exists but wasn't picked) — this must not leak into the label.
        nicheFullySelected: false,
      }),
    ]);
    expect(out).toContain(
      "Subcategory: Kids Hats (fully selected — every PLP under this subcategory was chosen, this exact search intent is fully in scope)"
    );
  });

  it("labels a partially-selected subcategory correctly", () => {
    const out = formatSelectionForPrompt([
      plp({
        id: "hats",
        name: "Hats",
        subcategoryName: "Kids Hats",
        subcategoryFullySelected: false,
      }),
    ]);
    expect(out).toContain(
      "Subcategory: Kids Hats (partial selection — only some PLPs under this subcategory were chosen, stay scoped to them)"
    );
  });

  it("falls back to flat category-only grouping when no subcategory is given", () => {
    const out = formatSelectionForPrompt([
      plp({ id: "eye", name: "Eyewear", nicheFullySelected: true }),
    ]);
    expect(out).toContain(
      "Category: Clothing (fully selected — every PLP under this category was chosen, full-category coverage is wanted)"
    );
    expect(out).not.toContain("Subcategory:");
  });

  it("includes the client's store path as supporting context when present", () => {
    const out = formatSelectionForPrompt([
      plp({
        id: "hats",
        name: "Hats",
        subcategoryName: "Kids Hats",
        taxonomyPath: ["Kids", "Hats"],
      }),
    ]);
    expect(out).toContain("store path: Kids > Hats");
  });

  it("omits the store path line for a single-entry (no real hierarchy) taxonomyPath", () => {
    const out = formatSelectionForPrompt([
      plp({ id: "eye", name: "Eyewear", taxonomyPath: ["Eyewear"] }),
    ]);
    expect(out).not.toContain("store path:");
  });

  it("keeps every PLP under its own subcategory group and never drops an id", () => {
    const items = [
      plp({ id: "a", name: "A", subcategoryName: "Sub1" }),
      plp({ id: "b", name: "B", subcategoryName: "Sub1" }),
      plp({ id: "c", name: "C", subcategoryName: "Sub2" }),
    ];
    const out = formatSelectionForPrompt(items);
    expect(out).toContain('id="a"');
    expect(out).toContain('id="b"');
    expect(out).toContain('id="c"');
  });
});
