import { describe, expect, it } from "vitest";
import {
  embedVisualizerPlaceholders,
  resolveVisualizerHtmlImages,
} from "@/lib/visualizer/html-embed";
import { buildVisualizerImagePrompt } from "@/lib/visualizer/agents/image-agent";
import { estimateImageCredits } from "@/lib/visualizer/pricing";
import { DEFAULT_VISUALIZER_SETTINGS } from "@/lib/visualizer/types";

describe("visualizer images phase helpers", () => {
  it("embeds storage-backed images into placeholder markers", () => {
    const html = embedVisualizerPlaceholders(
      "<p>Intro</p>[imageplaceholder-1]<p>More</p>[imageplaceholder-2]",
      [
        {
          index: 1,
          visualBrief: "brief one",
          alt: "Hero",
          storagePath: "ws/description-visualizer/s/rows/r/image-1.jpg",
        },
        {
          index: 2,
          visualBrief: "brief two",
          alt: "Detail",
          storagePath: "ws/description-visualizer/s/rows/r/image-2.jpg",
        },
      ]
    );
    expect(html).toContain('src="vz-storage:ws/description-visualizer/s/rows/r/image-1.jpg"');
    expect(html).toContain('alt="Hero"');
    expect(html).not.toContain("[imageplaceholder-1]");
    expect(html).not.toContain("[imageplaceholder-2]");
  });

  it("resolves storage tokens to signed urls", () => {
    const resolved = resolveVisualizerHtmlImages(
      '<img src="vz-storage:path/a.jpg" alt="A" />',
      { "path/a.jpg": "https://cdn.example/a.jpg?sig=1" }
    );
    expect(resolved).toContain('src="https://cdn.example/a.jpg?sig=1"');
  });

  it("builds an image prompt that keeps product identity", () => {
    const prompt = buildVisualizerImagePrompt({
      product: { productName: "Ceramic mug" },
      visualBrief: "Morning lifestyle scene with soft daylight",
      placeholderIndex: 2,
      brand: DEFAULT_VISUALIZER_SETTINGS.brand,
      images: DEFAULT_VISUALIZER_SETTINGS.images,
      hasLogo: false,
      hasBrandGuide: false,
      referenceList: "",
    });
    expect(prompt).toContain("Ceramic mug");
    expect(prompt).toContain("Morning lifestyle scene");
    expect(prompt).toContain("placeholder 2");
  });

  it("omits hex palette from image prompt when brand guide is upload-image mode", () => {
    const prompt = buildVisualizerImagePrompt({
      product: { productName: "Ceramic mug" },
      visualBrief: "Morning lifestyle scene",
      placeholderIndex: 1,
      brand: DEFAULT_VISUALIZER_SETTINGS.brand,
      images: {
        ...DEFAULT_VISUALIZER_SETTINGS.images,
        brandingEnabled: true,
        brandGuideMode: "image",
        brandColors: ["#111827", "#2563EB", "#F59E0B"],
      },
      hasLogo: true,
      hasBrandGuide: true,
      referenceList: "Reference image 2: brand guide",
    });
    expect(prompt).toContain("brand-guide");
    expect(prompt).not.toContain("Brand palette");
    expect(prompt).not.toContain("Brand primary color:");
    expect(prompt).not.toContain("#111827");
  });

  it("estimates image credits from placeholder count", () => {
    const estimate = estimateImageCredits({
      placeholderCount: 8,
      images: { tier: "premium", resolution: "1K" },
    });
    expect(estimate.min).toBeGreaterThan(0);
    expect(estimate.max).toBeGreaterThanOrEqual(estimate.min);
  });
});
