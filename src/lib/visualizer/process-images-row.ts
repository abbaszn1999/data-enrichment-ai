import { createAdminClient } from "@/lib/supabase-admin";
import { costToCredits } from "@/lib/ai-pricing";
import { requireGeminiApiKey } from "@/lib/sync/agent/ai-utils";
import { downloadImageBytes } from "@/lib/gallery/providers/serper-images";
import {
  generateVisualizerLifestyleImage,
  type VisualizerProductReference,
} from "@/lib/visualizer/agents/image-agent";
import { deductVisualizerCredits } from "@/lib/visualizer/credits";
import {
  collectVisualizerImagePaths,
  embedVisualizerPlaceholders,
} from "@/lib/visualizer/html-embed";
import { mappedProductFields } from "@/lib/visualizer/row-fields";
import { visualizerLog, visualizerWarn } from "@/lib/visualizer/log";
import { shouldChargeVisualizerCredits } from "@/lib/visualizer/pricing";
import { getVisualizerRowImagePath } from "@/lib/visualizer/storage-paths";
import {
  downloadVisualizerBytesAdmin,
  removeVisualizerPathsAdmin,
  uploadVisualizerBytesAdmin,
} from "@/lib/visualizer/storage-admin";
import type {
  VisualizerImagePlaceholder,
  VisualizerProjectSettings,
  VisualizerRow,
  VisualizerWorksheetJson,
} from "@/lib/visualizer/types";

type Admin = ReturnType<typeof createAdminClient>;

function normalizeMime(
  value: string
): "image/jpeg" | "image/png" | "image/webp" {
  if (value === "image/png" || value === "image/webp") return value;
  return "image/jpeg";
}

async function loadStoredReference(
  path: string | null | undefined,
  label: string
): Promise<VisualizerProductReference | null> {
  if (!path) return null;
  try {
    const stored = await downloadVisualizerBytesAdmin(path);
    if (!stored) return null;
    return {
      label,
      buffer: stored.buffer,
      contentType: normalizeMime(stored.contentType),
    };
  } catch {
    return null;
  }
}

