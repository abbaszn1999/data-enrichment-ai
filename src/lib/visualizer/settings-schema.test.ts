import { describe, expect, it } from "vitest";
import {
  clampVisualizerImageCount,
  getVisualizerLayout,
  resolveVisualizerLayoutSettings,
} from "@/lib/visualizer/layouts";
import { parseVisualizerProjectSettings } from "@/lib/visualizer/settings-schema";
import {
  createEmptyVisualizerWorksheet,
  resolveVisualizerDescriptionModel,
  resolveVisualizerImageModel,
} from "@/lib/visualizer/types";

describe("visualizer foundation settings", () => {
  it("parses defaults and forces fixed image/thinking settings", () => {
    const parsed = parseVisualizerProjectSettings({});
    expect(parsed.description.tier).toBe("standard");
    expect(parsed.description.thinkingLevel).toBe("medium");
    expect(parsed.description.layoutId).toBe("zigzag");
    expect(parsed.description.imageCount).toBe(4);
    expect(parsed.description.maxPlaceholders).toBe(4);
    expect(parsed.images.tier).toBe("premium");
    expect(parsed.images.aspectRatio).toBe("1:1");
    expect(parsed.images.resolution).toBe("1K");
    expect(parsed.images.instructions).toBe("");
    expect(parsed.images.sceneReferencePath).toBeNull();
    expect(parsed.images.style).toBe("lifestyle");
    expect(parsed.images.brandGuideMode).toBe("colors");
    expect(parsed.selectedColumns).toEqual([]);
    expect(parsed.productImageColumn).toBeNull();
    expect(parsed.brand.colorPrimary).toBe("#111827");
  });

  it("overrides legacy image/thinking settings on parse", () => {
    const parsed = parseVisualizerProjectSettings({
      description: { thinkingLevel: "high", maxPlaceholders: 2 },
      images: {
        tier: "standard",
        aspectRatio: "16:9",
        resolution: "4K",
        instructions: "old custom",
        sceneReferencePath: "ws/scene.png",
        groundWithSearch: true,
      },
    });
    expect(parsed.description.thinkingLevel).toBe("medium");
    expect(parsed.description.layoutId).toBe("zigzag");
    expect(parsed.description.imageCount).toBe(2);
    expect(parsed.images.tier).toBe("premium");
    expect(parsed.images.aspectRatio).toBe("1:1");
    expect(parsed.images.resolution).toBe("1K");
    expect(parsed.images.instructions).toBe("");
    expect(parsed.images.sceneReferencePath).toBeNull();
    expect(parsed.images.groundWithSearch).toBe(false);
  });

  it("clamps imageCount to the selected layout bounds", () => {
    const hero = parseVisualizerProjectSettings({
      description: { layoutId: "spotlight", imageCount: 6 },
    });
    expect(hero.description.layoutId).toBe("spotlight");
    expect(hero.description.imageCount).toBe(3);

    const grid = parseVisualizerProjectSettings({
      description: { layoutId: "feature-grid", imageCount: 1 },
    });
    expect(grid.description.imageCount).toBe(3);

    expect(clampVisualizerImageCount("mosaic", 2)).toBe(4);
    expect(getVisualizerLayout("stacked-squares").name).toBe("Stacked Squares");
    expect(getVisualizerLayout("carousel").name).toBe("Carousel");
    expect(
      resolveVisualizerLayoutSettings({
        layoutId: "zigzag",
        maxPlaceholders: 5,
      }).imageCount
    ).toBe(5);
  });

  it("migrates legacy layout ids to square-friendly layouts", () => {
    const parsed = parseVisualizerProjectSettings({
      description: { layoutId: "magazine-mix", imageCount: 4 },
    });
    expect(parsed.description.layoutId).toBe("mosaic");
  });

  it("defaults brandGuideMode to image when a guide path already exists", () => {
    const parsed = parseVisualizerProjectSettings({
      images: {
        brandGuidePath: "ws/guide.png",
      },
    });
    expect(parsed.images.brandGuideMode).toBe("image");
  });

  it("migrates legacy mapping.productImage to productImageColumn", () => {
    const parsed = parseVisualizerProjectSettings({
      mapping: {
        productName: "Name",
        productImage: "Product Image",
      },
    });
    expect(parsed.productImageColumn).toBe("Product Image");
  });

  it("maps tiers to the same models used by Gallery", () => {
    expect(resolveVisualizerDescriptionModel("standard")).toBe("gpt-5.6-terra");
    expect(resolveVisualizerDescriptionModel("premium")).toBe("gpt-5.6-sol");
    expect(resolveVisualizerImageModel("standard")).toBe(
      "gemini-3.1-flash-image"
    );
    expect(resolveVisualizerImageModel("premium")).toBe("gemini-3-pro-image");
  });

  it("creates an empty worksheet with selected columns", () => {
    const worksheet = createEmptyVisualizerWorksheet(
      "session-1",
      ["SKU", "Name"],
      [{ id: "r1", rowIndex: 0, originalData: { SKU: "A", Name: "Product" } }]
    );
    expect(worksheet.rows).toHaveLength(1);
    expect(worksheet.rows[0]?.status).toBe("not_started");
    expect(worksheet.settings.selectedColumns).toEqual(["SKU", "Name"]);
    expect(worksheet.settings.description.imageCount).toBe(4);
    expect(worksheet.settings.description.layoutId).toBe("zigzag");
    expect(worksheet.settings.images.tier).toBe("premium");
    expect(worksheet.settings.description.thinkingLevel).toBe("medium");
  });
});
