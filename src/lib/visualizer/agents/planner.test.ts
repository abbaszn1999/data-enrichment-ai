import { describe, expect, it } from "vitest";
import { buildVisualizerPlannerBrief } from "./planner-brief";
import { buildVisualizerPlannerSchema, guardVisualizerPlan, resolveSlotPrompt, resolveSlotShot } from "./planner-plan";
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
  it("states the layout, the fixed template, the frame and the attached images", () => {
    const brief = buildVisualizerPlannerBrief(baseInput);
    expect(brief).toContain("Nano Banana 2");
    expect(brief).toContain("aspect ratio 1:1, 1K");
    expect(brief).toContain("Layout: Zigzag (zigzag). Exactly 3 image slots.");
    expect(brief).toContain("you write the text only");
    expect(brief).toContain("body up to 480 characters;");
    expect(brief).not.toContain("[imageplaceholder-");
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

  it("gives small cards the short body limit", () => {
    const brief = buildVisualizerPlannerBrief({ ...baseInput, layoutId: "mosaic", count: 5 });
    expect(brief).toContain("except slots 3, 4, 5 (small cards): up to 240 characters");
    const grid = buildVisualizerPlannerBrief({ ...baseInput, layoutId: "feature-grid", count: 3 });
    expect(grid).toContain("body up to 240 characters;");
  });

  it("repeats a rejection hint on the retry", () => {
    const brief = buildVisualizerPlannerBrief({ ...baseInput, retryHint: "Image slot 2 is missing its heading or body copy" });
    expect(brief).toContain("## Fix your previous answer");
    expect(brief).toContain("Image slot 2 is missing its heading or body copy");
  });
});

const goodPrompt =
  "Use image 1 as the exact product. Three-quarter view on wet slate with water beading on the membrane, soft overcast light, square frame.";

function slot(index: number, overrides: Record<string, unknown> = {}) {
  return {
    index,
    perspective: index === 1 ? "three_quarter" : "close_up_detail",
    specClaim: index === 1 ? "waterproof" : "grip",
    heading: index === 1 ? "Dry on every run" : "Grip on wet rock",
    body: "A waterproof membrane keeps feet dry while the outsole holds on wet stone.",
    bullets: ["Sealed seams"],
    prompt: goodPrompt,
    useLogo: index === 1,
    alt: index === 1 ? "Waterproof trail shoe" : "Outsole grip",
    ...overrides,
  };
}

function plan(overrides: Record<string, unknown> = {}) {
  return {
    productIdentity: "Grey trail shoe with orange laces",
    headline: "Trail Runner GTX",
    intro: "Stay dry on every run with a waterproof membrane and a grippy outsole.",
    closing: "Built for the wettest trails.",
    imagePlaceholders: [slot(1), slot(2)],
    notes: "",
    ...overrides,
  };
}

const zigzag = { layoutId: "zigzag" as const };

