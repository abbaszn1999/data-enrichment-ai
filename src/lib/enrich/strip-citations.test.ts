import { describe, expect, it } from "vitest";
import { stripCitations } from "./strip-citations";

describe("stripCitations", () => {
  it("removes parenthesized domains and markdown citations", () => {
    expect(stripCitations("Weighs 2.5 kg (example.com).")).toBe("Weighs 2.5 kg.");
    expect(stripCitations("Made in Italy ([Shop](https://shop.com/p?utm_source=openai)) and sturdy.")).toBe(
      "Made in Italy and sturdy."
    );
    expect(stripCitations("Waterproof (https://brand.com/item)")).toBe("Waterproof");
    expect(stripCitations("Pair (a.com, b.co.uk) fits.")).toBe("Pair fits.");
  });

  it("removes a closing Sources list but keeps the copy", () => {
    expect(stripCitations("Great drum.\n\nSources:\n- https://a.com/x\n- https://b.com/y")).toBe("Great drum.");
  });

  it("keeps a plain label link and unrelated parentheses", () => {
    expect(stripCitations("See the [size guide](https://store.com/size) (1.5 kg, 3.5mm jack)")).toBe(
      "See the [size guide](https://store.com/size) (1.5 kg, 3.5mm jack)"
    );
    expect(stripCitations("Manual (manual.pdf) included")).toBe("Manual (manual.pdf) included");
  });

  it("drops the utm_source=openai parameter from remaining links", () => {
    expect(stripCitations('<a href="https://x.com/a?utm_source=openai">Buy</a>')).toBe(
      '<a href="https://x.com/a">Buy</a>'
    );
    expect(stripCitations("https://x.com/a?id=1&utm_source=openai")).toBe("https://x.com/a?id=1");
  });

  it("cleans arrays and nested objects", () => {
    expect(stripCitations(["Soft (shop.com)", "Warm"])).toEqual(["Soft", "Warm"]);
    expect(stripCitations([{ q: "Does it fit?", a: "Yes (brand.com)." }])).toEqual([{ q: "Does it fit?", a: "Yes." }]);
  });

  it("leaves non-strings alone", () => {
    expect(stripCitations(undefined)).toBeUndefined();
    expect(stripCitations(5)).toBe(5);
  });
});
