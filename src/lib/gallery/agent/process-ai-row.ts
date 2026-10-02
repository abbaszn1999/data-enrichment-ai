import { GoogleGenAI } from "@google/genai";
import { sumCosts, type AiCallCost } from "@/lib/ai-pricing";
import { GALLERY_PLANNER_OPENAI_MODEL } from "@/lib/enrich/models";
import { parseImageUrls } from "@/lib/gallery/image-urls";
import { galleryError, galleryLog, galleryWarn } from "@/lib/gallery/log";
import { downloadImageBytes } from "@/lib/gallery/providers/serper-images";
import {
  downloadGalleryBytesAdmin,
  removeGalleryPathsAdmin,
  uploadGalleryBytesAdmin,
} from "@/lib/gallery/storage-admin";
import { getGalleryRowImagePath } from "@/lib/gallery/storage-paths";
import type { GalleryRow, GalleryRunPhase, GalleryWorksheetJson } from "@/lib/gallery/types";
import {
  getRowMainImagePaths,
  MISSING_ORIGINAL_IMAGE_MESSAGE,
  resolveGalleryRunPhase,
} from "@/lib/gallery/types";
import { settleProviderUsage, type UsageSettlement } from "@/lib/jobs/credits";
import { buildAiRowCharge } from "@/lib/gallery/agent/ai-row-billing";
import { shouldChargeGalleryCredits } from "@/lib/gallery/pricing";
import {
  extensionForMime,
  type AiImageModel,
  type AiReferenceImage,
  type AiReferenceRole,
} from "@/lib/gallery/agents/ai-shared";
import { GalleryPlannerError, planGalleryImages, type GalleryPlannerPlan } from "@/lib/gallery/agents/ai-planner-agent";
import { generateNanoBananaImage } from "@/lib/ai-images/nano-banana";
import { classifyRowValues } from "@/lib/gallery/agents/gallery-brief";
import { prepareReferenceImage } from "@/lib/ai-images/reference-image";
import { MAX_PRODUCT_REFERENCES, orderReferences, selectShotReferences } from "@/lib/ai-images/reference-set";
import { loadGallerySkill } from "@/lib/gallery/skill-loader";

/** Images generated at the same time inside one row. */
const SLOT_CONCURRENCY = 2;
/** Time a slot needs before it may start: request timeout, one retry, upload. */
const SLOT_MIN_REMAINING_MS = { standard: 110_000, premium: 200_000 } as const;
const PLANNING_MIN_REMAINING_MS = 300_000;

