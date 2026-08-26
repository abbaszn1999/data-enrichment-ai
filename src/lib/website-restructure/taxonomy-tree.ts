import type { NavigationMenu, TaxonomySummary } from "@/lib/sync/core/types";
import type { WrStoreLinks, WrTaxonomyTree, WrTaxonomyTreeNode } from "./types";

// `taxonomy.list()` can return up to 5000 groups — too much for a prompt and
// useless for a header, which realistically shows a handful of top-level
// links plus a couple of dropdown columns. Keeping the top N by product count
// and folding the rest behind a count lets the agent reason about scale
// ("this store has 40 more categories under X") without paying for every row.
const MAX_TOP_TAXONOMIES = 150;

type FlatNavItem = { title: string; url: string; children?: FlatNavItem[] };

/** A provider's real navigation URL can itself be relative (Shopify's menu
 *  API commonly returns "/collections/all" rather than a full URL) — make it
 *  absolute against the store's own domain so it behaves the same inside the
 *  preview (served from our origin) as it will once embedded on the store. */
function absolutizeStoreUrl(url: string, baseUrl: string): string {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (!baseUrl) return url;
  return `${baseUrl}${url.startsWith("/") ? "" : "/"}${url}`;
}

function navigationItemToNode(item: FlatNavItem, baseUrl: string): WrTaxonomyTreeNode {
  const url = item.url ? absolutizeStoreUrl(item.url, baseUrl) : undefined;
  return {
    id: url || item.title,
    title: item.title,
    productCount: 0,
    url,
    children: Array.isArray(item.children)
      ? item.children.map((child) => navigationItemToNode(child, baseUrl))
      : [],
  };
}

/**
 * Resolves the one real, ready-to-use link for a taxonomy group so the agent
 * never has to guess or reassemble one itself: a provider-supplied URL
 * (WooCommerce's `link`) wins outright, otherwise a handle (Shopify) is
 * substituted into the store's known (already-absolute) collection URL
 * pattern. Groups with neither get no link at all rather than a fabricated
 * one.
 */
function resolveTaxonomyUrl(t: TaxonomySummary, storeLinks: WrStoreLinks): string | undefined {
  if (t.url) return absolutizeStoreUrl(t.url, storeLinks.baseUrl);
  if (t.handle) return storeLinks.collectionUrlPattern.replace("{handle}", t.handle);
  return undefined;
}

/** Flattens every real navigation menu's items into a tree the prompt can read. */
export function navigationMenusToTree(menus: NavigationMenu[], baseUrl: string): WrTaxonomyTreeNode[] {
  const out: WrTaxonomyTreeNode[] = [];
  for (const menu of menus) {
    for (const item of menu.items) {
      out.push(navigationItemToNode(item, baseUrl));
    }
  }
  return out;
}

/**
 * Builds a parent/child tree from WooCommerce-style flat taxonomies (which
 * carry `parent`), or a flat list of top nodes for providers with no
 * hierarchy (Shopify collections). Keeps only the top `MAX_TOP_TAXONOMIES` by
 * product count; the rest are summarized as `overflowCount`.
 */
