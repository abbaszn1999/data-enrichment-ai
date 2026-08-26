import { describe, expect, it } from "vitest";
import type { TaxonomySummary } from "@/lib/sync/core/types";
import { buildWrStoreLinks } from "./provider-links";
import {
  buildWrTaxonomyTree,
  compressTaxonomyTree,
  isGeneratedCollectionTitle,
  navigationMenusToTree,
  taxonomyTreeToPromptText,
} from "./taxonomy-tree";

const SHOPIFY_LINKS = buildWrStoreLinks("shopify", "https://mystore.myshopify.com");
const WOO_LINKS = buildWrStoreLinks("woocommerce", "https://mystore.com");

function tax(id: string, productCount: number, extra: Partial<TaxonomySummary> = {}): TaxonomySummary {
  return { id, title: `Category ${id}`, productCount, manual: true, ...extra };
}

describe("compressTaxonomyTree", () => {
  it("keeps every group as a flat top-level list when there is no parent info", () => {
    const { topTaxonomies, overflowCount } = compressTaxonomyTree(
      [tax("a", 10), tax("b", 30), tax("c", 5)],
      SHOPIFY_LINKS
    );
    expect(topTaxonomies.map((n) => n.id)).toEqual(["b", "a", "c"]); // sorted by productCount desc
    expect(overflowCount).toBe(0);
  });

  it("caps at maxTop and reports the rest as overflow", () => {
    const taxonomies = Array.from({ length: 10 }, (_, i) => tax(`t${i}`, i));
    const { topTaxonomies, overflowCount } = compressTaxonomyTree(taxonomies, SHOPIFY_LINKS, 3);
    expect(topTaxonomies).toHaveLength(3);
    expect(overflowCount).toBe(7);
    // Highest product counts survive the cut.
    expect(topTaxonomies.map((n) => n.id)).toEqual(["t9", "t8", "t7"]);
  });

  it("nests children under their parent when parent ids are present (WooCommerce)", () => {
    const taxonomies = [
      tax("root", 100, { parent: undefined }),
      tax("child", 40, { parent: "root" }),
      tax("grandchild", 10, { parent: "child" }),
    ];
    const { topTaxonomies } = compressTaxonomyTree(taxonomies, WOO_LINKS);
    expect(topTaxonomies).toHaveLength(1);
    expect(topTaxonomies[0].id).toBe("root");
    expect(topTaxonomies[0].children[0].id).toBe("child");
    expect(topTaxonomies[0].children[0].children[0].id).toBe("grandchild");
  });

  it("drops a child whose parent was cut by the cap, without crashing", () => {
    // "child" points at a parent that didn't make the top-3 cut.
    const taxonomies = [
      tax("a", 100),
      tax("b", 90),
      tax("orphan-parent", 1),
      tax("child", 50, { parent: "orphan-parent" }),
    ];
    const { topTaxonomies } = compressTaxonomyTree(taxonomies, WOO_LINKS, 3);
    expect(topTaxonomies.map((n) => n.id).sort()).toEqual(["a", "b", "child"]);
  });

  it("never invents a link — a Shopify handle resolves through the real, absolute URL pattern", () => {
    const { topTaxonomies } = compressTaxonomyTree(
      [tax("gid://1", 5, { handle: "sneakers" })],
      SHOPIFY_LINKS
    );
    expect(topTaxonomies[0].url).toBe("https://mystore.myshopify.com/collections/sneakers");
  });

  it("prefers a provider-supplied URL (WooCommerce `link`) over building one from a handle", () => {
    const { topTaxonomies } = compressTaxonomyTree(
      [tax("42", 5, { handle: "shoes", url: "https://store.example/product-category/shoes/" })],
      WOO_LINKS
    );
    expect(topTaxonomies[0].url).toBe("https://store.example/product-category/shoes/");
  });

  it("leaves url undefined instead of guessing when neither url nor handle is available", () => {
    const { topTaxonomies } = compressTaxonomyTree([tax("no-handle", 5)], SHOPIFY_LINKS);
    expect(topTaxonomies[0].url).toBeUndefined();
  });
});

describe("isGeneratedCollectionTitle", () => {
  it("matches every separator form the push step can produce", () => {
    for (const title of ["AI - Chargers", "AI: Chargers", "AI — Chargers", "AI | Chargers", "AI Chargers"]) {
      expect(isGeneratedCollectionTitle(title, "AI")).toBe(true);
    }
  });

  it("is case-insensitive and ignores surrounding whitespace", () => {
    expect(isGeneratedCollectionTitle("  ai - chargers ", "AI")).toBe(true);
  });

  it("does not match a real category that merely starts with the same letters", () => {
    expect(isGeneratedCollectionTitle("AIrpods Cases", "AI")).toBe(false);
    expect(isGeneratedCollectionTitle("Smartphones", "AI")).toBe(false);
  });

  it("matches nothing when no prefix is configured", () => {
    expect(isGeneratedCollectionTitle("AI - Chargers", "")).toBe(false);
    expect(isGeneratedCollectionTitle("AI - Chargers", undefined)).toBe(false);
  });

  it("treats a regex-special prefix as literal text", () => {
    expect(isGeneratedCollectionTitle("A.I - Chargers", "A.I")).toBe(true);
    expect(isGeneratedCollectionTitle("AXI - Chargers", "A.I")).toBe(false);
  });
});

