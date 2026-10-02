import { describe, expect, it } from "vitest";
import { hideProviderNames } from "./provider-names";

describe("hideProviderNames", () => {
  it("rewrites the old Exact match note saved on rows, whatever the dash looked like", () => {
    const expected = "Exact match: the product page was confirmed and its images were taken from it.";
    for (const dash of ["\u2013", "\u2014", "\u00e2\u20ac\u201d", "-"]) {
      expect(
        hideProviderNames(
          `Exact match ${dash} Google AI Mode found the product link; GPT-6.1 Sol confirmed it and pulled the images.`
        )
      ).toBe(expected);
    }
    expect(
      hideProviderNames(
        "Exact match \u2013 Google AI Mode found the product link; GPT-6.1 Sol confirmed it and pulled the images. Product image"
      )
    ).toBe(`${expected} Product image`);
  });

  it("hides search and model names in Not found reasons and errors", () => {
    expect(hideProviderNames("Google AI Mode found no exact-match product page for this item (search 1: returned no links).")).toBe(
      "The web search found no exact-match product page for this item (search 1: returned no links)."
    );
    expect(hideProviderNames("Standard: no page; Exact: Google AI Mode found no page")).toBe(
      "Standard: no page; Exact: the web search found no page"
    );
    expect(hideProviderNames("OpenAI enrich returned no parseable JSON output")).toBe(
      "AI enrich returned no parseable JSON output"
    );
    expect(hideProviderNames("SearchApi Google AI Mode failed (401)")).toBe("The web search failed (401)");
    expect(hideProviderNames("Researching with GPT-6.1 Sol and gpt-6.1-sol")).toBe(
      "Researching with the AI agent and the AI agent"
    );
  });

  it("leaves other text and empty values alone", () => {
    expect(hideProviderNames("Best match by title and brand.")).toBe("Best match by title and brand.");
    expect(hideProviderNames("")).toBe("");
    expect(hideProviderNames(undefined)).toBeUndefined();
  });
});
