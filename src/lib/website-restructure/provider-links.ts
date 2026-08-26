import type { WrStoreLinks } from "./types";

/**
 * Real store link facts. NOT sent to the agent — every header link it
 * outputs must be a bare "#" (see WR_SKILL_INSTRUCTIONS), so handing it real
 * URLs would only invite it to use one, which is exactly the contradiction
 * this used to create (the taxonomy/store-links prompt text said "use this
 * real URL" while the system instruction said "always use #"). These are
 * still built and threaded through `resolveTaxonomyUrl` purely so the
 * per-project taxonomy snapshot saved to storage carries a real, absolute
 * URL per category, in case a future feature (unrelated to the header
 * generator itself) needs it.
 *
 * Every URL is absolute (built from the store's real `baseUrl`), never a bare
 * relative path, so it never silently resolves against the wrong origin.
 */
export function buildWrStoreLinks(provider: string, baseUrl: string): WrStoreLinks {
  const origin = normalizeBaseUrl(baseUrl);

  if (provider === "woocommerce") {
    return {
      provider,
      baseUrl: origin,
      collectionUrlPattern: `${origin}/product-category/{handle}`,
      homeUrl: `${origin}/`,
      cartUrl: `${origin}/cart`,
      searchUrlPattern: `${origin}/?s={query}`,
    };
  }
  // Default to Shopify's convention — also the safe fallback for an
  // unrecognized provider id, since it's the most common storefront shape.
  return {
    provider: provider || "shopify",
    baseUrl: origin,
    collectionUrlPattern: `${origin}/collections/{handle}`,
    homeUrl: `${origin}/`,
    cartUrl: `${origin}/cart`,
    searchUrlPattern: `${origin}/search?q={query}`,
  };
}

/** Strips a trailing slash and guards against a missing/malformed integration
 *  base URL so a pattern never ends up doubly-slashed or protocol-less. */
function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = (baseUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
