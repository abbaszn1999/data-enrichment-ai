import { SHOT_PERSPECTIVES, type ShotPerspective } from "@/lib/gallery/agents/planner-plan";
import { VISUALIZER_MAX_IMAGES } from "@/lib/visualizer/layouts";
import type { VisualizerImagePlaceholder } from "@/lib/visualizer/types";

export const VISUALIZER_PROMPT_MIN_CHARS = 40;
export const VISUALIZER_PROMPT_MAX_CHARS = 4_000;
const DESCRIPTION_MIN_CHARS = 120;

export function visualizerMarker(index: number): string {
  return `[imageplaceholder-${index}]`;
}

function clampCount(imageCount: number): number {
  return Math.min(VISUALIZER_MAX_IMAGES, Math.max(1, Math.floor(imageCount) || 1));
}

/** Strict JSON schema for the planner answer: page HTML plus one finished prompt per image slot. */
export function buildVisualizerPlannerSchema(imageCount: number): Record<string, unknown> {
  const n = clampCount(imageCount);
  return {
    type: "object",
    additionalProperties: false,
    required: ["productIdentity", "description", "imagePlaceholders", "notes"],
    properties: {
      productIdentity: {
        type: "string",
        description:
          "What the product images prove about this exact item: colour, material, construction, markings, variant. One short paragraph.",
      },
      description: {
        type: "string",
        description:
          "The HTML content body (no html/head/body tags) that follows the selected layout and contains every [imageplaceholder-N] marker exactly once.",
      },
      imagePlaceholders: {
        type: "array",
        minItems: n,
        maxItems: n,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["index", "perspective", "specClaim", "prompt", "useLogo", "alt"],
          properties: {
            index: { type: "integer", minimum: 1, maximum: n },
            perspective: { type: "string", enum: [...SHOT_PERSPECTIVES] },
            specClaim: { type: "string" },
            prompt: {
              type: "string",
              description: "The complete prompt sent to Nano Banana for this one image.",
            },
            useLogo: { type: "boolean" },
            alt: { type: "string" },
          },
        },
      },
      notes: {
        type: "string",
        description: "Short note for the operator (ignored instructions, missing data). Empty string when none.",
      },
    },
  };
}

function normalizePerspective(value: unknown): ShotPerspective {
  const text = String(value ?? "").trim().toLowerCase();
  return (SHOT_PERSPECTIVES as readonly string[]).includes(text) ? (text as ShotPerspective) : "other";
}

/** Keep the HTML body only: no code fences, document wrappers or stray images. */
export function cleanPlannerHtml(html: string): string {
  return html
    .trim()
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/\s*```$/, "")
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<\/?(?:html|head|body)[^>]*>/gi, "")
    .replace(/<img\b[^>]*>/gi, "")
    .trim();
}

export type GuardedVisualizerPlan = {
  productIdentity: string;
  description: string;
  imagePlaceholders: VisualizerImagePlaceholder[];
  notes?: string;
};

/**
 * Validate the planner answer. Returns exactly `imageCount` slots (indexes 1..N)
 * whose markers each appear once in the HTML, or throws so the planner is retried.
 */
export function guardVisualizerPlan(
  raw: unknown,
  imageCount: number,
  options: { hasLogo: boolean }
): GuardedVisualizerPlan {
  if (!raw || typeof raw !== "object") throw new Error("Planner returned an unreadable response");
  const n = clampCount(imageCount);
  const record = raw as Record<string, unknown>;

  const description = cleanPlannerHtml(String(record.description ?? ""));
  if (description.length < DESCRIPTION_MIN_CHARS) {
    throw new Error("Planner returned an empty or too short description");
  }
  if (/<script\b/i.test(description) || /\son[a-z]+\s*=/i.test(description) || /javascript:/i.test(description)) {
    throw new Error("Planner returned unsafe HTML (script or event handler)");
  }
  for (let index = 1; index <= n; index += 1) {
    const occurrences = description.split(visualizerMarker(index)).length - 1;
    if (occurrences !== 1) {
      throw new Error(`Description must contain ${visualizerMarker(index)} exactly once (found ${occurrences})`);
    }
  }

  const list = Array.isArray(record.imagePlaceholders) ? record.imagePlaceholders : [];
  const byIndex = new Map<number, VisualizerImagePlaceholder>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const slot = item as Record<string, unknown>;
    const index = Number(slot.index);
    if (!Number.isInteger(index) || index < 1 || index > n || byIndex.has(index)) continue;
    const prompt = String(slot.prompt ?? "").trim();
    if (prompt.length < VISUALIZER_PROMPT_MIN_CHARS) continue;
    const capped = prompt.slice(0, VISUALIZER_PROMPT_MAX_CHARS);
    const specClaim = String(slot.specClaim ?? "").trim().slice(0, 300);
    byIndex.set(index, {
      index,
      visualBrief: capped,
      prompt: capped,
      perspective: normalizePerspective(slot.perspective),
      specClaim: specClaim || undefined,
      useLogo: options.hasLogo && slot.useLogo === true,
      alt: (String(slot.alt ?? "").trim() || `Product visual ${index}`).slice(0, 300),
      storagePath: null,
    });
  }
  if (byIndex.size !== n) {
    throw new Error(`Planner returned ${byIndex.size} usable image prompts; expected ${n}`);
  }

  const notes = String(record.notes ?? "").trim();
  return {
    productIdentity: String(record.productIdentity ?? "").trim().slice(0, 1_500),
    description,
    imagePlaceholders: [...byIndex.values()].sort((a, b) => a.index - b.index),
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
