import { describe, expect, it } from "vitest";
import {
  resolveGalleryRunPhase,
  resolveSelectionRunPhase,
} from "@/lib/gallery/types";

describe("resolveGalleryRunPhase", () => {
  it("honors an explicit phase even when an original column is set", () => {
    expect(
      resolveGalleryRunPhase({
        originalImageColumn: "Image",
        row: {
          mainImagePath: null,
          mainImagePaths: [],
          originalData: { Image: "https://cdn.example/original.png" },
        },
        requested: "main",
      })
    ).toBe("main");
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

  it("auto-selects main only when no Main exists and no original image is set", () => {
    expect(
      resolveGalleryRunPhase({
        originalImageColumn: null,
        row: { mainImagePath: null, mainImagePaths: [] },
      })
    ).toBe("main");
  });

  it("auto-selects main only (not full) when the original column has no usable URL", () => {
    expect(
      resolveGalleryRunPhase({
        originalImageColumn: "Image",
        row: {
          mainImagePath: null,
          mainImagePaths: [],
          originalData: { Image: "" },
        },
      })
    ).toBe("main");
  });

  it("auto-selects full (Gallery only, Main resolved from column) when the original column has a URL", () => {
    expect(
      resolveGalleryRunPhase({
        originalImageColumn: "Image",
        row: {
          mainImagePath: null,
          mainImagePaths: [],
          originalData: { Image: "https://cdn.example/original.png" },
        },
      })
    ).toBe("full");
  });

  it("auto-selects full when the original column has multiple URLs", () => {
    expect(
      resolveGalleryRunPhase({
        originalImageColumn: "Image",
        row: {
          mainImagePath: null,
          mainImagePaths: [],
          originalData: {
            Image:
              "https://cdn.example/front.png https://cdn.example/back.png",
          },
        },
      })
    ).toBe("full");
  });

  it("uses existing Main when the selected original cell is empty", () => {
    expect(
      resolveGalleryRunPhase({
        originalImageColumn: "Image",
        row: {
          mainImagePath: "stored/main.png",
          mainImagePaths: ["stored/main.png"],
          originalData: { Image: "" },
        },
      })
    ).toBe("gallery");
  });

  it("AI remaps requested main to full so Generate never stops after Main", () => {
    expect(
      resolveGalleryRunPhase({
        originalImageColumn: null,
        row: { mainImagePath: null, mainImagePaths: [] },
        requested: "main",
        provider: "ai",
      })
    ).toBe("full");
  });

  it("AI auto-selects full when creating Main with AI", () => {
    expect(
      resolveGalleryRunPhase({
        originalImageColumn: null,
        row: { mainImagePath: null, mainImagePaths: [] },
        provider: "ai",
      })
    ).toBe("full");
  });

  it("AI auto-selects gallery when a sheet photo exists", () => {
    expect(
      resolveGalleryRunPhase({
        originalImageColumn: "Image",
        row: {
          mainImagePath: null,
          mainImagePaths: [],
          originalData: { Image: "https://cdn.example/original.png" },
        },
        provider: "ai",
      })
    ).toBe("gallery");
  });

  it("AI auto-selects gallery when Main already exists", () => {
    expect(
      resolveGalleryRunPhase({
        originalImageColumn: null,
        row: {
          mainImagePath: "stored/main.png",
          mainImagePaths: ["stored/main.png"],
        },
        provider: "ai",
      })
    ).toBe("gallery");
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

  it("labels Generate full on the AI tab when creating Main", () => {
    const result = resolveSelectionRunPhase({
      originalImageColumn: null,
      rows: [{ mainImagePath: null, mainImagePaths: [] }],
      provider: "ai",
    });
    expect(result).toEqual({ phase: "full", label: "Generate full" });
  });

  it("labels Generate gallery on the AI tab when a sheet photo exists", () => {
    const result = resolveSelectionRunPhase({
      originalImageColumn: "Image",
      rows: [
        {
          mainImagePath: null,
          mainImagePaths: [],
          originalData: { Image: "https://cdn.example/a.png" },
        },
      ],
      provider: "ai",
    });
    expect(result).toEqual({ phase: "gallery", label: "Generate gallery" });
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
