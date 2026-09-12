import { describe, expect, it } from "vitest";
import { termEmbedText } from "./embeddings";

describe("termEmbedText", () => {
  it("embeds the phrase only, trimmed, with no collection context", () => {
    expect(termEmbedText("iphone 16 cases")).toBe("iphone 16 cases");
    expect(termEmbedText("  wireless headphones  ")).toBe("wireless headphones");
    expect(termEmbedText("Tablets")).not.toContain("Electronics");
    expect(termEmbedText("drawing tablets with stylus")).not.toMatch(
      /collection|description/i
    );
  });
});
