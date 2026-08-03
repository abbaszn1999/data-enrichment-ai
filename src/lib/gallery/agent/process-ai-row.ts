import { GoogleGenAI } from "@google/genai";
import { createAdminClient } from "@/lib/supabase-admin";
import { sumCosts, type AiCallCost } from "@/lib/ai-pricing";
import { parseImageUrls } from "@/lib/gallery/image-urls";
import { galleryError, galleryLog, galleryWarn } from "@/lib/gallery/log";
import { downloadImageBytes } from "@/lib/gallery/providers/serper-images";
import {
  downloadGalleryBytesAdmin,
  removeGalleryPathsAdmin,
  uploadGalleryBytesAdmin,
} from "@/lib/gallery/storage-admin";
import { getGalleryRowImagePath } from "@/lib/gallery/storage-paths";
import type {
  GalleryRow,
  GalleryRunPhase,
  GalleryWorksheetJson,
} from "@/lib/gallery/types";
import {
  getRowMainImagePaths,
  resolveGalleryRunPhase,
} from "@/lib/gallery/types";
import { deductGalleryCredits } from "@/lib/gallery/agent/process-row";
import {
  extensionForMime,
  normalizeMimeType,
  type AiImageModel,
  type AiReferenceImage,
} from "@/lib/gallery/agents/ai-shared";
import { generateAiMainImage } from "@/lib/gallery/agents/ai-main-agent";
import { generateAiGalleryImage } from "@/lib/gallery/agents/ai-gallery-agent";

async function loadStoredReference(
  path: string | null,
  label: string
): Promise<AiReferenceImage | null> {
  if (!path) return null;
  const file = await downloadGalleryBytesAdmin(path);
  if (!file) {
    galleryWarn("ai-image:reference", "Stored reference could not be downloaded", {
      path,
      label,
    });
    return null;
  }
  return {
    label,
    buffer: file.buffer,
    contentType: normalizeMimeType(file.contentType),
  };
}

