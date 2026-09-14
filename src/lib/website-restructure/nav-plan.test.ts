import { describe, expect, it } from "vitest";
import {
  buildNavPlan,
  computeCoverage,
  exceedsMaxDepth,
  flattenNavPlanDepth,
  navPlanToPromptText,
  normalizeNavPlan,
  repairCoverageGaps,
} from "./nav-plan";
import { buildCatalogDigest } from "./plp-clustering";
import type { WrNavNode, WrTaxonomyTree, WrTaxonomyTreeNode } from "./types";

function node(partial: Partial<WrTaxonomyTreeNode> & { id: string; title: string }): WrTaxonomyTreeNode {
  return { productCount: 0, children: [], source: "store", ...partial };
}

function treeFrom(allTaxonomies: WrTaxonomyTreeNode[]): WrTaxonomyTree {
  return { navigation: null, topTaxonomies: [], overflowCount: 0, allTaxonomies };
}

function navNode(partial: Partial<WrNavNode> & { id: string; label: string }): WrNavNode {
  return { level: "department", clusterRefs: [], plpCount: 0, productCount: 0, children: [], ...partial };
}

describe("normalizeNavPlan", () => {
  it("parses a well-formed raw model response into WrNavNode[]", () => {
    const nodes = normalizeNavPlan({
      nodes: [
        {
          id: "d1",
          label: "Electronics",
          level: "department",
          clusterRefs: ["brand:acme"],
          children: [{ id: "c1", label: "Phones", level: "category", clusterRefs: ["topic:phones"], children: [] }],
        },
      ],
    });
    expect(nodes).toHaveLength(1);
    expect(nodes[0].label).toBe("Electronics");
    expect(nodes[0].children[0].label).toBe("Phones");
  });

  it("returns an empty array for malformed input instead of throwing", () => {
    expect(normalizeNavPlan(null)).toEqual([]);
    expect(normalizeNavPlan({})).toEqual([]);
    expect(normalizeNavPlan({ nodes: "not-an-array" })).toEqual([]);
  });

  it("falls back to a sensible level by depth when the model omits/mistypes it", () => {
    const nodes = normalizeNavPlan({ nodes: [{ id: "d1", label: "X", clusterRefs: [], children: [] }] });
    expect(nodes[0].level).toBe("department");
  });

  it("gives id-less nodes unique ids across sibling branches, stable across re-parses", () => {
    const raw = {
      nodes: [
        { label: "A", children: [{ label: "A child" }] },
        { label: "B", children: [{ label: "B child" }] },
      ],
    };
    const first = normalizeNavPlan(raw);
    const ids = [
      first[0].id,
      first[1].id,
      first[0].children[0].id,
      first[1].children[0].id,
    ];
    expect(new Set(ids).size).toBe(4);
    expect(normalizeNavPlan(raw)).toEqual(first);
  });
});

describe("exceedsMaxDepth / flattenNavPlanDepth", () => {
  it("accepts a plan at exactly 3 levels", () => {
    const nodes = [
      navNode({
        id: "d",
        label: "D",
        children: [navNode({ id: "c", label: "C", level: "category", children: [navNode({ id: "s", label: "S", level: "subcategory" })] })],
      }),
    ];
    expect(exceedsMaxDepth(nodes)).toBe(false);
  });

  it("flags a plan that goes one level past the 3-click budget", () => {
    const nodes = [
      navNode({
        id: "d",
        label: "D",
        children: [
          navNode({
            id: "c",
            label: "C",
            level: "category",
            children: [
              navNode({
                id: "s",
                label: "S",
                level: "subcategory",
                children: [navNode({ id: "s2", label: "Too deep", clusterRefs: ["x"] })],
              }),
            ],
          }),
        ],
      }),
    ];
    expect(exceedsMaxDepth(nodes)).toBe(true);

    const flattened = flattenNavPlanDepth(nodes);
    expect(exceedsMaxDepth(flattened)).toBe(false);
    // The deepest allowed node absorbs the orphaned grandchild's refs rather
    // than losing them.
    const subcat = flattened[0].children[0].children[0];
    expect(subcat.clusterRefs).toContain("x");
    expect(subcat.children).toEqual([]);
  });
});

