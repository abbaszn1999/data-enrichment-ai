import { GoogleGenAI } from "@google/genai";
import { createImageGenerationCost, type AiCallCost } from "@/lib/ai-pricing";
import type { GalleryShotBrief } from "@/lib/gallery/agents/planner-plan";
import { referenceMapText } from "@/lib/gallery/agents/reference-set";
import { galleryLog, galleryWarn } from "@/lib/gallery/log";
import type { GalleryAiSettings } from "@/lib/gallery/types";
import {
  buildAiImageResponseFormat,
  convertImageFormat,
  normalizeMimeType,
  referenceToGeminiImagePart,
  type AiImageModel,
  type AiReferenceImage,
} from "@/lib/gallery/agents/ai-shared";

/**
 * The exact text sent to Nano Banana: the planner's prompt, the numbered list of
 * attached images (same numbering the planner used) and the fixed identity rules.
 */
export function buildNanoBananaPrompt(params: {
  shot: Pick<GalleryShotBrief, "prompt" | "specClaim">;
  references: AiReferenceImage[];
  identityRules: string;
}): string {
  return [
    params.shot.prompt.trim(),
    params.references.length > 0
      ? `Attached reference images, in order:\n${referenceMapText(params.references)}`
      : "",
    params.identityRules.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export interface GalleryImageResult {
  image: { buffer: Buffer; contentType: "image/jpeg" | "image/png" } | null;
  /** Every billed call, including a failed attempt that still reported usage. */
  costs: AiCallCost[];
  error?: string;
  prompt: string;
  interactionId?: string;
}

const RETRYABLE = /\b(429|500|502|503|504)\b|timeout|timed out|deadline|unavailable|overloaded|fetch failed|ECONNRESET|socket/i;

export function isRetryableImageError(message: string): boolean {
  return RETRYABLE.test(message);
}

/**
 * Generate one gallery image. Never throws for a provider failure: the result
 * carries the error and any usage Google reported, so the row can still bill it.
 * One retry covers a rate limit, a 5xx or a timeout.
 */
export async function generateAiGalleryImage(params: {
  ai: GoogleGenAI;
  model: AiImageModel;
  settings: Pick<GalleryAiSettings, "aspectRatio" | "resolution" | "outputFormat" | "groundWithSearch">;
  shot: GalleryShotBrief;
  references: AiReferenceImage[];
  identityRules: string;
  rowId: string;
  galleryIndex: number;
}): Promise<GalleryImageResult> {
  const { settings, model } = params;
  const prompt = buildNanoBananaPrompt({
    shot: params.shot,
    references: params.references,
    identityRules: params.identityRules,
  });
  const responseFormat = buildAiImageResponseFormat(settings, model);
  const input: Array<Record<string, unknown>> = [
    { type: "text", text: prompt },
    ...params.references.map((reference) => referenceToGeminiImagePart(reference)),
  ];
  const costs: AiCallCost[] = [];
  let lastError = "Image generation failed";

  galleryLog("ai-gallery:request", "Generating AI Gallery image", {
    rowId: params.rowId,
    model,
    galleryIndex: params.galleryIndex,
    perspective: params.shot.perspective,
    references: params.references.map((reference) => reference.role),
    responseFormat,
    promptChars: prompt.length,
  });

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const interaction = await params.ai.interactions.create({
        model,
        input,
        response_format: responseFormat,
        // Nano Banana Pro always thinks; Nano Banana 2 defaults to minimal, so ask for more.
        ...(model === "gemini-3.1-flash-image" ? { generation_config: { thinking_level: "high" } } : {}),
        ...(settings.groundWithSearch ? { tools: [{ type: "google_search" as const }] } : {}),
      } as Parameters<GoogleGenAI["interactions"]["create"]>[0] & { stream?: false });

      const data = interaction.output_image?.data;
      const returned = interaction.status === "completed" && !!data;
      const searchQueries =
        interaction.steps?.filter((step) => step.type === "google_search_call").length ?? 0;
      // Priced from real usage whether or not an image came back: input and thinking are billed either way.
      costs.push(
        createImageGenerationCost(model, settings.resolution, interaction.usage, searchQueries, {
          imageReturned: returned,
        })
      );
      if (!returned) {
        lastError =
          interaction.status === "completed"
            ? "The image model returned no final image"
            : `Image generation ended with status ${interaction.status}`;
        return { image: null, costs, error: lastError, prompt, interactionId: interaction.id };
      }

      const raw = Buffer.from(data as string, "base64");
      if (raw.length === 0) {
        return { image: null, costs, error: "The image model returned an empty image", prompt, interactionId: interaction.id };
      }
      const targetType = settings.outputFormat === "image/png" ? "image/png" : "image/jpeg";
      const converted = await convertImageFormat(
        raw,
        normalizeMimeType(interaction.output_image?.mime_type || "image/jpeg"),
        targetType
      );
      return { image: converted, costs, prompt, interactionId: interaction.id };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt === 1 && isRetryableImageError(lastError)) {
        galleryWarn("ai-gallery:request", "Image call failed; retrying once", {
          rowId: params.rowId,
          galleryIndex: params.galleryIndex,
          message: lastError.slice(0, 200),
        });
        continue;
      }
      break;
    }
  }
  return { image: null, costs, error: lastError, prompt };
}