async function toReference(
  buffer: Buffer,
  role: AiReferenceRole,
  key: string
): Promise<AiReferenceImage | null> {
  try {
    const prepared = await prepareReferenceImage(buffer);
    return { role, key, label: role, buffer: prepared.buffer, contentType: prepared.contentType };
  } catch (error) {
    galleryWarn("ai-image:reference", "Reference image could not be read", {
      role,
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function loadStoredReference(path: string | null, role: AiReferenceRole): Promise<AiReferenceImage | null> {
  if (!path) return null;
  const file = await downloadGalleryBytesAdmin(path);
  if (!file) {
    galleryWarn("ai-image:reference", "Stored reference could not be downloaded", { path, role });
    return null;
  }
  return toReference(file.buffer, role, path);
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
  /** Checked before each image so Stop takes effect within one image. */
  shouldCancel?: () => Promise<boolean>;
}): Promise<{
  row: GalleryRow;
  creditsUsed: number;
  cost: number;
  error?: string;
  /** The balance is spent: the run must stop, but this row's work is kept and billed. */
  balanceExhausted?: boolean;
}> {
  const { workspaceId, sessionId, worksheet, row } = params;
  const settings = worksheet.settings.ai;
  const runPhase = resolveGalleryRunPhase({
    originalImageColumn: worksheet.originalImageColumn,
    row,
    requested: params.runPhase ?? null,
    provider: "ai",
  });
  const runGallery = runPhase === "gallery" || runPhase === "full";
  const imageModel: AiImageModel =
    settings.tier === "premium" ? "gemini-3-pro-image" : "gemini-3.1-flash-image";
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) throw new Error("Gemini API key is not configured");
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { timeout: settings.tier === "premium" ? 180_000 : 90_000 },
  });
  const timeLeft = () => (params.deadlineAt ? params.deadlineAt - Date.now() : Number.POSITIVE_INFINITY);
  const stopRequested = async () => {
    if (!params.shouldCancel) return false;
    try {
      return await params.shouldCancel();
    } catch {
      return false;
    }
  };
  const checkpoint = async (patch: Partial<GalleryRow>) => {
    try {
      await params.onCheckpoint?.(patch);
    } catch (error) {
      galleryWarn("ai-image:row", "Checkpoint failed", {
        rowId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const oldMainPaths = getRowMainImagePaths(row);
  const oldGalleryPaths = [...row.galleryImagePaths];
  /** Every file this run created, so a failed row leaves nothing behind. */
  const newlyStoredPaths: string[] = [];
  const mainPaths: string[] = [];
  const plannerCosts: AiCallCost[] = [];
  const imageCosts: AiCallCost[] = [];
  let plan: GalleryPlannerPlan | null = null;
  let committed = false;

  const fail = async (error: string) => {
    if (!committed) await removeGalleryPathsAdmin(newlyStoredPaths).catch(() => undefined);
    // Billing rule: what the providers answered (and billed us for) is charged,
    // even when the row fails. A saved plan is not charged again on retry.
    const planner = sumCosts(plannerCosts);
    const images = sumCosts(imageCosts);
    const unbilled = planner.totalCost + images.totalCost;
    let settlement: UsageSettlement | null = null;
    if (!committed && unbilled > 0 && shouldChargeGalleryCredits(planner.totalCredits + images.totalCredits)) {
      settlement = await settleProviderUsage({
        ownerUserId: params.ownerUserId,
        workspaceId,
        actorUserId: params.actorUserId,
        amount: sumCosts([...plannerCosts, ...imageCosts]).totalCredits,
        operation: "gallery_ai",
        entityType: "gallery_session",
        entityId: sessionId,
        idempotencyKey: `${params.runId}:${row.id}:${runPhase}:failed`,
        details: {
          rowId: row.id,
          runPhase,
          provider: "ai",
          pipeline: "gallery-generate",
          failedRow: true,
          error: error.slice(0, 300),
          plannerCost: planner.totalCost,
          imageCost: images.totalCost,
          imageCalls: imageCosts.length,
          dollarCost: unbilled,
        },
      });
      if (settlement.shortfall > 0) {
        galleryWarn("ai-image:row", "Failed row: balance could not cover the provider usage", {
          rowId: row.id,
          shortfallCredits: settlement.shortfall,
          billingError: settlement.billingError,
        });
      }
    }
    return {
      row: {
        ...row,
        status: (row.status === "ready" ? "ready" : "failed") as GalleryRow["status"],
        generationStage: undefined,
        errorMessage: error,
        mainImagePaths: oldMainPaths,
        mainImagePath: oldMainPaths[0] ?? null,
        galleryImagePaths: oldGalleryPaths,
        // A plan that was already paid for stays on the row so a retry does not pay for it twice.
        sourceMeta: plan ? { ...(row.sourceMeta ?? {}), plan } : row.sourceMeta,
      },
      creditsUsed: settlement?.charged ?? 0,
      cost: unbilled,
      error,
      balanceExhausted: settlement?.balanceExhausted === true,
    };
  };

  galleryLog("ai-image:row", `Processing row ${row.id} via AI`, { runPhase, imageModel });

  try {
    const originalUrls = worksheet.originalImageColumn
      ? parseImageUrls(row.originalData[worksheet.originalImageColumn])
      : [];

    // --- Product references: the row's Main image(s), plus more photos of the same item from other image columns.
    const productRefs: AiReferenceImage[] = [];
    if (oldMainPaths.length > 0) {
      mainPaths.push(...oldMainPaths);
      for (const path of mainPaths) {
        if (productRefs.length >= MAX_PRODUCT_REFERENCES) break;
        let bytes: Buffer | null = null;
        if (/^https?:\/\//i.test(path)) {
          bytes = (await downloadImageBytes(path))?.buffer ?? null;
        } else {
          bytes = (await downloadGalleryBytesAdmin(path).catch(() => null))?.buffer ?? null;
        }
        const reference = bytes ? await toReference(bytes, "product", path) : null;
        if (reference) productRefs.push(reference);
      }
      if (productRefs.length === 0) {
        return await fail("Could not load the existing main image for gallery generation");
      }
    } else {
      for (const originalUrl of originalUrls) {
        if (!/^https?:\/\//i.test(originalUrl)) continue;
        const original = await downloadImageBytes(originalUrl);
        if (!original) {
          galleryWarn("ai-image:row", "Skipping undownloadable original image", { rowId: row.id, originalUrl });
          continue;
        }
        const path = getGalleryRowImagePath(workspaceId, sessionId, row.id, "main", original.ext);
        await uploadGalleryBytesAdmin(path, original.buffer, original.contentType);
        newlyStoredPaths.push(path);
        mainPaths.push(path);
        if (productRefs.length < MAX_PRODUCT_REFERENCES) {
          const reference = await toReference(original.buffer, "product", originalUrl);
          if (reference) productRefs.push(reference);
        }
      }
      if (productRefs.length === 0) {
        return await fail(
          originalUrls.length > 0
            ? "Could not download the image from the selected image column"
            : MISSING_ORIGINAL_IMAGE_MESSAGE
        );
      }
      await checkpoint({
        mainImagePaths: [...mainPaths],
        mainImagePath: mainPaths[0] ?? null,
        galleryImagePaths: runGallery ? [] : oldGalleryPaths,
        generationStage: runGallery ? "planning" : "finalizing",
      });
    }

    let plannedGallery: string[] = [];
    const failures: string[] = [];
    let stoppedEarly: string | undefined;
    let planReused = false;
    let sceneReference: AiReferenceImage | null = null;
    let referencesUsed: Record<string, number> = {};
    const galleryTarget = runGallery ? Math.min(Math.max(settings.imagesPerRow || 4, 1), 8) : 0;
    const generatedPaths: string[] = [];

    if (runGallery) {
      if (timeLeft() < PLANNING_MIN_REMAINING_MS) {
        return await fail("Run time budget reached; retry this product");
      }

      // More photos of the same item from other image columns of the row.
      if (productRefs.length < MAX_PRODUCT_REFERENCES) {
        const known = new Set([...originalUrls, ...productRefs.map((reference) => reference.key ?? "")]);
        const classified = classifyRowValues(row.originalData, worksheet.selectedColumns);
        for (const url of classified.imageUrls) {
          if (productRefs.length >= MAX_PRODUCT_REFERENCES) break;
          if (known.has(url)) continue;
          known.add(url);
          const extra = await downloadImageBytes(url);
          const reference = extra ? await toReference(extra.buffer, "product", url) : null;
          if (reference) productRefs.push(reference);
        }
      }

      // --- Model / scene, brand guide and logo.
      sceneReference = await loadStoredReference(settings.sceneReferencePath, "model");
      if (settings.sceneReferencePath && !sceneReference) {
        galleryWarn("ai-image:reference", "Clearing stale scene reference path", { path: settings.sceneReferencePath });
        settings.sceneReferencePath = null;
      }
      const logoReference = settings.brandingEnabled ? await loadStoredReference(settings.logoPath, "logo") : null;
      if (settings.brandingEnabled && settings.logoPath && !logoReference) {
        galleryWarn("ai-image:reference", "Clearing stale brand logo path", { path: settings.logoPath });
        settings.logoPath = null;
      }
      const guideReference =
        settings.brandingEnabled && settings.brandGuideMode === "image"
          ? await loadStoredReference(settings.brandGuidePath, "brandGuide")
          : null;
      if (settings.brandingEnabled && settings.brandGuideMode === "image" && settings.brandGuidePath && !guideReference) {
        galleryWarn("ai-image:reference", "Clearing stale brand guide path", { path: settings.brandGuidePath });
        settings.brandGuidePath = null;
      }

      const ordered = orderReferences(
        [...productRefs, sceneReference, guideReference, logoReference].filter(
          (value): value is AiReferenceImage => !!value
        )
      );
      referencesUsed = ordered.reduce<Record<string, number>>((acc, reference) => {
        acc[reference.role] = (acc[reference.role] ?? 0) + 1;
        return acc;
      }, {});

      galleryLog("ai-image:plan", "AI row image plan", {
        rowId: row.id,
        runPhase,
        galleryTarget,
        imageModel,
        references: referencesUsed,
        brandingEnabled: settings.brandingEnabled,
      });

      await checkpoint({ generationStage: "planning" });
      try {
        const planned = await planGalleryImages({
          row,
          selectedColumns: worksheet.selectedColumns,
          settings,
          imageModel,
          galleryCount: galleryTarget,
          references: ordered,
          shouldCancel: params.shouldCancel,
        });
        plan = planned.plan;
        planReused = planned.reused;
        plannerCosts.push(...planned.costs);
      } catch (error) {
        galleryError("ai-image:row", "Gallery planner failed", error);
        if (error instanceof GalleryPlannerError) plannerCosts.push(...error.costs);
        return await fail(error instanceof Error ? error.message : "Gallery planner failed");
      }

      // --- Nano Banana: one image per planned prompt, two at a time, a failed slot never stops the row.
      const skill = await loadGallerySkill("image");
      const results: Array<string | null> = Array.from({ length: galleryTarget }, () => null);
      const minRemaining = SLOT_MIN_REMAINING_MS[settings.tier === "premium" ? "premium" : "standard"];
      let nextSlot = 0;
      let checkpointChain: Promise<void> = Promise.resolve();
      await checkpoint({ generationStage: "gallery", galleryImagePaths: [] });

      const worker = async () => {
        for (;;) {
          const slot = nextSlot;
          nextSlot += 1;
          if (slot >= galleryTarget || stoppedEarly) return;
          if (await stopRequested()) {
            stoppedEarly = "Stopped";
            return;
          }
          if (timeLeft() < minRemaining) {
            stoppedEarly = "Run time budget reached";
            return;
          }
          const shot = plan!.gallery[slot];
          if (!shot) {
            failures.push(`Image ${slot + 1}: no planned prompt`);
            continue;
          }
          const generated = await generateNanoBananaImage({
            ai,
            model: imageModel,
            settings,
            shot,
            references: selectShotReferences(ordered, shot),
            identityRules: skill.instructions,
            rowId: row.id,
            galleryIndex: slot,
          });
          imageCosts.push(...generated.costs);
          if (!generated.image) {
            failures.push(`Image ${slot + 1}: ${generated.error ?? "generation failed"}`);
            galleryWarn("ai-image:row", "Image generation failed", { rowId: row.id, slot, error: generated.error });
            continue;
          }
          try {
            const path = getGalleryRowImagePath(
              workspaceId,
              sessionId,
              row.id,
              "gallery",
              extensionForMime(generated.image.contentType)
            );
            await uploadGalleryBytesAdmin(path, generated.image.buffer, generated.image.contentType);
            newlyStoredPaths.push(path);
            generatedPaths.push(path);
            results[slot] = path;
            checkpointChain = checkpointChain.then(() =>
              checkpoint({
                galleryImagePaths: results.filter((value): value is string => !!value),
                generationStage: "gallery",
              })
            );
          } catch (error) {
            failures.push(`Image ${slot + 1}: could not be saved`);
            galleryError("ai-image:row", "Generated image could not be stored", error);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(SLOT_CONCURRENCY, galleryTarget) }, () => worker()));
      await checkpointChain;
      plannedGallery = results.filter((value): value is string => !!value);

      if (plannedGallery.length === 0) {
        return await fail(
          stoppedEarly
            ? `${stoppedEarly} before any gallery image was created`
            : failures[0] ?? "No gallery images were created"
        );
      }
      await checkpoint({
        mainImagePaths: [...mainPaths],
        mainImagePath: mainPaths[0] ?? null,
        galleryImagePaths: [...plannedGallery],
        generationStage: "finalizing",
      });
    }

    if (mainPaths.length === 0) return await fail(MISSING_ORIGINAL_IMAGE_MESSAGE);

    const finalMainPaths = newlyStoredPaths.length > 0 ? mainPaths : oldMainPaths.length > 0 ? oldMainPaths : mainPaths;
    const finalGalleryPaths = runGallery ? plannedGallery : oldGalleryPaths;

    const charge = buildAiRowCharge({
      plannerCosts,
      imageCosts,
      plannerModel: GALLERY_PLANNER_OPENAI_MODEL,
      imageModel,
      resolution: settings.resolution,
      aspectRatio: settings.aspectRatio,
      outputFormat: settings.outputFormat,
      requestedImages: galleryTarget,
      generatedImages: generatedPaths.length,
      failedImages: failures.length,
      plannerReused: planReused,
      references: referencesUsed,
    });
    const totals = charge.totals;
    // The work is delivered, so it is always kept and billed. If the balance
    // cannot cover all of it, the rest of the balance is charged and the run stops.
    let creditsUsed = 0;
    let billing: UsageSettlement | null = null;
    if (shouldChargeGalleryCredits(totals.totalCredits)) {
      billing = await settleProviderUsage({
        ownerUserId: params.ownerUserId,
        workspaceId,
        actorUserId: params.actorUserId,
        amount: totals.totalCredits,
        operation: "gallery_ai",
        entityType: "gallery_session",
        entityId: sessionId,
        idempotencyKey: `${params.runId}:${row.id}:${runPhase}`,
        details: {
          rowId: row.id,
          runPhase,
          galleryImages: finalGalleryPaths.length,
          usedOriginalImage: originalUrls.length > 0,
          usedSceneReference: !!sceneReference,
          brandingEnabled: settings.brandingEnabled,
          ...charge.details,
        },
      });
      creditsUsed = billing.charged;
      if (billing.shortfall > 0) {
        galleryWarn("ai-image:row", "Balance could not cover the row; result kept and the rest of the balance charged", {
          rowId: row.id,
          shortfallCredits: billing.shortfall,
          billingError: billing.billingError,
        });
      }
    }
    committed = true;

    try {
      await removeGalleryPathsAdmin(
        runGallery ? oldGalleryPaths.filter((path) => !finalGalleryPaths.includes(path)) : []
      );
    } catch (error) {
      galleryWarn("ai-image:cleanup", "Generated images are ready but old files remain", {
        rowId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const partialWarning =
      runGallery && plannedGallery.length < galleryTarget
        ? `Created ${plannedGallery.length} of ${galleryTarget} gallery images${
            stoppedEarly ? ` (${stoppedEarly.toLowerCase()})` : failures[0] ? ` (${failures[0]})` : ""
          }`
        : undefined;
    galleryLog("ai-image:done", "AI product images completed", {
      rowId: row.id,
      imageModel,
      runPhase,
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
        mainImagePath: finalMainPaths[0] ?? null,
        galleryImagePaths: finalGalleryPaths,
        sourceMeta: {
          provider: "ai",
          pipeline: "gallery-generate",
          model: imageModel,
          plannerModel: GALLERY_PLANNER_OPENAI_MODEL,
          runPhase,
          usedOriginalImage: originalUrls.length > 0,
          usedSceneReference: !!sceneReference,
          brandingEnabled: settings.brandingEnabled,
          partialWarning,
          plan: plan ?? row.sourceMeta?.plan,
          cost: {
            total: totals.totalCost,
            credits: creditsUsed,
            ...(billing && billing.shortfall > 0 ? { shortfallCredits: billing.shortfall } : {}),
          },
        },
        creditsUsed: creditsUsed || row.creditsUsed || 0,
      },
      creditsUsed,
      cost: totals.totalCost,
      balanceExhausted: billing?.balanceExhausted === true,
    };
  } catch (error) {
    galleryError("ai-image:row", "AI row failed unexpectedly", error);
    return await fail(error instanceof Error ? error.message : "AI row failed");
  }
}