describe("guardVisualizerPlan", () => {
  it("returns exactly N slots with prompt, perspective and the logo flag", () => {
    const guarded = guardVisualizerPlan(plan(), 2, { hasLogo: true, ...zigzag });
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
    const guarded = guardVisualizerPlan(plan(), 2, { hasLogo: false, ...zigzag });
    expect(guarded.imagePlaceholders.every((item) => item.useLogo === false)).toBe(true);
  });

  it("renders the page from the template with every marker exactly once", () => {
    const guarded = guardVisualizerPlan(plan(), 2, { hasLogo: false, ...zigzag });
    for (const index of [1, 2]) {
      expect(guarded.description.split(`[imageplaceholder-${index}]`)).toHaveLength(2);
    }
    expect(guarded.description).toContain("<h2");
    expect(guarded.description).toContain("Dry on every run");
    expect(guarded.description).toContain("<li style=\"margin:0.25rem 0\">Sealed seams</li>");
    expect(guarded.copy.sections).toHaveLength(2);
  });

  it("turns model markup into plain, escaped text", () => {
    const guarded = guardVisualizerPlan(
      plan({
        headline: "<script>alert(1)</script>**Trail** Runner",
        imagePlaceholders: [slot(1, { heading: 'Dry <img src=x onerror="x()"> feet' }), slot(2, { body: "Grip & 5 < 6 [imageplaceholder-1] on rock" })],
      }),
      2,
      { hasLogo: false, ...zigzag }
    );
    expect(guarded.description).not.toMatch(/<script|<img|onerror/);
    expect(guarded.copy.headline).toBe("alert(1) Trail Runner");
    expect(guarded.description).toContain("Grip &amp; 5 &lt; 6 on rock");
    expect(guarded.description.split("[imageplaceholder-1]")).toHaveLength(2);
  });

  it("rejects a slot without heading or body", () => {
    expect(() =>
      guardVisualizerPlan(plan({ imagePlaceholders: [slot(1), slot(2, { heading: "  " })] }), 2, { hasLogo: false, ...zigzag })
    ).toThrow(/Image slot 2 is missing its heading or body copy/);
  });

  it("rejects an empty headline or intro", () => {
    expect(() => guardVisualizerPlan(plan({ headline: "" }), 2, { hasLogo: false, ...zigzag })).toThrow(/empty headline/);
    expect(() => guardVisualizerPlan(plan({ intro: "Hi" }), 2, { hasLogo: false, ...zigzag })).toThrow(/too short intro/);
  });

  it("rejects too few usable prompts", () => {
    const short = plan({ imagePlaceholders: [slot(1, { prompt: "too short" }), slot(2)] });
    expect(() => guardVisualizerPlan(short, 2, { hasLogo: false, ...zigzag })).toThrow(/1 usable image prompts; expected 2/);
  });

  it("shortens copy over its limit without cutting a word", () => {
    const long = "Water stays out. ".repeat(60);
    const guarded = guardVisualizerPlan(plan({ imagePlaceholders: [slot(1, { body: long }), slot(2)] }), 2, {
      hasLogo: false,
      ...zigzag,
    });
    const body = guarded.copy.sections[0].body;
    expect(body.length).toBeLessThanOrEqual(480);
    expect(body.endsWith("Water stays out.")).toBe(true);
  });

  it("builds right-to-left pages for Arabic copy", () => {
    const guarded = guardVisualizerPlan(
      plan({
        headline: "حذاء الجري المقاوم للماء",
        intro: "ابقَ جافاً في كل رحلة مع غشاء مقاوم للماء ونعل يثبت على الصخور المبللة.",
        imagePlaceholders: [
          slot(1, { heading: "جاف في كل خطوة", body: "غشاء مقاوم للماء يحمي قدميك من البلل طوال الرحلة." }),
          slot(2, { heading: "ثبات على الصخور", body: "نعل مطاطي يمسك بالأسطح المبللة بثقة." }),
        ],
      }),
      2,
      { hasLogo: false, ...zigzag }
    );
    expect(guarded.description.startsWith('<article dir="rtl"')).toBe(true);
  });

  it("falls back to an unknown perspective", () => {
    const guarded = guardVisualizerPlan(
      plan({ imagePlaceholders: [slot(1, { perspective: "weird" }), slot(2, { perspective: "front" })] }),
      2,
      { hasLogo: false, ...zigzag }
    );
    expect(guarded.imagePlaceholders[0].perspective).toBe("other");
  });
});

describe("buildVisualizerPlannerSchema", () => {
  it("requires exactly N slots with copy and a finished prompt each", () => {
    const schema = buildVisualizerPlannerSchema("zigzag", 4) as {
      required: string[];
      properties: { imagePlaceholders: { minItems: number; maxItems: number; items: { required: string[] } } };
    };
    expect(schema.required).toEqual([
      "productIdentity",
      "identityLock",
      "headline",
      "intro",
      "closing",
      "imagePlaceholders",
      "notes",
    ]);
    expect(schema.properties.imagePlaceholders.minItems).toBe(4);
    expect(schema.properties.imagePlaceholders.maxItems).toBe(4);
    expect(schema.properties.imagePlaceholders.items.required).toEqual([
      "index",
      "perspective",
      "specClaim",
      "heading",
      "body",
      "bullets",
      "shotSize",
      "setting",
      "viewImage",
      "prompt",
      "useLogo",
      "alt",
    ]);
  });

  it("clamps the slot count to the layout", () => {
    const schema = buildVisualizerPlannerSchema("spotlight", 6) as {
      properties: { imagePlaceholders: { maxItems: number } };
    };
    expect(schema.properties.imagePlaceholders.maxItems).toBe(3);
  });
});

