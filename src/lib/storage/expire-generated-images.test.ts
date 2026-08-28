import { describe, expect, it } from "vitest";
import { isGeneratedRowImagePath } from "./expire-generated-images";

describe("isGeneratedRowImagePath", () => {
  it("keeps Gallery and Visualizer generated row images", () => {
    expect(
      isGeneratedRowImagePath(
        "d1048967-0610-4e4a-9195-c846835fd807/gallery/abc/rows/r1/main-1.jpg"
      )
    ).toBe(true);
    expect(
      isGeneratedRowImagePath(
        "ws/gallery/sess/rows/r1/gallery/shot.webp"
      )
    ).toBe(true);
    expect(
      isGeneratedRowImagePath(
        "ws/description-visualizer/sess/rows/r1/image-1-uuid.png"
      )
    ).toBe(true);
  });

  it("skips worksheets, uploads, exports, and brand assets", () => {
    expect(isGeneratedRowImagePath("ws/gallery/sess/worksheet.json")).toBe(false);
    expect(isGeneratedRowImagePath("ws/gallery/sess/source-catalog.xlsx")).toBe(false);
    expect(isGeneratedRowImagePath("ws/gallery/sess/exports/1.xlsx")).toBe(false);
    expect(
      isGeneratedRowImagePath("ws/gallery/sess/settings/ai-assets/logo.png")
    ).toBe(false);
    expect(
      isGeneratedRowImagePath(
        "ws/description-visualizer/sess/settings/ai-assets/brand-guide.jpg"
      )
    ).toBe(false);
    expect(isGeneratedRowImagePath("https://cdn.example/photo.jpg")).toBe(false);
    expect(isGeneratedRowImagePath("ws/gallery/../rows/x.jpg")).toBe(false);
  });
});
