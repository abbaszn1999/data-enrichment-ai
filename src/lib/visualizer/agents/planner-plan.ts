import { SHOT_PERSPECTIVES, type ShotPerspective } from "@/lib/gallery/agents/planner-plan";
import {
  clampVisualizerImageCount,
  VISUALIZER_SLOT_ASPECT_RATIOS,
  visualizerSlotRole,
  type VisualizerLayoutId,
  type VisualizerSlotRole,
} from "@/lib/visualizer/layouts";
import { getVisualizerTheme } from "@/lib/visualizer/themes";
import {
  clampText,
  detectTextDirection,
  isCompactSlot,
  renderVisualizerPage,
  toPlainText,
  VISUALIZER_COPY_LIMITS,
  type VisualizerHighlight,
  type VisualizerPageCopy,
  type VisualizerSectionCopy,
  type VisualizerShowcaseCopy,
} from "@/lib/visualizer/templates";
import type { VisualizerImagePlaceholder } from "@/lib/visualizer/types";

export const VISUALIZER_PROMPT_MIN_CHARS = 40;
export const VISUALIZER_PROMPT_MAX_CHARS = 4_000;
const INTRO_MIN_CHARS = 20;

const SLOT_BASE_REQUIRED = [
  "index",
  "perspective",
  "specClaim",
  "shotSize",
  "setting",
  "viewImage",
  "prompt",
  "useLogo",
  "alt",
];

export const VISUALIZER_SHOT_SIZES = ["wide", "medium", "close", "macro"] as const;
const IDENTITY_FACTS_MIN = 4;
const IDENTITY_FACTS_MAX = 10;
const IDENTITY_FACT_CHARS = 160;
const IDENTITY_VIEWS_CHARS = 400;

/**
 * Strict JSON schema for the planner answer: the page copy plus one finished
 * prompt per image slot. Showcase slots carry no copy; its banner fields are
 * top level instead.
 */
