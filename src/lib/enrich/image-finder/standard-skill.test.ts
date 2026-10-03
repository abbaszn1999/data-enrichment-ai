import { describe, expect, it } from "vitest";
import { IMAGE_FINDER_STANDARD_SKILL } from "./standard-skill";

describe("IMAGE_FINDER_STANDARD_SKILL", () => {
  it("uses web_search only and never mentions page tools or model names", () => {
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("web_search");
    for (const absent of ["check_pages", "fetch_page", "view_images", "matchBasis", "gpt-"]) {
      expect(IMAGE_FINDER_STANDARD_SKILL).not.toContain(absent);
    }
  });

  it("gives a unique identifier the most weight, and falls back to brand and description without one", () => {
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("If the row has a unique identifier");
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("it carries the most weight");
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("If the row has no unique identifier, identify the item by brand");
  });

  it("trusts known pages as the same item, skips only obvious mismatches and keeps going to fill 7 images", () => {
    const known = IMAGE_FINDER_STANDARD_SKILL.indexOf("## Step 1 — Known pages first");
    const search = IMAGE_FINDER_STANDARD_SKILL.indexOf("## Step 2 — Search the exact identifier");
    expect(known).toBeGreaterThan(-1);
    expect(known).toBeLessThan(search);
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("treat each one as the same item by default");
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("do not compare it with the code a known page shows");
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("Skip a page only if it will not open, is a search or listing page");
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("do not retry it");
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("Do not stop at the first page");
    expect(IMAGE_FINDER_STANDARD_SKILL).not.toContain("They are leads, not proof");
    expect(IMAGE_FINDER_STANDARD_SKILL).not.toContain("only when it displays this row's identifier");
  });

  it("fills the gap by searching when known pages gave fewer than 7 images, and keeps the identifier rule for self-found pages", () => {
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("to fill the gap");
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("The pages you find here are not pre-matched");
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("## Step 5 — Accept a page you found yourself only on the page itself");
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("Known pages and pages you found yourself both count toward the 7");
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("identifier differs, product matches");
  });

  it("searches the exact identifier and reads it on the opened page", () => {
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("## Step 2 — Search the exact identifier");
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("A search snippet is not proof");
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("character for character");
  });

  it("keeps searching by retailer catalogues, concepts and synonyms instead of stopping", () => {
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("do not stop");
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("own catalogue or site search");
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("Search separate concepts");
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("synonyms");
  });

  it("treats near codes as different products and never infers an identifier", () => {
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("is a DIFFERENT product — but a lead");
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("Never infer an identifier from a URL");
  });

  it("takes up to 7 images only after the match, from the matched item's own opened page", () => {
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("## Step 6 — Images, only after the match");
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("up to 7 distinct images of that matched item from its own page(s) that you opened");
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("with that page's URL");
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("from general image search results");
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("Never add images of similar items to reach a number");
  });

  it("lets website rules and the custom instruction override defaults, without a hardcoded barcode rule", () => {
    const rules = IMAGE_FINDER_STANDARD_SKILL.indexOf("1. The store owner's website rules");
    const custom = IMAGE_FINDER_STANDARD_SKILL.indexOf("2. The store owner's custom instruction");
    const own = IMAGE_FINDER_STANDARD_SKILL.indexOf("3. Your own judgement");
    expect(rules).toBeGreaterThan(-1);
    expect(rules).toBeLessThan(custom);
    expect(custom).toBeLessThan(own);
    expect(IMAGE_FINDER_STANDARD_SKILL).not.toContain("ignore the barcode");
  });

  it("makes the custom instruction the owner's method, limited only by website rules and honesty", () => {
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("you follow it exactly");
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("how strict a match must be, what counts as the same item");
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("Its only limits are the website rules and honesty");
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("Without a custom instruction, the strict defaults below apply.");
  });

  it("says not found only after both search approaches and never claims non-existence", () => {
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("## Step 7 — Before answering not found");
    expect(IMAGE_FINDER_STANDARD_SKILL).toContain("Never claim the product does not exist.");
  });

  it("is not tuned to any store, brand or trial data", () => {
    for (const specific of ["toys4less", "Toys 4 Less", "PAKTAT", "Paktat", "Shopify", "AN5120", "RCP", "YWP"]) {
      expect(IMAGE_FINDER_STANDARD_SKILL).not.toContain(specific);
    }
  });
});
