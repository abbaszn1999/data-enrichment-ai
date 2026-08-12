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
  mimeTypeFromImageUrl,
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
  const mainProductReferences: AiReferenceImage[] = [];

  galleryLog("ai-image:row", `Processing row ${row.id} via AI`, { runPhase });

  const loadCanonicalFromPath = async (
    path: string,
    label: string
  ): Promise<AiReferenceImage | null> => {
    // Scraped / external mains: pass the public HTTPS URL to Gemini
    // (Interactions ImageContent.uri) so we do not re-download here.
    if (/^https?:\/\//i.test(path)) {
      return {
        label,
        uri: path,
        contentType: mimeTypeFromImageUrl(path),
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
    await params.onCheckpoint?.({ generationStage: "main" });
    const originalUrls = worksheet.originalImageColumn
      ? parseImageUrls(row.originalData[worksheet.originalImageColumn])
      : [];
    for (const originalUrl of originalUrls) {
      if (!/^https?:\/\//i.test(originalUrl)) continue;
      const original = await downloadImageBytes(originalUrl);
      if (!original) {
        galleryWarn("ai-image:row", "Skipping undownloadable original image", {
          rowId: row.id,
          originalUrl,
        });
        continue;
      }
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
      mainPath = mainPaths[0] ?? path;
      const reference: AiReferenceImage = {
        label:
          mainProductReferences.length === 0
            ? "trusted original product; preserve this exact product with high fidelity"
            : `additional original product image ${mainProductReferences.length + 1}; preserve this exact product with high fidelity`,
        buffer: original.buffer,
        contentType: normalizeMimeType(original.contentType),
      };
      mainProductReferences.push(reference);
      if (!canonicalProduct) canonicalProduct = reference;
    }
    if (mainPaths.length > 0) {
      await params.onCheckpoint?.({
        mainImagePaths: [...mainPaths],
        mainImagePath: mainPaths[0] ?? null,
        galleryImagePaths: runGallery ? [] : oldGalleryPaths,
        generationStage: runGallery ? "gallery" : "finalizing",
      });
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
    for (const path of mainPaths) {
      const loaded = await loadCanonicalFromPath(
        path,
        mainProductReferences.length === 0
          ? "canonical main product image; preserve this exact product identity"
          : `additional main product image ${mainProductReferences.length + 1}; preserve this exact product identity`
      );
      if (loaded) mainProductReferences.push(loaded);
    }
    canonicalProduct = mainProductReferences[0] ?? null;
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
  const brandGuideReference =
    settings.brandingEnabled && settings.brandGuideMode === "image"
      ? await loadStoredReference(
          settings.brandGuidePath,
          "visual brand guide and art-direction reference"
        )
      : null;
  if (
    settings.brandingEnabled &&
    settings.brandGuideMode === "image" &&
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
  const originalUrls = worksheet.originalImageColumn
    ? parseImageUrls(row.originalData[worksheet.originalImageColumn])
    : [];
  galleryLog("ai-image:plan", "AI row image plan", {
    rowId: row.id,
    runPhase,
    imagesPerRow: settings.imagesPerRow,
    galleryTarget,
    mainImagesPerRow: settings.main?.imagesPerRow,
    mainTarget: needGeneratedMain ? mainTarget : mainPaths.length || 1,
    needGeneratedMain,
    hasOriginalColumn: !!worksheet.originalImageColumn,
    originalImageCount: originalUrls.length,
    mainReferenceCount: mainProductReferences.length,
    sceneReferencePath: settings.sceneReferencePath,
    supportingReferenceCount: supportingReferences.length,
    supportingReferenceLabels: supportingReferences.map((item) => item.label),
    brandingEnabled: settings.brandingEnabled,
  });

  if (needGeneratedMain) {
    await params.onCheckpoint?.({ generationStage: "main" });
    for (let mainIndex = 0; mainIndex < mainTarget; mainIndex += 1) {
      ensureTime(35_000);
      try {
        const references = [
          ...mainProductReferences,
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
        const generatedReference: AiReferenceImage = {
          label:
            mainProductReferences.length === 0
              ? "canonical generated main product image; preserve this exact product identity"
              : `additional generated main product image ${mainProductReferences.length + 1}; preserve this exact product identity`,
          buffer: generated.buffer,
          contentType: generated.contentType,
        };
        mainProductReferences.push(generatedReference);
        if (!canonicalProduct) canonicalProduct = generatedReference;
      } catch (error) {
        galleryError("ai-image:row", "Main image generation failed", error);
        break;
      }
    }
    if (mainPaths.length > 0) {
      await params.onCheckpoint?.({
        mainImagePaths: [...mainPaths],
        mainImagePath: mainPath,
        galleryImagePaths: runGallery ? [] : oldGalleryPaths,
        generationStage: runGallery ? "gallery" : "finalizing",
      });
    }
  }

  if (runGallery) {
    // Clear previous Gallery paths while this stage runs so the UI stays in
    // skeleton mode for the whole field (no one-by-one / stale reveals).
    await params.onCheckpoint?.({
      generationStage: "gallery",
      galleryImagePaths: [],
    });
    for (let galleryIndex = 0; galleryIndex < galleryTarget; galleryIndex += 1) {
      ensureTime(35_000);
      if (mainProductReferences.length === 0) break;
      try {
        const references = [
          ...mainProductReferences,
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
    await params.onCheckpoint?.({
      mainImagePaths: [...mainPaths],
      mainImagePath: mainPath,
      galleryImagePaths: [...galleryPaths],
      generationStage: "finalizing",
    });
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
        usedOriginalImage: originalUrls.length > 0,
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
        usedOriginalImage: originalUrls.length > 0,
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
