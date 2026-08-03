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
      mainImageUrl: "https://cdn.example/main.png",
    });
    expect(prompt).toContain("Return 4 Gallery images");
    expect(prompt).toContain("at least 1200px");
    expect(prompt).toContain("Prefer square Gallery images");
    expect(prompt).toContain("Prefer official");
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

  it("builds separate AI Main and Gallery prompts", () => {
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
          main: { imagesPerRow: 1, instructions: "Studio hero only" },
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
      mainIndex: 0,
      mainTotal: 1,
    });
    const multiMainPrompt = buildAiMainPrompt({
      worksheet,
      row,
      referenceImages: [],
      mainIndex: 1,
      mainTotal: 3,
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
      galleryIndex: 0,
    });

    expect(mainPrompt).toContain("Main ecommerce image");
    expect(mainPrompt).toContain("Studio hero only");
    expect(mainPrompt).not.toContain("Show packaging");
    expect(mainPrompt).not.toContain("MULTIPLE MAIN IMAGES");
    expect(multiMainPrompt).toContain("MULTIPLE MAIN IMAGES");
    expect(multiMainPrompt).toContain("professionally distinct");
    expect(multiMainPrompt).toContain("Main image 2 of 3");
    expect(galleryPrompt).toContain("Gallery ecommerce image");
    expect(galleryPrompt).toContain("Show packaging");
    expect(galleryPrompt).not.toContain("Studio hero only");
  });
});
