import { createHash } from "node:crypto";
import type { GalleryRow } from "@/lib/gallery/types";

/** Bump when the planner contract changes so stored plans are re-planned. */
export const PLANNER_VERSION = 2;

export const GALLERY_PLAN_MAX_IMAGES = 8;

export const SHOT_PERSPECTIVES = [
  "front",
  "back",
  "side",
  "three_quarter",
  "top_down",
  "close_up_detail",
  "texture_material",
  "packaging",
  "in_use",
  "on_model",
  "lifestyle",
  "scale_reference",
  "flat_lay",
  "feature_proof",
  "other",
] as const;

export type ShotPerspective = (typeof SHOT_PERSPECTIVES)[number];

export type GalleryShotBrief = {
  perspective: ShotPerspective;
  /** The one purchase-relevant claim this shot proves. */
  specClaim: string;
  /** Complete Nano Banana prompt for this image. */
  prompt: string;
  /** True only when the attached logo should appear in this shot. */
  useLogo: boolean;
  alt: string;
};

export type GalleryPlannerPlan = {
  fingerprint: string;
  /** Identity facts the planner read from the product images (colour, materials, markings). */
  productIdentity: string;
  gallery: Array<GalleryShotBrief & { index: number }>;
  notes?: string;
};

const PROMPT_MIN_CHARS = 40;
const PROMPT_MAX_CHARS = 4_000;

export function buildPlannerResponseSchema(galleryCount: number): Record<string, unknown> {
  const n = Math.min(GALLERY_PLAN_MAX_IMAGES, Math.max(1, Math.floor(galleryCount)));
  return {
    type: "object",
    additionalProperties: false,
    required: ["productIdentity", "gallery", "notes"],
    properties: {
      productIdentity: {
        type: "string",
        description:
          "What the product images prove about this exact item: colour, material, construction, markings, variant. One short paragraph.",
      },
      gallery: {
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

/**
 * Validate the planner output. Returns exactly `galleryCount` shots with indexes
 * 1..N, or throws so the row is reported as a planner failure (nothing is charged
 * for a plan that cannot be used beyond the tokens already billed by the caller).
 */
export function guardGalleryPlan(
  raw: unknown,
  galleryCount: number,
  options: { hasLogo: boolean }
): { productIdentity: string; gallery: GalleryPlannerPlan["gallery"]; notes?: string } {
  if (!raw || typeof raw !== "object") throw new Error("Gallery planner returned an unreadable response");
  const record = raw as Record<string, unknown>;
  const list = Array.isArray(record.gallery) ? record.gallery : [];

  const byIndex = new Map<number, GalleryPlannerPlan["gallery"][number]>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const shot = item as Record<string, unknown>;
    const index = Number(shot.index);
    if (!Number.isInteger(index) || index < 1 || index > galleryCount || byIndex.has(index)) continue;
    const prompt = String(shot.prompt ?? "").trim();
    if (prompt.length < PROMPT_MIN_CHARS) continue;
    byIndex.set(index, {
      index,
      perspective: normalizePerspective(shot.perspective),
      specClaim: String(shot.specClaim ?? "").trim().slice(0, 300),
      prompt: prompt.slice(0, PROMPT_MAX_CHARS),
      useLogo: options.hasLogo && shot.useLogo === true,
      alt: (String(shot.alt ?? "").trim() || "Product image").slice(0, 300),
    });
  }
  if (byIndex.size !== galleryCount) {
    throw new Error(`Gallery planner returned ${byIndex.size} usable prompts; expected ${galleryCount}`);
  }
  const gallery = [...byIndex.values()].sort((a, b) => a.index - b.index);
  const notes = String(record.notes ?? "").trim();
  return {
    productIdentity: String(record.productIdentity ?? "").trim().slice(0, 1_500),
    gallery,
    notes: notes ? notes.slice(0, 800) : undefined,
  };
}

export interface GalleryPlanFingerprintInput {
  galleryCount: number;
  tier: "standard" | "premium";
  aspectRatio: string;
  style: string;
  instructions: string;
  /** Row values that reach the planner (already filtered to the selected columns). */
  rowText: string;
  /** Identity of every attached image, in send order (storage path or source URL). */
  referenceKeys: string[];
  brandingEnabled: boolean;
  brandGuideMode: string;
  brandColors: string[];
  groundWithSearch: boolean;
}

/** Stable hash of everything that shapes the plan; a stored plan is reused only on an exact match. */
export function galleryPlanFingerprint(input: GalleryPlanFingerprintInput): string {
  const payload = JSON.stringify({
    v: PLANNER_VERSION,
    n: input.galleryCount,
    tier: input.tier,
    ar: input.aspectRatio,
    style: input.style,
    instructions: input.instructions.trim(),
    row: input.rowText,
    refs: input.referenceKeys,
    branding: input.brandingEnabled,
    guide: input.brandGuideMode,
    colors: input.brandingEnabled ? input.brandColors : [],
    ground: input.groundWithSearch,
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

export function readStoredGalleryPlan(
  row: Pick<GalleryRow, "sourceMeta">,
  fingerprint: string,
  galleryCount: number
): GalleryPlannerPlan | null {
  const stored = row.sourceMeta?.plan;
  if (!stored || typeof stored !== "object") return null;
  const record = stored as Partial<GalleryPlannerPlan>;
  if (record.fingerprint !== fingerprint) return null;
  const gallery = Array.isArray(record.gallery) ? record.gallery : [];
  if (gallery.length !== galleryCount) return null;
  if (gallery.some((item) => !item?.prompt || String(item.prompt).length < PROMPT_MIN_CHARS)) return null;
  return {
    fingerprint,
    productIdentity: String(record.productIdentity ?? ""),
    gallery: gallery.map((item, index) => ({
      index: item.index || index + 1,
      perspective: normalizePerspective(item.perspective),
      specClaim: String(item.specClaim ?? ""),
      prompt: String(item.prompt),
      useLogo: item.useLogo === true,
      alt: String(item.alt ?? ""),
    })),
    notes: record.notes,
  };
}
