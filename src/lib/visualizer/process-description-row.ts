import { createAdminClient } from "@/lib/supabase-admin";
import { costToCredits } from "@/lib/ai-pricing";
import {
  generateProductDescription,
  type DescriptionReferenceImage,
} from "@/lib/visualizer/agents/description-agent";
import { deductVisualizerCredits } from "@/lib/visualizer/credits";
import { shouldChargeVisualizerCredits } from "@/lib/visualizer/pricing";
import { mappedProductFields } from "@/lib/visualizer/row-fields";
import { visualizerLog, visualizerWarn } from "@/lib/visualizer/log";
import { downloadVisualizerBytesAdmin } from "@/lib/visualizer/storage-admin";
import type {
  VisualizerProjectSettings,
  VisualizerRow,
  VisualizerWorksheetJson,
} from "@/lib/visualizer/types";
import { downloadImageBytes } from "@/lib/gallery/providers/serper-images";

type Admin = ReturnType<typeof createAdminClient>;

async function loadStoredReferenceImage(
  path: string | null | undefined,
  label: string
): Promise<DescriptionReferenceImage | null> {
  if (!path) return null;
  try {
    const stored = await downloadVisualizerBytesAdmin(path);
    if (!stored) return null;
    return {
      buffer: stored.buffer,
      contentType: stored.contentType || "image/jpeg",
    };
  } catch (error) {
    visualizerWarn("description-row", `Could not download ${label}`, {
      path,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function processDescriptionRow(params: {
  admin: Admin;
  workspaceId: string;
  sessionId: string;
  worksheet: VisualizerWorksheetJson;
  row: VisualizerRow;
  settings: VisualizerProjectSettings;
  ownerUserId: string;
  actorUserId: string;
  runId: string;
}): Promise<{
  row: VisualizerRow;
  creditsUsed: number;
  cost: number;
  error?: string;
}> {
  const { row, settings } = params;
  const product = mappedProductFields(row, settings);
  const next: VisualizerRow = {
    ...row,
    errorMessage: undefined,
  };

  const hasContext = Object.entries(product).some(
    ([key, value]) => key !== "productImage" && value.trim().length > 0
  );
  if (!hasContext) {
    next.status = "failed";
    next.errorMessage = "Selected columns are empty for this product";
    return { row: next, creditsUsed: 0, cost: 0, error: next.errorMessage };
  }

  let productImage:
    | { url: string; buffer?: Buffer; contentType?: string }
    | undefined;
  if (product.productImage && /^https?:\/\//i.test(product.productImage)) {
    try {
      const downloaded = await downloadImageBytes(product.productImage);
      if (downloaded) {
        productImage = {
          url: product.productImage,
          buffer: downloaded.buffer,
          contentType: downloaded.contentType,
        };
      } else {
        productImage = { url: product.productImage };
      }
    } catch (error) {
      visualizerWarn("description-row", "Could not download product image", {
        rowId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
      productImage = { url: product.productImage };
    }
  }

  const images = settings.images;
  const brandingEnabled = images.brandingEnabled === true;

  const [logoImage, brandGuideImage] = await Promise.all([
    brandingEnabled
      ? loadStoredReferenceImage(images.logoPath, "brand logo")
      : Promise.resolve(null),
    brandingEnabled && images.brandGuideMode === "image"
      ? loadStoredReferenceImage(images.brandGuidePath, "brand guide")
      : Promise.resolve(null),
  ]);

  visualizerLog("description-row", `Generating description for row ${row.id}`, {
    hasImage: !!productImage,
    brandingEnabled,
    hasLogoImage: !!logoImage,
    hasBrandGuideImage: !!brandGuideImage,
    tier: settings.description.tier,
  });

  try {
    const result = await generateProductDescription({
      product,
      tier: settings.description.tier,
      brand: settings.brand,
      layoutId: settings.description.layoutId,
      imageCount: settings.description.imageCount,
      customInstructions: settings.description.instructions,
      productImage,
      images: settings.images,
      logoImage,
      brandGuideImage,
    });

    next.generatedDescription = result.description;
    next.imagePlaceholders = result.imagePlaceholders;
    next.status = "description_ready";
    next.errorMessage = undefined;

    const creditsUsed = costToCredits(result.cost.totalCost);
    if (shouldChargeVisualizerCredits(creditsUsed)) {
      const deduct = await deductVisualizerCredits({
        admin: params.admin,
        ownerUserId: params.ownerUserId,
        workspaceId: params.workspaceId,
        actorUserId: params.actorUserId,
        amount: creditsUsed,
        sessionId: params.sessionId,
        rowId: row.id,
        operation: "visualizer_description",
        details: {
          runId: params.runId,
          idempotencyKey: `${params.runId}:visualizer_description:${row.id}`,
          model: result.model,
          phase: "description",
          cost: result.cost.totalCost,
          placeholderCount: result.imagePlaceholders.length,
          thinkingLevel: "medium",
        },
      });
      if (!deduct.success) {
        next.status = "failed";
        next.errorMessage = deduct.error || "Credit deduction failed";
        next.generatedDescription = undefined;
        next.imagePlaceholders = undefined;
        return {
          row: next,
          creditsUsed: 0,
          cost: 0,
          error: next.errorMessage,
        };
      }
    }

    return {
      row: next,
      creditsUsed,
      cost: result.cost.totalCost,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Description generation failed";
    visualizerWarn("description-row", `Row ${row.id} failed`, { message });
    next.status = "failed";
    next.errorMessage = message.slice(0, 500);
    next.generatedDescription = undefined;
    next.imagePlaceholders = undefined;
    return { row: next, creditsUsed: 0, cost: 0, error: message };
  }
}