export async function processAiRow(params: {
  workspaceId: string;
  sessionId: string;
  worksheet: GalleryWorksheetJson;
  row: GalleryRow;
  ownerUserId: string;
  actorUserId: string;
  runId: string;
  runPhase?: GalleryRunPhase;
  deadlineAt?: number;
  onCheckpoint?: (patch: Partial<GalleryRow>) => Promise<void>;
}): Promise<{
  row: GalleryRow;
  creditsUsed: number;
  cost: number;
  error?: string;
}> {
  const { workspaceId, sessionId, worksheet, row } = params;
  const settings = worksheet.settings.ai;
  const runPhase = resolveGalleryRunPhase({
    originalImageColumn: worksheet.originalImageColumn,
    row,
    requested: params.runPhase ?? null,
  });
  const runMain = runPhase === "main" || runPhase === "full";
  const runGallery = runPhase === "gallery" || runPhase === "full";
  const model: AiImageModel =
    settings.tier === "premium"
      ? "gemini-3-pro-image"
      : "gemini-3.1-flash-image";
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) throw new Error("Gemini API key is not configured");
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { timeout: 90_000 },
  });
  const ensureTime = (minimumRemainingMs: number) => {
    if (
      params.deadlineAt &&
      params.deadlineAt - Date.now() < minimumRemainingMs
    ) {
      throw new Error("Run time budget reached; retry this product");
    }
  };

  const oldMainPaths = getRowMainImagePaths(row);
  const oldGalleryPaths = [...row.galleryImagePaths];
  const newlyStoredPaths: string[] = [];
  const aiGeneratedPaths: string[] = [];
  const galleryPaths: string[] = [];
  const mainPaths: string[] = [];
  const costs: AiCallCost[] = [];
  let mainPath: string | null = null;
  let canonicalProduct: AiReferenceImage | null = null;

  galleryLog("ai-image:row", `Processing row ${row.id} via AI`, { runPhase });

  const loadCanonicalFromPath = async (
    path: string,
    label: string
  ): Promise<AiReferenceImage | null> => {
    if (/^https?:\/\//i.test(path)) {
      const original = await downloadImageBytes(path);
      if (!original) return null;
      return {
        label,
        buffer: original.buffer,
        contentType: normalizeMimeType(original.contentType),
      };
    }
    try {
      const stored = await downloadGalleryBytesAdmin(path);
      if (!stored) return null;
      return {
        label,
        buffer: stored.buffer,
        contentType: normalizeMimeType(stored.contentType),
      };
    } catch {
      return null;
    }
  };

  if (runMain) {
    const originalUrl = worksheet.originalImageColumn
      ? parseImageUrls(row.originalData[worksheet.originalImageColumn])[0]
      : undefined;
    if (originalUrl && /^https?:\/\//i.test(originalUrl)) {
      const original = await downloadImageBytes(originalUrl);
      if (original) {
        canonicalProduct = {
          label:
            "trusted original product; preserve this exact product with high fidelity",
          buffer: original.buffer,
          contentType: normalizeMimeType(original.contentType),
        };
        const path = getGalleryRowImagePath(
          workspaceId,
          sessionId,
          row.id,
          "main",
          original.ext
        );
        await uploadGalleryBytesAdmin(
          path,
          original.buffer,
          original.contentType
        );
        newlyStoredPaths.push(path);
        mainPaths.push(path);
        mainPath = path;
        await params.onCheckpoint?.({
          mainImagePaths: [...mainPaths],
          mainImagePath: path,
          galleryImagePaths: runGallery ? [] : oldGalleryPaths,
          generationStage: "main",
        });
      }
    }
  } else {
    mainPaths.push(...oldMainPaths);
    mainPath = mainPaths[0] ?? null;
    if (!mainPath) {
      return {
        row: {
          ...row,
          status: row.status === "ready" ? "ready" : "failed",
          generationStage: undefined,
          errorMessage: "Find main images first before generating the gallery",
          mainImagePaths: oldMainPaths,
          mainImagePath: oldMainPaths[0] ?? null,
          galleryImagePaths: oldGalleryPaths,
        },
        creditsUsed: 0,
        cost: 0,
        error: "Find main images first before generating the gallery",
      };
    }
    canonicalProduct = await loadCanonicalFromPath(
      mainPath,
      "canonical main product image; preserve this exact product identity"
    );
    if (!canonicalProduct) {
      return {
        row: {
          ...row,
          status: row.status === "ready" ? "ready" : "failed",
          generationStage: undefined,
          errorMessage: "Could not load the existing main image for gallery generation",
          mainImagePaths: oldMainPaths,
          mainImagePath: oldMainPaths[0] ?? null,
          galleryImagePaths: oldGalleryPaths,
        },
        creditsUsed: 0,
        cost: 0,
        error: "Could not load the existing main image for gallery generation",
      };
    }
  }

  const sceneReference = await loadStoredReference(
    settings.sceneReferencePath,
    "scene or model reference; preserve the person when applicable"
  );
  if (settings.sceneReferencePath && !sceneReference) {
    galleryWarn("ai-image:reference", "Clearing stale scene reference path", {
      path: settings.sceneReferencePath,
    });
    settings.sceneReferencePath = null;
  }
  const logoReference = settings.brandingEnabled
    ? await loadStoredReference(
        settings.logoPath,
        "official brand logo; preserve its recognizable design"
      )
    : null;
  if (settings.brandingEnabled && settings.logoPath && !logoReference) {
    galleryWarn("ai-image:reference", "Clearing stale brand logo path", {
      path: settings.logoPath,
    });
    settings.logoPath = null;
  }
  const brandGuideReference = settings.brandingEnabled
    ? await loadStoredReference(
        settings.brandGuidePath,
        "visual brand guide and art-direction reference"
      )
    : null;
  if (
    settings.brandingEnabled &&
    settings.brandGuidePath &&
    !brandGuideReference
  ) {
    galleryWarn("ai-image:reference", "Clearing stale brand guide path", {
      path: settings.brandGuidePath,
    });
    settings.brandGuidePath = null;
  }
  const supportingReferences = [
    sceneReference,
    logoReference,
    brandGuideReference,
  ].filter((value): value is AiReferenceImage => !!value);

  const galleryTarget = runGallery
    ? Math.min(Math.max(settings.imagesPerRow || 4, 1), 8)
    : 0;
  const mainTarget = Math.min(Math.max(settings.main?.imagesPerRow || 1, 1), 6);
  const needGeneratedMain = runMain && !canonicalProduct;
  const originalUrl = worksheet.originalImageColumn
    ? parseImageUrls(row.originalData[worksheet.originalImageColumn])[0]
    : undefined;
  galleryLog("ai-image:plan", "AI row image plan", {
    rowId: row.id,
    runPhase,
    imagesPerRow: settings.imagesPerRow,
    galleryTarget,
    mainImagesPerRow: settings.main?.imagesPerRow,
    mainTarget: needGeneratedMain ? mainTarget : mainPaths.length || 1,
    needGeneratedMain,
    hasOriginalColumn: !!worksheet.originalImageColumn,
    sceneReferencePath: settings.sceneReferencePath,
    supportingReferenceCount: supportingReferences.length,
    supportingReferenceLabels: supportingReferences.map((item) => item.label),
    brandingEnabled: settings.brandingEnabled,
  });

  if (needGeneratedMain) {
    for (let mainIndex = 0; mainIndex < mainTarget; mainIndex += 1) {
      ensureTime(35_000);
      try {
        const references = [
          ...(canonicalProduct ? [canonicalProduct] : []),
          ...supportingReferences,
        ].slice(0, model === "gemini-3-pro-image" ? 6 : 10);
        const generated = await generateAiMainImage({
          ai,
          model,
          worksheet,
          row,
          references,
          mainIndex,
          mainTotal: mainTarget,
        });
        costs.push(generated.cost);
        const ext = extensionForMime(generated.contentType);
        const path = getGalleryRowImagePath(
          workspaceId,
          sessionId,
          row.id,
          "main",
          ext
        );
        await uploadGalleryBytesAdmin(path, generated.buffer, generated.contentType);
        newlyStoredPaths.push(path);
        aiGeneratedPaths.push(path);
        mainPaths.push(path);
        mainPath = mainPaths[0];
        if (!canonicalProduct) {
          canonicalProduct = {
            label:
              "canonical generated main product image; preserve this exact product identity",
            buffer: generated.buffer,
            contentType: generated.contentType,
          };
        }
        await params.onCheckpoint?.({
          mainImagePaths: [...mainPaths],
          mainImagePath: mainPath,
          galleryImagePaths: runGallery ? [] : oldGalleryPaths,
          generationStage: "main",
        });
      } catch (error) {
        galleryError("ai-image:row", "Main image generation failed", error);
        break;
      }
    }
  }

  if (runGallery) {
    for (let galleryIndex = 0; galleryIndex < galleryTarget; galleryIndex += 1) {
      ensureTime(35_000);
      if (!canonicalProduct) break;
      try {
        const references = [
          canonicalProduct,
          ...supportingReferences,
        ].slice(0, model === "gemini-3-pro-image" ? 6 : 10);
        const generated = await generateAiGalleryImage({
          ai,
          model,
          worksheet,
          row,
          references,
          galleryIndex,
        });
        costs.push(generated.cost);
        const ext = extensionForMime(generated.contentType);
        const path = getGalleryRowImagePath(
          workspaceId,
          sessionId,
          row.id,
          "gallery",
          ext
        );
        await uploadGalleryBytesAdmin(path, generated.buffer, generated.contentType);
        newlyStoredPaths.push(path);
        aiGeneratedPaths.push(path);
        galleryPaths.push(path);
        await params.onCheckpoint?.({
          mainImagePaths: [...mainPaths],
          mainImagePath: mainPath,
          galleryImagePaths: [...galleryPaths],
          generationStage:
            galleryIndex === galleryTarget - 1 ? "finalizing" : "gallery",
        });
      } catch (error) {
        galleryError("ai-image:row", "Image generation attempt failed", error);
        galleryWarn("ai-image:row", "Keeping partial AI image result", {
          rowId: row.id,
          galleryIndex,
          generatedSoFar: aiGeneratedPaths.length,
        });
        break;
      }
    }
  }

  if (!mainPath) {
    await removeGalleryPathsAdmin(newlyStoredPaths);
    return {
      row: {
        ...row,
        status: "failed",
        generationStage: undefined,
        errorMessage: "AI could not create the main product image",
        mainImagePaths: oldMainPaths,
        mainImagePath: oldMainPaths[0] ?? null,
        galleryImagePaths: oldGalleryPaths,
      },
      creditsUsed: 0,
      cost: sumCosts(costs).totalCost,
      error: "AI could not create the main product image",
    };
  }

  const finalMainPaths = runMain ? mainPaths : oldMainPaths;
  const finalMainPath = finalMainPaths[0] ?? null;
  const finalGalleryPaths = runGallery ? galleryPaths : oldGalleryPaths;

  const totals = sumCosts(costs);
  let creditsUsed = 0;
  if (aiGeneratedPaths.length > 0) {
    const deduct = await deductGalleryCredits({
      admin: createAdminClient(),
      ownerUserId: params.ownerUserId,
      workspaceId,
      actorUserId: params.actorUserId,
      amount: totals.totalCredits,
      sessionId,
      rowId: row.id,
      operation: "gallery_ai",
      details: {
        idempotencyKey: `${params.runId}:${row.id}:${runPhase}`,
        provider: "ai",
        model,
        runPhase,
        resolution: settings.resolution,
        aspectRatio: settings.aspectRatio,
        requestedImages: galleryTarget,
        generatedImages: aiGeneratedPaths.length,
        galleryImages: finalGalleryPaths.length,
        generatedMain: needGeneratedMain && !!mainPath,
        usedOriginalImage: !!originalUrl,
        usedSceneReference: !!sceneReference,
        brandingEnabled: settings.brandingEnabled,
        dollarCost: totals.totalCost,
      },
    });
    if (!deduct.success) {
      await removeGalleryPathsAdmin(aiGeneratedPaths);
      return {
        row: {
          ...row,
          status: "failed",
          generationStage: undefined,
          errorMessage: deduct.error || "Credit deduction failed",
          mainImagePaths: oldMainPaths,
          mainImagePath: oldMainPaths[0] ?? null,
          galleryImagePaths: oldGalleryPaths,
        },
        creditsUsed: 0,
        cost: totals.totalCost,
        error: deduct.error || "Credit deduction failed",
      };
    }
    creditsUsed = deduct.duplicate ? 0 : totals.totalCredits;
  }

  try {
    await removeGalleryPathsAdmin([
      ...(runMain
        ? oldMainPaths.filter((path) => !finalMainPaths.includes(path))
        : []),
      ...(runGallery
        ? oldGalleryPaths.filter((path) => !finalGalleryPaths.includes(path))
        : []),
    ]);
  } catch (error) {
    galleryWarn("ai-image:cleanup", "Generated images are ready but old files remain", {
      rowId: row.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const partialWarning = [
    needGeneratedMain && mainPaths.length < mainTarget
      ? `Created ${mainPaths.length} of ${mainTarget} requested main images`
      : undefined,
    runGallery && galleryPaths.length < galleryTarget
      ? `Created ${galleryPaths.length} of ${galleryTarget} requested gallery images`
      : undefined,
  ]
    .filter(Boolean)
    .join(". ") || undefined;
  galleryLog("ai-image:done", "AI product images completed", {
    rowId: row.id,
    model,
    runPhase,
    mainPath: finalMainPath,
    galleryCount: finalGalleryPaths.length,
    creditsUsed,
    dollarCost: totals.totalCost,
    partial: !!partialWarning,
  });
  return {
    row: {
      ...row,
      status: "ready",
      generationStage: undefined,
      errorMessage: partialWarning,
      mainImagePaths: finalMainPaths,
      mainImagePath: finalMainPath,
      galleryImagePaths: finalGalleryPaths,
      sourceMeta: {
        provider: "ai",
        model,
        runPhase,
        usedOriginalImage: !!originalUrl,
        usedSceneReference: !!sceneReference,
        brandingEnabled: settings.brandingEnabled,
        partialWarning,
      },
      creditsUsed: creditsUsed || row.creditsUsed || 0,
    },
    creditsUsed,
    cost: totals.totalCost,
  };
}
