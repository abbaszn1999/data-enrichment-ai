import { describe, expect, it } from "vitest";
import {
  resolveGalleryRunPhase,
  resolveSelectionRunPhase,
} from "@/lib/gallery/types";

describe("resolveGalleryRunPhase", () => {
  it("uses full when an original image column is set", () => {
    expect(
      resolveGalleryRunPhase({
        originalImageColumn: "Image",
        row: { mainImagePath: null, mainImagePaths: [] },
        requested: "main",
      })
    ).toBe("full");
  });

  it("honors an explicit requested phase", () => {
    expect(
      resolveGalleryRunPhase({
        originalImageColumn: null,
        row: {
          mainImagePath: "https://cdn.example/main.png",
          mainImagePaths: ["https://cdn.example/main.png"],
        },
        requested: "main",
      })
    ).toBe("main");
  });

  it("auto-selects gallery when Main already exists", () => {
    expect(
      resolveGalleryRunPhase({
        originalImageColumn: null,
        row: {
          mainImagePath: "https://cdn.example/main.png",
          mainImagePaths: ["https://cdn.example/main.png"],
        },
      })
    ).toBe("gallery");
  });

  it("auto-selects main when no Main exists", () => {
    expect(
      resolveGalleryRunPhase({
        originalImageColumn: null,
        row: { mainImagePath: null, mainImagePaths: [] },
      })
    ).toBe("main");
  });
});

describe("resolveSelectionRunPhase", () => {
  it("labels Generate gallery when every selected row has Main", () => {
    const result = resolveSelectionRunPhase({
      originalImageColumn: null,
      rows: [
        {
          mainImagePath: "https://cdn.example/a.png",
          mainImagePaths: ["https://cdn.example/a.png"],
        },
        {
          mainImagePath: "https://cdn.example/b.png",
          mainImagePaths: ["https://cdn.example/b.png"],
        },
      ],
    });
    expect(result).toEqual({ phase: "gallery", label: "Generate gallery" });
  });

  it("labels Generate main when no selected row has Main", () => {
    const result = resolveSelectionRunPhase({
      originalImageColumn: null,
      rows: [
        { mainImagePath: null, mainImagePaths: [] },
        { mainImagePath: null },
      ],
    });
    expect(result).toEqual({ phase: "main", label: "Generate main" });
  });

  it("marks mixed selections so the server can resolve per row", () => {
    const result = resolveSelectionRunPhase({
      originalImageColumn: null,
      rows: [
        {
          mainImagePath: "https://cdn.example/a.png",
          mainImagePaths: ["https://cdn.example/a.png"],
        },
        { mainImagePath: null, mainImagePaths: [] },
      ],
    });
    expect(result).toEqual({ phase: "mixed", label: "Generate selected" });
  });
});
