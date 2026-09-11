import { describe, expect, it } from "vitest";
import { DEFAULT_AI_SETTINGS, DEFAULT_SCRAPING_SETTINGS } from "@/lib/gallery/types";
import {
  buildScrapingMainPrompt,
  SCRAPING_MAIN_SCHEMA,
} from "@/lib/gallery/agents/scraping-main-agent";
import {
  buildScrapingGalleryPrompt,
  SCRAPING_GALLERY_SCHEMA,
} from "@/lib/gallery/agents/scraping-gallery-agent";
import {
  AI_MAIN_RESPONSE_SCHEMA,
  buildAiMainPrompt,
} from "@/lib/gallery/agents/ai-main-agent";
import {
  AI_GALLERY_RESPONSE_SCHEMA,
  buildAiGalleryPrompt,
} from "@/lib/gallery/agents/ai-gallery-agent";

describe("separated agent prompts and schemas", () => {
  it("keeps Scraping Main schema free of Gallery fields", () => {
    expect(SCRAPING_MAIN_SCHEMA.required).toEqual([
      "productIdentity",
      "mainImageUrls",
      "notes",
    ]);
    expect(
      (SCRAPING_MAIN_SCHEMA.properties as Record<string, unknown>).galleryImageUrls
    ).toBeUndefined();
  });

  it("keeps Scraping Gallery schema free of Main URL fields", () => {
    expect(SCRAPING_GALLERY_SCHEMA.required).toEqual([
      "productIdentity",
      "galleryImageUrls",
      "notes",
    ]);
    expect(
      (SCRAPING_GALLERY_SCHEMA.properties as Record<string, unknown>).mainImageUrls
    ).toBeUndefined();
  });

  it("builds a Main-only Scraping prompt", () => {
    const prompt = buildScrapingMainPrompt({
      focusedRow: { SKU: "123" },
      mainCount: 2,
      mainInstructions: "White background only",
    });
    expect(prompt).toContain("Select exactly 2 Main images");
    expect(prompt).toContain("White background only");
    expect(prompt).toContain("Accept any resolution and any aspect ratio");
    expect(prompt).toContain("do not return an empty list out of caution");
    expect(prompt).not.toContain("An empty list is better than a wrong product");
    expect(prompt).not.toContain("Prefer official");
    expect(prompt).not.toContain("marketplace");
    expect(prompt).not.toContain("Gallery images must be meaningfully different");
    expect(prompt).toContain("productIdentity, mainImageUrls, notes");
  });

  it("builds a Gallery-only Scraping prompt", () => {
    const prompt = buildScrapingGalleryPrompt({
      focusedRow: { SKU: "123" },
      galleryCount: 4,
      settings: {
        ...DEFAULT_SCRAPING_SETTINGS,
        minResolution: 1200,
        aspectRatio: "square",
        sourcePolicy: "prefer-official",
      },
      mainImageUrls: ["https://cdn.example/main.png"],
    });
    expect(prompt).toContain("Return 4 Gallery images");
    expect(prompt).toContain("at least 1200px");
    expect(prompt).toContain("Prefer square Gallery images");
    expect(prompt).toContain("Prefer official");
    expect(prompt).toContain("do not return an empty Gallery out of caution");
    expect(prompt).not.toContain("An empty Gallery list is better than a wrong product");
    expect(prompt).not.toContain("marketplace");
    expect(prompt).not.toContain("Accept any resolution and any aspect ratio");
    expect(prompt).toContain("Gallery images must be meaningfully different");
    expect(prompt).toContain("productIdentity, galleryImageUrls, notes");
    expect(prompt).not.toContain("Select exactly");
  });

  it("keeps AI Main and Gallery response schemas distinct", () => {
    expect(AI_MAIN_RESPONSE_SCHEMA).toEqual({ type: "image", role: "main" });
    expect(AI_GALLERY_RESPONSE_SCHEMA).toEqual({ type: "image", role: "gallery" });
  });

  it("builds separate AI Main and Gallery prompts from planner briefs", () => {
    const worksheet = {
      sessionId: "s",
      columns: ["SKU"],
      originalImageColumn: null,
      selectedColumns: ["SKU"],
      settings: {
        provider: "ai" as const,
        scraping: DEFAULT_SCRAPING_SETTINGS,
        ai: {
          ...DEFAULT_AI_SETTINGS,
          instructions: "Show packaging",
        },
      },
      activeRun: null,
      rows: [],
    };
    const row = {
      id: "r1",
      rowIndex: 0,
      status: "not_started" as const,
      originalData: { SKU: "ABC" },
      mainImagePath: null,
      galleryImagePaths: [],
    };

    const mainPrompt = buildAiMainPrompt({
      worksheet,
      row,
      referenceImages: [],
      brief: {
        specClaim: "catalog identity",
        visualBrief: "Clean centered hero on seamless studio sweep",
        alt: "Product hero",
      },
    });
    const galleryPrompt = buildAiGalleryPrompt({
      worksheet,
      row,
      referenceImages: [
        {
          label: "canonical main product image; preserve this exact product identity",
          buffer: Buffer.from("x"),
          contentType: "image/jpeg",
        },
      ],
      brief: {
        specClaim: "waterproof shell",
        visualBrief: "Water beading on the shell under hard light",
        alt: "Waterproof proof",
      },
      galleryIndex: 0,
    });

    expect(mainPrompt).toContain("Main ecommerce image");
    expect(mainPrompt).toContain("catalog identity");
    expect(mainPrompt).toContain("Clean centered hero on seamless studio sweep");
    expect(mainPrompt).not.toContain("three-quarter front view");
    expect(galleryPrompt).toContain("Gallery ecommerce image");
    expect(galleryPrompt).toContain("waterproof shell");
    expect(galleryPrompt).toContain("Water beading on the shell under hard light");
    expect(galleryPrompt).not.toContain("three-quarter front view");
    expect(galleryPrompt).toContain("canonical main product image");
  });

  it("sends manual brand colors only in colors mode", () => {
    const worksheet = {
      sessionId: "s",
      columns: ["SKU"],
      originalImageColumn: null,
      selectedColumns: ["SKU"],
      settings: {
        provider: "ai" as const,
        scraping: DEFAULT_SCRAPING_SETTINGS,
        ai: {
          ...DEFAULT_AI_SETTINGS,
          brandingEnabled: true,
          brandGuideMode: "colors" as const,
          brandColors: ["#111111", "#222222", "#333333"],
        },
      },
      activeRun: null,
      rows: [],
    };
    const row = {
      id: "r1",
      rowIndex: 0,
      status: "not_started" as const,
      originalData: { SKU: "ABC" },
      mainImagePath: null,
      galleryImagePaths: [],
    };
    const colorsPrompt = buildAiMainPrompt({
      worksheet,
      row,
      referenceImages: [],
      brief: {
        specClaim: "identity",
        visualBrief: "Studio hero",
        alt: "Hero",
      },
    });
    expect(colorsPrompt).toContain("Brand palette");
    expect(colorsPrompt).toContain("#111111");

    const imageModePrompt = buildAiMainPrompt({
      worksheet: {
        ...worksheet,
        settings: {
          ...worksheet.settings,
          ai: {
            ...worksheet.settings.ai,
            brandGuideMode: "image",
          },
        },
      },
      row,
      referenceImages: [
        {
          label: "visual brand guide and art-direction reference",
          buffer: Buffer.from("x"),
          contentType: "image/png",
        },
      ],
      brief: {
        specClaim: "identity",
        visualBrief: "Studio hero",
        alt: "Hero",
      },
    });
    expect(imageModePrompt).not.toContain("Brand palette");
    expect(imageModePrompt).toContain("brand-guide");
  });
});
