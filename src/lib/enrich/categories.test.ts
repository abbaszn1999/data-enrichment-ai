import { describe, expect, it } from "vitest";
import {
  buildCategoryAllowlist,
  sanitizeCategoriesOutput,
} from "./categories";
import type { CategoryItem } from "@/types";

const storeCats: CategoryItem[] = [
  {
    id: "1",
    name: "TVs",
    slug: "tvs",
    fullPath: "Electronics > TVs",
    parentId: null,
  },
  {
    id: "2",
    name: "Smartphones",
    slug: "smartphones",
    fullPath: "Electronics > Smartphones",
    parentId: null,
  },
];

describe("buildCategoryAllowlist", () => {
  it("indexes name and fullPath", () => {
    const allow = buildCategoryAllowlist(storeCats);
    expect(allow.get("tvs")).toBe("TVs");
    expect(allow.get("electronics > tvs")).toBe("Electronics > TVs");
  });
});

describe("sanitizeCategoriesOutput", () => {
  it("keeps only allowlisted paths", () => {
    expect(
      sanitizeCategoriesOutput("Electronics > TVs, Baby & Toddler > Feeding", {
        workspaceCategories: storeCats,
        cmsType: "woocommerce",
        maxCategories: 3,
      })
    ).toBe("Electronics > TVs");
  });

  it("returns empty when nothing matches the allowlist", () => {
    expect(
      sanitizeCategoriesOutput("Baby & Toddler > Feeding", {
        workspaceCategories: storeCats,
        cmsType: "shopify",
      })
    ).toBe("");
  });

  it("passes through when no allowlist is provided", () => {
    expect(
      sanitizeCategoriesOutput("Baby & Toddler > Feeding", {
        workspaceCategories: [],
      })
    ).toBe("Baby & Toddler > Feeding");
  });

  it("respects maxCategories for multi-select CMS", () => {
    expect(
      sanitizeCategoriesOutput(
        "Electronics > TVs, Electronics > Smartphones",
        {
          workspaceCategories: storeCats,
          cmsType: "woocommerce",
          maxCategories: 1,
        }
      )
    ).toBe("Electronics > TVs");
  });

  it("shopify allowlist keeps at most one category", () => {
    expect(
      sanitizeCategoriesOutput(
        "Electronics > TVs, Electronics > Smartphones",
        {
          workspaceCategories: storeCats,
          cmsType: "shopify",
          maxCategories: 3,
        }
      )
    ).toBe("Electronics > TVs");
  });
});