describe("navigationMenusToTree", () => {
  it("flattens every menu's items into WrTaxonomyTreeNode, making relative URLs absolute", () => {
    const nodes = navigationMenusToTree(
      [
        {
          id: "1",
          title: "Main",
          items: [
            { title: "Shop", url: "/collections/shop", children: [{ title: "Shoes", url: "/collections/shoes" }] },
          ],
        },
      ],
      "https://mystore.myshopify.com"
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0].title).toBe("Shop");
    expect(nodes[0].url).toBe("https://mystore.myshopify.com/collections/shop");
    expect(nodes[0].children[0].title).toBe("Shoes");
    expect(nodes[0].children[0].url).toBe("https://mystore.myshopify.com/collections/shoes");
  });

  it("leaves an already-absolute navigation URL (e.g. an external link) untouched", () => {
    const nodes = navigationMenusToTree(
      [{ id: "1", title: "Main", items: [{ title: "Blog", url: "https://blog.example.com/" }] }],
      "https://mystore.myshopify.com"
    );
    expect(nodes[0].url).toBe("https://blog.example.com/");
  });
});

describe("buildWrTaxonomyTree / taxonomyTreeToPromptText", () => {
  it("prefers real navigation text but still lists top taxonomies underneath", () => {
    const tree = buildWrTaxonomyTree({
      taxonomies: [tax("a", 50, { handle: "a" })],
      navigationMenus: [{ id: "1", title: "Main", items: [{ title: "Shop", url: "/collections/shop" }] }],
      storeLinks: SHOPIFY_LINKS,
    });
    const text = taxonomyTreeToPromptText(tree);
    expect(text).toContain("Real storefront navigation");
    expect(text).toContain("Shop");
    expect(text).toContain("Top store categories");
    expect(text).toContain("Category a");
  });

  it("never prints a real URL — every header link must be a bare '#', so no URL should be exposed to the agent", () => {
    const tree = buildWrTaxonomyTree({
      taxonomies: [tax("a", 50, { handle: "a-handle" })],
      navigationMenus: [{ id: "1", title: "Main", items: [{ title: "Shop", url: "/collections/shop" }] }],
      storeLinks: SHOPIFY_LINKS,
    });
    const text = taxonomyTreeToPromptText(tree);
    expect(text).toContain("Shop");
    expect(text).toContain("Category a (50 products)");
    expect(text).not.toContain("https://");
    expect(text).not.toContain("→");
  });

  it("tells the agent to group the categories itself when the real menu is unavailable, without leaking the merchant-facing fix instructions", () => {
    const tree = buildWrTaxonomyTree({
      taxonomies: [tax("a", 1)],
      navigationMenus: null,
      navigationUnavailableReason:
        "This store's Shopify app is missing navigation permissions. In Shopify admin open Settings › Apps…",
      storeLinks: SHOPIFY_LINKS,
    });
    const text = taxonomyTreeToPromptText(tree);
    expect(text).toContain("not available");
    expect(text).not.toContain("Shopify admin");
    // The reason itself is kept on the tree for the UI, just not put in the prompt.
    expect(tree.navigationUnavailableReason).toContain("Shopify admin");
  });

  it("leaves out the collections Market Research pushed, which would otherwise outrank the store's own categories", () => {
    const tree = buildWrTaxonomyTree({
      taxonomies: [
        // Generated niche collections hold a whole niche, so they sort first.
        tax("g1", 33, { handle: "ai-electronics-smartphones" }),
        tax("g2", 33, { handle: "ai-best-electronics-brands" }),
        tax("real", 6, { handle: "smartphones" }),
      ].map((t, i) =>
        i < 2 ? { ...t, title: `AI - Electronics Smartphones ${i}` } : { ...t, title: "Smartphones" }
      ),
      navigationMenus: null,
      storeLinks: SHOPIFY_LINKS,
      generatedCollectionPrefix: "AI",
    });
    expect(tree.topTaxonomies.map((n) => n.title)).toEqual(["Smartphones"]);
    expect(taxonomyTreeToPromptText(tree)).not.toContain("AI - ");
  });

  it("keeps every category when the workspace has no naming prefix configured", () => {
    const tree = buildWrTaxonomyTree({
      taxonomies: [{ ...tax("g1", 33), title: "AI - Electronics" }, { ...tax("real", 6), title: "Smartphones" }],
      navigationMenus: null,
      storeLinks: SHOPIFY_LINKS,
    });
    expect(tree.topTaxonomies).toHaveLength(2);
  });

  it("mentions the overflow count when categories were cut", () => {
    const taxonomies = Array.from({ length: 5 }, (_, i) => tax(`t${i}`, i));
    const tree = buildWrTaxonomyTree({ taxonomies, navigationMenus: null, storeLinks: SHOPIFY_LINKS });
    const text = taxonomyTreeToPromptText({ ...tree, overflowCount: 12 });
    expect(text).toContain("12 more categories");
  });
});
