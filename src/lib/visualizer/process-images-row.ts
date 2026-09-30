import { GoogleGenAI } from "@google/genai";
import { createAdminClient } from "@/lib/supabase-admin";
import { sumCosts, type AiCallCost } from "@/lib/ai-pricing";
import { withAiSlot } from "@/lib/ai/global-concurrency";
import { generateNanoBananaImage } from "@/lib/ai-images/nano-banana";
import { selectShotReferences } from "@/lib/ai-images/reference-set";
import { extensionForMime } from "@/lib/gallery/agents/ai-shared";
import { requireGeminiApiKey } from "@/lib/sync/agent/ai-utils";
import { resolveSlotPrompt } from "@/lib/visualizer/agents/planner-plan";
import { buildImagesCharge } from "@/lib/visualizer/billing";
import { deductVisualizerCredits } from "@/lib/visualizer/credits";
import { embedVisualizerPlaceholders } from "@/lib/visualizer/html-embed";
import { visualizerLog, visualizerWarn } from "@/lib/visualizer/log";
import { shouldChargeVisualizerCredits } from "@/lib/visualizer/pricing";
import { loadVisualizerReferences } from "@/lib/visualizer/references";
import { loadVisualizerSkill } from "@/lib/visualizer/skill-loader";
import { removeVisualizerPathsAdmin, uploadVisualizerBytesAdmin } from "@/lib/visualizer/storage-admin";
import { getVisualizerRowImagePath } from "@/lib/visualizer/storage-paths";
import {
  resolveVisualizerImageModel,
  type VisualizerImagePlaceholder,
  type VisualizerProjectSettings,
  type VisualizerRow,
  type VisualizerWorksheetJson,
} from "@/lib/visualizer/types";

type Admin = ReturnType<typeof createAdminClient>;

/** Images generated at the same time inside one row. */
const SLOT_CONCURRENCY = 2;
/** Time a slot needs before it may start: request timeout, one retry, upload. */
const SLOT_MIN_REMAINING_MS = { standard: 110_000, premium: 200_000 } as const;

