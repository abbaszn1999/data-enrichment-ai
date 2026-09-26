import { parse, type HTMLElement } from "node-html-parser";

/**
 * Platform-agnostic reading of a fetched page. Nothing here knows about any
 * specific store or CMS: it reads the standards most product pages publish
 * (JSON-LD, microdata, OpenGraph, product JSON embedded in scripts or served
 * as JSON) plus visible text, links, images and site-search forms.
 */

export interface StructuredProduct {
  source: "json-ld" | "microdata" | "meta" | "embedded-json" | "json";
  name?: string;
  sku?: string[];
  mpn?: string[];
  gtin?: string[];
  barcode?: string[];
  brand?: string;
  price?: string;
  currency?: string;
  description?: string;
  images?: string[];
}

export interface SearchForm {
  /** Fill {query} with the search terms. */
  urlTemplate: string;
}

export interface PageExtract {
  title: string;
  text: string;
  /**
   * Text about the product itself — headings, structured and meta
   * descriptions, the page's product description block — without site
   * navigation, so category menus never count as a description match.
   */
  productText: string;
  links: Array<{ url: string; text: string }>;
  images: string[];
  products: StructuredProduct[];
  searchForms: SearchForm[];
}

const MAX_TEXT = 6_000;
const MAX_PRODUCT_TEXT = 3_000;
const MAX_DESCRIPTION = 400;
const DESCRIPTION_SELECTORS = [
  '[itemprop="description"]',
  ".product-description",
  ".product__description",
  ".product-single__description",
  ".woocommerce-product-details__short-description",
  "#product-description",
  "#tab-description",
  "#description",
  '[class*="product-description"]',
  '[class*="product__description"]',
  '[class*="ProductDescription"]',
].join(", ");
const MAX_LINKS = 80;
const MAX_IMAGES = 60;
const MAX_PRODUCTS = 8;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i;
const SEARCH_PARAM_NAMES = ["q", "s", "search", "query", "keyword", "keywords", "k", "term", "text", "search_query"];

function absolute(raw: string | undefined | null, base: string): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value || value.startsWith("data:") || value.startsWith("javascript:") || value.startsWith("mailto:")) {
    return null;
  }
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function asList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.flatMap(asList);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return asList(record.url ?? record.contentUrl ?? record["@id"] ?? record.name ?? record.value);
  }
  const text = String(value).trim();
  return text ? [text] : [];
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function plainText(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim()
    : "";
}

function productTextFrom(products: StructuredProduct[], extra: string[]): string {
  const parts = [
    ...products.flatMap((product) => [product.name ?? "", product.brand ?? "", product.description ?? ""]),
    ...extra,
  ];
  return uniq(parts.map((part) => part.replace(/\s+/g, " ").trim())).join(" ").slice(0, MAX_PRODUCT_TEXT);
}

function compactProduct(product: StructuredProduct): StructuredProduct | null {
  const cleaned: StructuredProduct = { source: product.source };
  if (product.name) cleaned.name = product.name.slice(0, 200);
  for (const key of ["sku", "mpn", "gtin", "barcode", "images"] as const) {
    const values = uniq(product[key] ?? []).slice(0, key === "images" ? 20 : 10);
    if (values.length > 0) cleaned[key] = values;
  }
  if (product.brand) cleaned.brand = product.brand.slice(0, 100);
  if (product.price) cleaned.price = product.price;
  if (product.currency) cleaned.currency = product.currency;
  if (product.description) cleaned.description = product.description.slice(0, MAX_DESCRIPTION);
  const hasIdentity = cleaned.sku || cleaned.mpn || cleaned.gtin || cleaned.barcode || cleaned.name;
  return hasIdentity ? cleaned : null;
}

