import { describe, expect, it } from "vitest";
import { buildCatalogDigest, catalogDigestToPromptText } from "./plp-clustering";
import type { WrTaxonomyTree, WrTaxonomyTreeNode } from "./types";

function node(partial: Partial<WrTaxonomyTreeNode> & { id: string; title: string }): WrTaxonomyTreeNode {
  return { productCount: 0, children: [], source: "store", ...partial };
}

function treeFrom(allTaxonomies: WrTaxonomyTreeNode[]): WrTaxonomyTree {
  return { navigation: null, topTaxonomies: [], overflowCount: 0, allTaxonomies };
}

describe("buildCatalogDigest", () => {
  it("elects a brand cluster from a dedicated brand PLP and folds in mentions from other titles", () => {
    const tree = treeFrom([
      node({ id: "brand-gucci", title: "Gucci", productCount: 400, kind: "brand" }),
      node({ id: "c1", title: "Gucci Sunglasses", productCount: 120 }),
      node({ id: "c2", title: "Gucci Belts", productCount: 80 }),
      node({ id: "c3", title: "Ray-Ban Aviators", productCount: 50 }),
    ]);

    const digest = buildCatalogDigest(tree);
    const gucci = digest.brandClusters.find((c) => c.ref === "brand:gucci");
    expect(gucci).toBeTruthy();
    expect(gucci?.plpCount).toBe(3); // the brand PLP + the two collections mentioning it
    expect(gucci?.productCount).toBe(400 + 120 + 80);
    expect(digest.allClusterRefs).toContain("brand:gucci");
  });

  it("clusters shared topic tokens across titles (the 'women + sunglasses' example)", () => {
    const tree = treeFrom([
      node({ id: "c1", title: "Women Red Sunglasses", productCount: 10 }),
      node({ id: "c2", title: "Women Pink Aviator Sunglasses Under $40", productCount: 15 }),
      node({ id: "c3", title: "Men Wallets", productCount: 5 }),
    ]);

    const digest = buildCatalogDigest(tree);
    // The token clustering is a naive singularizer (strips a trailing "s"),
    // so "sunglasses" collapses to "sunglasse" — fine for matching shared
    // tokens across titles, which is all clustering needs.
    const womenSunglasses = digest.topicClusters.find((c) => c.ref === "topic:sunglasse+women");
    expect(womenSunglasses).toBeTruthy();
    expect(womenSunglasses?.plpCount).toBe(2);
    expect(womenSunglasses?.productCount).toBe(25);
  });

  it("never produces a topic cluster for a single unshared PLP", () => {
    const tree = treeFrom([node({ id: "c1", title: "One Of A Kind Item", productCount: 3 })]);
    const digest = buildCatalogDigest(tree);
    expect(digest.topicClusters).toHaveLength(0);
  });

  it("passes a real WooCommerce-style hierarchy through with rolled-up stats and ancestry chains", () => {
    const tree = treeFrom([
      node({
        id: "bakery",
        title: "Bakery",
        productCount: 10,
        children: [
          node({
            id: "bread",
            title: "Bread",
            productCount: 4,
            children: [node({ id: "sandwich-bread", title: "Sandwich Bread", productCount: 2 })],
          }),
        ],
      }),
    ]);

    const digest = buildCatalogDigest(tree);
    expect(digest.hierarchyRoots).toHaveLength(1);
    expect(digest.allClusterRefs).toEqual(["hierarchy:sandwich-bread"]);
    expect(digest.hierarchyAncestryByLeafRef["hierarchy:sandwich-bread"]).toEqual([
      "hierarchy:sandwich-bread",
      "hierarchy:bread",
      "hierarchy:bakery",
    ]);
    // Rolled up: bakery's total includes its own + bread's + sandwich-bread's product counts.
    expect(digest.hierarchyStatsByRef["hierarchy:bakery"].productCount).toBe(16);
    expect(digest.hierarchyStatsByRef["hierarchy:bakery"].plpCount).toBe(1);
    expect(digest.hierarchyParentByRef["hierarchy:sandwich-bread"]).toBe("hierarchy:bread");
    expect(digest.hierarchyParentByRef["hierarchy:bread"]).toBe("hierarchy:bakery");
    expect(digest.hierarchyParentByRef["hierarchy:bakery"]).toBeUndefined();
  });

  it("folds a hierarchy-leaf title that mentions a brand into that brand's cluster", () => {
    const tree = treeFrom([
      node({ id: "brand-gucci", title: "Gucci", productCount: 400, kind: "brand" }),
      node({
        id: "women",
        title: "Women",
        children: [node({ id: "gucci-sunglasses", title: "Gucci Sunglasses", productCount: 120 })],
      }),
    ]);
    const digest = buildCatalogDigest(tree);
    const gucci = digest.brandClusters.find((c) => c.ref === "brand:gucci");
    expect(gucci?.plpCount).toBe(2);
    expect(gucci?.productCount).toBe(520);
    // The category is still a hierarchy coverage unit — folding it into the
    // brand cluster is extra weight, not a replacement for the tree.
    expect(digest.allClusterRefs).toContain("hierarchy:gucci-sunglasses");
  });

  it("topic-clusters growth-engine collections that sit beside a real category tree, instead of minting one hierarchy ref per collection", () => {
    const tree = treeFrom([
      node({
        id: "women",
        title: "Women",
        children: [node({ id: "dresses", title: "Dresses", productCount: 8 })],
      }),
      node({ id: "ge-1", title: "Women Sunglasses", productCount: 10, source: "growth-engine" }),
      node({ id: "ge-2", title: "Women Aviator Sunglasses", productCount: 20, source: "growth-engine" }),
    ]);
    const digest = buildCatalogDigest(tree);
    expect(digest.allClusterRefs).toContain("hierarchy:dresses");
    expect(digest.allClusterRefs).not.toContain("hierarchy:ge-1");
    expect(digest.topicClusters.find((c) => c.ref === "topic:sunglasse+women")?.plpCount).toBe(2);
    expect(digest.growthEnginePlps).toBe(2);
  });

  it("does not treat a short brand name as a substring of an unrelated title", () => {
    const tree = treeFrom([
      node({ id: "brand-lee", title: "Lee", productCount: 40, kind: "brand" }),
      node({ id: "c1", title: "Sleeping Bags", productCount: 12 }),
      node({ id: "c2", title: "Lee Jeans", productCount: 9 }),
    ]);
    const digest = buildCatalogDigest(tree);
    const lee = digest.brandClusters.find((c) => c.ref === "brand:lee");
    expect(lee?.plpCount).toBe(2); // brand PLP + Lee Jeans, not Sleeping Bags
    expect(lee?.exampleTitles).not.toContain("Sleeping Bags");
  });

  it("tags growth-engine PLPs without excluding them from clustering", () => {
    const tree = treeFrom([
      node({ id: "c1", title: "Women Sunglasses", productCount: 10, source: "store" }),
      node({ id: "c2", title: "Women Cheap Sunglasses", productCount: 20, source: "growth-engine" }),
    ]);
    const digest = buildCatalogDigest(tree);
    expect(digest.growthEnginePlps).toBe(1);
    expect(digest.growthEngineProducts).toBe(20);
    const cluster = digest.topicClusters.find((c) => c.ref === "topic:sunglasse+women");
    expect(cluster?.source).toBe("mixed");
  });
});

describe("catalogDigestToPromptText", () => {
  it("includes bracketed cluster refs the IA planner must echo back verbatim", () => {
    const tree = treeFrom([
      node({ id: "brand-gucci", title: "Gucci", productCount: 100, kind: "brand" }),
      node({ id: "c1", title: "Women Sunglasses", productCount: 10 }),
      node({ id: "c2", title: "Women Aviator Sunglasses", productCount: 20 }),
    ]);
    const text = catalogDigestToPromptText(buildCatalogDigest(tree));
    expect(text).toContain("[brand:gucci]");
    expect(text).toContain("[topic:sunglasse+women]");
    expect(text).toContain("CATALOG SIZE");
  });

  it("mentions the growth-engine share when present", () => {
    const tree = treeFrom([
      node({ id: "c1", title: "Women Sunglasses", productCount: 10 }),
      node({ id: "c2", title: "Women Sunglasses Cheap", productCount: 5, source: "growth-engine" }),
    ]);
    const text = catalogDigestToPromptText(buildCatalogDigest(tree));
    expect(text).toContain("long-tail collections this store already generated separately");
  });
});
