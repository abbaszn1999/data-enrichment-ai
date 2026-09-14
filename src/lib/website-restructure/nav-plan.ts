// Validation, deterministic repair, and prompt rendering for the IA
// planner's output (`WrNavPlan`). The model elects entry points; this file
// is the "don't just trust it" half — depth and coverage are checked in
// code, a depth violation earns one retry (mirroring the RECITATION retry
// already used for header generation), and any coverage gap left after that
// is folded into a generated catch-all node rather than silently dropped.

import type { WrCatalogDigest } from "./plp-clustering";
import { RESIDUAL_REF } from "./plp-clustering";
import { WR_MAX_NAV_CLICK_DEPTH, type WrNavLevel, type WrNavNode, type WrNavPlan } from "./types";

const NAV_LEVEL_ENUM = { type: "string", enum: ["department", "category", "subcategory"] };
const CLUSTER_REFS = { type: "array", items: { type: "string" } };

/**
 * The node schema is spelled out one level at a time rather than recursively,
 * because the 3-click budget IS the schema: the deepest level simply has no
 * `children` property to fill, so the model cannot express a 4th level in the
 * first place (`normalizeNavPlan` treats a missing `children` as a leaf). The
 * runtime depth check in `exceedsMaxDepth` stays as defense anyway — a schema
 * constrains the shape, not the model's willingness to honor it.
 */
export const NAV_NODE_SCHEMA_DEPTH3: Record<string, unknown> = {
  type: "object",
  required: ["id", "label", "level", "clusterRefs"],
  properties: {
    id: { type: "string" },
    label: { type: "string" },
    level: NAV_LEVEL_ENUM,
    clusterRefs: CLUSTER_REFS,
  },
};

const NAV_NODE_SCHEMA_DEPTH2: Record<string, unknown> = {
  type: "object",
  required: ["id", "label", "level", "clusterRefs"],
  properties: {
    id: { type: "string" },
    label: { type: "string" },
    level: NAV_LEVEL_ENUM,
    clusterRefs: CLUSTER_REFS,
    children: { type: "array", items: NAV_NODE_SCHEMA_DEPTH3 },
  },
};

export const NAV_PLAN_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["nodes"],
  properties: {
    nodes: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "label", "level", "clusterRefs"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          level: NAV_LEVEL_ENUM,
          clusterRefs: CLUSTER_REFS,
          children: { type: "array", items: NAV_NODE_SCHEMA_DEPTH2 },
        },
      },
    },
  },
};

type RawNavNode = {
  id?: unknown;
  label?: unknown;
  level?: unknown;
  clusterRefs?: unknown;
  children?: unknown;
};

const LEVEL_BY_DEPTH: WrNavLevel[] = ["department", "category", "subcategory"];

function normalizeNode(raw: RawNavNode, depth: number, path: string): WrNavNode {
  const level = LEVEL_BY_DEPTH.includes(raw.level as WrNavLevel)
    ? (raw.level as WrNavLevel)
    : LEVEL_BY_DEPTH[Math.min(depth, LEVEL_BY_DEPTH.length - 1)];
  const children = Array.isArray(raw.children)
    ? raw.children.map((c, i) => normalizeNode(c as RawNavNode, depth + 1, `${path}-${i}`))
    : [];
  return {
    // Fallback ids are derived from the node's position in the tree, so they
    // are unique across sibling branches and stable across re-parses of the
    // same saved plan (a timestamp would be neither).
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `node-${path}`,
    label: typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : "Untitled",
    level,
    clusterRefs: Array.isArray(raw.clusterRefs) ? raw.clusterRefs.filter((r) => typeof r === "string") : [],
    // Filled in for real by `annotateNavPlanStats` once the plan is final —
    // these placeholders only exist so the type is whole in between steps.
    plpCount: 0,
    productCount: 0,
    children,
  };
}

/** Parses the model's raw JSON into a well-formed `WrNavPlan` (coverage
 *  fields filled in by `validateAndRepairNavPlan`, not here). */
