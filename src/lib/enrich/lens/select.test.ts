import { describe, expect, it } from "vitest";
import { buildLensRowContext } from "./product-links";
import { LENS_PER_SITE_MAX, newLensSelection, selectLensPages, siteOf } from "./select";
import { LENS_ALSO_FOUND_MAX, LENS_SET_ASIDE_MAX } from "./side-keys";

type Rules = { allowedDomains: string[]; blockedDomains: string[] };
const open: Rules = { allowedDomains: [], blockedDomains: [] };
const match = (link: string, title = "", extra: { price?: string } = {}) => ({ link, title, ...extra });

function select(
  matches: ReturnType<typeof match>[],
  options: { limit?: number; productsOnly?: boolean; rules?: Rules; row?: ReturnType<typeof buildLensRowContext> } = {}
) {
  const selection = newLensSelection();
  selectLensPages(matches, selection, { rules: options.rules ?? open, limit: options.limit ?? 10, ...options });
  return selection;
}

describe("siteOf", () => {
  it("groups the same store across countries and subdomains", () => {
    expect(siteOf("amazon.ie")).toBe("amazon");
    expect(siteOf("amazon.co.jp")).toBe("amazon");
    expect(siteOf("m.alza.sk")).toBe("alza");
    expect(siteOf("www.ebay.co.uk".replace(/^www\./, ""))).toBe("ebay");
    expect(siteOf("shop.example.com")).toBe("example");
  });

  it("keeps stores on shared platforms apart", () => {
    expect(siteOf("alpha.myshopify.com")).toBe("alpha.myshopify.com");
    expect(siteOf("beta.myshopify.com")).toBe("beta.myshopify.com");
  });
});

