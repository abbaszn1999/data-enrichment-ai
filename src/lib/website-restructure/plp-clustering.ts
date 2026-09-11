// Deterministic, code-side aggregation of the store's full PLP catalog into a
// compact digest for the IA planner (skill 03). Thousands of raw taxonomy
// titles are never pasted into a prompt — this groups them by shared brand
// name and shared topic tokens, with real counts, so the model reasons over
// a few hundred weighted clusters instead of every individual row.

import type { WrTaxonomyTree, WrTaxonomyTreeNode } from "./types";

export type WrClusterSource = "store" | "growth-engine" | "mixed";

export type WrCatalogCluster = {
  /** Stable id the IA planner references verbatim in `clusterRefs`, e.g.
   *  "brand:gucci" or "topic:women+sunglasses". */
  ref: string;
  label: string;
  plpCount: number;
  productCount: number;
  exampleTitles: string[];
  source: WrClusterSource;
};

export type WrCatalogDigest = {
  totalPlps: number;
  totalProducts: number;
  growthEnginePlps: number;
  growthEngineProducts: number;
  /** The store's own real category tree, when the platform models one
   *  (WooCommerce-style parent/child). Null for flat catalogs (Shopify). */
  hierarchyRoots: WrTaxonomyTreeNode[] | null;
  brandClusters: WrCatalogCluster[];
  topicClusters: WrCatalogCluster[];
  residualClusterCount: number;
  residualPlpCount: number;
  /** Every ref that must be covered by the nav plan: hierarchy leaf refs +
   *  brand + topic cluster refs + (when non-zero) the synthetic residual ref. */
  allClusterRefs: string[];
  /** For a hierarchy leaf ref, its full ancestor chain (leaf first, root
   *  last, all as "hierarchy:<id>" refs) — referencing ANY node in this
   *  chain counts as covering the leaf, since covering a department also
   *  covers what's beneath it. */
  hierarchyAncestryByLeafRef: Record<string, string[]>;
  /** Rolled-up {plpCount, productCount} for EVERY hierarchy node (leaf or
   *  ancestor) keyed by its "hierarchy:<id>" ref, so a plan node that
   *  references a department (not just its leaves) still gets real totals. */
  hierarchyStatsByRef: Record<string, { plpCount: number; productCount: number }>;
  /** Parent ref for every non-root hierarchy node. Because the stats above
   *  are rolled up, summing a ref together with one of its descendants would
   *  count the descendant twice — this lets `nav-plan.ts` drop the redundant
   *  descendant refs before adding anything up. */
  hierarchyParentByRef: Record<string, string>;
};

const RESIDUAL_REF = "residual:long-tail";
const MAX_CLUSTERS_PER_KIND = 200;
const MAX_EXAMPLES_PER_CLUSTER = 5;
const MAX_TOKENS_PER_TITLE = 12;

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "your", "our", "all", "new", "of", "a", "an", "to", "in", "on",
  "by", "at", "is", "are", "this", "that", "under", "over", "up", "out", "best", "top", "shop", "buy",
]);

function slugifyToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Naive singularization — strips a trailing "s" (but not "ss") so "bags"
 *  and "bag" merge into one topic token. Good enough for clustering; not a
 *  real stemmer, and doesn't need to be. */