export function buildVisualizerPlannerSchema(layoutId: VisualizerLayoutId, imageCount: number): Record<string, unknown> {
  const n = clampVisualizerImageCount(layoutId, imageCount);
  const limits = VISUALIZER_COPY_LIMITS;
  const showcase = layoutId === "showcase";

  const slotProperties: Record<string, unknown> = {
    index: { type: "integer", minimum: 1, maximum: n },
    perspective: { type: "string", enum: [...SHOT_PERSPECTIVES] },
    specClaim: { type: "string" },
    shotSize: {
      type: "string",
      enum: [...VISUALIZER_SHOT_SIZES],
      description: "Camera distance: wide (product in its place), medium, close (one part fills the frame) or macro (material and texture).",
    },
    setting: {
      type: "string",
      description:
        "Where this shot happens in a few words: place, surface and backdrop colour. Every product slot has its own; never reuse one.",
    },
    viewImage: {
      type: "integer",
      minimum: 0,
      maximum: 14,
      description: "Number of the attached product photo whose view is closest to this shot's camera angle; 0 for a background scene.",
    },
    prompt: {
      type: "string",
      description: "The complete prompt sent to Nano Banana for this one image.",
    },
    useLogo: { type: "boolean" },
    alt: { type: "string" },
  };
  if (!showcase) {
    Object.assign(slotProperties, {
      heading: {
        type: "string",
        description: `Section heading named after the claim this image proves. Plain text, at most ${limits.heading} characters.`,
      },
      body: {
        type: "string",
        description: "Section copy beside this image (benefit, feature, proof). Plain text; length limit is in the runtime message.",
      },
      bullets: {
        type: "array",
        maxItems: limits.bullets,
        items: { type: "string" },
        description: `0 to ${limits.bullets} short supporting points, at most ${limits.bullet} characters each. Empty array for none.`,
      },
    });
  }
  const slotRequired = showcase
    ? SLOT_BASE_REQUIRED
    : [...SLOT_BASE_REQUIRED.slice(0, 3), "heading", "body", "bullets", ...SLOT_BASE_REQUIRED.slice(3)];

  const properties: Record<string, unknown> = {
    productIdentity: {
      type: "string",
      description:
        "What the product images prove about this exact item: colour, material, construction, markings, variant. One short paragraph.",
    },
    identityLock: {
      type: "object",
      additionalProperties: false,
      required: ["mustKeep", "views"],
      properties: {
        mustKeep: {
          type: "array",
          minItems: IDENTITY_FACTS_MIN,
          maxItems: IDENTITY_FACTS_MAX,
          items: { type: "string" },
          description: `${IDENTITY_FACTS_MIN} to ${IDENTITY_FACTS_MAX} exact visual facts every image must reproduce, each one short and specific (at most ${IDENTITY_FACT_CHARS} characters): silhouette and proportions, each colour and where it sits, material and finish, every part and piece of hardware, seams and patterns, logos and printed text with their position. Only what the photos show.`,
        },
        views: {
          type: "string",
          description:
            "Which side each attached product photo shows and which sides no photo shows, e.g. 'image 1 front three-quarter; image 2 back; underside not shown'.",
        },
      },
    },
    headline: {
      type: "string",
      description: `Page headline carrying the primary keyword. Plain text, at most ${limits.headline} characters.`,
    },
    intro: {
      type: "string",
      description: `Opening hook paragraph. Plain text, at most ${limits.intro} characters.`,
    },
    closing: {
      type: "string",
      description: `One closing line that reinforces value, at most ${limits.closing} characters. Empty string for none.`,
    },
  };
  const required = ["productIdentity", "identityLock", "headline", "intro", "closing"];
  if (showcase) {
    Object.assign(properties, {
      tagline: {
        type: "string",
        description: `Short line repeated in the top strip (product or collection name, or a 2–5 word hook), at most ${limits.tagline} characters.`,
      },
      badge: {
        type: "string",
        description: `The single strongest feature, shown as a badge on the product photo, at most ${limits.badge} characters.`,
      },
      highlights: {
        type: "array",
        minItems: limits.highlightsMin,
        maxItems: limits.highlightsMax,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["value", "label"],
          properties: {
            value: {
              type: "string",
              description: `A big, short value: a number with unit from the data (10 h, 500 ml) or one strong word. At most ${limits.highlightValue} characters.`,
            },
            label: { type: "string", description: `What the value means, at most ${limits.highlightLabel} characters.` },
          },
        },
      },
      promise: {
        type: "string",
        description: `One reassurance line shown as a label (warranty, care, what is included), only if the data supports it; otherwise the product's main benefit. At most ${limits.promise} characters.`,
      },
      palette: {
        type: "object",
        additionalProperties: false,
        required: ["dark", "accent"],
        description:
          "Two page colours taken from the product itself, as #RRGGBB. Used only when the store has no brand colours.",
        properties: {
          dark: {
            type: "string",
            description:
              "A deep shade of the product's main colour (or its darkest prominent colour) for headings, the badge and the promise label. Dark enough for white text.",
          },
          accent: {
            type: "string",
            description:
              "The product's most lively colour (a trim, a part, the packaging), or a colour that complements it, for the top strip and one highlight tile.",
          },
        },
      },
    });
    required.push("tagline", "badge", "highlights", "promise", "palette");
  }
  properties.imagePlaceholders = {
    type: "array",
    minItems: n,
    maxItems: n,
    items: { type: "object", additionalProperties: false, required: slotRequired, properties: slotProperties },
  };
  properties.notes = {
    type: "string",
    description: "Short note for the operator (ignored instructions, missing data). Empty string when none.",
  };
  required.push("imagePlaceholders", "notes");

  return { type: "object", additionalProperties: false, required, properties };
}

function normalizePerspective(value: unknown): ShotPerspective {
  const text = String(value ?? "").trim().toLowerCase();
  return (SHOT_PERSPECTIVES as readonly string[]).includes(text) ? (text as ShotPerspective) : "other";
}

function sectionCopy(slot: Record<string, unknown>, layoutId: VisualizerLayoutId, index: number): VisualizerSectionCopy | null {
  const limits = VISUALIZER_COPY_LIMITS;
  const heading = clampText(toPlainText(slot.heading), limits.heading);
  const body = clampText(toPlainText(slot.body), isCompactSlot(layoutId, index) ? limits.compactBody : limits.body);
  if (!heading || !body) return null;
  const bullets = (Array.isArray(slot.bullets) ? slot.bullets : [])
    .map((bullet) => clampText(toPlainText(bullet), limits.bullet))
    .filter(Boolean)
    .slice(0, limits.bullets);
  return { heading, body, bullets };
}