export async function processImagesRow(params: {
  admin: Admin;
  workspaceId: string;
  sessionId: string;
  worksheet: VisualizerWorksheetJson;
  row: VisualizerRow;
  settings: VisualizerProjectSettings;
  ownerUserId: string;
  actorUserId: string;
  runId: string;
  /** Cooperative stop: finish in-flight image requests, then skip new ones. */
  shouldCancel?: () => Promise<boolean>;
}): Promise<{
  row: VisualizerRow;
  creditsUsed: number;
  cost: number;
  error?: string;
}> {
  const { row, settings, workspaceId, sessionId } = params;
  const product = mappedProductFields(row, settings);
  const description = String(row.generatedDescription || "").trim();
  const placeholders = [...(row.imagePlaceholders ?? [])].sort(
    (a, b) => a.index - b.index
  );

  if (!description) {
    return {
      row: {
        ...row,
        status: "failed",
        errorMessage: "Missing generated description for image phase",
      },
      creditsUsed: 0,
      cost: 0,
      error: "Missing generated description for image phase",
    };
  }
  if (placeholders.length === 0) {
    return {
      row: {
        ...row,
        status: "failed",
        errorMessage: "No image placeholders to generate",
      },
      creditsUsed: 0,
      cost: 0,
      error: "No image placeholders to generate",
    };
  }

  let productReference: VisualizerProductReference | null = null;
  if (product.productImage && /^https?:\/\//i.test(product.productImage)) {
    try {
      const downloaded = await downloadImageBytes(product.productImage);
      if (downloaded) {
        productReference = {
          label: "canonical product photo; preserve this exact product",
          buffer: downloaded.buffer,
          contentType: normalizeMime(downloaded.contentType),
        };
      }
    } catch (error) {
      visualizerWarn("images-row", "Could not download product reference", {
        rowId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const supportingReferences = (
    await Promise.all([
      settings.images.brandingEnabled
        ? loadStoredReference(
            settings.images.logoPath,
            "official brand logo; preserve its recognizable design"
          )
        : Promise.resolve(null),
      settings.images.brandingEnabled &&
      settings.images.brandGuideMode === "image"
        ? loadStoredReference(
            settings.images.brandGuidePath,
            "visual brand guide and art-direction reference"
          )
        : Promise.resolve(null),
    ])
  ).filter((value): value is VisualizerProductReference => !!value);

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: requireGeminiApiKey() });

  const oldPaths = collectVisualizerImagePaths(row.imagePlaceholders);
  const newlyStored: string[] = [];
  const nextPlaceholders: VisualizerImagePlaceholder[] = [];
  let totalCost = 0;
  let totalCredits = 0;

  visualizerLog("images-row", `Generating images for row ${row.id}`, {
    placeholderCount: placeholders.length,
    tier: "premium",
    supportingCount: supportingReferences.length,
  });

  try {
    const IMAGE_PARALLEL = 4;
    let cancelledMidRow = false;
    for (let offset = 0; offset < placeholders.length; offset += IMAGE_PARALLEL) {
      // Finish any already-started chunk; do not begin a new batch after Stop.
      if (offset > 0 && params.shouldCancel && (await params.shouldCancel())) {
        cancelledMidRow = true;
        break;
      }
      const chunk = placeholders.slice(offset, offset + IMAGE_PARALLEL);
      const chunkResults = await Promise.all(
        chunk.map(async (placeholder) => {
          const result = await generateVisualizerLifestyleImage({
            ai,
            images: settings.images,
            brand: settings.brand,
            product,
            visualBrief: placeholder.visualBrief,
            placeholderIndex: placeholder.index,
            productReference,
            supportingReferences,
          });

          const storagePath = getVisualizerRowImagePath(
            workspaceId,
            sessionId,
            row.id,
            placeholder.index,
            result.ext
          );
          await uploadVisualizerBytesAdmin(
            storagePath,
            result.buffer,
            result.contentType
          );

          const credits = costToCredits(result.cost.totalCost);
          if (shouldChargeVisualizerCredits(credits)) {
            const deduct = await deductVisualizerCredits({
              admin: params.admin,
              ownerUserId: params.ownerUserId,
              workspaceId,
              actorUserId: params.actorUserId,
              amount: credits,
              sessionId,
              rowId: row.id,
              operation: "visualizer_images",
              details: {
                runId: params.runId,
                idempotencyKey: `${params.runId}:visualizer_images:${row.id}:${placeholder.index}`,
                model: result.model,
                phase: "images",
                placeholderIndex: placeholder.index,
                cost: result.cost.totalCost,
                resolution: settings.images.resolution,
              },
            });
            if (!deduct.success) {
              throw new Error(deduct.error || "Credit deduction failed");
            }
          }

          return {
            placeholder: { ...placeholder, storagePath },
            storagePath,
            cost: result.cost.totalCost,
            credits,
          };
        })
      );

      for (const item of chunkResults) {
        newlyStored.push(item.storagePath);
        totalCost += item.cost;
        totalCredits += item.credits;
        nextPlaceholders.push(item.placeholder);
      }
    }

    if (cancelledMidRow && nextPlaceholders.length === 0) {
      return {
        row: {
          ...row,
          status: "description_ready",
          errorMessage: undefined,
        },
        creditsUsed: 0,
        cost: 0,
      };
    }

    nextPlaceholders.sort((a, b) => a.index - b.index);

    if (oldPaths.length > 0) {
      await removeVisualizerPathsAdmin(oldPaths).catch((error) => {
        visualizerWarn("images-row", "Failed to remove previous images", {
          rowId: row.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    // Keep original placeholders for any indices not generated yet so HTML markers stay valid.
    const byIndex = new Map(
      nextPlaceholders.map((item) => [item.index, item] as const)
    );
    const merged = placeholders.map(
      (item) => byIndex.get(item.index) ?? item
    );
    const embedded = embedVisualizerPlaceholders(description, merged);
    const allDone = merged.every((item) => !!item.storagePath);

    return {
      row: {
        ...row,
        generatedDescription: embedded,
        imagePlaceholders: merged,
        status: allDone ? "images_ready" : "description_ready",
        errorMessage: cancelledMidRow
          ? "Stopped after finishing in-flight image requests"
          : undefined,
      },
      creditsUsed: totalCredits,
      cost: totalCost,
    };
  } catch (error) {
    if (newlyStored.length > 0) {
      await removeVisualizerPathsAdmin(newlyStored).catch(() => undefined);
    }
    const message =
      error instanceof Error ? error.message : "Image generation failed";
    visualizerWarn("images-row", `Row ${row.id} image phase failed`, {
      message,
    });
    return {
      row: {
        ...row,
        status: "failed",
        errorMessage: message.slice(0, 500),
      },
      creditsUsed: totalCredits,
      cost: totalCost,
      error: message,
    };
  }
}