export function normalizeNavPlan(raw: unknown): WrNavNode[] {
  const nodes = raw && typeof raw === "object" ? (raw as { nodes?: unknown }).nodes : undefined;
  if (!Array.isArray(nodes)) return [];
  return nodes.map((n, i) => normalizeNode(n as RawNavNode, 0, String(i)));
}

function treeDepth(nodes: WrNavNode[]): number {
  let max = 0;
  for (const node of nodes) {
    max = Math.max(max, 1 + (node.children.length > 0 ? treeDepth(node.children) : 0));
  }
  return max;
}

export function exceedsMaxDepth(nodes: WrNavNode[]): boolean {
  return treeDepth(nodes) > WR_MAX_NAV_CLICK_DEPTH;
}

/** Deterministically collapses anything deeper than `WR_MAX_NAV_CLICK_DEPTH`
 *  by merging a too-deep node's own clusterRefs (and everything under it)
 *  into its depth-3 ancestor, then dropping the extra nesting. Used only
 *  when the model still violates the depth budget after one retry. */
export function flattenNavPlanDepth(nodes: WrNavNode[], maxDepth = WR_MAX_NAV_CLICK_DEPTH): WrNavNode[] {
  function collectRefs(node: WrNavNode): string[] {
    return [...node.clusterRefs, ...node.children.flatMap(collectRefs)];
  }

  function walk(node: WrNavNode, depth: number): WrNavNode {
    if (depth >= maxDepth) {
      // This node is already at the deepest allowed level — fold every
      // descendant's refs into it and cut off further nesting.
      const mergedRefs = Array.from(new Set([...node.clusterRefs, ...node.children.flatMap(collectRefs)]));
      return { ...node, clusterRefs: mergedRefs, children: [] };
    }
    return { ...node, children: node.children.map((c) => walk(c, depth + 1)) };
  }

  return nodes.map((n) => walk(n, 1));
}

function collectAllRefs(nodes: WrNavNode[], out: Set<string>): void {
  for (const node of nodes) {
    for (const ref of node.clusterRefs) out.add(ref);
    collectAllRefs(node.children, out);
  }
}

/** A hierarchy leaf ref is covered if it, or ANY ancestor in its chain, was
 *  referenced somewhere in the plan — covering a department also covers
 *  everything beneath it. Every other ref needs an exact match. */
function isRefCovered(ref: string, coveredRefs: Set<string>, digest: WrCatalogDigest): boolean {
  if (coveredRefs.has(ref)) return true;
  const chain = digest.hierarchyAncestryByLeafRef[ref];
  if (chain) return chain.some((ancestorRef) => coveredRefs.has(ancestorRef));
  return false;
}

export type NavPlanCoverage = {
  totalClusters: number;
  coveredClusters: number;
  orphanedClusterRefs: string[];
};

export function computeCoverage(nodes: WrNavNode[], digest: WrCatalogDigest): NavPlanCoverage {
  const coveredRefs = new Set<string>();
  collectAllRefs(nodes, coveredRefs);

  const orphaned = digest.allClusterRefs.filter((ref) => !isRefCovered(ref, coveredRefs, digest));
  return {
    totalClusters: digest.allClusterRefs.length,
    coveredClusters: digest.allClusterRefs.length - orphaned.length,
    orphanedClusterRefs: orphaned,
  };
}

/** Deterministic last resort: anything the model left uncovered — after the
 *  one allowed retry — gets folded into a single generated department so
 *  nothing is silently dropped from the plan. */
export function repairCoverageGaps(nodes: WrNavNode[], orphanedClusterRefs: string[]): WrNavNode[] {
  if (orphanedClusterRefs.length === 0) return nodes;
  const catchAll: WrNavNode = {
    id: "more-categories",
    label: "More Categories",
    level: "department",
    clusterRefs: orphanedClusterRefs,
    plpCount: 0,
    productCount: 0,
    children: [],
  };
  return [...nodes, catchAll];
}

