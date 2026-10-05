/**
 * Tells product pages from everything else Google Lens returns for a picture
 * (videos, social posts, review pages, category lists, stock-photo sites).
 * Only what is clearly not a product page is dropped; a page that merely
 * looks unfamiliar is kept and ranked after the ones that look like products,
 * so a real product on an unusual URL is never lost.
 */
import { isNonProductHost } from "../image-finder/exact/links-checks";
import type { LensMatch } from "./searchapi-lens";

export type LensDropReason = "site" | "listing" | "not_page";

/** 0 = Google lists a price or stock for it, 1 = the URL looks like a product page, 2 = unknown. */
export type LensLinkTier = 0 | 1 | 2;

export interface LensLinkVerdict {
  drop?: LensDropReason;
  tier: LensLinkTier;
}

const EXTRA_NON_PRODUCT_HOSTS: RegExp[] = [
  /(^|\.)(x|twitter)\.com$/i,
  /(^|\.)linkedin\.com$/i,
  /(^|\.)flickr\.com$/i,
  /(^|\.)imgur\.com$/i,
  /(^|\.)medium\.com$/i,
  /(^|\.)shutterstock\.com$/i,
  /(^|\.)istockphoto\.com$/i,
  /(^|\.)gettyimages\.[a-z.]+$/i,
  /(^|\.)alamy\.com$/i,
  /(^|\.)dreamstime\.com$/i,
  /(^|\.)depositphotos\.com$/i,
  /(^|\.)123rf\.com$/i,
  /(^|\.)freepik\.com$/i,
  /(^|\.)pngtree\.com$/i,
  /(^|\.)vecteezy\.com$/i,
  /(^|\.)archive\.org$/i,
];

const FILE_EXTENSION = /\.(pdf|jpe?g|png|gif|webp|avif|svg|bmp|mp4|mov|webm|mp3|zip)$/i;

/** A path segment that names a product page in the languages catalogs come in. */
const PRODUCT_SEGMENTS = new Set([
  "product", "products", "produkt", "produkty", "producto", "productos", "produto", "produtos",
  "produit", "produits", "prodotto", "prodotti", "proizvod", "proizvodi", "urun", "goods",
  "item", "items", "itm", "dp", "ip", "p", "pd", "sku", "listing", "up",
]);
const PRODUCT_SEGMENT_PREFIX = /^(product|produkt|producto|produit|prodotto|proizvod|item)[-_]/;

/** Segments that name a list, an article, a review or a utility page rather than one product. */
const NON_PRODUCT_SEGMENTS = new Set([
  "blog", "blogs", "news", "article", "articles", "video", "videos", "watch", "forum", "forums",
  "review", "reviews", "recenzie", "recenze", "recensione", "recensioni", "rezension", "rezensionen",
  "exhibitor", "exhibitors", "search", "cart", "checkout", "login", "signin", "account", "wishlist",
  "tag", "tags", "category", "categories", "collection", "collections", "brand", "brands",
  "manufacturer", "manufacturers", "vendor", "vendors", "wiki", "questions", "faq", "help",
  "support", "about", "contact", "press", "stories", "gallery",
]);

const SEARCH_PARAMS = ["q", "s", "search", "query", "keyword", "keywords", "page", "sort", "filter"];

function hasProductSegment(segments: string[]): boolean {
  return segments.some((segment) => PRODUCT_SEGMENTS.has(segment) || PRODUCT_SEGMENT_PREFIX.test(segment));
}

export function classifyLensLink(match: Pick<LensMatch, "link" | "price" | "inStock">): LensLinkVerdict {
  let url: URL;
  try {
    url = new URL(match.link);
  } catch {
    return { drop: "not_page", tier: 2 };
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (isNonProductHost(host) || EXTRA_NON_PRODUCT_HOSTS.some((pattern) => pattern.test(host))) {
    return { drop: "site", tier: 2 };
  }
  const path = url.pathname.toLowerCase();
  if (!path || path === "/" || FILE_EXTENSION.test(path)) return { drop: "not_page", tier: 2 };

  if (match.price || match.inStock) return { tier: 0 };

  const segments = path.split("/").filter(Boolean);
  if (hasProductSegment(segments)) return { tier: 1 };

  if (segments.some((segment) => NON_PRODUCT_SEGMENTS.has(segment))) return { drop: "listing", tier: 2 };
  if (SEARCH_PARAMS.some((param) => url.searchParams.has(param))) return { drop: "listing", tier: 2 };
  return { tier: 2 };
}
