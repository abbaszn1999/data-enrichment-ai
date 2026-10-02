import { createAdminClient } from "@/lib/supabase-admin";
import { sumCosts, type AiCallCost } from "@/lib/ai-pricing";
import { VISUALIZER_PLANNER_OPENAI_MODEL } from "@/lib/enrich/models";
import { planVisualizerContent, VisualizerPlannerError } from "@/lib/visualizer/agents/description-agent";
import { buildDescriptionCharge } from "@/lib/visualizer/billing";
import { settleProviderUsage, type UsageSettlement } from "@/lib/jobs/credits";
import { collectVisualizerImagePaths } from "@/lib/visualizer/html-embed";
import { shouldChargeVisualizerCredits } from "@/lib/visualizer/pricing";
import { loadVisualizerReferences } from "@/lib/visualizer/references";
import { mappedProductFields } from "@/lib/visualizer/row-fields";
import { visualizerLog, visualizerWarn } from "@/lib/visualizer/log";
import { removeVisualizerPathsAdmin } from "@/lib/visualizer/storage-admin";
import {
  resolveVisualizerImageModel,
  type VisualizerProjectSettings,
  type VisualizerRow,
  type VisualizerWorksheetJson,
} from "@/lib/visualizer/types";

type Admin = ReturnType<typeof createAdminClient>;

/** Time the planner needs before it may start: image loading, two attempts, saving. */
const PLANNING_MIN_REMAINING_MS = 300_000;

export async function processDescriptionRow(params: {
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
  shouldCancel?: () => Promise<boolean>;
}): Promise<{
  row: VisualizerRow;
  creditsUsed: number;
  cost: number;
  error?: string;
  /** The balance is spent: the run must stop, but this row's work is kept and billed. */
  balanceExhausted?: boolean;
}> {
  const { row, settings } = params;
  const product = mappedProductFields(row, settings);
  const next: VisualizerRow = {
    ...row,
    errorMessage: undefined,
  };
  let charged = false;
  const fail = async (message: string, billedCosts: AiCallCost[] = []) => {
    // Billing rule: what the planner answered (and billed us for) is charged even when the row fails.
    const totals = sumCosts(billedCosts);
    let settlement: UsageSettlement | null = null;
    if (!charged && shouldChargeVisualizerCredits(totals.totalCredits)) {
      settlement = await settleProviderUsage({
        ownerUserId: params.ownerUserId,
        workspaceId: params.workspaceId,
        actorUserId: params.actorUserId,
        amount: totals.totalCredits,
        operation: "visualizer_description",
        entityType: "visualizer_session",
        entityId: params.sessionId,
        idempotencyKey: `${params.runId}:visualizer_description:${row.id}:failed`,
        details: {
          runId: params.runId,
          rowId: row.id,
          phase: "description",
          pipeline: "visualizer-description",
          failedRow: true,
          error: message.slice(0, 300),
          plannerRounds: billedCosts.length,
          dollarCost: totals.totalCost,
        },
      });
    }
    return {
      row: {
        ...next,
        status: "failed" as const,
        errorMessage: message.slice(0, 500),
        generatedDescription: undefined,
        imagePlaceholders: undefined,
      },
      creditsUsed: settlement?.charged ?? 0,
      cost: totals.totalCost,
      error: message,
      balanceExhausted: settlement?.balanceExhausted === true,
    };
  };

  const hasContext = Object.entries(product).some(
    ([key, value]) => key !== "productImage" && value.trim().length > 0
  );
  if (!hasContext) return fail("Selected columns are empty for this product");

  if (params.deadlineAt && params.deadlineAt - Date.now() < PLANNING_MIN_REMAINING_MS) {
    return fail("Run time budget reached; retry this product");
  }

  const references = await loadVisualizerReferences({ row, settings });
  if (references.productCount === 0) {
    return fail("Could not download the product image from the selected image column");
  }
  if (references.staleLogo || references.staleBrandGuide) {
    visualizerWarn("description-row", "A brand asset could not be loaded; continuing without it", {
      rowId: row.id,
      logo: references.staleLogo,
      brandGuide: references.staleBrandGuide,
    });
  }

  const imageModel = resolveVisualizerImageModel(settings.images.tier);
  visualizerLog("description-row", `Planning row ${row.id}`, {
    tier: settings.images.tier,
    imageModel,
    references: references.counts,
    layoutId: settings.description.layoutId,
    imageCount: settings.description.imageCount,
  });

  const plannerCosts: AiCallCost[] = [];
  try {
    const plan = await planVisualizerContent({
      row,
      settings,
      references: references.ordered,
      shouldCancel: params.shouldCancel,
    });
    plannerCosts.push(...plan.costs);

    const charge = buildDescriptionCharge({
      plannerCosts,
      plannerModel: VISUALIZER_PLANNER_OPENAI_MODEL,
      imageModel,
      tier: settings.images.tier,
      layoutId: settings.description.layoutId,
      requestedImages: plan.imagePlaceholders.length,
      references: references.counts,
    });
    let creditsUsed = 0;
    let billing: UsageSettlement | null = null;

    // The description is delivered, so it is always kept and billed. If the balance
    // cannot cover all of it, the rest of the balance is charged and the run stops.
    if (shouldChargeVisualizerCredits(charge.totals.totalCredits)) {
      billing = await settleProviderUsage({
        ownerUserId: params.ownerUserId,
        workspaceId: params.workspaceId,
        actorUserId: params.actorUserId,
        amount: charge.totals.totalCredits,
        operation: "visualizer_description",
        entityType: "visualizer_session",
        entityId: params.sessionId,
        idempotencyKey: `${params.runId}:visualizer_description:${row.id}`,
        details: {
          runId: params.runId,
          rowId: row.id,
          phase: "description",
          placeholderCount: plan.imagePlaceholders.length,
          notes: plan.notes,
          ...charge.details,
        },
      });
      creditsUsed = billing.charged;
      charged = true;
      if (billing.shortfall > 0) {
        visualizerWarn("description-row", "Balance could not cover the row; result kept and the rest of the balance charged", {
          rowId: row.id,
          shortfallCredits: billing.shortfall,
          billingError: billing.billingError,
        });
      }
    }

    // A new description replaces the page, so images from an earlier run are no longer used.
    const oldPaths = collectVisualizerImagePaths(row.imagePlaceholders);
    if (oldPaths.length > 0) {
      await removeVisualizerPathsAdmin(oldPaths).catch((error) => {
        visualizerWarn("description-row", "Old images could not be removed", {
          rowId: row.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    next.generatedDescription = plan.description;
    next.imagePlaceholders = plan.imagePlaceholders;
    next.status = "description_ready";
    next.errorMessage = undefined;

    return {
      row: next,
      creditsUsed,
      cost: charge.totals.totalCost,
      balanceExhausted: billing?.balanceExhausted === true,
    };
  } catch (error) {
    if (error instanceof VisualizerPlannerError) plannerCosts.push(...error.costs);
    const message = error instanceof Error ? error.message : "Description generation failed";
    visualizerWarn("description-row", `Row ${row.id} failed`, { message });
    return fail(message, plannerCosts);
  }
}
