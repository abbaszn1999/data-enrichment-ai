import { describe, expect, it } from "vitest";
import { DEFAULT_SOURCE_URLS_INSTRUCTION } from "@/types";
import {
  buildSiteSourceUrlsQuery,
  cleanSiteLink,
  describeSiteMiss,
  simplifySiteFields,
  siteFieldsOf,
  SITE_MAX_FIELDS,
  SITE_MAX_FIELD_CHARS,
  pickSitePage,
  joinDomains,
  siteDomainsOf,
  siteInstructionOf,
  siteLinkProblem,
  siteLinkProblemOn,
  SITE_INSTRUCTION_MAX_CHARS,
} from "./site";

const DOMAIN = "mamasandpapas.com";
const PRODUCT = "https://www.mamasandpapas.com/products/check-jacket-3-6-s07fn6db4";

const example = {
  SKU: "S07FN6DB5",
  Description: "CHECK JACKET BROWN 6-9M",
  Barcode: "5063229294815",
  Size: "6-9M",
  Image: "https://cdn.example.com/a.jpg",
};

describe("siteDomainsOf", () => {
  it("reduces a pasted link to the bare website and rejects what is not one", () => {
    expect(siteDomainsOf("https://www.MamasAndPapas.com/products/x?y=1")).toEqual([DOMAIN]);
    expect(siteDomainsOf("  mamasandpapas.co.uk ")).toEqual(["mamasandpapas.co.uk"]);
    expect(siteDomainsOf("")).toEqual([]);
    expect(siteDomainsOf(undefined)).toEqual([]);
    expect(siteDomainsOf("javascript:alert(1)")).toEqual([]);
  });

  it("takes up to three websites, in the order typed, without repeats", () => {
    expect(siteDomainsOf("mamasandpapas.com, https://www.mintvelvet.co.uk/x\nmamasandpapas.com allbirds.com")).toEqual([
      DOMAIN,
      "mintvelvet.co.uk",
      "allbirds.com",
    ]);
    expect(siteDomainsOf("a.com, b.com, c.com, d.com")).toEqual(["a.com", "b.com", "c.com"]);
  });
});

describe("joinDomains", () => {
  it("reads as a short list", () => {
    expect(joinDomains([])).toBe("");
    expect(joinDomains(["a.com"])).toBe("a.com");
    expect(joinDomains(["a.com", "b.com"])).toBe("a.com or b.com");
    expect(joinDomains(["a.com", "b.com", "c.com"])).toBe("a.com, b.com or c.com");
  });
});

describe("siteFieldsOf", () => {
  it("sends the source columns as the sheet has them: header and value, in sheet order", () => {
    expect(siteFieldsOf(example)).toEqual([
      { label: "SKU", value: "S07FN6DB5" },
      { label: "Description", value: "CHECK JACKET BROWN 6-9M" },
      { label: "Barcode", value: "5063229294815" },
      { label: "Size", value: "6-9M" },
    ]);
  });

  it("never reads the header for meaning: any language, any layout", () => {
    const fields = siteFieldsOf({ Artikelbezeichnung: "Akku-Bohrschrauber 18V", EAN: "4006381333931", __EMPTY_2: "BS-18-LI", Farbe: "Blau" });
    expect(fields.map((f) => `${f.label}: ${f.value}`)).toEqual([
      "Artikelbezeichnung: Akku-Bohrschrauber 18V",
      "EAN: 4006381333931",
      "Col 2: BS-18-LI",
      "Farbe: Blau",
    ]);
  });

  it("leaves out empty values and image columns, and caps how much one row sends", () => {
    expect(siteFieldsOf({ A: "", B: "  ", Photo: "https://cdn.example.com/a.jpg", C: "[2 images attached]", Title: "Widget" })).toEqual([
      { label: "Title", value: "Widget" },
    ]);
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`F${i}`, "x".repeat(400)]));
    const fields = siteFieldsOf(many);
    expect(fields).toHaveLength(SITE_MAX_FIELDS);
    expect(fields.every((f) => f.value.length <= SITE_MAX_FIELD_CHARS)).toBe(true);
  });

  it("strips HTML from a value", () => {
    expect(siteFieldsOf({ Description: "<p>Soft &amp; warm <b>jacket</b></p>" })[0]?.value).toBe("Soft & warm jacket");
  });
});

