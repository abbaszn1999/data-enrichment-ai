/**
 * Markets (countries) for the Source URLs search. A market is sent to the web
 * search as its `location` parameter (never written into the prompt), so the
 * search runs as a shopper in that country would see it. That is what makes a
 * site that sells in several countries return its page for the right one.
 *
 * Pure (no runtime imports) so the sidebar and the server share one list.
 */

export interface SearchMarket {
  /** Lowercase ISO 3166-1 code, stored in the column's `sourceMarket`. */
  code: string;
  /** The place name sent as the search `location`. */
  name: string;
}

/** `sourceMarket` value meaning "do not set a location". Empty / "auto" means "decide from the website". */
export const MARKET_ANY = "none";
export const MARKET_AUTO = "auto";

export const SEARCH_MARKETS: SearchMarket[] = [
  { code: "ar", name: "Argentina" },
  { code: "au", name: "Australia" },
  { code: "at", name: "Austria" },
  { code: "bh", name: "Bahrain" },
  { code: "be", name: "Belgium" },
  { code: "br", name: "Brazil" },
  { code: "ca", name: "Canada" },
  { code: "cl", name: "Chile" },
  { code: "cn", name: "China" },
  { code: "co", name: "Colombia" },
  { code: "cz", name: "Czechia" },
  { code: "dk", name: "Denmark" },
  { code: "eg", name: "Egypt" },
  { code: "fi", name: "Finland" },
  { code: "fr", name: "France" },
  { code: "de", name: "Germany" },
  { code: "gr", name: "Greece" },
  { code: "hk", name: "Hong Kong" },
  { code: "hu", name: "Hungary" },
  { code: "in", name: "India" },
  { code: "id", name: "Indonesia" },
  { code: "ie", name: "Ireland" },
  { code: "il", name: "Israel" },
  { code: "it", name: "Italy" },
  { code: "jp", name: "Japan" },
  { code: "jo", name: "Jordan" },
  { code: "ke", name: "Kenya" },
  { code: "kw", name: "Kuwait" },
  { code: "lb", name: "Lebanon" },
  { code: "my", name: "Malaysia" },
  { code: "mx", name: "Mexico" },
  { code: "ma", name: "Morocco" },
  { code: "nl", name: "Netherlands" },
  { code: "nz", name: "New Zealand" },
  { code: "ng", name: "Nigeria" },
  { code: "no", name: "Norway" },
  { code: "om", name: "Oman" },
  { code: "pk", name: "Pakistan" },
  { code: "pe", name: "Peru" },
  { code: "ph", name: "Philippines" },
  { code: "pl", name: "Poland" },
  { code: "pt", name: "Portugal" },
  { code: "qa", name: "Qatar" },
  { code: "ro", name: "Romania" },
  { code: "sa", name: "Saudi Arabia" },
  { code: "sg", name: "Singapore" },
  { code: "za", name: "South Africa" },
  { code: "kr", name: "South Korea" },
  { code: "es", name: "Spain" },
  { code: "se", name: "Sweden" },
  { code: "ch", name: "Switzerland" },
  { code: "tw", name: "Taiwan" },
  { code: "th", name: "Thailand" },
  { code: "tr", name: "Türkiye" },
  { code: "ua", name: "Ukraine" },
  { code: "ae", name: "United Arab Emirates" },
  { code: "gb", name: "United Kingdom" },
  { code: "us", name: "United States" },
  { code: "vn", name: "Vietnam" },
];

/** Country-code domain endings that are not the ISO code of the same country, or read differently. */
const TLD_TO_MARKET: Record<string, string> = { uk: "gb" };

/** Two-letter endings that are mostly used as a plain brand domain, so they say nothing about the market. */
const NEUTRAL_TLDS = new Set(["co", "me", "ai", "io", "tv", "fm", "ly", "to", "cc", "ws", "gg"]);

export function findMarket(code: string | undefined): SearchMarket | null {
  const wanted = (code ?? "").trim().toLowerCase();
  return SEARCH_MARKETS.find((market) => market.code === wanted) ?? null;
}

/**
 * The market a website's country-code ending points to: `.co.uk` and `.uk` are
 * the United Kingdom, `.de` Germany, `.com.au` Australia. Anything global
 * (`.com`, `.net`, `.shop`, ...) returns null, because it says nothing about
 * where the shop sells (mamasandpapas.com is a UK store).
 */
export function marketFromDomain(domain: string | null | undefined): SearchMarket | null {
  const labels = (domain ?? "").trim().toLowerCase().split(".");
  if (labels.length < 2) return null;
  const tld = labels[labels.length - 1] ?? "";
  if (tld.length !== 2 || NEUTRAL_TLDS.has(tld)) return null;
  return findMarket(TLD_TO_MARKET[tld] ?? tld);
}

export interface ResolvedMarket {
  market: SearchMarket | null;
  /** True when the market was decided from the website, not picked by the owner. */
  auto: boolean;
}

/**
 * The market a search uses. Empty or "auto" decides from the website's ending;
 * "none" sets no location; a country code uses that country. An unknown code
 * (a hand-edited sheet) sets no location rather than guessing.
 */
export function resolveSearchMarket(setting: string | undefined, website: string | null | undefined): ResolvedMarket {
  const value = (setting ?? "").trim().toLowerCase();
  if (value === "" || value === MARKET_AUTO) return { market: marketFromDomain(website), auto: true };
  if (value === MARKET_ANY) return { market: null, auto: false };
  return { market: findMarket(value), auto: false };
}
