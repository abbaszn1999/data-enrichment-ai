import { describe, expect, it } from "vitest";
import { classifyRowValues } from "./gallery-brief";
import { buildPlannerBrief } from "./planner-brief";
import {
  buildPlannerResponseSchema,
  galleryPlanFingerprint,
  guardGalleryPlan,
  readStoredGalleryPlan,
  type GalleryPlanFingerprintInput,
} from "./planner-plan";

const prompt = "Use image 1 as the exact product. Three-quarter view on a seamless grey sweep, soft key light from the left.";

function shot(index: number, overrides: Record<string, unknown> = {}) {
  return { index, perspective: "front", specClaim: "claim", prompt, useLogo: false, alt: "alt", ...overrides };
}

describe("guardGalleryPlan", () => {
  it("accepts exactly N prompts and sorts them", () => {
    const guarded = guardGalleryPlan(
      { productIdentity: "Red mug", gallery: [shot(2), shot(1)], notes: "" },
      2,
      { hasLogo: false }
    );
    expect(guarded.gallery.map((g) => g.index)).toEqual([1, 2]);
    expect(guarded.notes).toBeUndefined();
  });

  it("throws when a prompt is missing or too short", () => {
    expect(() =>
      guardGalleryPlan({ gallery: [shot(1), shot(2, { prompt: "short" })] }, 2, { hasLogo: false })
    ).toThrow(/1 usable prompts; expected 2/);
  });

  it("ignores duplicate and out-of-range indexes", () => {
    expect(() =>
      guardGalleryPlan({ gallery: [shot(1), shot(1), shot(5)] }, 2, { hasLogo: false })
    ).toThrow();
  });

  it("never allows the logo when none is attached", () => {
    const guarded = guardGalleryPlan({ gallery: [shot(1, { useLogo: true })] }, 1, { hasLogo: false });
    expect(guarded.gallery[0].useLogo).toBe(false);
    const withLogo = guardGalleryPlan({ gallery: [shot(1, { useLogo: true })] }, 1, { hasLogo: true });
    expect(withLogo.gallery[0].useLogo).toBe(true);
  });

  it("maps unknown perspectives to other", () => {
    const guarded = guardGalleryPlan({ gallery: [shot(1, { perspective: "weird" })] }, 1, { hasLogo: false });
    expect(guarded.gallery[0].perspective).toBe("other");
  });
});

describe("buildPlannerResponseSchema", () => {
  it("requires exactly N items", () => {
    const schema = buildPlannerResponseSchema(5) as { properties: { gallery: { minItems: number; maxItems: number } } };
    expect(schema.properties.gallery.minItems).toBe(5);
    expect(schema.properties.gallery.maxItems).toBe(5);
  });
});

describe("galleryPlanFingerprint", () => {
  const base: GalleryPlanFingerprintInput = {
    galleryCount: 4,
    tier: "standard",
    aspectRatio: "1:1",
    style: "studio",
    instructions: "model wears it",
    rowText: "- Title: Red dress",
    referenceKeys: ["product:a", "model:m"],
    brandingEnabled: false,
    brandGuideMode: "colors",
    brandColors: ["#111111"],
    groundWithSearch: false,
  };

  it("is stable for identical input", () => {
    expect(galleryPlanFingerprint(base)).toBe(galleryPlanFingerprint({ ...base }));
  });

  it.each([
    ["row data", { rowText: "- Title: Blue dress" }],
    ["instructions", { instructions: "different" }],
    ["a reference image", { referenceKeys: ["product:a", "model:other"] }],
    ["the count", { galleryCount: 5 }],
    ["the aspect ratio", { aspectRatio: "4:5" }],
    ["branding", { brandingEnabled: true }],
  ])("changes when %s changes", (_name, patch) => {
    expect(galleryPlanFingerprint({ ...base, ...patch })).not.toBe(galleryPlanFingerprint(base));
  });

  it("ignores brand colours while branding is off", () => {
    expect(galleryPlanFingerprint({ ...base, brandColors: ["#ffffff"] })).toBe(galleryPlanFingerprint(base));
  });
});

describe("readStoredGalleryPlan", () => {
  it("reuses only a matching fingerprint with complete prompts", () => {
    const plan = {
      fingerprint: "abc",
      productIdentity: "x",
      gallery: [{ index: 1, perspective: "front", specClaim: "", prompt, useLogo: false, alt: "" }],
    };
    const row = { sourceMeta: { plan } };
    expect(readStoredGalleryPlan(row, "abc", 1)?.gallery).toHaveLength(1);
    expect(readStoredGalleryPlan(row, "other", 1)).toBeNull();
    expect(readStoredGalleryPlan(row, "abc", 2)).toBeNull();
  });
});

describe("buildPlannerBrief", () => {
  const settings = {
    aspectRatio: "4:5",
    resolution: "2K",
    style: "studio",
    instructions: "Show the dress in a different outfit each time",
    brandingEnabled: true,
    brandGuideMode: "colors",
    brandColors: ["#111827", "#2563EB"],
  } as const;
  const classified = classifyRowValues({ Title: "Linen dress", Material: "Linen" }, ["Title", "Material"]);

  it("lists images in order, the frame, the count and the custom instructions", () => {
    const text = buildPlannerBrief({
      classified,
      count: 3,
      settings: { ...settings, brandColors: [...settings.brandColors] },
      imageModel: "gemini-3-pro-image",
      references: [
        { role: "product", label: "product photo, the trusted Main image of the exact item" },
        { role: "model", label: "model / scene reference" },
        { role: "logo", label: "brand logo" },
      ],
    });
    expect(text).toContain("Nano Banana Pro");
    expect(text).toContain("aspect ratio 4:5, 2K");
    expect(text).toContain("Image 1: product photo");
    expect(text).toContain("Image 3: brand logo");
    expect(text).toContain("exactly 3 distinct images");
    expect(text).toContain("Show the dress in a different outfit each time");
    expect(text).toContain("- Title: Linen dress");
    expect(text).toContain("#111827");
    expect(text).toContain("wears it");
  });

  it("tells the planner not to use a logo when none is attached", () => {
    const text = buildPlannerBrief({
      classified,
      count: 1,
      settings: { ...settings, brandColors: [] },
      imageModel: "gemini-3.1-flash-image",
      references: [{ role: "product", label: "p" }],
    });
    expect(text).toContain("No logo image is attached");
    expect(text).toContain("None attached. Do not invent a specific named person");
  });
});
