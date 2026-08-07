import { describe, expect, it } from "vitest";
import { buildEnrichToolPolicy } from "./policy";
import { buildEnrichJsonSchema } from "./schema";
import { resolveEnrichmentModel } from "@/types";
import {
  resolveEnrichOpenAiModel,
  resolveEnrichReasoningEffort,
} from "./models";

describe("buildEnrichJsonSchema", () => {
  it("includes only requested columns plus notes", () => {
    const policy = buildEnrichToolPolicy(["enhancedTitle", "imageUrls"]);
    const { name, schema } = buildEnrichJsonSchema(
      ["enhancedTitle", "imageUrls"],
      [
        {
          id: "enhancedTitle",
          label: "Title",
          description: "SEO title",
          type: "text",
          enabled: true,
        },
        {
          id: "imageUrls",
          label: "Images",
          description: "Images",
          type: "imageUrls",
          enabled: true,
          imageCount: 3,
        },
      ],
      policy
    );

    expect(name).toBe("import_product_enrichment");
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties as object).sort()).toEqual([
      "enhancedTitle",
      "imageUrls",
      "notes",
    ]);
    expect(schema.required).toEqual(
      expect.arrayContaining(["enhancedTitle", "imageUrls", "notes"])
    );
  });

  it("marks categories as allowlist-only when store list is present", () => {
    const policy = buildEnrichToolPolicy(["categories"]);
    const { schema } = buildEnrichJsonSchema(
      ["categories"],
      [
        {
          id: "categories",
          label: "Categories",
          description: "Cats",
          type: "categories",
          enabled: true,
          maxCategories: 2,
        },
      ],
      policy,
      { hasStoreCategoryAllowlist: true }
    );
    const cats = (schema.properties as Record<string, { description?: string }>)
      .categories;
    expect(cats.description).toMatch(/exact allowlist/i);
  });
});

describe("enrich model resolution", () => {
  it("maps legacy Gemini Pro to premium / Sol", () => {
    expect(resolveEnrichmentModel("gemini-3.1-pro-preview")).toBe("premium");
    expect(resolveEnrichOpenAiModel("premium")).toBe("gpt-5.6-sol");
    expect(resolveEnrichReasoningEffort("premium")).toBe("high");
  });

  it("maps legacy Fast and unknown to standard / Terra", () => {
    expect(resolveEnrichmentModel("gemini-3.6-flash")).toBe("standard");
    expect(resolveEnrichmentModel("standard")).toBe("standard");
    expect(resolveEnrichOpenAiModel("standard")).toBe("gpt-5.6-terra");
    expect(resolveEnrichReasoningEffort("standard")).toBe("medium");
  });
});
