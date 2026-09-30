import { describe, expect, it } from "vitest";
import { buildVisualizerPlannerBrief } from "./planner-brief";
import {
  buildVisualizerPlannerSchema,
  cleanPlannerHtml,
  guardVisualizerPlan,
  resolveSlotPrompt,
} from "./planner-plan";
import { resolveVisualizerDescriptionModel, resolveVisualizerImageModel } from "@/lib/visualizer/types";
import { normalizeVisualizerWorksheet, type VisualizerWorksheetJson } from "@/lib/visualizer/types";
import { parseVisualizerProjectSettings } from "@/lib/visualizer/settings-schema";
import { VISUALIZER_PLANNER_OPENAI_MODEL, VISUALIZER_PLANNER_REASONING_EFFORT } from "@/lib/enrich/models";

const classified = {
  fields: [
    { column: "Title", value: "Trail Runner GTX" },
    { column: "Features", value: "Waterproof membrane, Vibram outsole" },
  ],
  imageUrls: [],
  sourceUrls: [],
};

const baseInput = {
  classified,
  layoutId: "zigzag" as const,
  count: 3,
  imageModel: "gemini-3.1-flash-image" as const,
  images: {
    aspectRatio: "1:1",
    resolution: "1K",
    style: "lifestyle" as const,
    brandingEnabled: false,
    brandGuideMode: "colors" as const,
    brandColors: ["#111827", "#2563EB", "#F59E0B"],
  },
  brand: { styleNotes: "", fontsNotes: "" },
  customInstructions: "",
  references: [{ role: "product", label: "product photo, the trusted Main image of the exact item" }],
};

describe("buildVisualizerPlannerBrief", () => {
  it("states the layout, the exact markers, the frame and the attached images", () => {
    const brief = buildVisualizerPlannerBrief(baseInput);
    expect(brief).toContain("Nano Banana 2");
    expect(brief).toContain("aspect ratio 1:1, 1K");
    expect(brief).toContain("Layout: Zigzag (zigzag). Exactly 3 image slots.");
    expect(brief).toContain("[imageplaceholder-1], [imageplaceholder-2], [imageplaceholder-3]");
    expect(brief).toContain("Image 1: product photo");
    expect(brief).toContain("- Title: Trail Runner GTX");
    expect(brief).toContain("Branding is off");
  });

  it("names Nano Banana Pro for the premium image model", () => {
    const brief = buildVisualizerPlannerBrief({ ...baseInput, imageModel: "gemini-3-pro-image" });
    expect(brief).toContain("Nano Banana Pro");
  });

  it("puts custom instructions in the highest priority section", () => {
    const brief = buildVisualizerPlannerBrief({ ...baseInput, customInstructions: "Trail scenes at dawn" });
    expect(brief).toContain("## Custom instructions (store owner, highest priority)\nTrail scenes at dawn");
  });

  it("only allows the logo when one is attached and branding is on", () => {
    const withLogo = buildVisualizerPlannerBrief({
      ...baseInput,
      images: { ...baseInput.images, brandingEnabled: true },
      references: [...baseInput.references, { role: "logo", label: "brand logo: keep its exact mark" }],
    });
    expect(withLogo).toContain("Set useLogo true only on shots where the logo would naturally appear");
    expect(withLogo).toContain("Brand palette: #111827, #2563EB, #F59E0B");
    const noLogo = buildVisualizerPlannerBrief({
      ...baseInput,
      images: { ...baseInput.images, brandingEnabled: true },
    });
    expect(noLogo).toContain("No logo image is attached. Set useLogo false on every shot");
  });

  it("uses the brand guide image instead of a palette in image mode", () => {
    const brief = buildVisualizerPlannerBrief({
      ...baseInput,
      images: { ...baseInput.images, brandingEnabled: true, brandGuideMode: "image" },
      references: [...baseInput.references, { role: "brandGuide", label: "brand guide: visual language and mood to follow" }],
    });
    expect(brief).toContain("A brand guide image is attached");
    expect(brief).not.toContain("Brand palette");
  });

  it("repeats a rejection hint on the retry", () => {
    const brief = buildVisualizerPlannerBrief({ ...baseInput, retryHint: "Description must contain [imageplaceholder-2] exactly once" });
    expect(brief).toContain("## Fix your previous answer");
    expect(brief).toContain("[imageplaceholder-2] exactly once");
  });
});