describe("simplifySiteFields", () => {
  it("keeps the name and any barcode by the shape of the value, and drops codes and sizes", () => {
    const simple = simplifySiteFields(siteFieldsOf(example));
    expect(simple.map((f) => f.label)).toEqual(["Description", "Barcode"]);
  });

  it("works whatever the headers are called", () => {
    const simple = simplifySiteFields(
      siteFieldsOf({ Col1: "BS-18-LI", Col2: "Akku-Bohrschrauber 18V", Col3: "4006 3813 33931", Col4: "Blau" })
    );
    expect(simple.map((f) => f.value)).toEqual(["Akku-Bohrschrauber 18V", "4006 3813 33931"]);
  });

  it("uses a one-word name when that is all the row has, and nothing when it has no name or barcode", () => {
    expect(simplifySiteFields(siteFieldsOf({ X: "Widget", Y: "W-1" })).map((f) => f.value)).toEqual(["Widget"]);
    expect(simplifySiteFields(siteFieldsOf({ X: "W-1", Y: "12" }))).toEqual([]);
  });
});

describe("buildSiteSourceUrlsQuery", () => {
  it("is one fixed sentence around the source columns, as typed", () => {
    expect(buildSiteSourceUrlsQuery({ rowData: example, domains: [DOMAIN] })).toBe(
      [
        "mamasandpapas.com product page for this item:",
        "- SKU: S07FN6DB5",
        "- Description: CHECK JACKET BROWN 6-9M",
        "- Barcode: 5063229294815",
        "- Size: 6-9M",
        "Return the mamasandpapas.com product page link only.",
      ].join("\n")
    );
  });

  it("names every website in the same one request when there are several", () => {
    expect(buildSiteSourceUrlsQuery({ rowData: { SKU: "S07FN6DB5" }, domains: [DOMAIN, "mintvelvet.co.uk"] })).toBe(
      [
        "mamasandpapas.com or mintvelvet.co.uk product page for this item:",
        "- SKU: S07FN6DB5",
        "Return the product page link only, from mamasandpapas.com or mintvelvet.co.uk.",
      ].join("\n")
    );
    expect(
      buildSiteSourceUrlsQuery({ rowData: { SKU: "S1" }, domains: ["a.com", "b.com", "c.com"], customInstruction: "Brown." })
    ).toContain("a.com, b.com or c.com product page for this item:");
  });

  it("works for a sheet with unfamiliar headers", () => {
    expect(
      buildSiteSourceUrlsQuery({ rowData: { Artikelbezeichnung: "Akku-Bohrschrauber 18V", EAN: "4006381333931" }, domains: ["acme.de"] })
    ).toBe(
      "acme.de product page for this item:\n- Artikelbezeichnung: Akku-Bohrschrauber 18V\n- EAN: 4006381333931\nReturn the acme.de product page link only."
    );
  });

  it("says so plainly when the row has nothing to send", () => {
    expect(buildSiteSourceUrlsQuery({ rowData: { A: "" }, domains: ["acme.com"] })).toContain("(no product details were provided)");
  });

  it("has no JSON request, no shouting and no rulebook", () => {
    const query = buildSiteSourceUrlsQuery({ rowData: example, domains: [DOMAIN], customInstruction: "Prefer the brown one." });
    expect(query).not.toMatch(/json|critical|priority|sources|\{|\}/i);
    expect(query.length).toBeLessThan(500);
  });

  it("adds the owner's note after the request, short, and skips the default text", () => {
    const query = buildSiteSourceUrlsQuery({ rowData: example, domains: [DOMAIN], customInstruction: "Prefer the brown one." });
    const lines = query.split("\n");
    expect(lines[lines.length - 2]).toBe("Return the mamasandpapas.com product page link only.");
    expect(lines[lines.length - 1]).toBe("Note: Prefer the brown one.");

    expect(siteInstructionOf(DEFAULT_SOURCE_URLS_INSTRUCTION)).toBe("");
    expect(buildSiteSourceUrlsQuery({ rowData: example, domains: [DOMAIN], customInstruction: DEFAULT_SOURCE_URLS_INSTRUCTION })).not.toContain("Note:");
    expect(siteInstructionOf("word ".repeat(200)).length).toBeLessThanOrEqual(SITE_INSTRUCTION_MAX_CHARS);
  });

  it("mentions the photo only when one is attached", () => {
    expect(buildSiteSourceUrlsQuery({ rowData: example, domains: [DOMAIN] })).not.toContain("photo");
    expect(buildSiteSourceUrlsQuery({ rowData: example, domains: [DOMAIN], hasImage: true })).toContain("The attached photo shows the product.");
  });

  it("asks a simpler second question: the name and the barcode only", () => {
    expect(buildSiteSourceUrlsQuery({ rowData: example, domains: [DOMAIN], attempt: 2, customInstruction: "x", hasImage: true })).toBe(
      [
        "mamasandpapas.com product page for this item:",
        "- Description: CHECK JACKET BROWN 6-9M",
        "- Barcode: 5063229294815",
        "Return the mamasandpapas.com product page link only.",
      ].join("\n")
    );
  });

  it("asks no second question when there is nothing simpler to ask", () => {
    // Only a name: the first request already was the simple one.
    expect(buildSiteSourceUrlsQuery({ rowData: { Title: "Check Jacket" }, domains: ["acme.com"], attempt: 2 })).toBe("");
    // Only codes: dropping them would leave nothing to search for.
    expect(buildSiteSourceUrlsQuery({ rowData: { SKU: "W-1" }, domains: ["acme.com"], attempt: 2 })).toBe("");
    // A photo or a note made the first request different, so the plain one is worth asking.
    expect(buildSiteSourceUrlsQuery({ rowData: { Title: "Check Jacket" }, domains: ["acme.com"], attempt: 2, hasImage: true })).not.toBe("");
  });
});