describe("selectLensPages", () => {
  it("applies the website rules, drops repeated pages and stops at the limit", () => {
    const { kept, drops } = select(
      [
        match("https://a.test/p/1?utm=1", "A one"),
        match("https://www.a.test/p/1/", "A one again"),
        match("https://blocked.test/p/2", "Blocked"),
        match("https://sub.b.test/p/3", ""),
        match("https://c.test/p/4", "C"),
        match("https://d.test/p/5", "D"),
      ],
      { limit: 3, rules: { allowedDomains: [], blockedDomains: ["blocked.test"] } }
    );
    expect(kept.map((page) => page.uri)).toEqual([
      "https://a.test/p/1?utm=1",
      "https://sub.b.test/p/3",
      "https://c.test/p/4",
    ]);
    expect(kept[1]!.title).toBe("sub.b.test");
    expect(drops.rules).toBe(1);
  });

  it("removes what is certainly not a product page and records why", () => {
    const { kept, setAside, drops } = select([
      match("https://www.youtube.com/watch?v=1", "Video"),
      match("https://alza.test/recenzie/car-1", "Review"),
      match("https://shop.test/", "Home"),
      match("https://shop.test/products/car", "Car"),
    ]);
    expect(kept.map((page) => page.title)).toEqual(["Car"]);
    expect(setAside).toEqual([
      { uri: "https://www.youtube.com/watch?v=1", reason: "site" },
      { uri: "https://alza.test/recenzie/car-1", reason: "listing" },
      { uri: "https://shop.test/", reason: "not_page" },
    ]);
    expect(drops).toEqual({ site: 1, listing: 1, notPage: 1, rules: 0 });
  });

  it("orders priced pages, then product URLs, then unknown and unsure pages", () => {
    const { kept } = select([
      match("https://unknown.test/toy-123.html", "Unknown"),
      match("https://brand.test/collections/toys", "Unsure"),
      match("https://shop.test/products/car", "Car"),
      match("https://priced.test/some-page", "Priced", { price: "€10" }),
    ]);
    expect(kept.map((page) => page.title)).toEqual(["Priced", "Car", "Unknown", "Unsure"]);
    expect(kept[0]!.note).toBe("Price €10");
    expect(kept[1]!.note).toBe("Product page");
    expect(kept[3]!.note).toBe("Check");
  });

  it("keeps at most two pages per website and moves the rest to also found, best first", () => {
    const { kept, alsoFound } = select([
      match("https://www.ebay.co.uk/itm/1", "One"),
      match("https://www.ebay.com/itm/2", "Two"),
      match("https://www.ebay.de/itm/3", "Three"),
      match("https://shop.test/products/x", "Shop"),
    ]);
    expect(LENS_PER_SITE_MAX).toBe(2);
    expect(kept.map((page) => page.title)).toEqual(["One", "Two", "Shop"]);
    expect(alsoFound.map((page) => page.title)).toEqual(["Three"]);
  });

  it("puts good pages beyond the limit under also found", () => {
    const { kept, alsoFound } = select(
      [match("https://a.test/p/1", "A"), match("https://b.test/p/2", "B"), match("https://c.test/p/3", "C")],
      { limit: 2 }
    );
    expect(kept.map((page) => page.title)).toEqual(["A", "B"]);
    expect(alsoFound.map((page) => page.title)).toEqual(["C"]);
  });

  it("ranks pages whose title fits the row above plain unknown pages", () => {
    const row = buildLensRowContext({ DESC: "Spiderman Toy Gun M416 Assault Rifle" });
    const { kept } = select(
      [match("https://a.test/some-page", "Something else"), match("https://b.test/some-page", "Spiderman Toy Gun M416 Assault Rifle")],
      { row }
    );
    expect(kept.map((page) => page.uri)).toEqual(["https://b.test/some-page", "https://a.test/some-page"]);
  });

  it("keeps Google's order, every page and no site limit when product pages only is off", () => {
    const { kept, setAside } = select(
      [
        match("https://shop.test/collections/toys", "List"),
        match("https://www.ebay.com/itm/1", "One"),
        match("https://www.ebay.com/itm/2", "Two"),
        match("https://www.ebay.com/itm/3", "Three"),
        match("https://www.youtube.com/watch?v=1", "Video"),
      ],
      { productsOnly: false }
    );
    expect(kept.map((page) => page.title)).toEqual(["List", "One", "Two", "Three", "Video"]);
    expect(setAside).toEqual([]);
  });

  it("continues a second list without repeating pages or exceeding the site limit", () => {
    const selection = newLensSelection();
    const options = { rules: open, limit: 5 };
    selectLensPages([match("https://www.ebay.com/itm/1", "One"), match("https://a.test/p/1", "A")], selection, options);
    selectLensPages(
      [match("https://www.ebay.com/itm/1", "One again"), match("https://www.ebay.de/itm/2", "Two"), match("https://www.ebay.de/itm/3", "Three")],
      selection,
      options
    );
    expect(selection.kept.map((page) => page.title)).toEqual(["One", "A", "Two"]);
    expect(selection.alsoFound.map((page) => page.title)).toEqual(["Three"]);
  });

  it("caps the extra lists so a row stays small", () => {
    const many = Array.from({ length: 200 }, (_, i) => match(`https://site${i}.test/products/${i}`, `Page ${i}`));
    const junk = Array.from({ length: 100 }, (_, i) => match(`https://www.youtube.com/watch?v=${i}`, "Video"));
    const selection = select([...many, ...junk], { limit: 10 });
    expect(selection.kept).toHaveLength(10);
    expect(selection.alsoFound).toHaveLength(LENS_ALSO_FOUND_MAX);
    expect(selection.setAside).toHaveLength(LENS_SET_ASIDE_MAX);
    expect(selection.drops.site).toBe(100);
  });

  it("truncates long titles and links stored in the extra lists", () => {
    const longTitle = "T".repeat(500);
    const { alsoFound } = select(
      [match("https://a.test/p/1", "A"), match("https://b.test/p/2", longTitle)],
      { limit: 1 }
    );
    expect(alsoFound[0]!.title.length).toBeLessThanOrEqual(120);
  });
});
