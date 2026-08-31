import { describe, expect, it } from "vitest";
import {
  DEFAULT_AI_SETTINGS,
  DEFAULT_SCRAPING_SETTINGS,
  type GalleryProjectSettings,
  type GalleryWorksheetJson,
} from "@/lib/gallery/types";
import {
  hydrateGalleryWorksheetForJob,
  parseGalleryJobRuntimeSettings,
} from "./gallery-settings";

function strippedWorksheet(): GalleryWorksheetJson {
  return {
    sessionId: "session-1",
    columns: ["Name"],
    originalImageColumn: null,
    originalImageSelectionExplicit: true,
    selectedColumns: ["Name"],
    settings: {
      provider: "scraping",
      scraping: { ...DEFAULT_SCRAPING_SETTINGS },
      ai: DEFAULT_AI_SETTINGS,
    },
    activeRun: null,
    rows: [],
  };
}

function projectSettings(
  imagesPerRow: number
): GalleryProjectSettings {
  return {
    provider: "scraping",
    originalImageColumn: null,
    originalImageSelectionExplicit: true,
    selectedColumns: ["Name"],
    scraping: {
      ...DEFAULT_SCRAPING_SETTINGS,
      imagesPerRow,
      main: { imagesPerRow: 1, instructions: "" },
    },
    ai: DEFAULT_AI_SETTINGS,
  };
}

describe("hydrateGalleryWorksheetForJob", () => {
  it("restores the run's gallery count onto a defaulted worksheet", () => {
    const worksheet = strippedWorksheet();
    expect(worksheet.settings.scraping.imagesPerRow).toBe(4);

    const hydrated = hydrateGalleryWorksheetForJob(
      worksheet,
      projectSettings(2)
    );

    expect(hydrated.settings.scraping.imagesPerRow).toBe(2);
    expect(hydrated.settings.scraping.main.imagesPerRow).toBe(1);
  });

  it("leaves the worksheet unchanged when the job has no runtime settings", () => {
    const worksheet = strippedWorksheet();
    const hydrated = hydrateGalleryWorksheetForJob(worksheet, null);
    expect(hydrated.settings.scraping.imagesPerRow).toBe(4);
  });
});

describe("parseGalleryJobRuntimeSettings", () => {
  it("accepts a stored job snapshot", () => {
    const parsed = parseGalleryJobRuntimeSettings(projectSettings(2));
    expect(parsed?.scraping.imagesPerRow).toBe(2);
  });

  it("rejects missing snapshots", () => {
    expect(parseGalleryJobRuntimeSettings(undefined)).toBeNull();
    expect(parseGalleryJobRuntimeSettings("nope")).toBeNull();
  });
});