describe("siteLinkProblem", () => {
  it("accepts a product page on the website, with www or a country subdomain", () => {
    expect(siteLinkProblem(PRODUCT, DOMAIN)).toBeNull();
    expect(siteLinkProblem("https://mamasandpapas.com/products/a-b", DOMAIN)).toBeNull();
    expect(siteLinkProblem("https://uk.mamasandpapas.com/products/a-b", DOMAIN)).toBeNull();
    expect(siteLinkProblem("https://www.mamasandpapas.com/en-gb/products/a-b?variant=1", DOMAIN)).toBeNull();
    expect(siteLinkProblem("https://acme.com/collections/jackets/products/check-jacket", "acme.com")).toBeNull();
    expect(siteLinkProblem("https://acme.com/women/jackets/check-jacket-brown", "acme.com")).toBeNull();
    expect(siteLinkProblem("http://acme.com/p/12345.html", "acme.com")).toBeNull();
  });

  it("rejects the home page, with or without a language prefix", () => {
    expect(siteLinkProblem("https://www.mamasandpapas.com", DOMAIN)).toBe("homepage");
    expect(siteLinkProblem("https://www.mamasandpapas.com/", DOMAIN)).toBe("homepage");
    expect(siteLinkProblem("https://www.mamasandpapas.com/en/", DOMAIN)).toBe("homepage");
    expect(siteLinkProblem("https://www.mamasandpapas.com/en-gb", DOMAIN)).toBe("homepage");
  });

  it("rejects other websites, including look-alike hosts", () => {
    expect(siteLinkProblem("https://www.amazon.co.uk/dp/B0123456789", DOMAIN)).toBe("other_site");
    expect(siteLinkProblem("https://mamasandpapas.com.evil.test/products/a", DOMAIN)).toBe("other_site");
    expect(siteLinkProblem("https://notmamasandpapas.com/products/a", DOMAIN)).toBe("other_site");
  });

  it("rejects category, collection and search pages", () => {
    expect(siteLinkProblem("https://acme.com/collections/jackets", "acme.com")).toBe("listing_page");
    expect(siteLinkProblem("https://acme.com/collections", "acme.com")).toBe("listing_page");
    expect(siteLinkProblem("https://acme.com/products", "acme.com")).toBe("listing_page");
    expect(siteLinkProblem("https://acme.com/category/jackets", "acme.com")).toBe("listing_page");
    expect(siteLinkProblem("https://acme.com/search?q=jacket", "acme.com")).toBe("listing_page");
    expect(siteLinkProblem("https://acme.com/shop", "acme.com")).toBe("listing_page");
  });

  it("rejects text that is not a web link", () => {
    expect(siteLinkProblem("mamasandpapas.com/products/a", DOMAIN)).toBe("not_a_link");
    expect(siteLinkProblem("ftp://mamasandpapas.com/products/a", DOMAIN)).toBe("not_a_link");
  });
});

