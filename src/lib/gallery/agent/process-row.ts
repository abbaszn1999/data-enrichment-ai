import { createAdminClient } from "@/lib/supabase-admin";
import sharp from "sharp";
import {
  sumCosts,
  type AiCallCost,
} from "@/lib/ai-pricing";
import { updateCachedCredits } from "@/lib/workspace-context";
import { searchScrapingMainImages } from "@/lib/gallery/agents/scraping-main-agent";
import { searchScrapingGalleryImages } from "@/lib/gallery/agents/scraping-gallery-agent";
import { downloadImageBytes } from "@/lib/gallery/providers/serper-images";
import { removeGalleryAssets } from "@/lib/gallery/storage-assets";
import {
  downloadGalleryBytesAdmin,
  uploadGalleryBytesAdmin,
} from "@/lib/gallery/storage-admin";
import { getGalleryRowImagePath } from "@/lib/gallery/storage-paths";
import {
  getRowMainImagePaths,
  resolveGalleryRunPhase,
  type GalleryImageProvenance,
  type GalleryRow,
  type GalleryRunPhase,
  type GalleryWorksheetJson,
} from "@/lib/gallery/types";
import {
  GalleryPipelineTrace,
  galleryLog,
  galleryWarn,
} from "@/lib/gallery/log";
import { parseImageUrls } from "@/lib/gallery/image-urls";
import { shouldChargeGalleryCredits } from "@/lib/gallery/pricing";

type Admin = ReturnType<typeof createAdminClient>;

export const NO_GALLERY_MESSAGE = "No gallery images found";

export function getGalleryWarning(found: number, target: number): string | undefined {
  if (target <= 0 || found >= target) return undefined;
  if (found === 0) return NO_GALLERY_MESSAGE;
  return `Found ${found} of ${target} gallery images`;
}

async function removeStoragePaths(admin: Admin, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await removeGalleryAssets(admin, paths);
}

async function normalizePersistedMainImage(image: {
  buffer: Buffer;
  contentType: string;
  ext: string;
}) {
  if (
    image.contentType === "image/jpeg" ||
    image.contentType === "image/png" ||
    image.contentType === "image/webp"
  ) {
    return image;
  }
  return {
    buffer: await sharp(image.buffer, { animated: false }).webp().toBuffer(),
    contentType: "image/webp",
    ext: "webp",
  };
}

export async function deductGalleryCredits(params: {
  admin: Admin;
  ownerUserId: string;
  workspaceId: string;
  actorUserId: string;
  amount: number;
  sessionId: string;
  rowId: string;
  details: Record<string, unknown>;
  operation?: "gallery_google" | "gallery_ai";
}): Promise<{
  success: boolean;
  duplicate?: boolean;
  remaining?: number;
  error?: string;
}> {
  const { data, error } = await params.admin.rpc("deduct_user_credits", {
    p_user_id: params.ownerUserId,
    p_amount: params.amount,
    p_workspace_id: params.workspaceId,
    p_operation: params.operation ?? "gallery_google",
    p_uid: params.actorUserId,
    p_entity_type: "gallery_session",
    p_entity_id: params.sessionId,
    p_details: { ...params.details, rowId: params.rowId },
  });
  if (error) return { success: false, error: error.message };
  if (!data?.success) {
    return {
      success: false,
      remaining: data?.remaining,
      error: data?.error || "Deduction failed",
    };
  }
  if (!data?.duplicate && typeof data.remaining === "number") {
    updateCachedCredits(params.workspaceId, data.remaining);
  }
  return {
    success: true,
    duplicate: !!data?.duplicate,
    remaining: data?.remaining,
  };
}

/**
 * OpenAI-only Scraping row:
 * - Main and Gallery are separate run phases when finding new Main images.
 * - Both keep verified external URLs; Scraping never stores images.
 * - With an original column, one full run copies Main then finds Gallery.
 */
