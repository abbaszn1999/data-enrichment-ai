import type { VisualizerBrandSettings } from "@/lib/visualizer/types";
import {
  getVisualizerLayout,
  type VisualizerLayoutId,
  VISUALIZER_MAX_IMAGES,
} from "@/lib/visualizer/layouts";

function buildVisualDesignSpecs(
  brand: VisualizerBrandSettings,
  options?: { includeManualColors?: boolean }
): string {
  const includeManualColors = options?.includeManualColors !== false;
  return [
    includeManualColors
      ? `- Brand primary color: ${brand.colorPrimary}`
      : "",
    includeManualColors
      ? `- Brand secondary / accent color: ${brand.colorSecondary}`
      : "",
    !includeManualColors
      ? "- Color direction: follow the attached brand-guide image palette and mood (do not invent a conflicting hex palette)"
      : "",
    brand.styleNotes
      ? `- Style notes: ${brand.styleNotes}`
      : "- Style notes: modern clean premium ecommerce photography",
    brand.fontsNotes
      ? `- Typography / art-direction notes (mood only): ${brand.fontsNotes}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function placeholderList(maxPlaceholders: number): string {
  return Array.from(
    { length: maxPlaceholders },
    (_, index) => `[imageplaceholder-${index + 1}]`
  ).join(", ");
}

/** Brand palette text — only when branding is enabled (no image required). */
export function buildDescriptionBrandColorsBlock(brandColors: string[]): string {
  const primary = brandColors[0] || "#111827";
  const secondary = brandColors[1] || "#2563EB";
  const accent = brandColors[2] || "#F59E0B";
  return [
    "===============================================================",
    "BRAND COLOR PALETTE (MANDATORY — branding enabled)",
    "===============================================================",
    "When writing EACH visualBrief, weave these hex colors into lighting, backdrop tones, props, packaging cues, or environmental accents where commercially natural:",
    `- Primary: ${primary}`,
    `- Secondary: ${secondary}`,
    `- Accent: ${accent}`,
    "Do not force branding where it breaks realism; prefer subtle on-brand accents over heavy overlays.",
    "Do NOT invent a logo or brand wordmark unless a logo image is attached in a following content part.",
  ].join("\n");
}

/** Logo directive — send ONLY together with an attached logo image. */
export function buildDescriptionLogoBlock(): string {
  return [
    "===============================================================",
    "BRAND LOGO REFERENCE (MANDATORY — image attached immediately after this text)",
    "===============================================================",
    "The next content part is the official brand LOGO image. Study it carefully.",
    "In EVERY visualBrief, specify a professional, commercially natural logo placement (tag, packaging, subtle environmental mark).",
    "Preserve the exact recognizable mark, proportions, and colors from this attached logo.",
    "Never invent, redraw, distort, or misspell logo text. The same logo image will also be given to the image generation model.",
  ].join("\n");
}

/** Brand-guide directive — send ONLY together with an attached guide image. */
export function buildDescriptionBrandGuideBlock(): string {
  return [
    "===============================================================",
    "BRAND GUIDE / ART-DIRECTION REFERENCE (MANDATORY — image attached immediately after this text)",
    "===============================================================",
    "The next content part is the brand guide / art-direction reference image. Study its palette, mood, photography style, and overall brand feel.",
    "Instruct EACH visualBrief to follow this guide so the eventual generated images look on-brand.",
    "The same brand-guide image will also be given to the image generation model.",
  ].join("\n");
}

export function buildDescriptionProductImageIntro(): string {
  return [
    "===============================================================",
    "PRODUCT IMAGE REFERENCE (analyze the image attached immediately after this text)",
    "===============================================================",
    "The next content part is the canonical product photo. Use it for visual analysis and for accurate product identity in every visualBrief.",
  ].join("\n");
}

export function buildDescriptionJsonClosing(): string {
  return [
    "Respond with JSON only matching the schema:",
    "- description: the full semantic HTML body including the [imageplaceholder-N] markers",
    "- imagePlaceholders: array of { index, specClaim, visualBrief, alt } for each marker used",
    "- notes: short internal notes about assumptions or missing data (empty string if none)",
  ].join("\n");
}

/**
 * Runtime injection for skill 01 — product row, chosen layout, brand specs.
 * Durable craft (analysis, spec inventory, SEO/CRO, brief engineering) lives
 * in `skills/01-description.md`, not here.
 */
export function buildDescriptionUserPrompt(params: {
  product: Record<string, string>;
  layoutId: VisualizerLayoutId;
  imageCount: number;
  brand: VisualizerBrandSettings;
  customInstructions?: string;
  /** When false, omit manual hex palette lines (Upload image brand-guide mode). */
  includeManualBrandColors?: boolean;
}): string {
  const layout = getVisualizerLayout(params.layoutId);
  const imageCount = Math.min(
    layout.maxImages,
    Math.max(layout.minImages, Math.floor(params.imageCount) || layout.defaultImages)
  );
  const includeManualBrandColors = params.includeManualBrandColors !== false;
  const visualDesignSpecs = buildVisualDesignSpecs(params.brand, {
    includeManualColors: includeManualBrandColors,
  });
  const custom = params.customInstructions?.trim() || "";
  const markers = placeholderList(imageCount);
  const layoutRules = layout.agentRules(imageCount);
  const colorHint = includeManualBrandColors
    ? [
        "When writing each visualBrief, apply brand colors where commercially natural:",
        visualDesignSpecs,
        "- Primary: deep background tone, surface color, or dominant mood color",
        "- Secondary/accent: light streaks, rim lighting, environmental highlights",
        "- Never force a hex where it breaks realism",
      ].join("\n")
    : [
        "When writing each visualBrief, derive palette and mood from the attached brand-guide image, not from invented hex codes.",
        visualDesignSpecs,
      ].join("\n");

  return `
Write this product's layout-faithful description and claim-proving image briefs now.

===============================================================
SELECTED LAYOUT — MANDATORY (DO NOT IMPROVISE)
===============================================================

The merchant selected a fixed page layout. Follow it exactly. Do not invent a different composition.

Layout name: ${layout.name}
Layout id: ${layout.id}
Image count required: exactly ${imageCount}
Markers to use verbatim (all of them, each exactly once): ${markers}

${layoutRules}

SHARED HARD RULES FOR EVERY LAYOUT:
- Create exactly ${imageCount} placeholders — never more, never fewer
- Each placeholder proves a distinct spec (specClaim) with a matching visualBrief
- Put each marker alone inside its media column/cell (do not wrap markers in extra <figure> tags; the system embeds images later)
- Surrounding copy must stay tightly related to that image's specClaim
- Prefer balanced columns (image ~40–50%, text ~50–60%) in split layouts
- Never dump all images at the bottom
- Never place orphan images with no related nearby text

===============================================================
BRAND DESIGN SPECS FOR THIS RUN
===============================================================

${visualDesignSpecs}

${colorHint}

${
  custom
    ? `CUSTOM INSTRUCTIONS — treat as mandatory unless unsafe:\n${custom}\n`
    : ""
}
===============================================================
PRODUCT DATA
===============================================================

${JSON.stringify(params.product, null, 2)}
`.trim();
}

export function buildDescriptionResponseSchema(imageCount: number) {
  const maxItems = Math.min(
    VISUALIZER_MAX_IMAGES,
    Math.max(1, Math.floor(imageCount) || 1)
  );
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      description: { type: "string" },
      imagePlaceholders: {
        type: "array",
        maxItems,
        minItems: maxItems,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            index: { type: "integer", minimum: 1, maximum: maxItems },
            specClaim: { type: "string" },
            visualBrief: { type: "string" },
            alt: { type: "string" },
          },
          required: ["index", "specClaim", "visualBrief", "alt"],
        },
      },
      notes: { type: "string" },
    },
    required: ["description", "imagePlaceholders", "notes"],
  } as const;
}
