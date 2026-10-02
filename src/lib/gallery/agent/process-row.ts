import { createAdminClient } from "@/lib/supabase-admin";
import { hideProviderNames } from "@/lib/provider-names";
import {
  sumCosts,
  type AiCallCost,
} from "@/lib/ai-pricing";
import { researchGalleryImages } from "@/lib/gallery/agents/gallery-research-agent";
import { GALLERY_SCRAPING_OPENAI_MODEL } from "@/lib/enrich/models";
import { billedCostsOf } from "@/lib/enrich/openai";
import { removeGalleryAssets } from "@/lib/gallery/storage-assets";
import { downloadGalleryBytesAdmin } from "@/lib/gallery/storage-admin";
import {
  getRowMainImagePaths,
  MISSING_ORIGINAL_IMAGE_MESSAGE,
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
import { settleProviderUsage, type UsageSettlement } from "@/lib/jobs/credits";

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

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

/**
 * OpenAI-only Scraping row:
 * - Main always comes from the selected image column (full) or an existing
 *   Main (gallery); this pipeline never searches for a Main image.
 * - Gallery keeps verified source URLs.
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
  /** Defaults to full when the row has an image-column URL, otherwise gallery. */
  runPhase?: GalleryRunPhase;
  deadlineAt?: number;
  onCheckpoint?: (patch: Partial<GalleryRow>) => Promise<void>;
  /** Checked between research rounds so Stop takes effect within one round. */
  shouldCancel?: () => Promise<boolean>;
}): Promise<{
  row: GalleryRow;
  creditsUsed: number;
  cost: number;
  error?: string;
  /** The balance is spent: the run must stop, but this row's work is kept and billed. */
  balanceExhausted?: boolean;
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
    galleryImagesPerRow: settings.imagesPerRow,
  });
  const costs: AiCallCost[] = [];
  const recordUsage = async (_stageKey: string, cost: AiCallCost | null) => {
    if (!cost) return;
    costs.push(cost);
  };
  const previousGalleryPaths = [...row.galleryImagePaths];
  const previousMainPaths = getRowMainImagePaths(row);

  const originalImageUrls = worksheet.originalImageColumn
    ? parseImageUrls(row.originalData[worksheet.originalImageColumn])
    : [];
  const hasUsableOriginal =
    !!worksheet.originalImageColumn && originalImageUrls.length > 0;

  const galleryCount = runGallery ? Math.max(1, settings.imagesPerRow || 4) : 0;

  let mainPaths: string[] = [];
  let mainPath: string | null = null;
  type MainAttachment = {
    url: string;
    buffer?: Buffer;
    contentType?: string;
  };
  const mainAttachments: MainAttachment[] = [];
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

  let charged = false;
  const fail = async (
    message: string,
    extra?: Record<string, unknown>
  ): Promise<{
    row: GalleryRow;
    creditsUsed: number;
    cost: number;
    error?: string;
    balanceExhausted?: boolean;
  }> => {
    if (newlyStoredMainPaths.length > 0) {
      await removeStoragePaths(admin, newlyStoredMainPaths).catch(() => undefined);
    }
    const totals = sumCosts(costs);
    // Billing rule: rounds OpenAI answered (and billed us for) are charged even when the row fails.
    let settlement: UsageSettlement | null = null;
    if (!charged && shouldChargeGalleryCredits(totals.totalCredits)) {
      settlement = await settleProviderUsage({
        admin,
        ownerUserId: params.ownerUserId,
        workspaceId,
        actorUserId: params.actorUserId,
        amount: totals.totalCredits,
        operation: "gallery_google",
        entityType: "gallery_session",
        entityId: sessionId,
        idempotencyKey: `${params.runId}:${row.id}:${runPhase}:failed`,
        details: {
          rowId: row.id,
          runPhase,
          provider: "scraping",
          pipeline: "gallery-research",
          failedRow: true,
          error: message.slice(0, 300),
          rounds: costs.length,
          dollarCost: totals.totalCost,
        },
      });
    }
    trace.finish("failed", { error: message, ...extra });
    return {
      row: {
        ...row,
        status: row.status === "ready" ? "ready" : "failed",
        generationStage: undefined,
        errorMessage: hideProviderNames(message),
        sourceMeta: {
          ...(row.sourceMeta ?? {}),
          provider: "scraping",
          ...extra,
        },
        mainImagePaths: previousMainPaths,
        mainImagePath: previousMainPaths[0] ?? null,
        galleryImagePaths: previousGalleryPaths,
      },
      creditsUsed: settlement?.charged ?? 0,
      cost: totals.totalCost,
      error: message,
      balanceExhausted: settlement?.balanceExhausted === true,
    };
  };

  if (runMain) {
    if (!hasUsableOriginal) {
      return fail(MISSING_ORIGINAL_IMAGE_MESSAGE, { stage: "main" });
    }

    ensureTime(5_000, "original reference");
    trace.stage("main", "Keeping original image URL(s) as Main");
    await params.onCheckpoint?.({ generationStage: "main" });

    // Scraping stores public URLs only — OpenAI/Gemini fetch them later.
    for (const originalUrl of originalImageUrls) {
      if (!isHttpUrl(originalUrl)) {
        galleryWarn("row", "Skipping non-HTTP original image URL", {
          rowId: row.id,
          originalUrl,
        });
        continue;
      }
      mainPaths.push(originalUrl);
      mainAttachments.push({ url: originalUrl });
      sourceMetaImages.push({
        ref: originalUrl,
        url: originalUrl,
        persistence: "external",
        sourceUrl: originalUrl,
        pageUrl: originalUrl,
        title: "original",
        role: "main",
        fallbackUrl: originalUrl,
      });
    }

    mainPath = mainPaths[0] ?? null;
    if (!mainPath) {
      return fail("The selected original image is not a valid image URL");
    }
    // Reveal Main paths only once the full Main set is ready (no partial UI flash).
    await params.onCheckpoint?.({
      mainImagePaths: mainPaths,
      mainImagePath: mainPath,
      generationStage: runGallery ? "gallery" : "finalizing",
      sourceMeta: {
        ...(row.sourceMeta ?? {}),
        provider: "scraping",
        images: [...sourceMetaImages],
      },
    });
  } else {
    mainPaths = previousMainPaths;
    mainPath = mainPaths[0] ?? null;
    if (!mainPath) {
      return fail(MISSING_ORIGINAL_IMAGE_MESSAGE, { stage: "main" });
    }
  }

  const galleryPaths: string[] = [];
  let galleryNote: string | undefined;

  let researchStats: Record<string, unknown> | undefined;
  let unverifiedNote = "";
  if (runGallery && galleryCount > 0) {
    ensureTime(180_000, "gallery research");
    trace.stage("gallery-scrape", "Researching new Gallery images");
    // Clear previous Gallery paths while this stage runs so the UI stays in
    // skeleton mode for the whole field (no one-by-one / stale reveals).
    await params.onCheckpoint?.({
      generationStage: "gallery",
      galleryImagePaths: [],
    });

    // Public Main links go to the model as URLs; legacy internal storage
    // paths are loaded as bytes and attached as data URLs.
    const galleryMainImages: MainAttachment[] =
      mainAttachments.length > 0
        ? [...mainAttachments]
        : mainPaths.map((url) => ({ url }));

    for (const attachment of galleryMainImages) {
      if (attachment.buffer || isHttpUrl(attachment.url)) continue;
      try {
        if (attachment.url) {
          const stored = await downloadGalleryBytesAdmin(attachment.url);
          if (stored) {
            attachment.buffer = stored.buffer;
            attachment.contentType = stored.contentType;
          }
        }
      } catch (error) {
        galleryWarn("row", "Could not load stored Main image for gallery search", {
          rowId: row.id,
          mainUrl: attachment.url,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const usableMainImages = galleryMainImages.filter(
      (attachment) => !!attachment.buffer || isHttpUrl(attachment.url)
    );
    if (usableMainImages.length === 0) {
      return fail(
        "No usable Main image for gallery search. Check the original image column or retry.",
        { stage: "gallery", mainUrl: mainPaths[0] ?? "" }
      );
    }

    try {
      const research = await researchGalleryImages({
        rowData: row.originalData,
        selectedColumns: selected,
        mainImageUrls: usableMainImages
          .filter((attachment) => isHttpUrl(attachment.url))
          .map((attachment) => attachment.url),
        extraInputImages: usableMainImages
          .filter((attachment) => attachment.buffer)
          .map(
            (attachment) =>
              `data:${attachment.contentType || "image/jpeg"};base64,${attachment.buffer!.toString("base64")}`
          ),
        settings,
        requestedGalleryImages: galleryCount,
        shouldCancel: params.shouldCancel,
      });
      for (const cost of research.costs) await recordUsage("gallery-research", cost);
      searchQueryCount += research.searchCallCount;
      productIdentity = research.productIdentity;
      unverifiedNote = research.unverifiedNote;
      researchStats = { ...research.stats, rejected: research.rejections.length };

      for (const candidate of research.images) {
        if (galleryPaths.length >= galleryCount) break;
        if (galleryPaths.includes(candidate.imageUrl)) continue;
        galleryPaths.push(candidate.imageUrl);
        sourceMetaImages.push({
          ref: candidate.imageUrl,
          url: candidate.imageUrl,
          persistence: "external",
          sourceUrl: candidate.imageUrl,
          pageUrl: candidate.pageUrl,
          title: candidate.title,
          perspective: candidate.perspective,
          role: "gallery",
          fallbackUrl: candidate.imageUrl,
        });
      }

      // Batch reveal Gallery only when the research pass finishes.
      await params.onCheckpoint?.({
        mainImagePaths: mainPaths,
        mainImagePath: mainPath,
        galleryImagePaths: [...galleryPaths],
        generationStage: "finalizing",
        sourceMeta: {
          ...(row.sourceMeta ?? {}),
          provider: "scraping",
          images: [...sourceMetaImages],
        },
      });

      if (galleryPaths.length === 0) {
        galleryNote = NO_GALLERY_MESSAGE;
      }
    } catch (error) {
      // Rounds OpenAI already billed are recorded and charged by fail().
      for (const cost of billedCostsOf(error)) await recordUsage("gallery-research", cost);
      return fail(
        error instanceof Error ? error.message : "Gallery research failed",
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

  // The research is delivered, so it is always kept and billed. If the balance
  // cannot cover all of it, the rest of the balance is charged and the run stops.
  const settlement: UsageSettlement | null =
    shouldChargeGalleryCredits(credits)
      ? await settleProviderUsage({
          admin,
          ownerUserId: params.ownerUserId,
          workspaceId,
          actorUserId: params.actorUserId,
          amount: credits,
          operation: "gallery_google",
          entityType: "gallery_session",
          entityId: sessionId,
          idempotencyKey: `${params.runId}:${row.id}:${runPhase}`,
          details: {
            rowId: row.id,
            provider: "scraping",
            pipeline: "gallery-research",
            model: GALLERY_SCRAPING_OPENAI_MODEL,
            rounds: costs.length,
            tokens: {
              input: costs.reduce((sum, c) => sum + c.usage.promptTokens, 0),
              cached: costs.reduce((sum, c) => sum + c.usage.cachedTokens, 0),
              output: costs.reduce((sum, c) => sum + c.usage.candidatesTokens, 0),
              reasoning: costs.reduce((sum, c) => sum + c.usage.thoughtsTokens, 0),
              total: totals.totalTokens,
            },
            research: researchStats,
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
            hasUsableOriginalImage: hasUsableOriginal,
          },
        })
      : null;
  charged = true;
  const creditsCharged = settlement?.charged ?? 0;
  const alreadyCharged = settlement?.duplicate === true;
  if (settlement && settlement.shortfall > 0) {
    galleryWarn("row", "Balance could not cover the row; result kept and the rest of the balance charged", {
      rowId: row.id,
      shortfallCredits: settlement.shortfall,
      billingError: settlement.billingError,
    });
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

  const partialWarning = runGallery
    ? galleryNote || getGalleryWarning(galleryPaths.length, galleryCount)
    : undefined;

  galleryLog("row:done", "Row completed", {
    rowId: row.id,
    status: "ready",
    runPhase,
    mainPath,
    galleryCount: finalGalleryPaths.length,
    galleryNote,
    credits: creditsCharged,
    dollarCost: totals.totalCost,
    searchQueryCount,
  });
  trace.finish("ready", {
    mainPath,
    galleryCount: finalGalleryPaths.length,
    credits: creditsCharged,
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
        pipeline: "gallery-research",
        model: GALLERY_SCRAPING_OPENAI_MODEL,
        researchStats,
        ...(unverifiedNote ? { unverifiedNote } : {}),
        runPhase,
        productIdentity,
        searchQueryCount,
        images: sourceMetaImages,
        galleryNote,
        cost: {
          total: totals.totalCost,
          credits: creditsCharged,
        },
      },
      creditsUsed: alreadyCharged ? row.creditsUsed ?? 0 : creditsCharged,
    },
    creditsUsed: creditsCharged,
    cost: totals.totalCost,
    balanceExhausted: settlement?.balanceExhausted === true,
  };
}

/** @deprecated Use processScrapingRow */
export const processGoogleRow = processScrapingRow;