/** Collects product-like objects from any JSON value (JSON-LD graphs, product JSON, variants). */
function productsFromJson(value: unknown, source: StructuredProduct["source"], base: string, depth = 0): StructuredProduct[] {
  if (depth > 8 || value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item) => productsFromJson(item, source, base, depth + 1));
  const record = value as Record<string, unknown>;
  const out: StructuredProduct[] = [];
  const type = asList(record["@type"]).join(" ").toLowerCase();
  const variants = Array.isArray(record.variants) ? (record.variants as Record<string, unknown>[]) : [];
  const offers = record.offers && typeof record.offers === "object" ? record.offers : undefined;
  const looksLikeProduct =
    type.includes("product") ||
    "sku" in record ||
    "gtin13" in record ||
    "gtin" in record ||
    "mpn" in record ||
    "barcode" in record ||
    (variants.length > 0 && ("title" in record || "name" in record));
  if (looksLikeProduct) {
    const fromVariants = (key: string) => variants.flatMap((v) => asList(v?.[key]));
    const offerRecords = (Array.isArray(offers) ? offers : offers ? [offers] : []) as Record<string, unknown>[];
    const imageField = record.image ?? record.images ?? record.featured_image;
    const images = asList(imageField)
      .concat(Array.isArray(record.images) ? (record.images as unknown[]).flatMap((img) => asList((img as Record<string, unknown>)?.src ?? img)) : [])
      .map((src) => absolute(src, base))
      .filter((src): src is string => Boolean(src));
    out.push({
      source,
      name: asList(record.name ?? record.title)[0],
      sku: [...asList(record.sku), ...fromVariants("sku"), ...offerRecords.flatMap((o) => asList(o?.sku))],
      mpn: [...asList(record.mpn), ...fromVariants("mpn")],
      gtin: [
        ...["gtin", "gtin8", "gtin12", "gtin13", "gtin14", "ean", "upc", "isbn"].flatMap((key) => asList(record[key])),
        ...offerRecords.flatMap((o) => ["gtin", "gtin13", "gtin12"].flatMap((key) => asList(o?.[key]))),
      ],
      barcode: [...asList(record.barcode), ...fromVariants("barcode")],
      brand: asList(record.brand ?? record.vendor ?? record.manufacturer)[0],
      price: asList(offerRecords[0]?.price ?? record.price)[0],
      currency: asList(offerRecords[0]?.priceCurrency ?? record.currency)[0],
      description: plainText(record.description ?? record.body_html) || undefined,
      images,
    });
  }
  for (const [key, child] of Object.entries(record)) {
    if (key === "variants" || key === "offers") continue;
    if (child && typeof child === "object") out.push(...productsFromJson(child, source, base, depth + 1));
  }
  return out;
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function imageUrlsInJson(value: unknown, base: string, out: Set<string>, depth = 0): void {
  if (depth > 10 || out.size >= MAX_IMAGES * 2) return;
  if (typeof value === "string") {
    if (IMAGE_EXT.test(value)) {
      const url = absolute(value, base);
      if (url) out.add(url);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      imageUrlsInJson(child, base, out, depth + 1);
    }
  }
}

function largestFromSrcset(srcset: string): string | undefined {
  let best: { url: string; size: number } | undefined;
  for (const part of srcset.split(",")) {
    const [url, descriptor] = part.trim().split(/\s+/);
    if (!url) continue;
    const size = Number.parseFloat(descriptor ?? "1") || 1;
    if (!best || size > best.size) best = { url, size };
  }
  return best?.url;
}

function microdataProduct(root: HTMLElement, base: string): StructuredProduct | null {
  const read = (prop: string) =>
    root
      .querySelectorAll(`[itemprop="${prop}"]`)
      .map((el) => el.getAttribute("content") || el.getAttribute("href") || el.getAttribute("src") || el.text)
      .map((value) => value.trim())
      .filter(Boolean);
  const sku = [...read("sku"), ...read("productID")];
  const gtin = ["gtin", "gtin8", "gtin12", "gtin13", "gtin14"].flatMap(read);
  const mpn = read("mpn");
  if (sku.length + gtin.length + mpn.length === 0) return null;
  return {
    source: "microdata",
    name: read("name")[0],
    sku,
    gtin,
    mpn,
    brand: read("brand")[0],
    price: read("price")[0],
    currency: read("priceCurrency")[0],
    description: read("description")[0],
    images: read("image")
      .map((src) => absolute(src, base))
      .filter((src): src is string => Boolean(src)),
  };
}

