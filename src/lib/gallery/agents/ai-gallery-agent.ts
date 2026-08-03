import { GoogleGenAI } from "@google/genai";
import {
  createImageGenerationCost,
  type AiCallCost,
} from "@/lib/ai-pricing";
import { galleryLog } from "@/lib/gallery/log";
import type { GalleryRow, GalleryWorksheetJson } from "@/lib/gallery/types";
import {
  brandingInstruction,
  buildAiImageResponseFormat,
  buildProductDescription,
  normalizeMimeType,
  referenceFlags,
  sceneInstruction,
  styleInstruction,
  type AiImageModel,
  type AiReferenceImage,
} from "@/lib/gallery/agents/ai-shared";

const GALLERY_ANGLES = [
  "three-quarter front view",
  "side profile highlighting construction and proportions",
  "rear or opposite-side view",
  "close-up detail of materials, texture, and important features",
  "natural lifestyle scene showing realistic use",
  "premium editorial composition",
  "packaging or complete product presentation",
];

/**
 * Output schema for the AI Gallery image agent (Gemini image response format).
 * Kept separate from the Main agent on purpose.
 */
export const AI_GALLERY_RESPONSE_SCHEMA = {
  type: "image",
  role: "gallery",
} as const;

export function buildAiGalleryPrompt(params: {
  worksheet: GalleryWorksheetJson;
  row: GalleryRow;
  referenceImages: AiReferenceImage[];
  galleryIndex: number;
}): string {
  const settings = params.worksheet.settings.ai;
  const { hasSceneReference, hasLogo, hasBrandGuide, referenceList } =
    referenceFlags(params.referenceImages);
  const galleryCustom = settings.instructions?.trim() || "";
  const angle = GALLERY_ANGLES[params.galleryIndex % GALLERY_ANGLES.length];

  const shot = `Create one new and clearly distinct Gallery image from a ${angle}${
    hasSceneReference
      ? ", still including the same referenced person/scene with the product"
      : ""
  }.`;

  return [
    "Create exactly one production-ready Gallery ecommerce image.",
    sceneInstruction(hasSceneReference),
    brandingInstruction({
      brandingEnabled: settings.brandingEnabled,
      brandColors: settings.brandColors || [],
      hasLogo,
      hasBrandGuide,
    }),
    shot,
    "Match the attached Main / canonical product exactly: preserve shape, construction, color, materials, markings, proportions, and distinctive details.",
    "This Gallery image must be meaningfully different from Main and from other Gallery shots (angle, crop, packaging, detail, or lifestyle).",
    styleInstruction(settings.style, hasSceneReference),
    "Use realistic lighting, physically plausible geometry, clean edges, and commercially useful framing. Do not add unrelated products, watermarks, captions, or invented text.",
    galleryCustom
      ? `GALLERY CUSTOM INSTRUCTIONS — treat as mandatory unless unsafe: ${galleryCustom}`
      : "",
    referenceList,
    `Worksheet product data:\n${buildProductDescription(params.worksheet, params.row)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * AI Gallery agent: generates one diversified Gallery image from a trusted Main.
 * Settings used: instructions, style, branding, aspect/resolution/format.
 */
export async function generateAiGalleryImage(params: {
  ai: GoogleGenAI;
  model: AiImageModel;
  worksheet: GalleryWorksheetJson;
  row: GalleryRow;
  references: AiReferenceImage[];
  galleryIndex: number;
}): Promise<{
  buffer: Buffer;
  contentType: string;
  cost: AiCallCost;
  interactionId?: string;
  prompt: string;
}> {
  const settings = params.worksheet.settings.ai;
  const prompt = buildAiGalleryPrompt({
    worksheet: params.worksheet,
    row: params.row,
    referenceImages: params.references,
    galleryIndex: params.galleryIndex,
  });
  const responseFormat = buildAiImageResponseFormat(settings);
  const input: Array<Record<string, unknown>> = [
    { type: "text", text: prompt },
    ...params.references.map((reference) => ({
      type: "image",
      data: reference.buffer.toString("base64"),
      mime_type: reference.contentType,
    })),
  ];

  galleryLog("ai-gallery:request", "Generating AI Gallery image", {
    rowId: params.row.id,
    model: params.model,
    galleryIndex: params.galleryIndex,
    referenceCount: params.references.length,
    aspectRatio: settings.aspectRatio,
    resolution: settings.resolution,
    schema: AI_GALLERY_RESPONSE_SCHEMA,
  });

  const interaction = await params.ai.interactions.create({
    model: params.model,
    input,
    ...(settings.groundWithSearch
      ? { tools: [{ type: "google_search" as const }] }
      : {}),
    response_format: responseFormat,
  });
  if (interaction.status !== "completed" || !interaction.output_image?.data) {
    throw new Error(
      interaction.status === "completed"
        ? "The image model returned no final image"
        : `Image generation ended with status ${interaction.status}`
    );
  }
  const contentType = normalizeMimeType(
    interaction.output_image.mime_type || settings.outputFormat
  );
  const buffer = Buffer.from(interaction.output_image.data, "base64");
  if (buffer.length === 0) throw new Error("The image model returned an empty image");
  const searchQueryCount =
    interaction.steps?.filter((step) => step.type === "google_search_call")
      .length || (settings.groundWithSearch ? 1 : 0);

  return {
    buffer,
    contentType,
    cost: createImageGenerationCost(
      params.model,
      settings.resolution,
      interaction.usage,
      searchQueryCount
    ),
    interactionId: interaction.id,
    prompt,
  };
}