function showcasePlan(overrides: Record<string, unknown> = {}) {
  const showcaseSlot = (index: number) => ({
    index,
    perspective: index === 2 ? "front" : "in_use",
    specClaim: "waterproof",
    prompt: goodPrompt,
    useLogo: true,
    alt: `Shot ${index}`,
  });
  return plan({
    tagline: "Trail Runner",
    badge: "Waterproof",
    highlights: [
      { value: "280 g", label: "Light on the trail" },
      { value: "GTX", label: "Sealed membrane" },
    ],
    promise: "2-year warranty",
    imagePlaceholders: [1, 2, 3, 4, 5].map(showcaseSlot),
    ...overrides,
  });
}

describe("showcase plan", () => {
  it("adds the banner fields and drops slot copy from the schema", () => {
    const schema = buildVisualizerPlannerSchema("showcase", 5) as {
      required: string[];
      properties: { imagePlaceholders: { minItems: number; items: { required: string[] } } };
    };
    expect(schema.required).toEqual(expect.arrayContaining(["tagline", "badge", "highlights", "promise"]));
    expect(schema.properties.imagePlaceholders.minItems).toBe(5);
    expect(schema.properties.imagePlaceholders.items.required).not.toContain("heading");
  });

  it("gives each slot its role and frame and never puts the logo in the scene", () => {
    const guarded = guardVisualizerPlan(showcasePlan(), 5, { hasLogo: true, layoutId: "showcase" });
    expect(guarded.imagePlaceholders.map((item) => [item.role, item.aspectRatio])).toEqual([
      ["scene", "16:9"],
      ["packshot", "1:1"],
      ["gallery", "4:5"],
      ["gallery", "4:5"],
      ["gallery", "4:5"],
    ]);
    expect(guarded.imagePlaceholders[0].useLogo).toBe(false);
    expect(guarded.description).toContain("2-year warranty");
    for (const index of [1, 2, 3, 4, 5]) {
      expect(guarded.description.split(`[imageplaceholder-${index}]`)).toHaveLength(2);
    }
  });

  it("rejects a showcase plan without banner copy", () => {
    expect(() =>
      guardVisualizerPlan(showcasePlan({ highlights: [] }), 5, { hasLogo: false, layoutId: "showcase" })
    ).toThrow(/Showcase copy is missing/);
  });

  it("tells the planner the slot roles and the theme", () => {
    const brief = buildVisualizerPlannerBrief({
      ...baseInput,
      layoutId: "showcase",
      count: 5,
      images: { ...baseInput.images, style: "sport" },
    });
    expect(brief).toContain("Theme - Sport and action:");
    expect(brief).toMatch(/scene/);
    expect(brief).toMatch(/packshot/);
  });
});

