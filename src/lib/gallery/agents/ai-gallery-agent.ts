import { GoogleGenAI } from "@google/genai";
import {
  createImageGenerationCost,
  type AiCallCost,
} from "@/lib/ai-pricing";
import type { GalleryShotBrief } from "@/lib/gallery/agents/ai-planner-agent";
import { galleryLog } from "@/lib/gallery/log";
import { loadGallerySkill } from "@/lib/gallery/skill-loader";
import type { GalleryRow, GalleryWorksheetJson } from "@/lib/gallery/types";
import {
  brandingInstruction,
  buildAiImageResponseFormat,
  buildProductDescription,
  normalizeMimeType,
  referenceFlags,
  sceneInstruction,
  styleInstruction,
  referenceToGeminiImagePart,
  type AiImageModel,
  type AiReferenceImage,
} from "@/lib/gallery/agents/ai-shared";

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
  brief: GalleryShotBrief;
  galleryIndex: number;
  skillInstructions?: string;
}): string {
  const settings = params.worksheet.settings.ai;
  const { hasSceneReference, hasLogo, hasBrandGuide, referenceList } =
    referenceFlags(params.referenceImages);

  const shot = `Create one new and clearly distinct Gallery image for slot ${params.galleryIndex + 1}${
    hasSceneReference
      ? ", still including the same referenced person/scene with the product"
      : ""
  }.`;

  return [
    params.skillInstructions || "",
    "Create exactly one production-ready Gallery ecommerce image.",
    sceneInstruction(hasSceneReference),
    brandingInstruction({
      brandingEnabled: settings.brandingEnabled,
      brandColors: settings.brandColors || [],
      hasLogo,
      hasBrandGuide,
      includeBrandColors:
        settings.brandingEnabled && settings.brandGuideMode === "colors",
    }),
    shot,
    params.brief.specClaim
      ? `This image must visually prove: ${params.brief.specClaim}`
      : "",
    "Follow the visual brief closely while keeping the real product as the hero subject.",
    `Visual brief:\n${params.brief.visualBrief}`,
    "Match the attached Main / canonical product exactly: preserve shape, construction, color, materials, markings, proportions, and distinctive details.",
    "This Gallery image must be meaningfully different from Main and from other Gallery shots.",
    styleInstruction(settings.style, hasSceneReference),
    "Use realistic lighting, physically plausible geometry, clean edges, and commercially useful framing. Do not add unrelated products, watermarks, captions, or invented text.",
    referenceList,
    `Worksheet product data:\n${buildProductDescription(params.worksheet, params.row)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * AI Gallery agent: generates one Gallery image from a planner brief + Main identity.
 */
export async function generateAiGalleryImage(params: {
  ai: GoogleGenAI;
  model: AiImageModel;
  worksheet: GalleryWorksheetJson;
  row: GalleryRow;
  references: AiReferenceImage[];
  brief: GalleryShotBrief;
  galleryIndex: number;
}): Promise<{
  buffer: Buffer;
  contentType: string;
  cost: AiCallCost;
  interactionId?: string;
  prompt: string;
}> {
  const settings = params.worksheet.settings.ai;
  const skill = await loadGallerySkill("image");
  const prompt = buildAiGalleryPrompt({
    worksheet: params.worksheet,
    row: params.row,
    referenceImages: params.references,
    brief: params.brief,
    galleryIndex: params.galleryIndex,
    skillInstructions: skill.instructions,
  });
  const responseFormat = buildAiImageResponseFormat(settings);
  const input: Array<Record<string, unknown>> = [
    { type: "text", text: prompt },
    ...params.references.map((reference) =>
      referenceToGeminiImagePart(reference)
    ),
  ];

  galleryLog("ai-gallery:request", "Generating AI Gallery image", {
    rowId: params.row.id,
    model: params.model,
    galleryIndex: params.galleryIndex,
    specClaim: params.brief.specClaim,
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