function metaProduct(root: HTMLElement, base: string): StructuredProduct | null {
  const meta = (key: string) =>
    root.querySelector(`meta[property="${key}"]`)?.getAttribute("content") ??
    root.querySelector(`meta[name="${key}"]`)?.getAttribute("content") ??
    undefined;
  const sku = uniq([meta("product:retailer_item_id"), meta("product:sku"), meta("sku")].filter(Boolean) as string[]);
  const gtin = uniq([meta("product:gtin"), meta("product:ean"), meta("product:upc")].filter(Boolean) as string[]);
  const image = absolute(meta("og:image") ?? meta("og:image:secure_url") ?? meta("twitter:image"), base);
  const name = meta("og:title");
  if (!sku.length && !gtin.length && !image && !name) return null;
  return {
    source: "meta",
    name,
    sku,
    gtin,
    brand: meta("product:brand") ?? meta("og:brand"),
    price: meta("product:price:amount") ?? meta("og:price:amount"),
    currency: meta("product:price:currency") ?? meta("og:price:currency"),
    description: meta("og:description") ?? meta("description"),
    images: image ? [image] : [],
  };
}

/** Code values written as `"sku": "…"` etc. inside any inline script, even when it is not valid JSON on its own. */
function embeddedCodes(scripts: string): StructuredProduct | null {
  const grab = (keys: string) =>
    uniq(
      [...scripts.matchAll(new RegExp(`["'](?:${keys})["']\\s*:\\s*["']([^"'\\\\]{3,40})["']`, "gi"))].map((m) => m[1]!.trim())
    ).slice(0, 20);
  const sku = grab("sku|product_sku|productSku|item_id|itemId");
  const barcode = grab("barcode|ean|upc|gtin|gtin13|gtin12");
  const mpn = grab("mpn|model|model_number|modelNumber|part_number|partNumber");
  if (!sku.length && !barcode.length && !mpn.length) return null;
  return { source: "embedded-json", sku, barcode, mpn };
}

function searchFormsFrom(root: HTMLElement, base: string): SearchForm[] {
  const forms: SearchForm[] = [];
  for (const form of root.querySelectorAll("form")) {
    const method = (form.getAttribute("method") || "get").toLowerCase();
    if (method !== "get") continue;
    const inputs = form.querySelectorAll("input");
    const field =
      inputs.find((input) => (input.getAttribute("type") || "").toLowerCase() === "search") ??
      inputs.find((input) => SEARCH_PARAM_NAMES.includes((input.getAttribute("name") || "").toLowerCase()));
    const name = field?.getAttribute("name");
    if (!name) continue;
    const action = absolute(form.getAttribute("action") || base, base);
    if (!action) continue;
    const url = new URL(action);
    for (const hidden of inputs) {
      const hiddenName = hidden.getAttribute("name");
      if ((hidden.getAttribute("type") || "").toLowerCase() === "hidden" && hiddenName && hiddenName !== name) {
        url.searchParams.set(hiddenName, hidden.getAttribute("value") || "");
      }
    }
    url.searchParams.set(name, "QUERYPLACEHOLDER");
    forms.push({ urlTemplate: url.href.replace("QUERYPLACEHOLDER", "{query}") });
  }
  return uniq(forms.map((f) => f.urlTemplate))
    .slice(0, 3)
    .map((urlTemplate) => ({ urlTemplate }));
}

export function extractJsonPage(text: string, url: string): PageExtract {
  const data = tryJson(text);
  const images = new Set<string>();
  imageUrlsInJson(data, url, images);
  const products = productsFromJson(data, "json", url)
    .map(compactProduct)
    .filter((p): p is StructuredProduct => Boolean(p))
    .slice(0, MAX_PRODUCTS);
  const links = new Set<string>();
  const collectLinks = (value: unknown, depth = 0) => {
    if (depth > 8 || links.size >= MAX_LINKS) return;
    if (typeof value === "string" && /^(https?:)?\/[^\s]*$/.test(value) && !IMAGE_EXT.test(value)) {
      const link = absolute(value, url);
      if (link) links.add(link);
    } else if (value && typeof value === "object") {
      for (const child of Array.isArray(value) ? value : Object.values(value)) collectLinks(child, depth + 1);
    }
  };
  collectLinks(data);
  return {
    title: products[0]?.name ?? "",
    text: text.slice(0, MAX_TEXT),
    productText: productTextFrom(products, []),
    links: [...links].map((link) => ({ url: link, text: "" })),
    images: [...images].slice(0, MAX_IMAGES),
    products,
    searchForms: [],
  };
}