const goodPrompt =
  "Use image 1 as the exact product. Three-quarter view on wet slate with water beading on the membrane, soft overcast light, square frame.";

function plan(overrides: Record<string, unknown> = {}) {
  return {
    productIdentity: "Grey trail shoe with orange laces",
    description:
      "<article><h2>Trail Runner GTX</h2><p>Stay dry on every run with a waterproof membrane and a grippy outsole that holds on wet rock.</p><div>[imageplaceholder-1]</div><p>More copy here to describe the sole in detail.</p><div>[imageplaceholder-2]</div></article>",
    imagePlaceholders: [
      { index: 1, perspective: "three_quarter", specClaim: "waterproof", prompt: goodPrompt, useLogo: true, alt: "Waterproof trail shoe" },
      { index: 2, perspective: "close_up_detail", specClaim: "grip", prompt: goodPrompt, useLogo: false, alt: "Outsole grip" },
    ],
    notes: "",
    ...overrides,
  };
}

describe("guardVisualizerPlan", () => {
  it("returns exactly N slots with prompt, perspective and the logo flag", () => {
    const guarded = guardVisualizerPlan(plan(), 2, { hasLogo: true });
    expect(guarded.imagePlaceholders).toHaveLength(2);
    expect(guarded.imagePlaceholders[0]).toMatchObject({
      index: 1,
      perspective: "three_quarter",
      specClaim: "waterproof",
      prompt: goodPrompt,
      visualBrief: goodPrompt,
      useLogo: true,
      storagePath: null,
    });
    expect(guarded.productIdentity).toContain("trail shoe");
  });

  it("drops the logo flag when no logo is attached", () => {
    const guarded = guardVisualizerPlan(plan(), 2, { hasLogo: false });
    expect(guarded.imagePlaceholders.every((item) => item.useLogo === false)).toBe(true);
  });

  it("rejects a marker that is missing or duplicated", () => {
    const missing = plan({ description: "<article><p>" + "x".repeat(200) + "</p><div>[imageplaceholder-1]</div></article>" });
    expect(() => guardVisualizerPlan(missing, 2, { hasLogo: false })).toThrow(/imageplaceholder-2\] exactly once \(found 0\)/);
    const duplicate = plan({
      description: "<article><p>" + "x".repeat(200) + "</p><div>[imageplaceholder-1][imageplaceholder-1]</div><div>[imageplaceholder-2]</div></article>",
    });
    expect(() => guardVisualizerPlan(duplicate, 2, { hasLogo: false })).toThrow(/imageplaceholder-1\] exactly once \(found 2\)/);
  });

  it("rejects too few usable prompts", () => {
    const short = plan({
      imagePlaceholders: [
        { index: 1, perspective: "front", specClaim: "a", prompt: "too short", useLogo: false, alt: "a" },
        { index: 2, perspective: "front", specClaim: "b", prompt: goodPrompt, useLogo: false, alt: "b" },
      ],
    });
    expect(() => guardVisualizerPlan(short, 2, { hasLogo: false })).toThrow(/1 usable image prompts; expected 2/);
  });

  it("rejects scripts and event handlers", () => {
    const script = plan({
      description: "<article><script>alert(1)</script><p>" + "x".repeat(200) + "</p>[imageplaceholder-1][imageplaceholder-2]</article>",
    });
    expect(() => guardVisualizerPlan(script, 2, { hasLogo: false })).toThrow(/unsafe HTML/);
    const handler = plan({
      description: '<article><p onclick="x()">' + "x".repeat(200) + "</p>[imageplaceholder-1][imageplaceholder-2]</article>",
    });
    expect(() => guardVisualizerPlan(handler, 2, { hasLogo: false })).toThrow(/unsafe HTML/);
  });

  it("strips fences, document wrappers and stray images", () => {
    const cleaned = cleanPlannerHtml('```html\n<html><body><p>Hi</p><img src="x.jpg"></body></html>\n```');
    expect(cleaned).toBe("<p>Hi</p>");
  });

  it("falls back to an unknown perspective", () => {
    const guarded = guardVisualizerPlan(
      plan({
        imagePlaceholders: [
          { index: 1, perspective: "weird", specClaim: "a", prompt: goodPrompt, useLogo: false, alt: "a" },
          { index: 2, perspective: "front", specClaim: "b", prompt: goodPrompt, useLogo: false, alt: "b" },
        ],
      }),
      2,
      { hasLogo: false }
    );
    expect(guarded.imagePlaceholders[0].perspective).toBe("other");
  });
});