type ClusterStats = { plpCount: number; productCount: number };

/** One lookup table per plan, not per node. */
function indexClusterStats(digest: WrCatalogDigest): Map<string, ClusterStats> {
  const byRef = new Map<string, ClusterStats>();
  for (const c of digest.brandClusters) byRef.set(c.ref, { plpCount: c.plpCount, productCount: c.productCount });
  for (const c of digest.topicClusters) byRef.set(c.ref, { plpCount: c.plpCount, productCount: c.productCount });
  for (const [ref, stats] of Object.entries(digest.hierarchyStatsByRef)) byRef.set(ref, stats);
  if (digest.residualClusterCount > 0) {
    byRef.set(RESIDUAL_REF, { plpCount: digest.residualPlpCount, productCount: 0 });
  }
  return byRef;
}

function sumClusterStats(refs: string[], byRef: Map<string, ClusterStats>): ClusterStats {
  let plpCount = 0;
  let productCount = 0;
  for (const ref of refs) {
    const stats = byRef.get(ref);
    if (stats) {
      plpCount += stats.plpCount;
      productCount += stats.productCount;
    }
  }
  return { plpCount, productCount };
}

function subtreeRefs(node: WrNavNode): string[] {
  return [...node.clusterRefs, ...node.children.flatMap(subtreeRefs)];
}

/**
 * Deduplicates refs and drops any hierarchy ref whose ancestor is also in
 * the set: hierarchy stats are rolled up, so counting "Bakery" alongside its
 * own "Bread" would bill Bread twice. Everything else (brand/topic clusters)
 * is already disjoint and only needs the dedupe.
 */
function pruneRedundantRefs(refs: string[], digest: WrCatalogDigest): string[] {
  const unique = new Set(refs);
  return [...unique].filter((ref) => {
    let parent = digest.hierarchyParentByRef[ref];
    while (parent) {
      if (unique.has(parent)) return false;
      parent = digest.hierarchyParentByRef[parent];
    }
    return true;
  });
}

/** Fills in `plpCount`/`productCount` per node from every cluster in its own
 *  subtree, for the builder prompt and any future UI that wants to show
 *  catalog weight per header entry. */
export function annotateNavPlanStats(nodes: WrNavNode[], digest: WrCatalogDigest): WrNavNode[] {
  const byRef = indexClusterStats(digest);
  function walk(node: WrNavNode): WrNavNode {
    const children = node.children.map(walk);
    const stats = sumClusterStats(pruneRedundantRefs(subtreeRefs(node), digest), byRef);
    return { ...node, children, plpCount: stats.plpCount, productCount: stats.productCount };
  }
  return nodes.map(walk);
}

export function buildNavPlan(nodes: WrNavNode[], digest: WrCatalogDigest): WrNavPlan {
  const coverage = computeCoverage(nodes, digest);
  return {
    nodes: annotateNavPlanStats(nodes, digest),
    maxDepth: treeDepth(nodes),
    coverage,
    generatedAt: new Date().toISOString(),
  };
}

function walkPlanText(nodes: WrNavNode[], depth: number, lines: string[]): void {
  for (const node of nodes) {
    const indent = "  ".repeat(depth);
    const count = node.productCount > 0 ? ` (${node.productCount.toLocaleString()} products)` : "";
    lines.push(`${indent}- ${node.label}${count}`);
    if (node.children.length > 0) walkPlanText(node.children, depth + 1, lines);
  }
}

/** Compact text form of the elected nav plan for the header-builder prompt —
 *  labels and nesting only; cluster refs/ids are internal bookkeeping the
 *  builder never needs to see. */
export function navPlanToPromptText(plan: WrNavPlan): string {
  if (plan.nodes.length === 0) return "(no nav plan available — use the store categories below directly)";
  const lines: string[] = ["Header entry points, in header order (build the menu with exactly this structure):"];
  walkPlanText(plan.nodes, 0, lines);
  return lines.join("\n");
}
