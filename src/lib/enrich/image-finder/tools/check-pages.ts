import type { EnrichFunctionTool } from "../../openai";
import type { PageSession } from "./fetch-page";

export const CHECK_PAGES_TOOL_NAME = "check_pages";
export const CHECK_PAGES_MAX_URLS = 15;

const MAX_TITLE_OUT = 140;
const MAX_NAME_OUT = 140;

/**
 * Quick check of many candidate pages at once. Every page is opened and
 * recorded in full (same evidence as fetch_page, same budgets), but the model
 * only gets one short line per page — enough to spot the real hits without
 * paying to re-read whole pages on every later round.
 */
export function createCheckPagesTool(session: PageSession): EnrichFunctionTool {
  return {
    name: CHECK_PAGES_TOOL_NAME,
    description: `Quick-check up to ${CHECK_PAGES_MAX_URLS} candidate pages in one call (search results, listing links, product pages from several stores). Each page is opened live; you get one short summary per page: status, title, product name, brand, price, which of this row's identifiers it shows, near codes (the row code plus or minus trailing letters) and how many images it has. Use fetch_page afterwards on the few pages worth reading in full.`,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          description: `Full http(s) URLs to check, at most ${CHECK_PAGES_MAX_URLS}.`,
        },
      },
      required: ["urls"],
    },
    run: async (args) => {
      const requested = Array.isArray(args.urls) ? args.urls.map((url) => String(url ?? "").trim()) : [];
      const urls = [...new Set(requested.filter(Boolean))];
      const extra = urls.length - CHECK_PAGES_MAX_URLS;
      const results = await Promise.all(
        urls.slice(0, CHECK_PAGES_MAX_URLS).map(async (url) => {
          const opened = await session.open(url);
          if (opened.refused !== undefined) return { url, error: opened.refused };
          const { page, seen, near } = opened;
          if (!page.extract) {
            return { url, status: page.status, error: page.error ?? `The page returned HTTP ${page.status}.` };
          }
          const product = page.extract.products.find((item) => item.name) ?? page.extract.products[0];
          return {
            url,
            ...(page.finalUrl !== url ? { finalUrl: page.finalUrl } : {}),
            status: page.status,
            title: page.extract.title.slice(0, MAX_TITLE_OUT),
            ...(product?.name ? { product: product.name.slice(0, MAX_NAME_OUT) } : {}),
            ...(product?.brand ? { brand: product.brand } : {}),
            ...(product?.price ? { price: `${product.price}${product.currency ? ` ${product.currency}` : ""}` } : {}),
            rowIdentifiersSeen: seen.map((identifier) => identifier.value),
            ...(near.length > 0 ? { nearCodesSeen: [...new Set(near.map((match) => match.pageCode))] } : {}),
            images: page.extract.images.length,
          };
        }),
      );
      return JSON.stringify({
        pages: results,
        ...(extra > 0 ? { skipped: `${extra} URLs over the limit of ${CHECK_PAGES_MAX_URLS} were not checked.` } : {}),
        pagesLeftForThisProduct: session.pagesLeft(),
      });
    },
  };
}
