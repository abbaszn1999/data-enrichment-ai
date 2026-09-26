import { describe, expect, it } from "vitest";
import { IMAGE_FINDER_SKILL } from "./skill";

describe("IMAGE_FINDER_SKILL", () => {
  it("names the four research tools", () => {
    for (const tool of ["web_search", "check_pages", "fetch_page", "view_images"]) {
      expect(IMAGE_FINDER_SKILL).toContain(tool);
    }
  });

  it("batches discovery: check_pages for sweeps, fetch_page for the few hits, all candidates in one call", () => {
    expect(IMAGE_FINDER_SKILL).toContain(
      "Use check_pages for wide sweeps of search results and listing links, and fetch_page only for the 1 to 3 promising pages"
    );
    expect(IMAGE_FINDER_SKILL).toContain("Request all newly discovered candidates together in one check_pages call, not one per round");
    expect(IMAGE_FINDER_SKILL).toContain("never a reason to skip the mandatory steps");
  });

  it("allows a near code only when the exact code exists nowhere, on two websites, and never for a real variant", () => {
    expect(IMAGE_FINDER_SKILL).toContain("### Near codes");
    expect(IMAGE_FINDER_SKILL).toContain("only for when the exact code exists nowhere");
    expect(IMAGE_FINDER_SKILL).toContain("at least two independent websites");
    expect(IMAGE_FINDER_SKILL).toContain("is a different product: answer not found");
    expect(IMAGE_FINDER_SKILL).toContain('matchBasis "near_identifier"');
  });

  it("gives rows without codes a best-match path that never mixes candidates or guesses", () => {
    expect(IMAGE_FINDER_SKILL).toContain("### Rows with no code (best match)");
    expect(IMAGE_FINDER_SKILL).toContain("Never mix images from different candidates");
    expect(IMAGE_FINDER_SKILL).toContain("Price is supporting evidence only");
    expect(IMAGE_FINDER_SKILL).toContain("If two different products match about equally well, answer not found");
    expect(IMAGE_FINDER_SKILL).toContain("brandSeen");
  });

  it("starts with identity analysis that separates identifiers from variant attributes, for any sheet", () => {
    expect(IMAGE_FINDER_SKILL).toContain("## Step 1 — Identity analysis");
    expect(IMAGE_FINDER_SKILL).toContain("column names vary from sheet to sheet");
    expect(IMAGE_FINDER_SKILL).toContain("Variant-defining attributes");
    expect(IMAGE_FINDER_SKILL).toContain("ESP32-S3 vs ESP32-S2");
  });

  it("makes the store's own site search and the structured-data check mandatory", () => {
    expect(IMAGE_FINDER_SKILL).toContain("MANDATORY store search");
    expect(IMAGE_FINDER_SKILL).toContain("MANDATORY: never reject or accept a candidate from its title");
    expect(IMAGE_FINDER_SKILL).toContain(".json or .js");
  });

  it("requires every source type, including Chinese sources, before giving up", () => {
    for (const source of ["manufacturer", "distributors", "marketplaces", "Alibaba", "1688", "AliExpress", "Chinese"]) {
      expect(IMAGE_FINDER_SKILL).toContain(source);
    }
  });

  it("uses sheet-learned websites and treats near matches as leads, not answers", () => {
    expect(IMAGE_FINDER_SKILL).toContain("Websites where other products of this same sheet were verified");
    expect(IMAGE_FINDER_SKILL).toContain("A near match (nearby code, same brand and category) is a DIFFERENT product");
  });

  it("allows a model/variant match only when the row's code is internal", () => {
    expect(IMAGE_FINDER_SKILL).toContain("model/variant match is allowed");
    expect(IMAGE_FINDER_SKILL).toContain("Never use it when a strong identifier exists on the page for a different code");
  });

  it("gathers every distinct image of the exact item, up to 7, only from verified pages", () => {
    expect(IMAGE_FINDER_SKILL).toContain("## Step 4 — Gather every distinct image of the exact item, up to 7");
    expect(IMAGE_FINDER_SKILL).toContain("other pages of the SAME exact item");
    expect(IMAGE_FINDER_SKILL).toContain("in use / lifestyle shots");
    expect(IMAGE_FINDER_SKILL).toContain("never add images of similar items to reach a number");
  });

  it("excludes other variants when the row names one, and allows the item's own options when it does not", () => {
    expect(IMAGE_FINDER_SKILL).toContain("a photo of any other variant is a different product and is excluded");
    expect(IMAGE_FINDER_SKILL).toContain("when the row names no variant");
  });

  it("keeps the custom instruction above the model's judgement but below hard and website rules", () => {
    const hard = IMAGE_FINDER_SKILL.indexOf("1. Hard rules");
    const custom = IMAGE_FINDER_SKILL.indexOf("2. The store owner's custom instruction");
    const own = IMAGE_FINDER_SKILL.indexOf("3. Your own judgement");
    expect(hard).toBeGreaterThan(-1);
    expect(hard).toBeLessThan(custom);
    expect(custom).toBeLessThan(own);
    expect(IMAGE_FINDER_SKILL).toContain("It can never make you return an image of a different item.");
  });

  it("says not found only after the full checklist and never claims non-existence", () => {
    expect(IMAGE_FINDER_SKILL).toContain("## Step 5 — Not found (only after the checklist)");
    expect(IMAGE_FINDER_SKILL).toContain("Never claim the product does not exist.");
  });

  it("is not tuned to any store, brand or trial data", () => {
    for (const specific of ["toys4less", "Toys 4 Less", "PAKTAT", "Paktat", "Shopify", "AN5120", "RCP", "YWP"]) {
      expect(IMAGE_FINDER_SKILL).not.toContain(specific);
    }
  });
});
