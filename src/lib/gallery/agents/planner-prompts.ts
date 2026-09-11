import { buildProductDescription } from "@/lib/gallery/agents/ai-shared";
import type { GalleryRow, GalleryWorksheetJson } from "@/lib/gallery/types";

export function buildPlannerProductImageIntro(): string {
  return [
    "===============================================================",
    "PRODUCT / MAIN IMAGE REFERENCE (analyze the image attached immediately after this text)",
    "===============================================================",
    "The next content part is the canonical product photo. Use it for visual analysis and accurate product identity in every brief.",
  ].join("\n");
}

export function buildPlannerJsonClosing(needMain: boolean, galleryCount: number): string {
  return [
    "Respond with JSON only matching the schema.",
    needMain
      ? `Include main (identity hero) and exactly ${galleryCount} gallery items with indexes 1…${galleryCount}.`
      : `Do not include a main brief. Include exactly ${galleryCount} gallery items with indexes 1…${galleryCount}.`,
  ].join("\n");
}

export function galleryPlanFingerprint(params: {
  galleryCount: number;
  needMain: boolean;
  instructions: string;
  style: string;
  scene: boolean;
  branding: boolean;
}): string {
  return JSON.stringify({
    galleryCount: params.galleryCount,
    needMain: params.needMain,
    instructions: params.instructions.trim(),
    style: params.style,
    scene: params.scene,
    branding: params.branding,
  });
}

export function buildPlannerUserPrompt(params: {
  worksheet: GalleryWorksheetJson;
  row: GalleryRow;
  galleryCount: number;
  needMain: boolean;
  hasProductImage: boolean;
  hasSceneReference: boolean;
  hasLogo: boolean;
  hasBrandGuide: boolean;
}): string {
  const settings = params.worksheet.settings.ai;
  const custom = settings.instructions?.trim() || "";
  const product = buildProductDescription(params.worksheet, params.row);

  return `
Write professional photography briefs for this SKU now.

===============================================================
RUN MODE — MANDATORY
===============================================================

Need Main brief: ${params.needMain ? "YES — write exactly one clean identity hero brief" : "NO — Gallery briefs only"}
Gallery count required: exactly ${params.galleryCount}
Product photo attached: ${params.hasProductImage ? "YES" : "NO — do not invent surface detail"}
Scene / model will be attached to the photographer: ${params.hasSceneReference ? "YES" : "NO"}
Brand logo will be attached: ${params.hasLogo ? "YES" : "NO"}
Brand guide will be attached: ${params.hasBrandGuide ? "YES" : "NO"}
Style: ${settings.style || "studio"}
Aspect ratio: ${settings.aspectRatio}
Resolution: ${settings.resolution}

${
  custom
    ? `GALLERY CUSTOM INSTRUCTIONS — treat as mandatory unless unsafe:\n${custom}\n`
    : "No Gallery custom instructions. Choose commercially useful distinct claims from the inventory.\n"
}

===============================================================
PRODUCT DATA
===============================================================

${product || "(no column values)"}
`.trim();
}

function shotSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      specClaim: { type: "string" },
      visualBrief: { type: "string" },
      alt: { type: "string" },
    },
    required: ["specClaim", "visualBrief", "alt"],
  } as const;
}

export function buildPlannerResponseSchema(params: {
  galleryCount: number;
  needMain: boolean;
}) {
  const n = Math.min(8, Math.max(1, Math.floor(params.galleryCount) || 1));
  const galleryItems = {
    type: "object",
    additionalProperties: false,
    properties: {
      index: { type: "integer", minimum: 1, maximum: n },
      specClaim: { type: "string" },
      visualBrief: { type: "string" },
      alt: { type: "string" },
    },
    required: ["index", "specClaim", "visualBrief", "alt"],
  } as const;

  if (params.needMain) {
    return {
      type: "object",
      additionalProperties: false,
      properties: {
        main: shotSchema(),
        gallery: {
          type: "array",
          minItems: n,
          maxItems: n,
          items: galleryItems,
        },
        notes: { type: "string" },
      },
      required: ["main", "gallery", "notes"],
    } as const;
  }

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      gallery: {
        type: "array",
        minItems: n,
        maxItems: n,
        items: galleryItems,
      },
      notes: { type: "string" },
    },
    required: ["gallery", "notes"],
  } as const;
}
