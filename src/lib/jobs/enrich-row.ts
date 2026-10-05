import {
  SEARCHAPI_GOOGLE_AI_MODE_MODEL,
  SEARCHAPI_GOOGLE_LENS_MODEL,
  sumCosts,
  type AiCallCost,
} from "@/lib/ai-pricing";
import {
  enrichRow,
  isImageFinderRun,
  resolveEnrichOpenAiModel,
  type EnrichAgentResult,
  type EnrichSettings,
} from "@/lib/enrich";
import { IMAGE_FINDER_OPENAI_MODEL } from "@/lib/enrich/models";
import { usesGoogleSourceUrls } from "@/lib/enrich/source-urls/agent";
import { lensImageForRow } from "@/lib/enrich/lens/image-column";
import { isLensRun } from "@/lib/enrich/lens/run";
import {
  billedCostsOf,
  isEnrichCancelledError,
  isEnrichOutputTruncatedError,
  isEnrichProviderUnavailableError,
} from "@/lib/enrich/openai";
import {
  resolveEnrichmentModel,
  SOURCE_URLS_COLUMN_ID,
  type CategoryItem,
  type ContentLength,
  type EnrichmentColumnType,
  type WritingTone,
} from "@/types";
import { createAdminClient } from "@/lib/supabase-admin";
import { deductCreditsIdempotent, isInsufficientCredits } from "./credits";
import { JOB_ROW_ATTEMPTS } from "./config";
import { loadProjectJsonAdmin } from "./project-json";
import { isJobCancelRequested, loadJobRun } from "./repo";
import type { CatalogJobSettings } from "./types";
import type { ProjectRow } from "@/lib/storage-helpers";
import { buildRowSources } from "./row-sources";
import { resolveStoredImageUrls } from "./stored-images";

export { buildRowSources } from "./row-sources";

export type EnrichRowOutcome =
  | {
      ok: true;
      rowId: string;
      data: Record<string, unknown>;
      originalPatches: Record<string, string>;
      credits: number;
      cost: number;
      tokens: number;
      /** OpenAI calls billed for this row, including failed attempts before the success. */
      billedAttempts: number;
      /** Provider breakdown recorded with the charge (see usageDetails). */
      details?: Record<string, unknown>;
    }
  | {
      ok: false;
      rowId: string;
      error: string;
      noCredits?: boolean;
      /** Stopped by the user mid-call, not a real failure — don't mark the row done. */
      cancelled?: boolean;
      /** Our AI provider account is out of quota — stop the job and leave the row pending. */
      providerUnavailable?: boolean;
      /** What OpenAI already billed for this row before it failed or stopped; charged like any row. */
      billed?: BilledUsage;
    };

export interface BilledUsage {
  credits: number;
  cost: number;
  tokens: number;
  billedAttempts: number;
  details?: Record<string, unknown>;
}

/**
 * What one row's charge is made of, per provider, recorded with the charge so
 * it can be reconciled against each provider's own dashboard.
 */
export function usageDetails(
  costs: AiCallCost[],
  meta?: { tiersRun: string[]; foundBy?: string }
): Record<string, unknown> {
  const summed = sumCosts(costs);
  return {
    ...(meta ? { tiersRun: meta.tiersRun, foundBy: meta.foundBy ?? "" } : {}),
    openAiCost: summed.totalCost - summed.breakdown.searchApiCost,
    openAiTokens: summed.totalTokens,
    webSearchCalls: summed.breakdown.webSearchCalls,
    searchApiCalls: summed.breakdown.searchApiCalls,
    searchApiCost: summed.breakdown.searchApiCost,
  };
}

/** Usage OpenAI billed, or undefined when nothing was billed. */
function billedUsage(costs: AiCallCost[]): BilledUsage | undefined {
  if (costs.length === 0) return undefined;
  const summed = sumCosts(costs);
  if (summed.totalCost <= 0) return undefined;
  return {
    credits: summed.totalCredits,
    cost: summed.totalCost,
    tokens: summed.totalTokens,
    billedAttempts: costs.length,
    details: usageDetails(costs),
  };
}

const GOOGLE_AI_MODE_MODEL = SEARCHAPI_GOOGLE_AI_MODE_MODEL;

export const PROVIDER_UNAVAILABLE_JOB_ERROR =
  "AI service temporarily unavailable. Unfinished rows were charged only for AI work already done; run them again later.";

