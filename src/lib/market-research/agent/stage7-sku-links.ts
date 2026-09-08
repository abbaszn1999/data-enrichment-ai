/**
 * Stage 7 SKU (product) link targets.
 *
 * Reuses the product-to-collection matches Stage 5 already computed — no new
 * AI call, no web_search. For each article, the collections it already links
 * to (from `buildArticleLinkTargets`) are walked round-robin, picking their
 * best-scoring in-stock products until the cap is reached. A product without
 * a resolvable, verified path is never offered to the writer.
 */

import type {
  ArticleSkuTarget,
  CollectionProductMatch,
  MarketResearchProduct,
  ProposedCollection,
} from "@/components/market-research/workspace-data";

/** Same ceiling as collection links, so a "roundup" article isn't a product dump. */
export const DEFAULT_MAX_SKU_LINKS = 5;

const MAX_ANCHOR_LENGTH = 70;

/**
 * Resolves a product's real, storefront-relative path. Shopify/WooCommerce
 * both write an absolute `url` (`${baseUrl}/products/{handle}` or a full
 * permalink) — only the path survives here so a product link behaves exactly
 * like a collection link: relative, and correct on whatever domain the
 * merchant is actually live on, not whatever domain it was fetched from.
 */
export function productPath(
  product: Pick<MarketResearchProduct, "url" | "handle">
): string {
  const raw = (product.url || "").trim();
  if (raw) {
    if (/^https?:\/\//i.test(raw)) {
      try {
        return new URL(raw).pathname || "";
      } catch {
        // Falls through to the handle-based fallback below.
      }
    } else {
      return raw.startsWith("/") ? raw : `/${raw}`;
    }
  }
  const handle = (product.handle || "").trim();
  return handle ? `/products/${handle}` : "";
}

function clampAnchor(title: string): string {
  const clean = (title || "").replace(/\s+/g, " ").trim();
  if (!clean) return "this product";
  if (clean.length <= MAX_ANCHOR_LENGTH) return clean;
  return `${clean.slice(0, MAX_ANCHOR_LENGTH - 1).trimEnd()}\u2026`;
}

export interface ArticleSkuInput {
  /** Article id -> the proposed-collection ids its collection links point at, in priority order. */
  collectionIdsByArticle: Record<string, string[]>;
  proposedCollections: ProposedCollection[];
  /** All known products, keyed by id, for cheap repeated lookups across articles. */
  productsById: Map<string, MarketResearchProduct>;
  maxPerArticle?: number;
}

/**
 * Builds up to `maxPerArticle` verified product link targets per article, by
 * round-robining across the collections that article already links to and
 * taking each collection's best-scoring untaken, in-stock product in turn.
 */
export function buildArticleSkuTargets(
  input: ArticleSkuInput
): Record<string, ArticleSkuTarget[]> {
  const cap = Math.max(0, input.maxPerArticle ?? DEFAULT_MAX_SKU_LINKS);
  const result: Record<string, ArticleSkuTarget[]> = {};
  const articleIds = Object.keys(input.collectionIdsByArticle);

  if (cap === 0) {
    for (const articleId of articleIds) result[articleId] = [];
    return result;
  }

  const collectionsById = new Map(
    input.proposedCollections.map((collection) => [collection.id, collection])
  );

  for (const articleId of articleIds) {
    const queues: CollectionProductMatch[][] = (
      input.collectionIdsByArticle[articleId] ?? []
    )
      .map((id) => collectionsById.get(id))
      .filter((c): c is ProposedCollection => Boolean(c))
      .map((collection) =>
        [...(collection.productMatches ?? [])].sort((a, b) => b.score - a.score)
      );

    const picks: ArticleSkuTarget[] = [];
    const usedProductIds = new Set<string>();
    const usedUrls = new Set<string>();
    const cursors = new Array(queues.length).fill(0);

    // One pick per collection per round, so a 5-link article draws from every
    // linked collection it can rather than exhausting the first one's list.
    let madeProgressThisRound = true;
    while (picks.length < cap && madeProgressThisRound) {
      madeProgressThisRound = false;
      for (let i = 0; i < queues.length && picks.length < cap; i += 1) {
        const queue = queues[i];
        while (cursors[i] < queue.length) {
          const match = queue[cursors[i]];
          cursors[i] += 1;
          const product = input.productsById.get(match.productId);
          if (!product) continue;
          if (product.inStock === false) continue;
          if (usedProductIds.has(product.id)) continue;
          const path = productPath(product);
          if (!path || usedUrls.has(path)) continue;

          usedProductIds.add(product.id);
          usedUrls.add(path);
          picks.push({
            anchor: clampAnchor(product.title),
            url: path,
            productName: (product.title || "").trim() || "Product",
          });
          madeProgressThisRound = true;
          break;
        }
      }
    }

    result[articleId] = picks;
  }

  return result;
}