describe("identity lock and shot variety", () => {
  const lock = {
    mustKeep: ["Grey mesh upper with orange laces", "Black Vibram outsole", "White logo on the outer side, heel area", "Rounded toe cap"],
    views: "image 1 outer side; inner side not shown",
  };
  const varied = (overrides: Array<Record<string, unknown>> = []) =>
    plan({
      identityLock: lock,
      imagePlaceholders: [
        slot(1, { setting: "wet slate trail at dawn", shotSize: "medium", viewImage: 1, ...overrides[0] }),
        slot(2, { setting: "mossy rock close to a stream", shotSize: "macro", viewImage: 1, ...overrides[1] }),
        slot(3, { setting: "city park path at golden hour", shotSize: "wide", viewImage: 1, ...overrides[2] }),
      ],
    });

  it("attaches the checklist, the views and the closest photo to every product slot", () => {
    const guarded = guardVisualizerPlan(varied(), 3, { hasLogo: false, ...zigzag, strictVariety: true });
    const first = guarded.imagePlaceholders[0].identityLock ?? "";
    expect(first).toMatch(/^PRODUCT IDENTITY LOCK/);
    expect(first).toContain("- Black Vibram outsole");
    expect(first).toContain("Views in the product photos: image 1 outer side; inner side not shown");
    expect(first).toContain("follow image 1 most closely");
    expect(first).toContain("turn the product so its known sides face the camera");
  });

  it("falls back to the identity paragraph when no checklist is given", () => {
    const guarded = guardVisualizerPlan(plan(), 2, { hasLogo: false, ...zigzag });
    expect(guarded.imagePlaceholders[0].identityLock).toContain("- Grey trail shoe with orange laces");
  });

  it("sends no identity lock with a background scene", () => {
    const guarded = guardVisualizerPlan(
      showcasePlan({ identityLock: lock }),
      5,
      { hasLogo: false, layoutId: "showcase" }
    );
    expect(guarded.imagePlaceholders[0].identityLock).toBeUndefined();
    expect(guarded.imagePlaceholders[1].identityLock).toContain("PRODUCT IDENTITY LOCK");
  });

  it("asks for a retry when two product shots share a setting, and accepts it on the last attempt", () => {
    const repeated = varied([{}, { setting: "Wet slate trail, at dawn!" }]);
    expect(() => guardVisualizerPlan(repeated, 3, { hasLogo: false, ...zigzag, strictVariety: true })).toThrow(
      /Slots 1 and 2 use the same setting/
    );
    expect(guardVisualizerPlan(repeated, 3, { hasLogo: false, ...zigzag }).imagePlaceholders).toHaveLength(3);
  });

  it("asks for mixed camera distances when every product shot is the same", () => {
    const same = varied([{ shotSize: "close" }, { shotSize: "close" }, { shotSize: "close" }]);
    expect(() => guardVisualizerPlan(same, 3, { hasLogo: false, ...zigzag, strictVariety: true })).toThrow(
      /Every product shot is close/
    );
  });

  it("puts the identity lock before the shot prompt", () => {
    const guarded = guardVisualizerPlan(varied(), 3, { hasLogo: false, ...zigzag });
    const shot = resolveSlotShot(guarded.imagePlaceholders[1], { style: "lifestyle", fallbackAspectRatio: "1:1" });
    expect(shot.prompt.indexOf("PRODUCT IDENTITY LOCK")).toBe(0);
    expect(shot.prompt.indexOf(goodPrompt)).toBeGreaterThan(0);
  });

  it("tells the planner to tell a story and lock the identity", () => {
    const brief = buildVisualizerPlannerBrief({ ...baseInput, images: { ...baseInput.images, brandingEnabled: true } });
    expect(brief).toContain("never the same set-up twice");
    expect(brief).toContain("fill `identityLock`");
    expect(brief).toContain("give each slot a different place inside that world");
    expect(brief).toContain("as the backdrop in at most one slot");
  });
});

describe("resolveSlotShot", () => {
  const base = { index: 1, visualBrief: goodPrompt, alt: "a", prompt: goodPrompt };

  it("keeps older square slots unchanged", () => {
    const shot = resolveSlotShot(base, { style: "lifestyle", fallbackAspectRatio: "1:1" });
    expect(shot).toEqual({ prompt: goodPrompt, aspectRatio: "1:1", attachProduct: true });
  });

  it("sends a background scene without product photos and with the theme", () => {
    const shot = resolveSlotShot({ ...base, role: "scene", aspectRatio: "16:9" }, { style: "outdoor", fallbackAspectRatio: "1:1" });
    expect(shot.attachProduct).toBe(false);
    expect(shot.aspectRatio).toBe("16:9");
    expect(shot.prompt).toContain("show no product");
    expect(shot.prompt).toContain("Outdoor:");
  });

  it("keeps the packshot on white whatever the theme", () => {
    const shot = resolveSlotShot({ ...base, role: "packshot", aspectRatio: "1:1" }, { style: "luxury", fallbackAspectRatio: "1:1" });
    expect(shot.attachProduct).toBe(true);
    expect(shot.prompt).toContain("pure white background");
    expect(shot.prompt).not.toContain("Luxury:");
  });

  it("adds the theme to gallery photos", () => {
    const shot = resolveSlotShot({ ...base, role: "gallery", aspectRatio: "4:5" }, { style: "auto", fallbackAspectRatio: "1:1" });
    expect(shot.aspectRatio).toBe("4:5");
    expect(shot.prompt).toBe(goodPrompt);
    const themed = resolveSlotShot({ ...base, role: "gallery", aspectRatio: "4:5" }, { style: "cozy", fallbackAspectRatio: "1:1" });
    expect(themed.prompt).toContain("Cozy home:");
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
            { index: 1, visualBrief: goodPrompt, alt: "a", specClaim: "waterproof", prompt: goodPrompt, perspective: "front", useLogo: true, storagePath: null, role: "scene", aspectRatio: "16:9" },
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
      role: "scene",
      aspectRatio: "16:9",
    });
  });
});