describe("computeCoverage / repairCoverageGaps", () => {
  it("reports every digest cluster covered when the plan references them all", () => {
    const tree = treeFrom([node({ id: "brand-a", title: "Acme", productCount: 10, kind: "brand" })]);
    const digest = buildCatalogDigest(tree);
    const nodes = [navNode({ id: "d", label: "Acme", clusterRefs: ["brand:acme"] })];

    const coverage = computeCoverage(nodes, digest);
    expect(coverage.orphanedClusterRefs).toEqual([]);
    expect(coverage.coveredClusters).toBe(coverage.totalClusters);
  });

  it("treats referencing a hierarchy ancestor as covering all of its descendants", () => {
    const tree = treeFrom([
      node({
        id: "bakery",
        title: "Bakery",
        productCount: 5,
        children: [node({ id: "bread", title: "Bread", productCount: 3 })],
      }),
    ]);
    const digest = buildCatalogDigest(tree);
    // The plan only references the department, never the leaf directly.
    const nodes = [navNode({ id: "d", label: "Bakery", clusterRefs: ["hierarchy:bakery"] })];

    const coverage = computeCoverage(nodes, digest);
    expect(coverage.orphanedClusterRefs).toEqual([]);
  });

  it("flags an uncovered cluster and repairCoverageGaps folds it into a generated catch-all node", () => {
    const tree = treeFrom([node({ id: "brand-a", title: "Acme", productCount: 10, kind: "brand" })]);
    const digest = buildCatalogDigest(tree);
    const nodes: WrNavNode[] = [];

    const coverage = computeCoverage(nodes, digest);
    expect(coverage.orphanedClusterRefs).toEqual(["brand:acme"]);

    const repaired = repairCoverageGaps(nodes, coverage.orphanedClusterRefs);
    expect(repaired).toHaveLength(1);
    expect(repaired[0].id).toBe("more-categories");
    expect(repaired[0].clusterRefs).toEqual(["brand:acme"]);
    expect(computeCoverage(repaired, digest).orphanedClusterRefs).toEqual([]);
  });

  it("is a no-op when there is nothing to repair", () => {
    const nodes = [navNode({ id: "d", label: "D" })];
    expect(repairCoverageGaps(nodes, [])).toBe(nodes);
  });
});

describe("buildNavPlan / navPlanToPromptText", () => {
  it("annotates each node with rolled-up plp/product counts from the digest", () => {
    const tree = treeFrom([node({ id: "brand-a", title: "Acme", productCount: 10, kind: "brand" })]);
    const digest = buildCatalogDigest(tree);
    const nodes = [navNode({ id: "d", label: "Acme", clusterRefs: ["brand:acme"] })];

    const plan = buildNavPlan(nodes, digest);
    expect(plan.nodes[0].productCount).toBe(10);
    expect(plan.maxDepth).toBe(1);
    expect(plan.coverage.orphanedClusterRefs).toEqual([]);
  });

  it("counts a hierarchy department once when a child node references its descendant", () => {
    const tree = treeFrom([
      node({
        id: "bakery",
        title: "Bakery",
        children: [
          node({ id: "bread", title: "Bread", productCount: 3 }),
          node({ id: "cakes", title: "Cakes", productCount: 7 }),
        ],
      }),
    ]);
    const digest = buildCatalogDigest(tree);
    // Hierarchy stats are rolled up, so "Bakery" (10) already contains
    // "Bread" (3) — the department must still report 10, not 13.
    const plan = buildNavPlan(
      [
        navNode({
          id: "d",
          label: "Bakery",
          clusterRefs: ["hierarchy:bakery"],
          children: [navNode({ id: "c", label: "Bread", level: "category", clusterRefs: ["hierarchy:bread"] })],
        }),
      ],
      digest
    );
    expect(plan.nodes[0].productCount).toBe(10);
    expect(plan.nodes[0].children[0].productCount).toBe(3);
  });

  it("renders a compact label-only tree, never a cluster ref or raw id", () => {
    const plan = buildNavPlan(
      [
        navNode({
          id: "d",
          label: "Electronics",
          clusterRefs: ["brand:acme"],
          children: [navNode({ id: "c", label: "Phones", level: "category" })],
        }),
      ],
      buildCatalogDigest(treeFrom([]))
    );
    const text = navPlanToPromptText(plan);
    expect(text).toContain("Electronics");
    expect(text).toContain("Phones");
    expect(text).not.toContain("brand:acme");
  });

  it("says plainly that there is no plan when the tree is empty", () => {
    const plan = buildNavPlan([], buildCatalogDigest(treeFrom([])));
    expect(navPlanToPromptText(plan)).toContain("no nav plan available");
  });
});