function showcaseCopy(record: Record<string, unknown>, galleryCount: number): VisualizerShowcaseCopy {
  const limits = VISUALIZER_COPY_LIMITS;
  const tagline = clampText(toPlainText(record.tagline), limits.tagline);
  const badge = clampText(toPlainText(record.badge), limits.badge);
  const promise = clampText(toPlainText(record.promise), limits.promise);
  const highlights: VisualizerHighlight[] = (Array.isArray(record.highlights) ? record.highlights : [])
    .map((item) => {
      const entry = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      return {
        value: clampText(toPlainText(entry.value), limits.highlightValue),
        label: clampText(toPlainText(entry.label), limits.highlightLabel),
      };
    })
    .filter((highlight) => highlight.value && highlight.label)
    .slice(0, limits.highlightsMax);
  const missing = [
    !tagline && "tagline",
    !badge && "badge",
    !promise && "promise",
    highlights.length < limits.highlightsMin && `at least ${limits.highlightsMin} highlights`,
  ].filter(Boolean);
  if (missing.length > 0) throw new Error(`Showcase copy is missing: ${missing.join(", ")}`);
  return { tagline, badge, highlights, promise, galleryCount };
}

function identityFacts(record: Record<string, unknown>): { facts: string[]; views: string } {
  const lock = record.identityLock && typeof record.identityLock === "object" ? (record.identityLock as Record<string, unknown>) : {};
  const facts = (Array.isArray(lock.mustKeep) ? lock.mustKeep : [])
    .map((fact) => clampText(toPlainText(fact), IDENTITY_FACT_CHARS))
    .filter(Boolean)
    .slice(0, IDENTITY_FACTS_MAX);
  if (facts.length === 0) {
    const identity = clampText(toPlainText(record.productIdentity), 600);
    if (identity) facts.push(identity);
  }
  return { facts, views: clampText(toPlainText(lock.views), IDENTITY_VIEWS_CHARS) };
}

/**
 * The identity block sent first with every image that shows the product. Image
 * models follow named, specific prohibitions more reliably than a general
 * "keep it the same", and drift most on a side no photo shows.
 */
export function buildIdentityLock(facts: string[], views: string, viewImage: number): string {
  if (facts.length === 0) return "";
  return [
    "PRODUCT IDENTITY LOCK (mandatory; it overrides every other instruction):",
    "The product is the exact physical item in the attached product photos. It must be identical in this shot, whatever the angle, distance, pose, hand or light.",
    "Reproduce exactly:",
    ...facts.map((fact) => `- ${fact}`),
    views ? `Views in the product photos: ${views}` : "",
    viewImage > 0
      ? `For this camera angle follow image ${viewImage} most closely; use the other product photos only to confirm details.`
      : "",
    "Never: change any colour, shade or finish; change the silhouette, proportions or thickness; add, remove, move or resize any part, seam, button, strap, cap or hardware; redraw, move, add or remove any logo or printed text; simplify fine details; show a second unit unless the prompt asks for it. If the angle would reveal a side no photo shows, turn the product so its known sides face the camera instead of inventing the hidden side.",
  ]
    .filter(Boolean)
    .join("\n");
}

const normalizeSetting = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Product shots must not repeat a place, and a set of three or more mixes camera distances. */
function varietyProblem(
  slots: Array<{ index: number; role: VisualizerSlotRole; setting: string; shotSize: string }>
): string | null {
  const productShots = slots.filter((slot) => slot.role === "feature" || slot.role === "gallery");
  const seen = new Map<string, number>();
  for (const slot of productShots) {
    const key = normalizeSetting(slot.setting);
    if (!key) continue;
    const first = seen.get(key);
    if (first !== undefined) {
      return `Slots ${first} and ${slot.index} use the same setting ("${slot.setting}"). Give every product shot its own place, surface and backdrop colour so the images tell a story.`;
    }
    seen.set(key, slot.index);
  }
  const sizes = new Set(productShots.map((slot) => slot.shotSize).filter(Boolean));
  if (productShots.length >= 3 && sizes.size === 1) {
    return `Every product shot is ${[...sizes][0]}. Mix camera distances (wide, medium, close, macro) across the slots.`;
  }
  return null;
}