export function extractHtmlPage(html: string, url: string): PageExtract {
  const root = parse(html, { comment: false, blockTextElements: { script: true, style: true, noscript: false } });
  const scripts = root.querySelectorAll("script");
  const products: StructuredProduct[] = [];
  const images = new Set<string>();

  for (const script of scripts) {
    const type = (script.getAttribute("type") || "").toLowerCase();
    const body = script.text || script.innerHTML;
    if (type.includes("ld+json") || type === "application/json") {
      const data = tryJson(body.trim());
      if (data !== undefined) {
        products.push(...productsFromJson(data, type.includes("ld+json") ? "json-ld" : "embedded-json", url));
        imageUrlsInJson(data, url, images);
      }
    }
  }
  const micro = microdataProduct(root, url);
  if (micro) products.push(micro);
  const meta = metaProduct(root, url);
  if (meta) products.push(meta);
  const embedded = embeddedCodes(scripts.map((s) => s.text || s.innerHTML).join("\n"));
  if (embedded) products.push(embedded);

  for (const product of products) for (const image of product.images ?? []) images.add(image);
  for (const img of root.querySelectorAll("img, source")) {
    const srcset = img.getAttribute("srcset") || img.getAttribute("data-srcset");
    const candidates = [
      srcset ? largestFromSrcset(srcset) : undefined,
      img.getAttribute("data-zoom-image"),
      img.getAttribute("data-large_image"),
      img.getAttribute("data-full"),
      img.getAttribute("data-src"),
      img.getAttribute("src"),
    ];
    for (const candidate of candidates) {
      const abs = absolute(candidate, url);
      if (abs) {
        images.add(abs);
        break;
      }
    }
  }
  for (const link of root.querySelectorAll('link[rel="image_src"], a[href]')) {
    const href = link.getAttribute("href");
    if (href && IMAGE_EXT.test(href)) {
      const abs = absolute(href, url);
      if (abs) images.add(abs);
    }
  }

  for (const el of root.querySelectorAll("script, style, noscript, svg, template")) el.remove();
  const title = (root.querySelector("title")?.text || root.querySelector("h1")?.text || "").trim().slice(0, 200);
  const text = root.text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  const headings = root.querySelectorAll("h1").slice(0, 2).map((el) => el.text);
  const metaDescription =
    root.querySelector('meta[property="og:description"]')?.getAttribute("content") ??
    root.querySelector('meta[name="description"]')?.getAttribute("content") ??
    "";
  const descriptionBlocks = root
    .querySelectorAll(DESCRIPTION_SELECTORS)
    .filter((el) => !el.closest("nav, header, footer"))
    .slice(0, 3)
    .map((el) => el.text.slice(0, 1_500));

  const host = new URL(url).hostname;
  const seenLinks = new Set<string>();
  const sameSite: Array<{ url: string; text: string }> = [];
  const external: Array<{ url: string; text: string }> = [];
  for (const anchor of root.querySelectorAll("a[href]")) {
    const href = absolute(anchor.getAttribute("href"), url);
    if (!href || IMAGE_EXT.test(href) || seenLinks.has(href)) continue;
    seenLinks.add(href);
    const entry = { url: href, text: anchor.text.replace(/\s+/g, " ").trim().slice(0, 80) };
    (new URL(href).hostname === host ? sameSite : external).push(entry);
  }

  const compacted = products
    .map(compactProduct)
    .filter((p): p is StructuredProduct => Boolean(p))
    .slice(0, MAX_PRODUCTS);
  return {
    title,
    text,
    productText: productTextFrom(compacted, [...headings, metaDescription.slice(0, MAX_DESCRIPTION), ...descriptionBlocks]),
    links: [...sameSite, ...external].slice(0, MAX_LINKS),
    images: [...images].slice(0, MAX_IMAGES),
    products: compacted,
    searchForms: searchFormsFrom(root, url),
  };
}