export async function processImagesRow(params: {
  admin: Admin;
  workspaceId: string;
  sessionId: string;
  worksheet?: VisualizerWorksheetJson;
  row: VisualizerRow;
  settings: VisualizerProjectSettings;
  ownerUserId: string;
  actorUserId: string;
  runId: string;
  deadlineAt?: number;
  /** Cooperative stop: finish in-flight image requests, then skip new ones. */
  shouldCancel?: () => Promise<boolean>;
  /** Saves progress after each stored image so leaving the page never loses it. */
  onCheckpoint?: (patch: Partial<VisualizerRow>) => Promise<void>;
}): Promise<{
  row: VisualizerRow;
  creditsUsed: number;
  cost: number;
  error?: string;
}> {
  const { row, settings, workspaceId, sessionId } = params;
  const description = String(row.generatedDescription || "").trim();
  const placeholders = [...(row.imagePlaceholders ?? [])].sort((a, b) => a.index - b.index);
  const tier = settings.images.tier === "premium" ? "premium" : "standard";
  const imageModel = resolveVisualizerImageModel(tier);

  const failRow = (message: string, cost = 0) => ({
    row: { ...row, status: "failed" as const, generationStage: undefined, errorMessage: message.slice(0, 500) },
    creditsUsed: 0,
    cost,
    error: message,
  });

  if (!description) return failRow("Missing generated description for image phase");
  if (placeholders.length === 0) return failRow("No image placeholders to generate");

  // Only the slots without a stored image are generated; finished images are never redone or deleted.
  const missing = placeholders.filter((item) => !item.storagePath);
  if (missing.length === 0) {
    return { row: { ...row, status: "images_ready", generationStage: undefined, errorMessage: undefined }, creditsUsed: 0, cost: 0 };
  }

  const timeLeft = () => (params.deadlineAt ? params.deadlineAt - Date.now() : Number.POSITIVE_INFINITY);
  const stopRequested = async () => {
    if (!params.shouldCancel) return false;
    try {
      return await params.shouldCancel();
    } catch {
      return false;
    }
  };
  const minRemaining = SLOT_MIN_REMAINING_MS[tier];
  const stoppedRow = (reason: string) => ({
    row: {
      ...row,
      status: "description_ready" as const,
      generationStage: undefined,
      errorMessage: reason,
    },
    creditsUsed: 0,
    cost: 0,
  });

  if (await stopRequested()) return stoppedRow("Stopped before any image was created");
  if (timeLeft() < minRemaining) return stoppedRow("Run time budget reached; retry this product");

  const references = await loadVisualizerReferences({ row, settings });
  if (references.productCount === 0) {
    return failRow("Could not download the product image from the selected image column");
  }

  const skill = await loadVisualizerSkill("image");
  const ai = new GoogleGenAI({
    apiKey: requireGeminiApiKey(),
    httpOptions: { timeout: tier === "premium" ? 180_000 : 90_000 },
  });

  const current = new Map<number, VisualizerImagePlaceholder>(placeholders.map((item) => [item.index, item]));
  const snapshot = () => {
    const merged = placeholders.map((item) => current.get(item.index) ?? item);
    return { merged, html: embedVisualizerPlaceholders(description, merged) };
  };

  const imageCosts: AiCallCost[] = [];
  const generatedIndexes: number[] = [];
  const newlyStored: string[] = [];
  const failures: string[] = [];
  let stoppedEarly: string | undefined;
  let nextSlot = 0;
  let checkpointChain: Promise<void> = Promise.resolve();

  visualizerLog("images-row", `Generating images for row ${row.id}`, {
    missing: missing.length,
    total: placeholders.length,
    imageModel,
    tier,
    references: references.counts,
  });

  const worker = async () => {
    for (;;) {
      const slot = nextSlot;
      nextSlot += 1;
      if (slot >= missing.length || stoppedEarly) return;
      if (await stopRequested()) {
        stoppedEarly = "Stopped";
        return;
      }
      if (timeLeft() < minRemaining) {
        stoppedEarly = "Run time budget reached";
        return;
      }
      const placeholder = missing[slot];
      const shot = { prompt: resolveSlotPrompt(placeholder), perspective: placeholder.perspective };
      const generated = await withAiSlot(() =>
        generateNanoBananaImage({
          ai,
          model: imageModel,
          settings: {
            aspectRatio: settings.images.aspectRatio,
            resolution: settings.images.resolution,
            outputFormat: settings.images.outputFormat,
            groundWithSearch: settings.images.groundWithSearch,
          },
          shot,
          references: selectShotReferences(references.ordered, { useLogo: placeholder.useLogo === true }),
          identityRules: skill.instructions,
          rowId: row.id,
          galleryIndex: placeholder.index,
        })
      );
      imageCosts.push(...generated.costs);
      if (!generated.image) {
        failures.push(`Image ${placeholder.index}: ${generated.error ?? "generation failed"}`);
        visualizerWarn("images-row", "Image generation failed", {
          rowId: row.id,
          index: placeholder.index,
          error: generated.error,
        });
        continue;
      }
      try {
        const storagePath = getVisualizerRowImagePath(
          workspaceId,
          sessionId,
          row.id,
          placeholder.index,
          extensionForMime(generated.image.contentType)
        );
        await uploadVisualizerBytesAdmin(storagePath, generated.image.buffer, generated.image.contentType, {
          upsert: true,
        });
        newlyStored.push(storagePath);
        generatedIndexes.push(placeholder.index);
        current.set(placeholder.index, { ...placeholder, storagePath });
        checkpointChain = checkpointChain.then(async () => {
          if (!params.onCheckpoint) return;
          const { merged, html } = snapshot();
          try {
            await params.onCheckpoint({
              imagePlaceholders: merged,
              generatedDescription: html,
              generationStage: "images",
            });
          } catch (error) {
            visualizerWarn("images-row", "Checkpoint failed", {
              rowId: row.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
      } catch (error) {
        failures.push(`Image ${placeholder.index}: could not be saved`);
        visualizerWarn("images-row", "Generated image could not be stored", {
          rowId: row.id,
          index: placeholder.index,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(SLOT_CONCURRENCY, missing.length) }, () => worker()));
    await checkpointChain;

    const spent = sumCosts(imageCosts).totalCost;
    if (generatedIndexes.length === 0) {
      if (stoppedEarly) return { ...stoppedRow(`${stoppedEarly} before any image was created`), cost: spent };
      const message = failures[0] ?? "No images were created";
      if (spent > 0) {
        visualizerWarn("images-row", "Row failed after provider usage; not charged to the customer", {
          rowId: row.id,
          dollarCost: spent,
          error: message,
        });
      }
      return failRow(message, spent);
    }

    const charge = buildImagesCharge({
      imageCosts,
      imageModel,
      tier,
      resolution: settings.images.resolution,
      aspectRatio: settings.images.aspectRatio,
      outputFormat: settings.images.outputFormat,
      requestedImages: missing.length,
      generatedIndexes,
      failedImages: failures.length,
      references: references.counts,
    });
    let creditsUsed = charge.totals.totalCredits;
    if (shouldChargeVisualizerCredits(creditsUsed)) {
      const deduct = await deductVisualizerCredits({
        admin: params.admin,
        ownerUserId: params.ownerUserId,
        workspaceId,
        actorUserId: params.actorUserId,
        amount: creditsUsed,
        sessionId,
        rowId: row.id,
        operation: "visualizer_images",
        details: {
          runId: params.runId,
          idempotencyKey: `${params.runId}:visualizer_images:${row.id}:${charge.indexKey}`,
          phase: "images",
          ...charge.details,
        },
      });
      if (!deduct.success) {
        // The images were never paid for, so they are not kept.
        await removeVisualizerPathsAdmin(newlyStored).catch(() => undefined);
        return failRow(deduct.error || "Credit deduction failed", charge.totals.totalCost);
      }
      if (deduct.duplicate) creditsUsed = 0;
    }

    const { merged, html } = snapshot();
    const done = merged.filter((item) => !!item.storagePath).length;
    const allDone = done === merged.length;
    const partialNote = allDone
      ? undefined
      : `Created ${done} of ${merged.length} images${
          stoppedEarly ? ` (${stoppedEarly.toLowerCase()})` : failures[0] ? ` (${failures[0]})` : ""
        }`;

    visualizerLog("images-row", "Images completed", {
      rowId: row.id,
      done,
      total: merged.length,
      creditsUsed,
      dollarCost: charge.totals.totalCost,
    });

    return {
      row: {
        ...row,
        generatedDescription: html,
        imagePlaceholders: merged,
        status: allDone ? "images_ready" : "description_ready",
        generationStage: undefined,
        errorMessage: partialNote,
      },
      creditsUsed,
      cost: charge.totals.totalCost,
    };
  } catch (error) {
    await removeVisualizerPathsAdmin(newlyStored).catch(() => undefined);
    const message = error instanceof Error ? error.message : "Image generation failed";
    visualizerWarn("images-row", `Row ${row.id} image phase failed`, { message });
    return failRow(message, sumCosts(imageCosts).totalCost);
  }
}
