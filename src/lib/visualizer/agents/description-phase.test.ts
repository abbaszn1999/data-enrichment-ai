import { describe, expect, it } from "vitest";
import { buildDescriptionInputContent } from "@/lib/visualizer/agents/description-agent";
import {
  buildDescriptionBrandColorsBlock,
  buildDescriptionBrandGuideBlock,
  buildDescriptionLogoBlock,
  buildDescriptionResponseSchema,
  buildDescriptionUserPrompt,
} from "@/lib/visualizer/agents/prompts";
import { estimateDescriptionCredits } from "@/lib/visualizer/pricing";
import { validateVisualizerSettings } from "@/lib/visualizer/row-fields";
import { buildVisualizerResultsHeaders } from "@/lib/visualizer/results-xlsx";
import {
  createEmptyVisualizerWorksheet,
  DEFAULT_VISUALIZER_SETTINGS,
} from "@/lib/visualizer/types";

describe("visualizer description phase helpers", () => {
  it("requires selected columns and product image column", () => {
    expect(
      validateVisualizerSettings(
        {
          ...DEFAULT_VISUALIZER_SETTINGS,
          selectedColumns: ["Name"],
          productImageColumn: null,
        },
        ["Name", "Image"]
      )
    ).toMatch(/image/i);

    expect(
      validateVisualizerSettings(
        {
          ...DEFAULT_VISUALIZER_SETTINGS,
          selectedColumns: ["Name"],
          productImageColumn: "Image",
        },
        ["Name", "Image"],
        [
          {
            originalData: {
              Name: "Bag",
              Image: "https://cdn.example/bag.jpg",
            },
          },
        ]
      )
    ).toBeNull();

    expect(
      validateVisualizerSettings(
        {
          ...DEFAULT_VISUALIZER_SETTINGS,
          selectedColumns: ["Name"],
          productImageColumn: "Title",
        },
        ["Name", "Title"],
        [
          {
            originalData: {
              Name: "Bag",
              Title: "Leather tote",
            },
          },
        ]
      )
    ).toMatch(/image URLs/i);
  });

  it("builds the elite prompt with analysis phases and brand colors", () => {
    const prompt = buildDescriptionUserPrompt({
      product: { productName: "Leather bag" },
      layoutId: "zigzag",
      imageCount: 3,
      brand: {
        ...DEFAULT_VISUALIZER_SETTINGS.brand,
        colorPrimary: "#111827",
        colorSecondary: "#F06E3C",
      },
    });
    expect(prompt).toContain("PHASE 1: VISUAL PRODUCT ANALYSIS");
    expect(prompt).toContain("PHASE 5: PROFESSIONAL E-COMMERCE VISUAL PROMPT ENGINEERING");
    expect(prompt).toContain("[imageplaceholder-1]");
    expect(prompt).toContain("[imageplaceholder-3]");
    expect(prompt).toContain("SELECTED LAYOUT: Zigzag");
    expect(prompt).toContain("Layout id: zigzag");
    expect(prompt).toContain("exactly 3");
    expect(prompt).toContain("#111827");
    expect(prompt).toContain("#F06E3C");
    expect(prompt).toContain("Leather bag");
    expect(prompt).toContain("CONTEXT-DRIVEN VISUAL STORYTELLING");
    expect(prompt).not.toContain("BRAND COLOR PALETTE");
    expect(prompt).not.toContain("BRAND LOGO REFERENCE");
    expect(prompt).not.toContain("SCENE / MODEL REFERENCE");
  });

  it("embeds the exact selected layout rules for feature-grid", () => {
    const prompt = buildDescriptionUserPrompt({
      product: { productName: "Watch" },
      layoutId: "feature-grid",
      imageCount: 4,
      brand: DEFAULT_VISUALIZER_SETTINGS.brand,
    });
    expect(prompt).toContain("SELECTED LAYOUT: Feature Grid");
    expect(prompt).toContain("exactly 4");
    expect(prompt).toContain("ONE grid");
    expect(prompt).toContain("aspect-ratio:1/1");
    expect(prompt).toContain("[imageplaceholder-4]");
  });

  it("embeds carousel layout rules for square slides", () => {
    const prompt = buildDescriptionUserPrompt({
      product: { productName: "Sneaker" },
      layoutId: "carousel",
      imageCount: 4,
      brand: DEFAULT_VISUALIZER_SETTINGS.brand,
    });
    expect(prompt).toContain("SELECTED LAYOUT: Carousel");
    expect(prompt).toContain("scroll-snap");
    expect(prompt).toContain("SQUARE IMAGE CONSTRAINT");
  });

  it("interleaves logo/guide prompts only when images exist", () => {
    const tinyPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    const ref = { buffer: tinyPng, contentType: "image/png" };

    const withGuideImage = buildDescriptionInputContent({
      prompt: "MAIN PROMPT BODY",
      productImage: {
        url: "https://example.com/p.jpg",
        buffer: tinyPng,
        contentType: "image/jpeg",
      },
      brandingEnabled: true,
      includeBrandColors: false,
      brandColors: ["#111111", "#222222", "#333333"],
      logoImage: ref,
      brandGuideImage: ref,
    });

    const guideTexts = withGuideImage
      .filter((part) => part.type === "input_text")
      .map((part) => String(part.text));
    const guideImages = withGuideImage.filter(
      (part) => part.type === "input_image"
    );

    expect(guideTexts.some((t) => t.includes("MAIN PROMPT BODY"))).toBe(true);
    expect(guideTexts.some((t) => t.includes("BRAND COLOR PALETTE"))).toBe(
      false
    );
    expect(guideTexts.some((t) => t.includes("BRAND LOGO REFERENCE"))).toBe(
      true
    );
    expect(
      guideTexts.some((t) => t.includes("BRAND GUIDE / ART-DIRECTION"))
    ).toBe(true);
    expect(guideImages.length).toBe(3); // product + logo + guide

    const logoTextIdx = withGuideImage.findIndex(
      (p) =>
        p.type === "input_text" &&
        String(p.text).includes("BRAND LOGO REFERENCE")
    );
    expect(withGuideImage[logoTextIdx + 1]?.type).toBe("input_image");

    const colorsOnly = buildDescriptionInputContent({
      prompt: "MAIN",
      brandingEnabled: true,
      includeBrandColors: true,
      brandColors: ["#111111", "#222222", "#333333"],
      logoImage: null,
      brandGuideImage: null,
    });
    const colorsTexts = colorsOnly
      .filter((part) => part.type === "input_text")
      .map((part) => String(part.text));
    expect(colorsTexts.some((t) => t.includes("BRAND COLOR PALETTE"))).toBe(
      true
    );
    expect(colorsTexts.some((t) => t.includes("BRAND LOGO REFERENCE"))).toBe(
      false
    );
    expect(colorsTexts.some((t) => t.includes("BRAND GUIDE / ART-DIRECTION"))).toBe(
      false
    );
    expect(colorsOnly.filter((p) => p.type === "input_image")).toHaveLength(0);

    expect(buildDescriptionBrandColorsBlock(["#a", "#b", "#c"])).toContain(
      "Primary: #a"
    );
    expect(buildDescriptionLogoBlock()).toContain(
      "image attached immediately after"
    );
    expect(buildDescriptionBrandGuideBlock()).toContain("brand guide");
  });

  it("omits manual hex palette from the main prompt in upload-image mode", () => {
    const prompt = buildDescriptionUserPrompt({
      product: { productName: "Bag" },
      layoutId: "feature-grid",
      imageCount: 4,
      brand: {
        ...DEFAULT_VISUALIZER_SETTINGS.brand,
        colorPrimary: "#111827",
        colorSecondary: "#2563EB",
      },
      includeManualBrandColors: false,
    });
    expect(prompt).not.toContain("Brand primary color: #111827");
    expect(prompt).not.toContain("Brand secondary / accent color: #2563EB");
    expect(prompt).toContain("attached brand-guide image");
    expect(prompt).not.toContain("BRAND COLOR PALETTE");
  });

  it("keeps description schema strict and bounded", () => {
    const schema = buildDescriptionResponseSchema(4);
    expect(schema.required).toEqual([
      "description",
      "imagePlaceholders",
      "notes",
    ]);
    expect(schema.properties.imagePlaceholders.maxItems).toBe(4);
    expect(schema.properties.imagePlaceholders.minItems).toBe(4);
    expect(buildDescriptionResponseSchema(6).properties.imagePlaceholders.maxItems).toBe(6);
  });

  it("estimates credits for description rows", () => {
    const estimate = estimateDescriptionCredits({
      rowCount: 10,
      tier: "standard",
    });
    expect(estimate.min).toBeGreaterThan(0);
    expect(estimate.max).toBeGreaterThanOrEqual(estimate.min);
  });

  it("builds results headers without placeholder briefs", () => {
    const worksheet = createEmptyVisualizerWorksheet("session-1", ["Name"], [
      { id: "r1", rowIndex: 0, originalData: { Name: "A" } },
    ]);
    worksheet.rows[0]!.status = "description_ready";
    worksheet.rows[0]!.imagePlaceholders = [
      { index: 1, visualBrief: "brief", alt: "alt", storagePath: null },
      { index: 2, visualBrief: "brief 2", alt: "alt 2", storagePath: null },
    ];
    const headers = buildVisualizerResultsHeaders(worksheet);
    expect(headers).toContain("AI Description");
    expect(headers).toContain("Image 1 URL");
    expect(headers).toContain("Image 2 URL");
    expect(headers).not.toContain("Image Placeholder 1 Brief");
    expect(headers).not.toContain("Image Placeholder 2 Brief");
    expect(headers.some((h) => /Placeholder.*Brief/i.test(h))).toBe(false);
    expect(headers).toContain("Status");
  });
});