describe("buildVisualizerPlannerSchema", () => {
  it("requires exactly N slots with a finished prompt each", () => {
    const schema = buildVisualizerPlannerSchema(4) as {
      required: string[];
      properties: { imagePlaceholders: { minItems: number; maxItems: number; items: { required: string[] } } };
    };
    expect(schema.required).toEqual(["productIdentity", "description", "imagePlaceholders", "notes"]);
    expect(schema.properties.imagePlaceholders.minItems).toBe(4);
    expect(schema.properties.imagePlaceholders.maxItems).toBe(4);
    expect(schema.properties.imagePlaceholders.items.required).toEqual([
      "index",
      "perspective",
      "specClaim",
      "prompt",
      "useLogo",
      "alt",
    ]);
  });
});

describe("resolveSlotPrompt", () => {
  it("uses the planner prompt when present", () => {
    expect(resolveSlotPrompt({ index: 1, visualBrief: "old", alt: "a", prompt: goodPrompt })).toBe(goodPrompt);
  });

  it("builds a safe prompt from the brief of an older row", () => {
    const prompt = resolveSlotPrompt({ index: 1, visualBrief: "Shoe splashing through a puddle", alt: "a" });
    expect(prompt).toContain("Use image 1 as the exact product");
    expect(prompt).toContain("Shoe splashing through a puddle");
    expect(prompt).toContain("No text overlays");
  });
});

describe("models and tier", () => {
  it("uses GPT-6.1 Sol medium for the planner on both tiers", () => {
    expect(VISUALIZER_PLANNER_OPENAI_MODEL).toBe("gpt-6.1-sol");
    expect(VISUALIZER_PLANNER_REASONING_EFFORT).toBe("medium");
    expect(resolveVisualizerDescriptionModel("standard")).toBe("gpt-6.1-sol");
    expect(resolveVisualizerDescriptionModel("premium")).toBe("gpt-6.1-sol");
  });

  it("maps Standard to Nano Banana 2 and Premium to Nano Banana Pro", () => {
    expect(resolveVisualizerImageModel("standard")).toBe("gemini-3.1-flash-image");
    expect(resolveVisualizerImageModel("premium")).toBe("gemini-3-pro-image");
  });

  it("keeps the saved images tier and defaults new projects to standard", () => {
    expect(parseVisualizerProjectSettings({}).images.tier).toBe("standard");
    expect(parseVisualizerProjectSettings({ images: { tier: "premium" } }).images.tier).toBe("premium");
    expect(parseVisualizerProjectSettings({ images: { tier: "standard" } }).images.tier).toBe("standard");
  });
});

describe("normalizeVisualizerWorksheet", () => {
  it("keeps the planner prompt, perspective and logo flag on placeholders", () => {
    const worksheet = {
      sessionId: "s1",
      columns: ["Title"],
      settings: parseVisualizerProjectSettings({}),
      activeRun: null,
      rows: [
        {
          id: "r1",
          rowIndex: 0,
          status: "description_ready",
          originalData: { Title: "Shoe" },
          generatedDescription: "<p>[imageplaceholder-1]</p>",
          imagePlaceholders: [
            { index: 1, visualBrief: goodPrompt, alt: "a", specClaim: "waterproof", prompt: goodPrompt, perspective: "front", useLogo: true, storagePath: null },
          ],
        },
      ],
    } as unknown as VisualizerWorksheetJson;
    const normalized = normalizeVisualizerWorksheet(worksheet);
    expect(normalized.rows[0].imagePlaceholders?.[0]).toMatchObject({
      prompt: goodPrompt,
      perspective: "front",
      useLogo: true,
      specClaim: "waterproof",
    });
  });
});
