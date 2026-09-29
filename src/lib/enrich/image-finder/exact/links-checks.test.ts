import { describe, expect, it } from "vitest";
import { checkExactLinks } from "./links-checks";

describe("checkExactLinks", () => {
  it("keeps a normal full product URL", () => {
    const out = checkExactLinks(
      [{ url: "https://shop.test/products/an7312-ic", evidence: "AN7312 IC" }],
      ["AN7312"]
    );
    expect(out).toEqual([
      { url: "https://shop.test/products/an7312-ic", site: "shop.test", matchedOn: "", evidence: "AN7312 IC", differences: "" },
    ]);
  });

  it("drops a bare domain with no path (footshop.com-style)", () => {
    const out = checkExactLinks([{ url: "https://footshop.com" }], []);
    expect(out).toEqual([]);
  });

  it("drops a bare domain with only a trailing slash", () => {
    const out = checkExactLinks([{ url: "https://footshop.com/" }], []);
    expect(out).toEqual([]);
  });

  it("drops a link with no scheme at all", () => {
    const out = checkExactLinks([{ url: "gohailo.com" }], []);
    expect(out).toEqual([]);
  });

  it("drops a plain http link (https-only)", () => {
    const out = checkExactLinks([{ url: "http://shop.test/products/x" }], []);
    expect(out).toEqual([]);
  });

  it("drops known non-product / datasheet-aggregator hosts", () => {
    const hosts = [
      "https://datasheet4u.com/datasheets/Panasonic/AN264/1407129",
      "https://www.alldatasheet.com/datasheet-pdf/pdf/13328/PANASONIC/AN5265.html",
      "https://www.datasheetarchive.com/?q=an5620",
      "https://electronicsupplycorp.com/contents/en-us/d125.html",
      "https://www.radiomuseum.org/tubes/tube_an253.html",
      "https://www.google.com/search?q=an253",
    ];
    for (const url of hosts) {
      expect(checkExactLinks([{ url }], []), url).toEqual([]);
    }
  });

  it("rejects a real suffix variant reported in the evidence (AN6326N)", () => {
    const out = checkExactLinks(
      [{ url: "https://ebay.test/itm/1", evidence: '1pcs AN6326N AN6326 N dip18 Integrated Circuit' }],
      ["AN6326"]
    );
    expect(out).toEqual([]);
  });

  it("does NOT reject on the raw text's own concatenation noise (code glued onto unrelated words with no space)", () => {
    // Real SearchApi output seen in testing: "IC | AN7312Go to product viewer dialog for this item.."
    const out = checkExactLinks(
      [{ url: "https://ekt1.test/p/an7312", evidence: "IC | AN7312Go to product viewer dialog for this item.." }],
      ["AN7312"]
    );
    expect(out).toHaveLength(1);
  });

  it("does not reject a code followed only by a space and more text", () => {
    const out = checkExactLinks(
      [{ url: "https://shop.test/p/1", evidence: "AN7312 DIP-14 High-Frequency Amplifier" }],
      ["AN7312"]
    );
    expect(out).toHaveLength(1);
  });

  it("caps the result at maxLinks, keeping the earlier (best-first) candidates", () => {
    const candidates = [1, 2, 3, 4].map((n) => ({ url: `https://shop.test/p/${n}` }));
    const out = checkExactLinks(candidates, [], 3);
    expect(out.map((c) => c.url)).toEqual([
      "https://shop.test/p/1",
      "https://shop.test/p/2",
      "https://shop.test/p/3",
    ]);
  });

  it("deduplicates identical URLs", () => {
    const out = checkExactLinks(
      [{ url: "https://shop.test/p/1" }, { url: "https://shop.test/p/1" }],
      []
    );
    expect(out).toHaveLength(1);
  });

  it("falls back to the hostname as the site when none is given", () => {
    const out = checkExactLinks([{ url: "https://www.shop.test/p/1" }], []);
    expect(out[0].site).toBe("shop.test");
  });

  it("returns an empty array for no candidates", () => {
    expect(checkExactLinks([], [])).toEqual([]);
  });
});
