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
  referenceToGeminiImagePart,
  type AiImageModel,
  type AiReferenceImage,
} from "@/lib/gallery/agents/ai-shared";

/**
 * Professional Main-shot variations when the user asks for more than one Main.
 * Same product identity — different commercial framing each time.
 */
const MAIN_VARIATIONS = [
  "straight-on front hero packshot, centered, catalog-ready",
  "slight three-quarter angle that still reads as a primary hero shot",
  "alternate lighting / soft shadow treatment while keeping a clean commercial look",
  "tighter product-focused crop that still shows the full item clearly",
  "subtle presentation change (stance, base, or prop-free staging) without changing the product",
  "premium studio hero with a different camera height or distance",
];

/**
 * Output schema for the AI Main image agent (Gemini image response format).
 * Exported so Main generation never shares Gallery prompt/schema builders.
 */
export const AI_MAIN_RESPONSE_SCHEMA = {
  type: "image",
  role: "main",
} as const;

export function buildAiMainPrompt(params: {
  worksheet: GalleryWorksheetJson;
  row: GalleryRow;
  referenceImages: AiReferenceImage[];
  mainIndex: number;
  mainTotal: number;
}): string {
  const settings = params.worksheet.settings.ai;
  const { hasSceneReference, hasLogo, hasBrandGuide, referenceList } =
    referenceFlags(params.referenceImages);
  const mainCustom = settings.main?.instructions?.trim() || "";
  const variation =
    MAIN_VARIATIONS[params.mainIndex % MAIN_VARIATIONS.length];
  const multiMain = params.mainTotal > 1;

  const shot = hasSceneReference
    ? `Create Main image ${params.mainIndex + 1} of ${params.mainTotal}: a primary ecommerce hero featuring the exact product together with the referenced person/scene — not a solo product packshot. Variation focus: ${variation}.`
    : `Create Main image ${params.mainIndex + 1} of ${params.mainTotal}: a clear primary product shot that accurately establishes the product identity (catalog / hero style). Variation focus: ${variation}.`;

  const diversityRules = multiMain
    ? [
        "MULTIPLE MAIN IMAGES: the user requested several Main images for the SAME exact product.",
        "Each Main image must be professionally distinct from the others — different angle, crop, distance, or lighting — while remaining a primary ecommerce hero / packshot (not a lifestyle gallery shot).",
        "Do NOT repeat or near-duplicate a previous Main image. Identical or lookalike frames are unacceptable.",
        params.mainIndex > 0
          ? "A previous Main image may be attached as a product-identity reference only. Match the product exactly, but create a NEW professional Main variation — never copy that frame."
          : "Later Main images will vary; make this first shot a strong, clean primary hero.",
      ].join(" ")
    : "";

  return [
    "Create exactly one production-ready Main ecommerce image.",
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
    diversityRules,
    "The product must be exact: preserve shape, construction, color, materials, markings, proportions, and distinctive details. Do not substitute a similar product.",
    styleInstruction(settings.style, hasSceneReference),
    "Use realistic lighting, physically plausible geometry, clean edges, and commercially useful framing. Do not add unrelated products, watermarks, captions, or invented text.",
    mainCustom
      ? `MAIN IMAGE CUSTOM INSTRUCTIONS — treat as mandatory unless unsafe: ${mainCustom}`
      : "",
    referenceList,
    `Worksheet product data:\n${buildProductDescription(params.worksheet, params.row)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * AI Main agent: generates one Main product image.
 * Settings used: main.instructions, style, branding, aspect/resolution/format.
 */
export async function generateAiMainImage(params: {
  ai: GoogleGenAI;
  model: AiImageModel;
  worksheet: GalleryWorksheetJson;
  row: GalleryRow;
  references: AiReferenceImage[];
  mainIndex: number;
  mainTotal: number;
}): Promise<{
  buffer: Buffer;
  contentType: string;
  cost: AiCallCost;
  interactionId?: string;
  prompt: string;
}> {
  const settings = params.worksheet.settings.ai;
  const prompt = buildAiMainPrompt({
    worksheet: params.worksheet,
    row: params.row,
    referenceImages: params.references,
    mainIndex: params.mainIndex,
    mainTotal: params.mainTotal,
  });
  const responseFormat = buildAiImageResponseFormat(settings);
  const input: Array<Record<string, unknown>> = [
    { type: "text", text: prompt },
    ...params.references.map((reference) =>
      referenceToGeminiImagePart(reference)
    ),
  ];

  galleryLog("ai-main:request", "Generating AI Main image", {
    rowId: params.row.id,
    model: params.model,
    mainIndex: params.mainIndex,
    mainTotal: params.mainTotal,
    referenceCount: params.references.length,
    aspectRatio: settings.aspectRatio,
    resolution: settings.resolution,
    schema: AI_MAIN_RESPONSE_SCHEMA,
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
