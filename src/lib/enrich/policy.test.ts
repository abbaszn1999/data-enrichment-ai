import { describe, expect, it } from "vitest";
import { buildEnrichToolPolicy } from "./policy";

describe("buildEnrichToolPolicy", () => {
  it("uses auto search for text-only columns", () => {
    const policy = buildEnrichToolPolicy(["enhancedTitle", "marketingDescription"]);
    expect(policy.toolChoice).toBe("auto");
    expect(policy.searchContentTypes).toEqual(["text"]);
    expect(policy.needsImages).toBe(false);
    expect(policy.needsSources).toBe(false);
    expect(policy.textColumnIds).toEqual([
      "enhancedTitle",
      "marketingDescription",
    ]);
  });

  it("requires search for sourceUrls", () => {
    const policy = buildEnrichToolPolicy(["sourceUrls"], [
      {
        id: "sourceUrls",
        label: "Sources",
        description: "",
        type: "sourceUrls",
        enabled: true,
        sourceCount: 5,
      },
    ]);
    expect(policy.toolChoice).toBe("required");
    expect(policy.needsSources).toBe(true);
    expect(policy.includeSources).toBe(true);
    expect(policy.sourceCount).toBe(5);
    expect(policy.searchContentTypes).toEqual(["text"]);
  });

  it("requires image+text search for imageUrls", () => {
    const policy = buildEnrichToolPolicy(["imageUrls"], [
      {
        id: "imageUrls",
        label: "Images",
        description: "",
        type: "imageUrls",
        enabled: true,
        imageCount: 4,
      },
    ]);
    expect(policy.toolChoice).toBe("required");
    expect(policy.needsImages).toBe(true);
    expect(policy.includeResults).toBe(true);
    expect(policy.imageCount).toBe(4);
    expect(policy.searchContentTypes).toEqual(["image", "text"]);
  });

  it("forces required when mixing text and images", () => {
    const policy = buildEnrichToolPolicy([
      "enhancedTitle",
      "imageUrls",
      "categories",
    ]);
    expect(policy.toolChoice).toBe("required");
    expect(policy.needsCategories).toBe(true);
    expect(policy.searchContentTypes).toEqual(["image", "text"]);
  });
});
