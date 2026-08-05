import { describe, expect, it } from "vitest";
import {
  parseAiSettings,
  parseGalleryProjectSettings,
  parseScrapingSettings,
  shouldApplySubmittedResponse,
} from "@/lib/gallery/settings-schema";
import {
  DEFAULT_AI_SETTINGS,
  DEFAULT_SCRAPING_SETTINGS,
  normalizeGalleryWorksheet,
  type GalleryWorksheetJson,
} from "@/lib/gallery/types";

describe("gallery settings", () => {
  it("migrates legacy flexible/duplicate settings to strict invariants", () => {
    const worksheet = {
      sessionId: "session",
      columns: ["SKU"],
      originalImageColumn: null,
      selectedColumns: ["SKU"],
      settings: {
        provider: "google",
        google: {
          imagesPerRow: 20,
          candidates: 8,
          instructions: " exact ",
          duplicates: "allow",
          matchStrictness: "flexible",
        },
        ai: DEFAULT_AI_SETTINGS,
      },
      activeRun: null,
      rows: [],
    } as unknown as GalleryWorksheetJson;

    const normalized = normalizeGalleryWorksheet(worksheet);
    expect(normalized.settings.provider).toBe("scraping");
    expect(normalized.settings.scraping.imagesPerRow).toBe(12);
    expect(normalized.settings.scraping.searchDepth).toBe("low");
    expect(normalized.settings.scraping.duplicates).toBe("avoid");
    expect(normalized.settings.scraping.matchStrictness).toBe("strict");
  });

  it("rejects out-of-range and unknown settings", () => {
    expect(() =>
      parseScrapingSettings({
        imagesPerRow: 13,
        instructions: "",
        searchDepth: "extreme",
      })
    ).toThrow();
    expect(() =>
      parseScrapingSettings({
        imagesPerRow: 4,
        instructions: "x".repeat(2_001),
      })
    ).toThrow();
  });

  it("does not apply a stale save response after newer edits", () => {
    expect(shouldApplySubmittedResponse("new", "old")).toBe(false);
    expect(shouldApplySubmittedResponse("same", "same")).toBe(true);
  });

  it("preserves whether the original-image choice was explicit", () => {
    const parsed = parseGalleryProjectSettings({
      provider: "ai",
      originalImageColumn: null,
      originalImageSelectionExplicit: true,
      selectedColumns: ["SKU"],
      scraping: {
        ...DEFAULT_SCRAPING_SETTINGS,
      },
      ai: DEFAULT_AI_SETTINGS,
    });
    expect(parsed.originalImageSelectionExplicit).toBe(true);
  });

  it("defaults brandGuideMode from an existing guide path", () => {
    const parsed = parseAiSettings({
      ...DEFAULT_AI_SETTINGS,
      brandGuideMode: undefined,
      brandGuidePath: "workspace/gallery/s/settings/ai-assets/brand-guide.png",
    });
    expect(parsed.brandGuideMode).toBe("image");
  });

  it("defaults brandGuideMode to colors when no guide path exists", () => {
    const parsed = parseAiSettings({
      ...DEFAULT_AI_SETTINGS,
      brandGuideMode: undefined,
      brandGuidePath: null,
    });
    expect(parsed.brandGuideMode).toBe("colors");
  });
});
