import { describe, expect, it } from "vitest";
import { KNOWN_PAGES_MAX, prepareKnownPages } from "./known-pages";

const NO_RULES = { allowedDomains: [], blockedDomains: [] };

describe("prepareKnownPages", () => {
  it("keeps public http(s) pages in order and drops repeats", () => {
    const pages = prepareKnownPages(
      [
        { url: "https://shop.test/p/a", title: "A" },
        { url: "https://www.shop.test/p/a/", title: "A again" },
        { url: "ftp://shop.test/p/b" },
        { url: "not a url" },
        { url: "https://other.test/p/c" },
      ],
      NO_RULES
    );
    expect(pages).toEqual([{ url: "https://shop.test/p/a", title: "A" }, { url: "https://other.test/p/c" }]);
  });

  it("drops blocked websites and keeps only allowed ones when an allow list is set", () => {
    const pages = [
      { url: "https://www.amazon.com/dp/1" },
      { url: "https://shop.test/p/2" },
      { url: "https://sub.store.test/p/3" },
    ];
    expect(prepareKnownPages(pages, { allowedDomains: [], blockedDomains: ["amazon.com"] }).map((p) => p.url)).toEqual([
      "https://shop.test/p/2",
      "https://sub.store.test/p/3",
    ]);
    expect(prepareKnownPages(pages, { allowedDomains: ["store.test"], blockedDomains: [] }).map((p) => p.url)).toEqual([
      "https://sub.store.test/p/3",
    ]);
  });

  it("caps the list", () => {
    const pages = Array.from({ length: 25 }, (_, i) => ({ url: `https://shop.test/p/${i}` }));
    expect(prepareKnownPages(pages, NO_RULES)).toHaveLength(KNOWN_PAGES_MAX);
  });

  it("handles no pages", () => {
    expect(prepareKnownPages(undefined, NO_RULES)).toEqual([]);
  });
});
