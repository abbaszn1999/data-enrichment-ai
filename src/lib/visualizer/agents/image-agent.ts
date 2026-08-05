import { GoogleGenAI } from "@google/genai";
import {
  createImageGenerationCost,
  type AiCallCost,
} from "@/lib/ai-pricing";
import {
  brandingInstruction,
  normalizeMimeType as galleryNormalizeMime,
  styleInstruction,
} from "@/lib/gallery/agents/ai-shared";
import { visualizerLog } from "@/lib/visualizer/log";
import {
  resolveVisualizerImageModel,
  type VisualizerBrandSettings,
  type VisualizerImagesSettings,
} from "@/lib/visualizer/types";

/** Fixed image generation defaults (no longer user-configurable). */
export const VISUALIZER_IMAGE_ASPECT_RATIO = "1:1";
export const VISUALIZER_IMAGE_RESOLUTION = "1K";

export type VisualizerProductReference = {
  label: string;
  buffer: Buffer;
  contentType: "image/jpeg" | "image/png" | "image/webp";
};

function normalizeMimeType(
  value: string
): "image/jpeg" | "image/png" | "image/webp" {
  return galleryNormalizeMime(value);
}

export function extensionForMime(value: string): string {
  if (value === "image/png") return "png";
  if (value === "image/webp") return "webp";
  return "jpg";
}

export function buildVisualizerImagePrompt(params: {
  product: Record<string, string>;
  visualBrief: string;
  placeholderIndex: number;
  brand: VisualizerBrandSettings;
  images: VisualizerImagesSettings;
  hasLogo: boolean;
  hasBrandGuide: boolean;
  referenceList: string;
}): string {
  const useManualColors =
    params.images.brandingEnabled &&
    params.images.brandGuideMode === "colors";
  const colors = useManualColors
    ? params.images.brandColors?.length > 0
      ? params.images.brandColors
      : [params.brand.colorPrimary, params.brand.colorSecondary]
    : [];

  return [
    "Create exactly one production-ready ecommerce lifestyle or feature image.",
    brandingInstruction({
      brandingEnabled: params.images.brandingEnabled,
      brandColors: colors,
      includeBrandColors: useManualColors,
      hasLogo: params.hasLogo,
      hasBrandGuide: params.hasBrandGuide,
    }),
    "The attached product photo is the canonical product identity — preserve shape, color, materials, markings, and proportions exactly.",
    `This image illustrates placeholder ${params.placeholderIndex} in a product description.`,
    "Follow the visual brief closely while keeping the real product as the hero subject.",
    `Visual brief:\n${params.visualBrief}`,
    styleInstruction(params.images.style, false),
    useManualColors
      ? `Brand primary color: ${colors[0] || params.brand.colorPrimary}`
      : "",
    useManualColors
      ? `Brand secondary color: ${colors[1] || params.brand.colorSecondary}`
      : "",
    params.brand.styleNotes
      ? `Brand style notes: ${params.brand.styleNotes}`
      : "",
    params.brand.fontsNotes
      ? `Typography / art-direction notes (mood only): ${params.brand.fontsNotes}`
      : "",
    "Use realistic lighting, physically plausible geometry, and commercially useful framing.",
    "Do not add watermarks, captions, UI chrome, or invented product claims.",
    "Do not invent logos or brand text unless clearly visible on an attached logo/product reference.",
    params.referenceList,
    `Product data:\n${JSON.stringify(params.product, null, 2)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function generateVisualizerLifestyleImage(params: {
  ai: GoogleGenAI;
  images: VisualizerImagesSettings;
  brand: VisualizerBrandSettings;
  product: Record<string, string>;
  visualBrief: string;
  placeholderIndex: number;
  productReference?: VisualizerProductReference | null;
  supportingReferences?: VisualizerProductReference[];
}): Promise<{
  buffer: Buffer;
  contentType: string;
  ext: string;
  cost: AiCallCost;
  model: string;
  prompt: string;
}> {
  const model = resolveVisualizerImageModel("premium");
  const supporting = params.supportingReferences ?? [];
  const hasLogo = supporting.some((item) => /brand logo/i.test(item.label));
  const hasBrandGuide = supporting.some((item) =>
    /brand guide|art-direction/i.test(item.label)
  );
  const referenceList = [
    params.productReference
      ? "Reference image 1: canonical product photo; preserve this exact product."
      : "",
    ...supporting.map(
      (item, index) =>
        `Reference image ${index + (params.productReference ? 2 : 1)}: ${item.label}.`
    ),
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = buildVisualizerImagePrompt({
    product: params.product,
    visualBrief: params.visualBrief,
    placeholderIndex: params.placeholderIndex,
    brand: params.brand,
    images: params.images,
    hasLogo,
    hasBrandGuide,
    referenceList,
  });

  const input: Array<Record<string, unknown>> = [
    { type: "text", text: prompt },
  ];
  if (params.productReference) {
    input.push({
      type: "image",
      data: params.productReference.buffer.toString("base64"),
      mime_type: params.productReference.contentType,
    });
  }
  for (const reference of supporting) {
    input.push({
      type: "image",
      data: reference.buffer.toString("base64"),
      mime_type: reference.contentType,
    });
  }

  const responseFormat = {
    type: "image" as const,
    mime_type: normalizeMimeType(params.images.outputFormat || "image/jpeg"),
    aspect_ratio: VISUALIZER_IMAGE_ASPECT_RATIO,
    image_size: VISUALIZER_IMAGE_RESOLUTION,
  };

  visualizerLog("image-agent", "Generating lifestyle image", {
    model,
    placeholderIndex: params.placeholderIndex,
    aspectRatio: VISUALIZER_IMAGE_ASPECT_RATIO,
    resolution: VISUALIZER_IMAGE_RESOLUTION,
    style: params.images.style,
    hasProductReference: !!params.productReference,
    supportingCount: supporting.length,
  });

  const interaction = await params.ai.interactions.create({
    model,
    input,
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
    interaction.output_image.mime_type || params.images.outputFormat
  );
  const buffer = Buffer.from(interaction.output_image.data, "base64");
  if (buffer.length === 0) {
    throw new Error("The image model returned an empty image");
  }

  return {
    buffer,
    contentType,
    ext: extensionForMime(contentType),
    cost: createImageGenerationCost(
      model,
      VISUALIZER_IMAGE_RESOLUTION,
      interaction.usage,
      0
    ),
    model,
    prompt,
  };
}