function singularize(token: string): string {
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

/** Strips prices/measurements ("$40", "12oz") and stopwords, keeping the
 *  meaningful topic tokens from a PLP title, lowercase and singularized. */
function extractTopicTokens(title: string): string[] {
  const cleaned = title
    .toLowerCase()
    .replace(/\$\s?\d+(\.\d+)?/g, " ")
    .replace(/\b\d+(\.\d+)?\s?(oz|ml|kg|g|lb|cm|in|inch|pack)\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ");
  return cleaned
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(singularize);
}

type FlatItem = {
  id: string;
  title: string;
  productCount: number;
  source: "store" | "growth-engine";
  kind: "collection" | "brand";
};

function flattenLeaves(nodes: WrTaxonomyTreeNode[], out: FlatItem[]): void {
  for (const node of nodes) {
    if (node.children.length === 0) {
      out.push({
        id: node.id,
        title: node.title,
        productCount: node.productCount,
        source: node.source ?? "store",
        kind: node.kind ?? "collection",
      });
    } else {
      flattenLeaves(node.children, out);
    }
  }
}

function mergeSource(a: WrClusterSource, b: "store" | "growth-engine"): WrClusterSource {
  if (a === b) return a;
  return "mixed";
}

/** Whole-word match so a short brand like "Lee" does not swallow "Sleeping",
 *  and "Apple" does not swallow "Pineapple". */
function titleMentionsBrand(title: string, brandName: string): boolean {
  const escaped = brandName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(title);
}

/** Aggregates the store's full, uncapped taxonomy list into brand/topic
 *  clusters plus a pass-through of any real category hierarchy. */
export function buildCatalogDigest(tree: WrTaxonomyTree): WrCatalogDigest {
  const roots = tree.allTaxonomies ?? [];
  const hasHierarchy = roots.some((n) => n.children.length > 0 && n.kind !== "brand");

  // Growth-engine collections are almost always flat siblings of a real
  // WooCommerce tree. If they rode along as hierarchy roots they'd each
  // become their own coverage ref — thousands of them — instead of being
  // topic-clustered like they are on Shopify. Brands are pulled out for
  // the same reason (they are not categories).
  const hierarchyRoots = hasHierarchy
    ? roots.filter((n) => n.kind !== "brand" && n.source !== "growth-engine")
    : null;
  const flatRoots = hasHierarchy
    ? roots.filter((n) => n.kind === "brand" || n.source === "growth-engine")
    : roots;

  // Hierarchy ancestry map (leaf -> [leaf, ..., root], all as hierarchy refs)
  // and rolled-up stats per node (post-order: a node's totals include every
  // descendant's, so referencing a department also gets its real weight).
  const hierarchyAncestryByLeafRef: Record<string, string[]> = {};
  const hierarchyStatsByRef: Record<string, { plpCount: number; productCount: number }> = {};
  const hierarchyParentByRef: Record<string, string> = {};
  const hierarchyLeafRefs: string[] = [];
  let hierarchyPlps = 0;
  let hierarchyProducts = 0;
  if (hierarchyRoots) {
    const walk = (
      node: WrTaxonomyTreeNode,
      ancestry: string[]
    ): { plpCount: number; productCount: number } => {
      const ref = `hierarchy:${node.id}`;
      const chain = [ref, ...ancestry];
      if (ancestry[0]) hierarchyParentByRef[ref] = ancestry[0];
      if (node.children.length === 0) {
        hierarchyAncestryByLeafRef[ref] = chain;
        hierarchyLeafRefs.push(ref);
        const stats = { plpCount: 1, productCount: node.productCount };
        hierarchyStatsByRef[ref] = stats;
        return stats;
      }
      const childStats = node.children.map((child) => walk(child, chain));
      const stats = {
        plpCount: childStats.reduce((sum, s) => sum + s.plpCount, 0),
        productCount: node.productCount + childStats.reduce((sum, s) => sum + s.productCount, 0),
      };
      hierarchyStatsByRef[ref] = stats;
      return stats;
    };
    for (const root of hierarchyRoots) {
      const stats = walk(root, []);
      hierarchyPlps += stats.plpCount;
      hierarchyProducts += stats.productCount;
    }
  }

  // Flat items: brand PLPs always flow through here; on a flat (Shopify-style)
  // catalog every collection does too.
  const flatItems: FlatItem[] = [];
  flattenLeaves(flatRoots, flatItems);
  const hierarchyLeaves: FlatItem[] = [];
  if (hierarchyRoots) flattenLeaves(hierarchyRoots, hierarchyLeaves);

  const totalPlps = hierarchyPlps + flatItems.length;
  const totalProducts = hierarchyProducts + flatItems.reduce((sum, i) => sum + i.productCount, 0);
  const growthEngineItems = [
    ...flatItems.filter((i) => i.source === "growth-engine"),
    ...hierarchyLeaves.filter((i) => i.source === "growth-engine"),
  ];
  const growthEnginePlps = growthEngineItems.length;
  const growthEngineProducts = growthEngineItems.reduce((sum, i) => sum + i.productCount, 0);

  // ── Brand clusters ──
  // Every `kind: "brand"` item is its own atomic cluster, plus any
  // collection/category title that mentions the brand name gets folded in so
  // the pillar reflects the brand's true reach across the whole catalog.
  const brandItems = flatItems.filter((i) => i.kind === "brand");
  const nonBrandItems = flatItems.filter((i) => i.kind !== "brand");
  // Hierarchy leaves are scanned for brand mentions (so "Gucci Sunglasses"
  // under WooCommerce Women > Accessories still weights the Gucci pillar)
  // but they are NOT topic-clustered — the hierarchy refs already cover them.
  const mentionItems = [...nonBrandItems, ...hierarchyLeaves];

  // Tokenize once. Scanning every title for every brand name would be
  // brands × titles substring tests — tens of millions on a big store.
  const nonBrandTokens = nonBrandItems.map((item) => Array.from(new Set(extractTopicTokens(item.title))));
  const mentionTokens = mentionItems.map((item) => Array.from(new Set(extractTopicTokens(item.title))));
  const itemIdxByToken = new Map<string, number[]>();
  mentionTokens.forEach((tokens, idx) => {
    for (const token of tokens) {
      const list = itemIdxByToken.get(token);
      if (list) list.push(idx);
      else itemIdxByToken.set(token, [idx]);
    }
  });

  /** Items worth testing against a brand name: those sharing the name's
   *  rarest token. Falls back to everything when the name tokenizes to
   *  nothing (e.g. "H&M") or the index misses (substring without a token). */
  function brandMentionCandidates(brandName: string): number[] {
    const allIdx = () => mentionItems.map((_, i) => i);
    const tokens = Array.from(new Set(extractTopicTokens(brandName)));
    if (tokens.length === 0) return allIdx();
    let rarest: number[] = itemIdxByToken.get(tokens[0]) ?? [];
    for (const token of tokens.slice(1)) {
      const list = itemIdxByToken.get(token) ?? [];
      if (list.length < rarest.length) rarest = list;
    }
    return rarest.length === 0 ? allIdx() : rarest;
  }

  const brandClusterByRef = new Map<
    string,
    { label: string; plpIds: Set<string>; productCount: number; examples: string[]; source: WrClusterSource }
  >();
  for (const brand of brandItems) {
    const ref = `brand:${slugifyToken(brand.title) || brand.id}`;
    const existing = brandClusterByRef.get(ref);
    if (existing) {
      existing.plpIds.add(brand.id);
      existing.productCount += brand.productCount;
      existing.source = mergeSource(existing.source, brand.source);
    } else {
      brandClusterByRef.set(ref, {
        label: brand.title,
        plpIds: new Set([brand.id]),
        productCount: brand.productCount,
        examples: [brand.title],
        source: brand.source,
      });
    }
  }
  // Fold in non-brand titles that literally mention a known brand name.
  for (const cluster of brandClusterByRef.values()) {
    for (const idx of brandMentionCandidates(cluster.label)) {
      const item = mentionItems[idx];
      if (titleMentionsBrand(item.title, cluster.label)) {
        cluster.plpIds.add(item.id);
        cluster.productCount += item.productCount;
        cluster.source = mergeSource(cluster.source, item.source);
        if (cluster.examples.length < MAX_EXAMPLES_PER_CLUSTER && !cluster.examples.includes(item.title)) {
          cluster.examples.push(item.title);
        }
      }
    }
  }

  const brandClusters: WrCatalogCluster[] = Array.from(brandClusterByRef.entries())
    .map(([ref, c]) => ({
      ref,
      label: c.label,
      plpCount: c.plpIds.size,
      productCount: c.productCount,
      exampleTitles: c.examples.slice(0, MAX_EXAMPLES_PER_CLUSTER),
      source: c.source,
    }))
    .sort((a, b) => b.plpCount - a.plpCount || b.productCount - a.productCount);

  // ── Topic clusters (1- and 2-token n-grams across non-brand titles) ──
  const topicClusterByRef = new Map<
    string,
    { label: string; plpIds: Set<string>; productCount: number; examples: string[]; source: WrClusterSource }
  >();
  nonBrandItems.forEach((item, idx) => {
    // Pair generation is quadratic in token count, so an unusually verbose
    // title contributes its leading tokens only — the head of a PLP title is
    // where its topic lives anyway.
    const tokens = nonBrandTokens[idx].slice(0, MAX_TOKENS_PER_TITLE);
    const grams: string[] = [...tokens];
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        grams.push([tokens[i], tokens[j]].sort().join("+"));
      }
    }
    for (const gram of grams) {
      const ref = `topic:${gram}`;
      const existing = topicClusterByRef.get(ref);
      if (existing) {
        existing.plpIds.add(item.id);
        existing.productCount += item.productCount;
        existing.source = mergeSource(existing.source, item.source);
        if (existing.examples.length < MAX_EXAMPLES_PER_CLUSTER && !existing.examples.includes(item.title)) {
          existing.examples.push(item.title);
        }
      } else {
        topicClusterByRef.set(ref, {
          label: gram.replace(/\+/g, " "),
          plpIds: new Set([item.id]),
          productCount: item.productCount,
          examples: [item.title],
          source: item.source,
        });
      }
    }
  });

  const allTopicClusters = Array.from(topicClusterByRef.entries())
    .map(([ref, c]) => ({
      ref,
      label: c.label,
      plpCount: c.plpIds.size,
      productCount: c.productCount,
      exampleTitles: c.examples.slice(0, MAX_EXAMPLES_PER_CLUSTER),
      source: c.source,
    }))
    // A cluster with only one PLP carries no real "shared" signal — every
    // single-token single-PLP cluster is exactly the raw item itself, which
    // just re-inflates the digest back to catalog size. Require at least 2.
    .filter((c) => c.plpCount >= 2)
    .sort((a, b) => b.plpCount - a.plpCount || b.productCount - a.productCount);

  const topicClusters = allTopicClusters.slice(0, MAX_CLUSTERS_PER_KIND);
  const residualTopicClusters = allTopicClusters.slice(MAX_CLUSTERS_PER_KIND);
  const residualBrandCount = Math.max(brandClusters.length - MAX_CLUSTERS_PER_KIND, 0);
  const cappedBrandClusters = brandClusters.slice(0, MAX_CLUSTERS_PER_KIND);

  const residualClusterCount = residualTopicClusters.length + residualBrandCount;
  const residualPlpCount = residualTopicClusters.reduce((sum, c) => sum + c.plpCount, 0);

  const allClusterRefs = [
    ...hierarchyLeafRefs,
    ...cappedBrandClusters.map((c) => c.ref),
    ...topicClusters.map((c) => c.ref),
    ...(residualClusterCount > 0 ? [RESIDUAL_REF] : []),
  ];

  return {
    totalPlps,
    totalProducts,
    growthEnginePlps,
    growthEngineProducts,
    hierarchyRoots,
    brandClusters: cappedBrandClusters,
    topicClusters,
    residualClusterCount,
    residualPlpCount,
    allClusterRefs,
    hierarchyAncestryByLeafRef,
    hierarchyStatsByRef,
    hierarchyParentByRef,
  };
}

