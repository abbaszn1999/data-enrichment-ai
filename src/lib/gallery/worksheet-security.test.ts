import { describe, expect, it } from "vitest";
import {
  DEFAULT_AI_SETTINGS,
  DEFAULT_SCRAPING_SETTINGS,
  type GalleryWorksheetJson,
} from "@/lib/gallery/types";
import {
  galleryReferencePathsBelongToSession,
  worksheetImageRefsBelongToSession,
} from "@/lib/gallery/worksheet-security";

function worksheet(paths: string[]): GalleryWorksheetJson {
  return {
    sessionId: "session",
    columns: ["SKU"],
    originalImageColumn: null,
    selectedColumns: ["SKU"],
    settings: {
      provider: "scraping",
      scraping: DEFAULT_SCRAPING_SETTINGS,
      ai: DEFAULT_AI_SETTINGS,
    },
    activeRun: null,
    rows: [
      {
        id: "row",
        rowIndex: 0,
        status: "ready",
        originalData: { SKU: "1" },
        mainImagePath: paths[0] ?? null,
        mainImagePaths: paths.slice(0, 1),
        galleryImagePaths: paths.slice(1),
      },
    ],
  };
}

describe("worksheet image path authorization", () => {
  it("allows this session's private rows and external source URLs", () => {
    expect(
      worksheetImageRefsBelongToSession(
        worksheet([
          "workspace/gallery/session/rows/row/main-a.png",
          "https://cdn.example/gallery.jpg",
        ]),
        "workspace",
        "session"
      )
    ).toBe(true);
  });

  it("rejects private paths belonging to another workspace", () => {
    expect(
      worksheetImageRefsBelongToSession(
        worksheet(["other/gallery/session/rows/row/main-a.png"]),
        "workspace",
        "session"
      )
    ).toBe(false);
  });

  it("only allows references from this session's settings folder", () => {
    const settings = {
      provider: "ai" as const,
      originalImageColumn: null,
      originalImageSelectionExplicit: true,
      selectedColumns: ["SKU"],
      scraping: DEFAULT_SCRAPING_SETTINGS,
      ai: {
        ...DEFAULT_AI_SETTINGS,
        logoPath: "workspace/gallery/session/settings/ai-assets/logo.png",
      },
    };
    expect(
      galleryReferencePathsBelongToSession(
        settings,
        "workspace",
        "session"
      )
    ).toBe(true);
    expect(
      galleryReferencePathsBelongToSession(
        {
          ...settings,
          ai: {
            ...settings.ai,
            logoPath: "workspace/gallery/other/rows/row/main.png",
          },
        },
        "workspace",
        "session"
      )
    ).toBe(false);
  });
});