/** Showcase colours picked from the product, in brand-colour order (primary, secondary, accent). */
function productPalette(record: Record<string, unknown>): string[] | undefined {
  const palette = record.palette && typeof record.palette === "object" ? (record.palette as Record<string, unknown>) : {};
  const colors = [String(palette.dark ?? "").trim(), "", String(palette.accent ?? "").trim()];
  return colors[0] || colors[2] ? colors : undefined;
}

export type GuardedVisualizerPlan = {
  productIdentity: string;
  /** The page HTML, rendered from the layout template with every marker placed by code. */
  description: string;
  copy: VisualizerPageCopy;
  imagePlaceholders: VisualizerImagePlaceholder[];
  notes?: string;
};

/**
 * Validate the planner answer and render the page. Returns exactly `imageCount`
 * slots (indexes 1..N), each with a usable prompt (and copy, outside Showcase),
 * or throws so the planner is retried.
 */
export function guardVisualizerPlan(
  raw: unknown,
  imageCount: number,
  options: {
    hasLogo: boolean;
    layoutId: VisualizerLayoutId;
    brandColors?: string[];
    /** Reject repeated settings so the planner retries; the last attempt accepts them. */
    strictVariety?: boolean;
  }
): GuardedVisualizerPlan {
  if (!raw || typeof raw !== "object") throw new Error("Planner returned an unreadable response");
  const { layoutId } = options;
  const n = clampVisualizerImageCount(layoutId, imageCount);
  const record = raw as Record<string, unknown>;
  const limits = VISUALIZER_COPY_LIMITS;
  const isShowcase = layoutId === "showcase";

  const headline = clampText(toPlainText(record.headline), limits.headline);
  if (!headline) throw new Error("Planner returned an empty headline");
  const intro = clampText(toPlainText(record.intro), limits.intro);
  if (intro.length < INTRO_MIN_CHARS) throw new Error("Planner returned an empty or too short intro");
  const closing = clampText(toPlainText(record.closing), limits.closing);
  const showcase = isShowcase ? showcaseCopy(record, n - 2) : undefined;
  const identity = identityFacts(record);

  const list = Array.isArray(record.imagePlaceholders) ? record.imagePlaceholders : [];
  const byIndex = new Map<
    number,
    {
      placeholder: VisualizerImagePlaceholder;
      section: VisualizerSectionCopy | null;
      shot: { index: number; role: VisualizerSlotRole; setting: string; shotSize: string };
    }
  >();
  const missingCopy: number[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const slot = item as Record<string, unknown>;
    const index = Number(slot.index);
    if (!Number.isInteger(index) || index < 1 || index > n || byIndex.has(index)) continue;
    const prompt = String(slot.prompt ?? "").trim();
    if (prompt.length < VISUALIZER_PROMPT_MIN_CHARS) continue;
    const section = isShowcase ? null : sectionCopy(slot, layoutId, index);
    if (!isShowcase && !section) {
      missingCopy.push(index);
      continue;
    }
    const capped = prompt.slice(0, VISUALIZER_PROMPT_MAX_CHARS);
    const specClaim = String(slot.specClaim ?? "").trim().slice(0, 300);
    const role = visualizerSlotRole(layoutId, n, index);
    const viewImage = Number.isInteger(slot.viewImage) ? Math.max(0, Number(slot.viewImage)) : 0;
    const identityLock = role === "scene" ? "" : buildIdentityLock(identity.facts, identity.views, viewImage);
    byIndex.set(index, {
      section,
      shot: {
        index,
        role,
        setting: String(slot.setting ?? "").trim().slice(0, 200),
        shotSize: String(slot.shotSize ?? "").trim(),
      },
      placeholder: {
        index,
        visualBrief: capped,
        prompt: capped,
        perspective: normalizePerspective(slot.perspective),
        specClaim: specClaim || undefined,
        useLogo: options.hasLogo && role !== "scene" && slot.useLogo === true,
        role,
        aspectRatio: VISUALIZER_SLOT_ASPECT_RATIOS[role],
        identityLock: identityLock || undefined,
        alt: (toPlainText(slot.alt) || `Product visual ${index}`).slice(0, 300),
        storagePath: null,
      },
    });
  }
  if (missingCopy.length > 0) {
    throw new Error(`Image slot ${missingCopy.join(", ")} is missing its heading or body copy`);
  }
  if (byIndex.size !== n) {
    throw new Error(`Planner returned ${byIndex.size} usable image prompts; expected ${n}`);
  }

  const slots = [...byIndex.values()].sort((a, b) => a.placeholder.index - b.placeholder.index);
  if (options.strictVariety) {
    const problem = varietyProblem(slots.map((slot) => slot.shot));
    if (problem) throw new Error(problem);
  }
  const sections = slots.flatMap((slot) => (slot.section ? [slot.section] : []));
  const copy: VisualizerPageCopy = { headline, intro, closing, sections, showcase };
  const direction = detectTextDirection([
    headline,
    intro,
    ...sections.flatMap((section) => [section.heading, section.body]),
    ...(showcase ? [showcase.badge, showcase.promise, ...showcase.highlights.map((highlight) => highlight.label)] : []),
  ]);
  const description = renderVisualizerPage(layoutId, copy, {
    direction,
    brandColors: options.brandColors?.length ? options.brandColors : isShowcase ? productPalette(record) : undefined,
  });

  const notes = String(record.notes ?? "").trim();
  return {
    productIdentity: String(record.productIdentity ?? "").trim().slice(0, 1_500),
    description,
    copy,
    imagePlaceholders: slots.map((slot) => slot.placeholder),
    notes: notes ? notes.slice(0, 800) : undefined,
  };
}