describe("siteLinkProblemOn", () => {
  const sites = [DOMAIN, "mintvelvet.co.uk"];

  it("passes a product page on any of the named websites", () => {
    expect(siteLinkProblemOn(PRODUCT, sites)).toBeNull();
    expect(siteLinkProblemOn("https://www.mintvelvet.co.uk/product/check-coat-123", sites)).toBeNull();
  });

  it("still rejects other websites, and reports a problem on a named site first", () => {
    expect(siteLinkProblemOn("https://www.google.com/search?q=product&ibp=oshop", sites)).toBe("other_site");
    expect(siteLinkProblemOn("https://www.mintvelvet.co.uk/", sites)).toBe("homepage");
    expect(siteLinkProblemOn("https://www.mintvelvet.co.uk/collections/coats", sites)).toBe("listing_page");
  });

  it("picks the page from whichever named website has it, and titles it with that site", () => {
    const mint = "https://www.mintvelvet.co.uk/product/check-coat-123";
    const pick = pickSitePage([], [{ link: "https://www.google.com/search?ibp=oshop" }, { link: mint }], sites);
    expect(pick.page).toEqual({ url: mint, title: "mintvelvet.co.uk" });
    expect(describeSiteMiss(pickSitePage([], [], sites), sites)).toBe("returned no pages");
    expect(describeSiteMiss(pickSitePage([], [{ link: "https://www.amazon.co.uk/dp/B0123456789" }], sites), sites)).toBe(
      "returned 1 link, none a product page on mamasandpapas.com or mintvelvet.co.uk (1 on another website)"
    );
  });
});

describe("cleanSiteLink", () => {
  it("drops the fragment and tracking parameters but keeps the variant", () => {
    expect(cleanSiteLink(`${PRODUCT}?variant=54315569021265&utm_source=google&srsltid=abc#:~:text=Check`)).toBe(
      `${PRODUCT}?variant=54315569021265`
    );
    expect(cleanSiteLink(`${PRODUCT}?utm_medium=cpc`)).toBe(PRODUCT);
  });
});

describe("pickSitePage", () => {
  const ref = (link: string, title?: string) => ({ link, title });

  it("takes the cited product page when the answer only names the home page (the bug this mode fixes)", () => {
    const pick = pickSitePage(["Here it is: https://www.mamasandpapas.com"], [ref(PRODUCT, "Check Jacket - Mamas & Papas")], [DOMAIN]);
    expect(pick.page).toEqual({ url: PRODUCT, title: "Check Jacket - Mamas & Papas" });
    expect(pick.dropped.homepage).toBe(1);
  });

  it("takes a product page from the answer when nothing was cited", () => {
    const pick = pickSitePage([`[Check Jacket](${PRODUCT})`], [], [DOMAIN]);
    expect(pick.page).toEqual({ url: PRODUCT, title: "Check Jacket" });
  });

  it("reads JSON when the search still answers with it", () => {
    const pick = pickSitePage([JSON.stringify({ sources: [{ url: PRODUCT, title: "Check Jacket" }] })], [], [DOMAIN]);
    expect(pick.page?.url).toBe(PRODUCT);
  });

  it("prefers a page that is both named in the answer and cited", () => {
    const other = "https://www.mamasandpapas.com/products/check-coat-s07fn7aa1";
    const pick = pickSitePage([`Best match: ${PRODUCT}`], [ref(other, "Coat"), ref(PRODUCT, "Jacket")], [DOMAIN]);
    expect(pick.page?.url).toBe(PRODUCT);
    expect(pick.page?.title).toBe("Jacket");
  });

  it("keeps only the first valid page, never a second guess", () => {
    const second = "https://www.mamasandpapas.com/products/check-coat-s07fn7aa1";
    const pick = pickSitePage([], [ref(PRODUCT), ref(second)], [DOMAIN]);
    expect(pick.page?.url).toBe(PRODUCT);
  });

  it("ignores other websites, listing pages and the home page, and says what it dropped", () => {
    const pick = pickSitePage(
      ["https://www.amazon.co.uk/dp/B0123456789 https://www.mamasandpapas.com/collections/jackets"],
      [ref("https://www.mamasandpapas.com/"), ref("https://www.argos.co.uk/product/1234567")],
      [DOMAIN]
    );
    expect(pick.page).toBeNull();
    expect(pick.considered).toBe(4);
    expect(describeSiteMiss(pick, [DOMAIN])).toBe(
      "returned 4 links, none a product page on mamasandpapas.com (2 on another website, 1 the home page, 1 a category or search page)"
    );
  });

  it("falls back to the website name for a page with no title, and reports an empty answer", () => {
    expect(pickSitePage([], [ref(PRODUCT)], [DOMAIN]).page?.title).toBe(DOMAIN);
    const none = pickSitePage(["I could not find it."], [], [DOMAIN]);
    expect(none.page).toBeNull();
    expect(describeSiteMiss(none, [DOMAIN])).toBe("returned no pages");
  });

  it("counts a page once however many times it appears", () => {
    const pick = pickSitePage([`${PRODUCT} ${PRODUCT}#reviews`], [ref(`${PRODUCT}?utm_source=x`)], [DOMAIN]);
    expect(pick.considered).toBe(1);
  });
});

