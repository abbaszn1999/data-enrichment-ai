import { mapLimit } from "@/lib/async/map-limit";
import { hostMatchesDomain, normalizeDomain } from "../domains";

/**
 * Direct catalog lookup on the stores the owner pointed at (allow list or
 * domains named in the custom instruction). OpenAI's page reader only gets
 * one live read per store per run and many store product pages are missing
 * from its search index, so the exact product often can't be reached from
 * inside the model. Shopify stores answer `/search/suggest.json` by SKU or
 * barcode and `/products/<handle>.json` with every gallery image; a product
 * is returned only when one of its variants' SKU or barcode equals a row
 * identifier exactly. Non-Shopify stores simply yield nothing.
 */

const REQUEST_TIMEOUT_MS = 6_000;
const MAX_STORES = 5;
const MAX_IDENTIFIERS = 4;
const MAX_HANDLES_PER_STORE = 4;
const MAX_MATCHES = 3;
const MAX_IMAGES_PER_MATCH = 10;

export interface StoreCatalogMatch {
  pageUrl: string;
  title: string;
  vendor: string;
  skus: string[];
  barcodes: string[];
  imageUrls: string[];
}

/** Values that look like a SKU, model code or barcode — not prices, quantities or phrases. */
export function extractIdentifiers(rowData: Record<string, string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of Object.values(rowData)) {
    const value = String(raw ?? "").trim();
    if (value.length < 5 || value.length > 40 || /\s/.test(value)) continue;
    if (!/\d/.test(value) || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)) continue;
    if (/^\d+$/.test(value) ? value.length < 8 || value.length > 14 : /^[\d.,-]+$/.test(value)) {
      continue;
    }
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= MAX_IDENTIFIERS) break;
  }
  return out;
}

/** Allowed websites first, then any website named in the custom instruction; never a blocked one. */
export function storeDomainsToQuery(input: {
  allowedDomains: string[];
  blockedDomains: string[];
  customInstruction?: string;
}): string[] {
  const named = (input.customInstruction ?? "")
    .split(/[\s,;()<>"']+/)
    .filter((token) => /[a-z0-9-]\.[a-z]{2,}/i.test(token))
    .map((token) => normalizeDomain(token))
    .filter((domain): domain is string => Boolean(domain));
  const out: string[] = [];
  for (const domain of [...input.allowedDomains, ...named]) {
    if (out.includes(domain)) continue;
    if (input.blockedDomains.some((blocked) => hostMatchesDomain(domain, blocked))) continue;
    out.push(domain);
    if (out.length >= MAX_STORES) break;
  }
  return out;
}

async function getJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    if (!(response.headers.get("content-type") || "").includes("json")) return null;
    const body = (await response.json()) as unknown;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function searchStoreHandles(domain: string, identifier: string): Promise<string[]> {
  const query = new URLSearchParams({
    q: identifier,
    "resources[type]": "product",
    "resources[limit]": String(MAX_HANDLES_PER_STORE),
  });
  const body = await getJson(`https://${domain}/search/suggest.json?${query}`);
  const results = (body?.resources as { results?: { products?: unknown[] } } | undefined)?.results;
  const handles: string[] = [];
  for (const product of results?.products ?? []) {
    const handle = (product as { handle?: unknown })?.handle;
    if (typeof handle === "string" && /^[a-z0-9][a-z0-9-]*$/i.test(handle)) handles.push(handle);
  }
  return handles;
}

async function readStoreProduct(
  domain: string,
  handle: string,
  identifiers: Set<string>
): Promise<StoreCatalogMatch | null> {
  const body = await getJson(`https://${domain}/products/${handle}.json`);
  const product = body?.product as
    | {
        title?: string;
        vendor?: string;
        variants?: Array<{ sku?: string | null; barcode?: string | null }>;
        images?: Array<{ src?: string }>;
      }
    | undefined;
  if (!product) return null;
  const variants = product.variants ?? [];
  const skus = [...new Set(variants.map((v) => String(v.sku ?? "").trim()).filter(Boolean))];
  const barcodes = [...new Set(variants.map((v) => String(v.barcode ?? "").trim()).filter(Boolean))];
  const matched = [...skus, ...barcodes].some((code) => identifiers.has(code.toLowerCase()));
  if (!matched) return null;
  const imageUrls = [
    ...new Set(
      (product.images ?? [])
        .map((image) => String(image.src ?? "").trim())
        .filter((src) => /^https:\/\//i.test(src))
    ),
  ].slice(0, MAX_IMAGES_PER_MATCH);
  if (imageUrls.length === 0) return null;
  return {
    pageUrl: `https://${domain}/products/${handle}`,
    title: String(product.title ?? "").trim(),
    vendor: String(product.vendor ?? "").trim(),
    skus,
    barcodes,
    imageUrls,
  };
}

async function lookupStore(domain: string, identifiers: string[]): Promise<StoreCatalogMatch[]> {
  const handleLists = await mapLimit(identifiers, 2, (identifier) =>
    searchStoreHandles(domain, identifier)
  );
  const handles = [...new Set(handleLists.flat())].slice(0, MAX_HANDLES_PER_STORE);
  if (handles.length === 0) return [];
  const wanted = new Set(identifiers.map((id) => id.toLowerCase()));
  const products = await mapLimit(handles, 2, (handle) => readStoreProduct(domain, handle, wanted));
  return products.filter((match): match is StoreCatalogMatch => match !== null);
}

export async function lookupStoreCatalog(input: {
  rowData: Record<string, string>;
  allowedDomains: string[];
  blockedDomains: string[];
  customInstruction?: string;
}): Promise<StoreCatalogMatch[]> {
  const identifiers = extractIdentifiers(input.rowData);
  const domains = storeDomainsToQuery(input);
  if (identifiers.length === 0 || domains.length === 0) return [];
  const perStore = await mapLimit(domains, 3, (domain) => lookupStore(domain, identifiers));
  const seen = new Set<string>();
  return perStore
    .flat()
    .filter((match) => {
      const key = match.pageUrl.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_MATCHES);
}