/** The Image Finder's final re-check is a second billed pass, so it gets its own key. */
export function catalogCreditIdempotencyKey(runId: string, rowId: string, recheck = false): string {
  return `catalog_intelligence:${runId}:${rowId}${recheck ? ":recheck" : ""}`;
}

/** Extra context the Image Finder uses; ignored by other catalog modes. */
export interface CatalogRowContext {
  learnedDomains?: string[];
  recheck?: boolean;
}

/** Rows the user targeted, minus ones this same run already finished. `done` from an earlier run is not skipped. */
export function catalogPendingRowIds(
  targetIds: string[],
  rows: Array<{ id: string }>,
  processedRowIds?: string[] | null
): string[] {
  const known = new Set(rows.map((row) => row.id));
  const processed = new Set((processedRowIds ?? []).map(String));
  return targetIds.filter((id) => known.has(id) && !processed.has(id));
}

export async function processCatalogRow(params: {
  sessionId: string;
  workspaceId: string;
  row: ProjectRow;
  settings: CatalogJobSettings;
  shouldCancel?: () => Promise<boolean>;
  context?: CatalogRowContext;
}): Promise<EnrichRowOutcome> {
  const { row, settings } = params;
  const enrichSettings: EnrichSettings = {
    enrichmentModel: resolveEnrichmentModel(settings.enrichmentModel),
    outputLanguage: settings.outputLanguage || "English",
    ...(settings.globalInstruction?.trim() ? { globalInstruction: settings.globalInstruction.trim() } : {}),
  };
  const enrichmentColumnIds = new Set(settings.enrichmentColumns.map((c) => c.id));
  const aiColumnLabels: Record<string, string> = { ...(settings.sourceColumnLabels ?? {}) };
  for (const col of settings.enrichmentColumns) if (col.label) aiColumnLabels[col.id] ??= col.label;
  const imageFinderRun = isImageFinderRun(settings.kind ?? "product", settings.enabledColumns);
  const { productData, sourceImageUrls: sheetImageUrls, knownPages } = buildRowSources(
    row,
    settings.sourceColumns,
    enrichmentColumnIds,
    aiColumnLabels,
    { pagesAsLeads: imageFinderRun }
  );
  // Lens searches with the one picture of the column the owner picked (a link
  // without an image extension counts there), so it does not use the image
  // list built for the model.
  const lensRun = isLensRun(settings.kind ?? "product", settings.enabledColumns);
  const lensPicture = lensRun ? lensImageForRow(row, settings.sourceColumns?.[0] ?? "") : null;
  const sourceImageUrls = await resolveStoredImageUrls(lensRun ? (lensPicture ? [lensPicture] : []) : sheetImageUrls);

  let lastError = "Enrichment failed";
  // Every call OpenAI bills is charged to the row, whatever the outcome: a
  // success includes earlier failed attempts, and a failed or stopped row is
  // charged for what was billed before it ended.
  const failedAttemptCosts: AiCallCost[] = [];
  // A Google Source URLs answer from an attempt whose OpenAI half failed; the
  // retry reuses it rather than paying for the same search again.
  const sourceUrlsMemo: { result?: EnrichAgentResult } = {};
  // A second whole-row Image Finder attempt would re-pay the search;
  // a failed row is simply run again.
  // The same goes for Lens: every search it ran is billed.
  const rowAttempts = imageFinderRun || lensRun ? 1 : JOB_ROW_ATTEMPTS;
  for (let attempt = 1; attempt <= rowAttempts; attempt += 1) {
    try {
      const enriched = await enrichRow({
        productData,
        sourceImageUrls,
        knownPages,
        enabledColumns: settings.enabledColumns,
        enrichmentColumns: settings.enrichmentColumns.map((c) => ({
          id: c.id,
          label: c.label,
          description: c.description,
          type: (c.type || "text") as EnrichmentColumnType,
          enabled: c.enabled !== false,
          imageCount: c.imageCount,
          sourceCount: c.sourceCount,
          maxCategories: c.maxCategories,
          categoryFormat: c.categoryFormat,
          useStoreCategories: c.useStoreCategories,
          itemCount: c.itemCount,
          maxChars: c.maxChars,
          customInstruction: c.customInstruction,
          allowedDomains: c.allowedDomains,
          blockedDomains: c.blockedDomains,
          lensMatchScope: c.lensMatchScope,
          lensProductPagesOnly: c.lensProductPagesOnly,
          writingTone: c.writingTone as WritingTone | undefined,
          contentLength: c.contentLength as ContentLength | undefined,
        })),
        settings: enrichSettings,
        kind: settings.kind,
        cmsType: settings.cmsType,
        workspaceCategories: settings.workspaceCategories as CategoryItem[] | undefined,
        categoriesRawRows: settings.categoriesRawRows,
        shouldCancel: params.shouldCancel,
        learnedDomains: params.context?.learnedDomains,
        recheck: params.context?.recheck,
        sourceUrlsMemo,
      });
      const billed = [...failedAttemptCosts, ...enriched.costs];
      const costs = sumCosts(billed);
      return {
        ok: true,
        rowId: row.id,
        data: enriched.data as Record<string, unknown>,
        originalPatches: {},
        credits: costs.totalCredits,
        cost: costs.totalCost,
        tokens: costs.totalTokens,
        billedAttempts: billed.length,
        details: usageDetails(billed, enriched.meta),
      };
    } catch (error) {
      // Stop and an out-of-quota account end the row at once — no retry.
      if (isEnrichCancelledError(error)) {
        return {
          ok: false,
          rowId: row.id,
          error: "Cancelled by user",
          cancelled: true,
          billed: billedUsage([...failedAttemptCosts, ...billedCostsOf(error)]),
        };
      }
      if (isEnrichProviderUnavailableError(error)) {
        return {
          ok: false,
          rowId: row.id,
          error: PROVIDER_UNAVAILABLE_JOB_ERROR,
          providerUnavailable: true,
          billed: billedUsage([...failedAttemptCosts, ...billedCostsOf(error)]),
        };
      }
      failedAttemptCosts.push(...billedCostsOf(error));
      lastError = error instanceof Error ? error.message : "Enrichment failed";
      // The same request would run out of output space again: a retry would
      // only pay twice for the same failure.
      if (isEnrichOutputTruncatedError(error)) {
        return { ok: false, rowId: row.id, error: lastError, billed: billedUsage(failedAttemptCosts) };
      }
      if (attempt < rowAttempts) {
        // Stop never starts a fresh attempt: the row stays pending for a
        // later run and is charged only for what OpenAI already billed.
        if (params.shouldCancel && (await params.shouldCancel().catch(() => false))) {
          return {
            ok: false,
            rowId: row.id,
            error: "Cancelled by user",
            cancelled: true,
            billed: billedUsage(failedAttemptCosts),
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  return { ok: false, rowId: row.id, error: lastError, billed: billedUsage(failedAttemptCosts) };
}

/** Which providers did the row's work, as recorded with its charge. */
export function catalogChargeModel(settings: CatalogJobSettings, imageFinder: boolean): string {
  // Lens is one SearchApi search per row and no model call.
  if (isLensRun(settings.kind ?? "product", settings.enabledColumns)) return SEARCHAPI_GOOGLE_LENS_MODEL;
  if (imageFinder) {
    // Source URLs can run in the same Source & Image Finder run: its Google search is billed too.
    return usesGoogleSourceUrls(settings.kind ?? "product", settings.enabledColumns)
      ? `${IMAGE_FINDER_OPENAI_MODEL}+${GOOGLE_AI_MODE_MODEL}`
      : IMAGE_FINDER_OPENAI_MODEL;
  }
  const openAi = resolveEnrichOpenAiModel(settings.enrichmentModel);
  if (!usesGoogleSourceUrls(settings.kind ?? "product", settings.enabledColumns)) return openAi;
  const onlySourceUrls = settings.enabledColumns.every((id) => id === SOURCE_URLS_COLUMN_ID);
  return onlySourceUrls ? GOOGLE_AI_MODE_MODEL : `${openAi}+${GOOGLE_AI_MODE_MODEL}`;
}

export async function chargeCatalogRow(params: {
  runId: string;
  sessionId: string;
  workspaceId: string;
  rowId: string;
  rowIndex: number;
  credits: number;
  cost: number;
  tokens: number;
  billedAttempts?: number;
  settings: CatalogJobSettings;
  recheck?: boolean;
  /** The row failed or was stopped; this charges only the AI calls already billed. */
  unfinished?: boolean;
  /** Per-provider breakdown stored with the charge (see usageDetails). */
  details?: Record<string, unknown>;
}): Promise<
  | {
      ok: true;
      remaining?: number;
      /** The balance ran out: only `chargedCredits` of `fullCredits` could be taken. The run must pause. */
      outOfCredits?: { fullCredits: number; chargedCredits: number };
    }
  | { ok: false; noCredits: boolean; error: string }
> {
  if (params.credits <= 0) return { ok: true };
  const imageFinder = isImageFinderRun(params.settings.kind ?? "product", params.settings.enabledColumns);
  // The search is already done and billed to us (a Lens run has no other cost),
  // so a short balance is handled like the Image Finder's: take what is left and pause.
  const keepsResultOnShortBalance =
    imageFinder || isLensRun(params.settings.kind ?? "product", params.settings.enabledColumns);
  const deduct = (amount: number, partial: boolean) =>
    deductCreditsIdempotent({
      ownerUserId: params.settings.ownerUserId,
      workspaceId: params.workspaceId,
      actorUserId: params.settings.actorUserId,
      amount,
      operation: "catalog_intelligence",
      entityType: params.settings.kind === "plp" ? "catalog_plp_row" : "catalog_row",
      entityId: params.rowId,
      idempotencyKey: catalogCreditIdempotencyKey(params.runId, params.rowId, params.recheck),
      details: {
        sessionId: params.sessionId,
        rowIndex: params.rowIndex,
        enrichmentModel: params.settings.enrichmentModel,
        model: catalogChargeModel(params.settings, imageFinder),
        ...(params.recheck ? { recheck: true } : {}),
        ...(params.unfinished ? { unfinished: true } : {}),
        billedAttempts: params.billedAttempts ?? 1,
        totalCost: params.cost,
        totalTokens: params.tokens,
        ...(params.details ?? {}),
        fullCredits: params.credits,
        chargedCredits: amount,
        ...(partial ? { partial: true } : {}),
      },
    });

  const result = await deduct(params.credits, false);
  if (result.success) return { ok: true, remaining: result.remaining };

  const noCredits = isInsufficientCredits(result.error);
  // Image Finder: the AI work (up to three tiers) is already done and billed
  // to us. Take whatever balance is left under the same idempotency key (a
  // retry after a crash finds it and does not charge twice), keep the
  // result, and let the run pause.
  if (keepsResultOnShortBalance && noCredits && /insufficient credits|insufficient_credits/i.test(result.error ?? "")) {
    const available = Math.floor(Math.max(0, result.remaining ?? 0) * 1000) / 1000;
    if (available > 0) {
      const partial = await deduct(available, true);
      if (partial.success) {
        return {
          ok: true,
          remaining: 0,
          outOfCredits: { fullCredits: params.credits, chargedCredits: available },
        };
      }
    } else {
      return {
        ok: true,
        remaining: 0,
        outOfCredits: { fullCredits: params.credits, chargedCredits: 0 },
      };
    }
  }
  return {
    ok: false,
    noCredits,
    error: result.error || "Credit deduction failed",
  };
}

export type CatalogRowTaskInput = {
  runId: string;
  rowId: string;
} & CatalogRowContext;

export async function executeCatalogRow(
  input: CatalogRowTaskInput
): Promise<EnrichRowOutcome> {
  const admin = createAdminClient();
  const run = await loadJobRun(admin, input.runId);
  if (!run || run.kind !== "catalog") {
    return { ok: false, rowId: input.rowId, error: "Job run not found" };
  }
  const settings = run.settings as CatalogJobSettings;
  const project = await loadProjectJsonAdmin(
    run.workspace_id,
    run.session_id,
    admin
  );
  const row = project?.rows.find((candidate) => candidate.id === input.rowId);
  if (!row) {
    return { ok: false, rowId: input.rowId, error: "Row not found" };
  }
  return processCatalogRow({
    sessionId: run.session_id,
    workspaceId: run.workspace_id,
    row,
    settings,
    // Each row runs as its own Render task, so it needs its own poll rather
    // than sharing the session worker's in-memory check.
    shouldCancel: () => isJobCancelRequested(admin, run.id),
    context: { learnedDomains: input.learnedDomains, recheck: input.recheck },
  });
}
