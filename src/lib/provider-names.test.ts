import { describe, expect, it } from "vitest";
import { hideProviderNames, withDisplayError } from "./provider-names";

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

  it("hides lower-case model ids and provider billing links", () => {
    expect(hideProviderNames("Image model gemini-3.1-flash-image failed")).toBe("Image model AI failed");
    expect(
      hideProviderNames(
        "You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/."
      )
    ).toBe("You have no credits remaining. Add credits to continue using the API.");
    expect(
      hideProviderNames(
        "401 Incorrect API key provided: sk-proj-abc123XYZ. You can find your API key at https://platform.openai.com/account/api-keys."
      )
    ).toBe("401 Incorrect API key provided: [key]. You can find your API key.");
    expect(
      hideProviderNames(
        "[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/x: [429 Too Many Requests]"
      )
    ).toBe("Error fetching from [429 Too Many Requests]");
  });

  it("leaves other text and empty values alone", () => {
    expect(hideProviderNames("Best match by title and brand.")).toBe("Best match by title and brand.");
    expect(hideProviderNames("")).toBe("");
    expect(hideProviderNames(undefined)).toBeUndefined();
  });
});

describe("withDisplayError", () => {
  it("hides provider names in a saved error message and leaves other rows untouched", () => {
    const row = { id: "r1", errorMessage: "OpenAI request failed" };
    expect(withDisplayError(row).errorMessage).toBe("AI request failed");
    expect(row.errorMessage).toBe("OpenAI request failed");
    const clean = { id: "r2", errorMessage: "Row not found" };
    expect(withDisplayError(clean)).toBe(clean);
    const none = { id: "r3", errorMessage: undefined };
    expect(withDisplayError(none)).toBe(none);
  });
});