export async function processScrapingRow(params: {
  admin: Admin;
  workspaceId: string;
  sessionId: string;
  worksheet: GalleryWorksheetJson;
  row: GalleryRow;
  ownerUserId: string;
  actorUserId: string;
  runId: string;
  /** Defaults to full when an original column is set, otherwise main. */
  runPhase?: GalleryRunPhase;
  deadlineAt?: number;
  onCheckpoint?: (patch: Partial<GalleryRow>) => Promise<void>;
}): Promise<{
  row: GalleryRow;
  creditsUsed: number;
  cost: number;
  error?: string;
}> {
  const { admin, workspaceId, sessionId, worksheet, row } = params;
  const settings = worksheet.settings.scraping;
  const runPhase: GalleryRunPhase = resolveGalleryRunPhase({
    originalImageColumn: worksheet.originalImageColumn,
    row,
    requested: params.runPhase ?? null,
  });
  const runMain = runPhase === "main" || runPhase === "full";
  const runGallery = runPhase === "gallery" || runPhase === "full";
  const trace = new GalleryPipelineTrace(row.id);
  const ensureTime = (minimumRemainingMs: number, stage: string) => {
    if (
      params.deadlineAt &&
      params.deadlineAt - Date.now() < minimumRemainingMs
    ) {
      throw new Error(`Run time budget reached before ${stage}; retry this row`);
    }
  };
  const selected = worksheet.selectedColumns.length
    ? worksheet.selectedColumns
    : worksheet.columns;

  galleryLog("row", `Processing row ${row.id} (index ${row.rowIndex}) via Scraping`, {
    runPhase,
  });
  const costs: AiCallCost[] = [];
  const recordUsage = async (_stageKey: string, cost: AiCallCost | null) => {
    if (!cost) return;
    costs.push(cost);
  };
  const previousGalleryPaths = [...row.galleryImagePaths];
  const previousMainPaths = getRowMainImagePaths(row);

  const originalImageUrls = worksheet.originalImageColumn
    ? parseImageUrls(row.originalData[worksheet.originalImageColumn]).slice(0, 1)
    : [];
  const originalValue = originalImageUrls[0] ?? "";
  const originalIsHttpUrl = /^https?:\/\//i.test(originalValue);
  const hasUsableOriginal =
    !!worksheet.originalImageColumn && originalIsHttpUrl;

  const needMain = !worksheet.originalImageColumn;
  const mainCount = Math.min(6, Math.max(1, settings.main?.imagesPerRow || 1));
  const galleryCount = runGallery ? Math.max(1, settings.imagesPerRow || 4) : 0;

  let mainPaths: string[] = [];
  let mainPath: string | null = null;
  let mainPublicUrl = "";
  let mainBuffer: Buffer | undefined;
  let mainContentType: string | undefined;
  let productIdentity = "";
  let searchQueryCount = 0;
  const newlyStoredMainPaths: string[] = [];
  const sourceMetaImages: GalleryImageProvenance[] = (
    Array.isArray(row.sourceMeta?.images) ? row.sourceMeta.images : []
  )
    .map((image) => {
      const ref = String(image.ref || image.url || "").trim();
      if (!ref || (image.role !== "main" && image.role !== "gallery")) {
        return null;
      }
      return {
        ...image,
        ref,
        url: image.url || ref,
        persistence:
          image.persistence ||
          (/^https?:\/\//i.test(ref) ? "external" : "internal"),
      } as GalleryImageProvenance;
    })
    .filter((image): image is GalleryImageProvenance => {
      if (!image) return false;
      return image.role === "main" ? !runMain : !runGallery;
    });

  const fail = async (
    message: string,
    extra?: Record<string, unknown>
  ): Promise<{
    row: GalleryRow;
    creditsUsed: number;
    cost: number;
    error?: string;
  }> => {
    if (newlyStoredMainPaths.length > 0) {
      await removeStoragePaths(admin, newlyStoredMainPaths).catch(() => undefined);
    }
    const totals = sumCosts(costs);
    trace.finish("failed", { error: message, ...extra });
    return {
      row: {
        ...row,
        status: row.status === "ready" ? "ready" : "failed",
        generationStage: undefined,
        errorMessage: message,
        sourceMeta: {
          ...(row.sourceMeta ?? {}),
          provider: "scraping",
          ...extra,
        },
        mainImagePaths: previousMainPaths,
        mainImagePath: previousMainPaths[0] ?? null,
        galleryImagePaths: previousGalleryPaths,
      },
      creditsUsed: 0,
      cost: totals.totalCost,
      error: message,
    };
  };

  if (runMain) {
    if (worksheet.originalImageColumn && !hasUsableOriginal) {
      return fail(
        originalValue
          ? "The selected original image is not a valid downloadable URL"
          : "The selected original image cell is empty"
      );
    }

    if (hasUsableOriginal) {
      ensureTime(5_000, "original reference");
      trace.stage("main", "Saving original external image as Main");
      await params.onCheckpoint?.({ generationStage: "main" });
      const sourceImage = await downloadImageBytes(originalValue);
      if (!sourceImage) {
        return fail("The selected original image could not be downloaded");
      }
      const downloaded = await normalizePersistedMainImage(sourceImage);
      const storedPath = getGalleryRowImagePath(
        workspaceId,
        sessionId,
        row.id,
        "main",
        downloaded.ext
      );
      await uploadGalleryBytesAdmin(
        storedPath,
        downloaded.buffer,
        downloaded.contentType
      );
      newlyStoredMainPaths.push(storedPath);
      mainPaths = [storedPath];
      mainPath = storedPath;
      mainPublicUrl = storedPath;
      mainBuffer = downloaded.buffer;
      mainContentType = downloaded.contentType;
      sourceMetaImages.push({
        ref: storedPath,
        url: storedPath,
        persistence: "internal",
        sourceUrl: originalValue,
        pageUrl: originalValue,
        title: "original",
        role: "main",
        fallbackUrl: originalValue,
      });
      await params.onCheckpoint?.({
        mainImagePaths: mainPaths,
        mainImagePath: mainPath,
        generationStage: runGallery ? "gallery" : "finalizing",
      });
    } else {
      ensureTime(120_000, "OpenAI product image search");
      trace.stage("searching", "Finding Main images with OpenAI");
      await params.onCheckpoint?.({ generationStage: "searching" });

      try {
        const mainSearch = await searchScrapingMainImages({
          rowData: row.originalData,
          selectedColumns: selected,
          settings,
        });
        await recordUsage("openai-search", mainSearch.cost);
        productIdentity = mainSearch.productIdentity;
        searchQueryCount += mainSearch.searchCallCount;
        if (mainSearch.mainCandidates.length === 0) {
          return fail("No suitable main image found for this product", {
            stage: "main",
            notes: mainSearch.notes,
            imageResultCount: mainSearch.allImageResults.length,
          });
        }

        await params.onCheckpoint?.({ generationStage: "main" });
        const mainPicks = mainSearch.mainCandidates.slice(0, mainCount);
        for (const candidate of mainPicks) {
          const sourceImage = await downloadImageBytes(candidate.imageUrl);
          if (!sourceImage) {
            galleryWarn("row", "Skipping undownloadable Main image", {
              rowId: row.id,
              sourceDomain: candidate.sourceDomain,
            });
            continue;
          }
          const downloaded = await normalizePersistedMainImage(sourceImage);
          const storedPath = getGalleryRowImagePath(
            workspaceId,
            sessionId,
            row.id,
            "main",
            downloaded.ext
          );
          await uploadGalleryBytesAdmin(
            storedPath,
            downloaded.buffer,
            downloaded.contentType
          );
          newlyStoredMainPaths.push(storedPath);
          mainPaths.push(storedPath);
          if (!mainBuffer) {
            mainBuffer = downloaded.buffer;
            mainContentType = downloaded.contentType;
          }
          sourceMetaImages.push({
            ref: storedPath,
            url: storedPath,
            persistence: "internal",
            sourceUrl: candidate.imageUrl,
            pageUrl: candidate.pageUrl,
            title: candidate.title,
            role: "main",
            fallbackUrl: candidate.imageUrl,
          });
        }
        mainPath = mainPaths[0] ?? null;
        mainPublicUrl = mainPath ?? "";
        if (!mainPath) {
          return fail("No selected Main image could be downloaded", {
            stage: "main",
          });
        }
        await params.onCheckpoint?.({
          mainImagePaths: mainPaths,
          mainImagePath: mainPath,
          generationStage: runGallery ? "gallery" : "finalizing",
        });
      } catch (error) {
        return fail(
          error instanceof Error ? error.message : "OpenAI image search failed",
          { stage: "searching" }
        );
      }
    }

    if (!mainPath) {
      return fail("Main image is required before gallery sourcing");
    }
  } else {
    mainPaths = previousMainPaths;
    mainPath = mainPaths[0] ?? null;
    mainPublicUrl = mainPath ?? "";
    if (!mainPath) {
      return fail("Find main images first before generating the gallery");
    }
  }

  const galleryPaths: string[] = [];
  let galleryNote: string | undefined;

  if (runGallery && galleryCount > 0) {
    ensureTime(120_000, "OpenAI gallery search");
    trace.stage("gallery-scrape", "Selecting exact Gallery images with OpenAI");
    await params.onCheckpoint?.({ generationStage: "gallery" });

    // Download Main ourselves and send bytes to OpenAI. Passing only a remote
    // URL often fails when OpenAI's fetchers time out or are blocked by CDNs.
    const mainImagePayload: {
      url: string;
      buffer?: Buffer;
      contentType?: string;
    } = {
      url: mainPublicUrl,
      buffer: mainBuffer,
      contentType: mainContentType,
    };
    try {
      if (!mainImagePayload.buffer && /^https?:\/\//i.test(mainPublicUrl)) {
        const downloaded = await downloadImageBytes(mainPublicUrl);
        if (downloaded) {
          mainImagePayload.buffer = downloaded.buffer;
          mainImagePayload.contentType = downloaded.contentType;
        }
      } else if (!mainImagePayload.buffer && mainPublicUrl) {
        const stored = await downloadGalleryBytesAdmin(mainPublicUrl);
        if (stored) {
          mainImagePayload.buffer = stored.buffer;
          mainImagePayload.contentType = stored.contentType;
        }
      }
    } catch (error) {
      galleryWarn("row", "Could not prefetch Main image for gallery search", {
        rowId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (!mainImagePayload.buffer) {
      return fail(
        "Could not download the Main image for gallery search. Try another Main image or retry.",
        { stage: "gallery", mainUrl: mainPublicUrl }
      );
    }

    try {
      const gallerySearch = await searchScrapingGalleryImages({
        rowData: row.originalData,
        selectedColumns: selected,
        settings,
        requestedGalleryImages: galleryCount,
        mainImage: mainImagePayload,
      });
      await recordUsage("openai-gallery-search", gallerySearch.cost);
      searchQueryCount += gallerySearch.searchCallCount;
      if (gallerySearch.productIdentity) {
        productIdentity = gallerySearch.productIdentity;
      }

      for (const candidate of gallerySearch.galleryCandidates) {
        if (galleryPaths.includes(candidate.imageUrl)) continue;
        galleryPaths.push(candidate.imageUrl);
        sourceMetaImages.push({
          ref: candidate.imageUrl,
          url: candidate.imageUrl,
          persistence: "external",
          sourceUrl: candidate.imageUrl,
          pageUrl: candidate.pageUrl,
          title: candidate.title,
          role: "gallery",
          fallbackUrl:
            candidate.thumbnailUrl &&
            candidate.thumbnailUrl !== candidate.imageUrl
              ? candidate.thumbnailUrl
              : candidate.canonicalUrl !== candidate.imageUrl
                ? candidate.canonicalUrl
                : undefined,
        });
        await params.onCheckpoint?.({
          mainImagePaths: mainPaths,
          mainImagePath: mainPath,
          galleryImagePaths: [...galleryPaths],
          generationStage:
            galleryPaths.length < galleryCount ? "gallery" : "finalizing",
        });
      }

      if (galleryPaths.length === 0) {
        galleryNote = NO_GALLERY_MESSAGE;
      }
    } catch (error) {
      return fail(
        error instanceof Error ? error.message : "OpenAI image search failed",
        { stage: "gallery" }
      );
    }
  }

  const finalGalleryPaths = runGallery ? galleryPaths : previousGalleryPaths;
  const totals = sumCosts(costs);
  const credits = totals.totalCredits;
  trace.stage("credits", "Deducting credits", {
    credits,
    dollarCost: totals.totalCost,
    searchQueryCount,
    runPhase,
  });

  const deduct =
    shouldChargeGalleryCredits(credits)
      ? await deductGalleryCredits({
          admin,
          ownerUserId: params.ownerUserId,
          workspaceId,
          actorUserId: params.actorUserId,
          amount: credits,
          sessionId,
          rowId: row.id,
          details: {
            idempotencyKey: `${params.runId}:${row.id}:${runPhase}`,
            provider: "scraping",
            pipeline: "openai-web-image-search",
            runPhase,
            searchQueryCount,
            productIdentity,
            dollarCost: totals.totalCost,
            externalMainImages: mainPaths.length,
            externalGalleryImages: finalGalleryPaths.length,
            requestedGalleryImages: galleryCount,
            galleryTarget: galleryCount,
            galleryFound: galleryPaths.length,
            noGallery: !!galleryNote,
            needMain,
            hasUsableOriginalImage: hasUsableOriginal,
          },
        })
      : { success: true, duplicate: false };

  if (!deduct.success) {
    return fail(deduct.error || "Credit deduction failed");
  }

  await removeStoragePaths(admin, [
    ...(runMain
      ? previousMainPaths.filter(
          (path) => !/^https?:\/\//i.test(path) && !mainPaths.includes(path)
        )
      : []),
    ...(runGallery
      ? previousGalleryPaths.filter(
          (path) =>
            !/^https?:\/\//i.test(path) && !finalGalleryPaths.includes(path)
        )
      : []),
  ]);

  const partialWarning =
    [
      runMain && !hasUsableOriginal && mainPaths.length < mainCount
        ? `Found ${mainPaths.length} of ${mainCount} requested main images`
        : undefined,
      runGallery
        ? galleryNote || getGalleryWarning(galleryPaths.length, galleryCount)
        : undefined,
    ]
      .filter(Boolean)
      .join(". ") || undefined;

  galleryLog("row:done", "Row completed", {
    rowId: row.id,
    status: "ready",
    runPhase,
    mainPath,
    galleryCount: finalGalleryPaths.length,
    galleryNote,
    credits: deduct.duplicate ? 0 : credits,
    dollarCost: totals.totalCost,
    searchQueryCount,
  });
  trace.finish("ready", {
    mainPath,
    galleryCount: finalGalleryPaths.length,
    credits: deduct.duplicate ? 0 : credits,
    dollarCost: totals.totalCost,
  });

  return {
    row: {
      ...row,
      status: "ready",
      generationStage: undefined,
      errorMessage: partialWarning,
      mainImagePaths: mainPaths,
      mainImagePath: mainPath,
      galleryImagePaths: finalGalleryPaths,
      sourceMeta: {
        provider: "scraping",
        pipeline: "openai-web-image-search-url-preview",
        model: "server-managed",
        runPhase,
        productIdentity,
        searchQueryCount,
        images: sourceMetaImages,
        galleryNote,
        cost: {
          total: totals.totalCost,
          credits: deduct.duplicate ? 0 : credits,
        },
      },
      creditsUsed: deduct.duplicate ? row.creditsUsed ?? 0 : credits,
    },
    creditsUsed: deduct.duplicate ? 0 : credits,
    cost: totals.totalCost,
  };
}

/** @deprecated Use processScrapingRow */
export const processGoogleRow = processScrapingRow;