export function compressTaxonomyTree(
  taxonomies: TaxonomySummary[],
  storeLinks: WrStoreLinks,
  maxTop: number = MAX_TOP_TAXONOMIES
): { topTaxonomies: WrTaxonomyTreeNode[]; overflowCount: number } {
  const sorted = [...taxonomies].sort((a, b) => b.productCount - a.productCount);
  const kept = sorted.slice(0, maxTop);
  const overflowCount = Math.max(sorted.length - kept.length, 0);

  const hasHierarchy = kept.some((t) => t.parent);
  if (!hasHierarchy) {
    return {
      topTaxonomies: kept.map((t) => ({
        id: t.id,
        title: t.title,
        productCount: t.productCount,
        url: resolveTaxonomyUrl(t, storeLinks),
        children: [],
      })),
      overflowCount,
    };
  }

  const nodeById = new Map<string, WrTaxonomyTreeNode>();
  for (const t of kept) {
    nodeById.set(t.id, {
      id: t.id,
      title: t.title,
      productCount: t.productCount,
      url: resolveTaxonomyUrl(t, storeLinks),
      children: [],
    });
  }
  const roots: WrTaxonomyTreeNode[] = [];
  for (const t of kept) {
    const node = nodeById.get(t.id)!;
    const parent = t.parent ? nodeById.get(t.parent) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return { topTaxonomies: roots, overflowCount };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Market Research pushes the collections it generates to the store titled
 * `${prefix} - ${name}` ("AI - Electronics Smartphones"). They exist to catch
 * search traffic, not to be storefront navigation, and because they hold a
 * whole niche's products they dominate a product-count sort — burying the
 * merchant's own real categories. A header built from them would name the
 * same thing six slightly different ways, so they are dropped before the
 * agent ever sees the list.
 */
export function isGeneratedCollectionTitle(title: string, prefix: string | undefined): boolean {
  const p = (prefix || "").trim();
  const clean = (title || "").trim();
  if (!p || !clean) return false;
  const escaped = escapeRegex(p);
  return (
    new RegExp(`^${escaped}\\s*[-–—:|]\\s*`, "i").test(clean) ||
    new RegExp(`^${escaped}\\s+`, "i").test(clean)
  );
}

export function buildWrTaxonomyTree(input: {
  taxonomies: TaxonomySummary[];
  navigationMenus: NavigationMenu[] | null;
  navigationUnavailableReason?: string;
  storeLinks: WrStoreLinks;
  /** The workspace's Market Research naming prefix, whose collections are
   *  excluded from the header's category list. */
  generatedCollectionPrefix?: string;
}): WrTaxonomyTree {
  const ownTaxonomies = input.generatedCollectionPrefix
    ? input.taxonomies.filter(
        (t) => !isGeneratedCollectionTitle(t.title, input.generatedCollectionPrefix)
      )
    : input.taxonomies;
  const { topTaxonomies, overflowCount } = compressTaxonomyTree(ownTaxonomies, input.storeLinks);
  return {
    navigation: input.navigationMenus
      ? navigationMenusToTree(input.navigationMenus, input.storeLinks.baseUrl)
      : null,
    topTaxonomies,
    overflowCount,
    navigationUnavailableReason: input.navigationUnavailableReason,
  };
}

/** Compact text form for the prompt — cheaper than raw JSON and easier for
 *  the model to skim than deeply nested objects.
 *
 *  Deliberately never prints `node.url`: every header link is required to be
 *  a bare "#" (see WR_SKILL_INSTRUCTIONS), so handing the agent a real,
 *  copy-pasteable URL here would just contradict that rule and invite it to
 *  use one anyway. Only the name/hierarchy/count — what the agent actually
 *  needs to write realistic nav labels — is included. */
export function taxonomyTreeToPromptText(tree: WrTaxonomyTree): string {
  const lines: string[] = [];

  function walk(nodes: WrTaxonomyTreeNode[], depth: number) {
    for (const node of nodes) {
      const indent = "  ".repeat(depth);
      const count = node.productCount > 0 ? ` (${node.productCount} products)` : "";
      lines.push(`${indent}- ${node.title}${count}`);
      if (node.children.length > 0) walk(node.children, depth + 1);
    }
  }

  if (tree.navigation && tree.navigation.length > 0) {
    lines.push("Real storefront navigation:");
    walk(tree.navigation, 0);
  } else if (tree.navigationUnavailableReason) {
    // `navigationUnavailableReason` is written for the merchant (it walks them
    // through granting a Shopify scope); the agent only needs to know that it
    // has to derive the menu from the category list instead of a real menu.
    lines.push(
      "The store's real menu structure is not available, so group the categories below into a sensible menu yourself."
    );
  }

  if (tree.topTaxonomies.length > 0) {
    lines.push(tree.navigation ? "\nTop store categories:" : "Top store categories:");
    walk(tree.topTaxonomies, 0);
  }

  if (tree.overflowCount > 0) {
    lines.push(`\n…and ${tree.overflowCount} more categories not listed here.`);
  }

  return lines.join("\n");
}
