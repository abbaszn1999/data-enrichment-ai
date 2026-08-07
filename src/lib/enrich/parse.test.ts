import { describe, expect, it } from "vitest";
import {
  buildEnrichedData,
  collectToolImages,
  collectToolSources,
  looksLikeDirectImageUrl,
  pickImagesFromSelection,
} from "./parse";
import { buildEnrichToolPolicy } from "./policy";
import type { OpenAiResponse } from "./types";

const responseFixture: OpenAiResponse = {
  status: "completed",
  output: [
    {
      type: "web_search_call",
      status: "completed",
      results: [
        {
          type: "image_result",
          image_url: "https://cdn.example/product.jpg",
          source_website_url: "https://brand.example/p",
          caption: "Front packshot",
        },
        {
          type: "image_result",
          image_url: "https://cdn.example/product-side.jpg",
          source_website_url: "https://brand.example/p",
          caption: "Side",
        },
      ],
      action: {
        type: "search",
        sources: [
          { type: "url", url: "https://brand.example/p", title: "Official" },
          { type: "url", url: "https://retailer.example/sku", title: "Retailer" },
        ],
      },
    },
    {
      type: "message",
      content: [
        {
          type: "output_text",
          text: JSON.stringify({
            enhancedTitle: "Acme Widget Pro",
            imageUrls: [
              "https://cdn.example/product.jpg",
              "https://invented.example/fake.jpg",
            ],
            sourceUrls: [
              { title: "Official", uri: "https://brand.example/p" },
              { title: "Fake", uri: "https://fake.example/nope" },
            ],
            notes: "searched",
          }),
          annotations: [
            {
              type: "url_citation",
              url: "https://docs.example/spec",
              title: "Spec sheet",
            },
          ],
        },
      ],
    },
  ],
};

describe("enrich parse validation", () => {
  it("collects tool images and sources", () => {
    const images = collectToolImages(responseFixture);
    const sources = collectToolSources(responseFixture);
    expect(images.map((i) => i.imageUrl)).toEqual([
      "https://cdn.example/product.jpg",
      "https://cdn.example/product-side.jpg",
    ]);
    expect(sources.map((s) => s.uri)).toEqual(
      expect.arrayContaining([
        "https://brand.example/p",
        "https://retailer.example/sku",
        "https://docs.example/spec",
      ])
    );
  });

  it("rejects invented image and source URLs, pads images to count", () => {
    const policy = buildEnrichToolPolicy(["enhancedTitle", "imageUrls", "sourceUrls"], [
      {
        id: "imageUrls",
        label: "Images",
        description: "",
        type: "imageUrls",
        enabled: true,
        imageCount: 2,
      },
      {
        id: "sourceUrls",
        label: "Sources",
        description: "",
        type: "sourceUrls",
        enabled: true,
        sourceCount: 3,
      },
    ]);

    const data = buildEnrichedData({
      selection: {
        enhancedTitle: "Acme Widget Pro",
        imageUrls: [
          "https://cdn.example/product.jpg",
          "https://invented.example/fake.jpg",
        ],
        sourceUrls: [
          { title: "Official", uri: "https://brand.example/p" },
          { title: "Fake", uri: "https://fake.example/nope" },
        ],
      },
      response: responseFixture,
      enabledColumns: ["enhancedTitle", "imageUrls", "sourceUrls"],
      policy,
    });

    expect(data.enhancedTitle).toBe("Acme Widget Pro");
    expect((data.imageUrls as { imageUrl: string }[]).map((i) => i.imageUrl)).toEqual([
      "https://cdn.example/product.jpg",
      "https://cdn.example/product-side.jpg",
    ]);
    expect((data.sourceUrls as { uri: string }[]).map((s) => s.uri)).toEqual([
      "https://brand.example/p",
    ]);
  });

  it("never treats source_website_url / HTML pages as images", () => {
    const toolImages = collectToolImages(responseFixture);
    const picked = pickImagesFromSelection(
      [
        "https://brand.example/p",
        "https://spinneys.com/en/product/foo",
      ],
      toolImages,
      3
    );
    expect(picked.map((i) => i.imageUrl)).toEqual([
      "https://cdn.example/product.jpg",
      "https://cdn.example/product-side.jpg",
    ]);
  });

  it("looksLikeDirectImageUrl rejects catalogue pages", () => {
    expect(looksLikeDirectImageUrl("https://cdn.example/a.jpg")).toBe(true);
    expect(
      looksLikeDirectImageUrl("https://www.spinneys.com/en/boon-pulp")
    ).toBe(false);
  });

  it("sanitizes categories against store allowlist", () => {
    const policy = buildEnrichToolPolicy(["categories"]);
    const data = buildEnrichedData({
      selection: {
        categories: "Baby & Toddler > Feeding, Electronics > TVs",
      },
      response: { status: "completed", output: [] },
      enabledColumns: ["categories"],
      policy,
      workspaceCategories: [
        {
          id: "1",
          name: "TVs",
          slug: "tvs",
          fullPath: "Electronics > TVs",
          parentId: null,
        },
      ],
      cmsType: "shopify",
      maxCategories: 3,
    });
    expect(data.categories).toBe("Electronics > TVs");
  });
});