/** The prompt for one slot: the planner's, or a safe one built from an older row's brief. */
export function resolveSlotPrompt(placeholder: VisualizerImagePlaceholder): string {
  const prompt = placeholder.prompt?.trim();
  if (prompt && prompt.length >= VISUALIZER_PROMPT_MIN_CHARS) return prompt;
  const brief = placeholder.visualBrief.trim();
  return [
    "Create a photorealistic ecommerce product photograph.",
    "Use image 1 as the exact product: keep its shape, colour, material, markings and proportions unchanged.",
    brief,
    "Square 1:1 composition with the product as the clear hero.",
    "No text overlays, captions, watermarks or invented lettering.",
  ]
    .filter(Boolean)
    .join(" ");
}

const ROLE_RULES: Partial<Record<VisualizerSlotRole, string>> = {
  scene:
    "Background scene only: show no product of any kind, no people in focus and no text. Keep the centre calm and low in detail because a content card covers it.",
  packshot:
    "Seamless pure white background (#FFFFFF), the exact product alone and centred, soft contact shadow, no props, no scene.",
};

export interface VisualizerSlotShot {
  prompt: string;
  aspectRatio: string;
  /** False for a background scene: no product photo or logo is attached. */
  attachProduct: boolean;
}

/**
 * What one image request sends: the slot prompt plus the fixed rule of its role,
 * and the slot's frame. Scene and gallery slots also repeat the theme recipe;
 * feature shots get the theme through the planner's prompt, so a close-up proof
 * shot is not pushed into a lifestyle scene.
 */
export function resolveSlotShot(
  placeholder: VisualizerImagePlaceholder,
  options: { style: unknown; fallbackAspectRatio: string }
): VisualizerSlotShot {
  const role = placeholder.role ?? "feature";
  const recipe = role === "scene" || role === "gallery" ? getVisualizerTheme(options.style).recipe : null;
  const prompt = [
    role === "scene" ? "" : (placeholder.identityLock?.trim() ?? ""),
    resolveSlotPrompt(placeholder),
    ROLE_RULES[role] ?? "",
    recipe ? `Visual theme for this shot: ${recipe}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    prompt,
    aspectRatio: placeholder.aspectRatio || options.fallbackAspectRatio,
    attachProduct: role !== "scene",
  };
}