function sourceTag(source: WrClusterSource): string {
  return source === "mixed" ? "[store + growth-engine]" : `[${source}]`;
}

function walkHierarchyText(nodes: WrTaxonomyTreeNode[], depth: number, lines: string[]): void {
  for (const node of nodes) {
    const indent = "  ".repeat(depth);
    const tag = sourceTag(node.source ?? "store");
    lines.push(`${indent}- [hierarchy:${node.id}] ${node.title} (${node.productCount} products) ${tag}`);
    if (node.children.length > 0) walkHierarchyText(node.children, depth + 1, lines);
  }
}

/** Renders the digest as compact prompt text for the IA planner (skill 03). */
export function catalogDigestToPromptText(digest: WrCatalogDigest): string {
  const lines: string[] = [];

  lines.push(
    `CATALOG SIZE: ${digest.totalPlps.toLocaleString()} PLPs / ${digest.totalProducts.toLocaleString()} products total across categories, collections, and brand pages.`
  );
  if (digest.growthEnginePlps > 0) {
    lines.push(
      `Of these, ${digest.growthEnginePlps.toLocaleString()} PLPs (${digest.growthEngineProducts.toLocaleString()} products) are long-tail collections this store already generated separately (tagged [growth-engine] below) — legitimate entry-point candidates when they carry real weight, never automatically excluded.`
    );
  }

  if (digest.hierarchyRoots && digest.hierarchyRoots.length > 0) {
    lines.push("", "REAL CATEGORY HIERARCHY (from the store's own structure — trust this as a strong prior):");
    walkHierarchyText(digest.hierarchyRoots, 0, lines);
  }

  if (digest.brandClusters.length > 0) {
    lines.push("", "BRAND CLUSTERS (candidate brand pillars, sorted by reach):");
    for (const c of digest.brandClusters) {
      lines.push(
        `- [${c.ref}] ${c.label} — ${c.plpCount.toLocaleString()} PLPs, ${c.productCount.toLocaleString()} products. Examples: ${c.exampleTitles.map((t) => `"${t}"`).join(", ")} ${sourceTag(c.source)}`
      );
    }
  }

  if (digest.topicClusters.length > 0) {
    lines.push("", "TOPIC CLUSTERS (candidate category/hub pillars, sorted by reach):");
    for (const c of digest.topicClusters) {
      lines.push(
        `- [${c.ref}] ${c.label} — ${c.plpCount.toLocaleString()} PLPs, ${c.productCount.toLocaleString()} products. Examples: ${c.exampleTitles.map((t) => `"${t}"`).join(", ")} ${sourceTag(c.source)}`
      );
    }
  }

  if (digest.residualClusterCount > 0) {
    lines.push(
      "",
      `- [${RESIDUAL_REF}] …and ${digest.residualClusterCount.toLocaleString()} more small/long-tail clusters (~${digest.residualPlpCount.toLocaleString()} PLPs) not listed individually. Give this bucket a sensible home too (e.g. a broad catch-all entry) — do not ignore it.`
    );
  }

  return lines.join("\n");
}

export { RESIDUAL_REF };
