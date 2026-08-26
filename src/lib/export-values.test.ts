import { describe, expect, it } from "vitest";
import { enrichedValueToJson, enrichedValueToText } from "./export-values";

describe("enrichedValueToText", () => {
  it("renders FAQ pairs as readable Q/A blocks", () => {
    const text = enrichedValueToText(
      [
        { question: "Do you ship?", answer: "Yes." },
        { question: "Returns?", answer: "30 days." },
      ],
      "faq"
    );
    expect(text).toBe("Q: Do you ship?\nA: Yes.\n\nQ: Returns?\nA: 30 days.");
  });

  it("keeps image and source columns as bare url lists", () => {
    expect(
      enrichedValueToText(
        [{ imageUrl: "https://a/1.jpg", pageUrl: "https://a" }],
        "imageUrls"
      )
    ).toBe("https://a/1.jpg");
    expect(
      enrichedValueToText([{ title: "T", uri: "https://b" }], "sourceUrls")
    ).toBe("https://b");
  });

  it("joins plain string lists such as internal links", () => {
    expect(
      enrichedValueToText(["Running Shoes", "Trail Shoes"], "internalLinks")
    ).toBe("Running Shoes\nTrail Shoes");
  });

  it("returns an empty string for missing values", () => {
    expect(enrichedValueToText(undefined, "seoTitle")).toBe("");
    expect(enrichedValueToText(null, "seoTitle")).toBe("");
  });
});

describe("enrichedValueToJson", () => {
  it("keeps FAQ structured", () => {
    expect(
      enrichedValueToJson([{ question: "Q", answer: "A" }], "faq")
    ).toEqual([{ question: "Q", answer: "A" }]);
  });

  it("flattens image and source objects to urls", () => {
    expect(
      enrichedValueToJson([{ imageUrl: "https://a/1.jpg" }], "imageUrls")
    ).toEqual(["https://a/1.jpg"]);
    expect(
      enrichedValueToJson([{ title: "T", uri: "https://b" }], "sourceUrls")
    ).toEqual(["https://b"]);
  });
});
