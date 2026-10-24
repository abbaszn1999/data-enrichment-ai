/**
 * The Source URLs plan of a catalog run: when it is needed, how its samples are
 * taken from the sheet, and how its cost is charged.
 *
 * The planner (enrich/source-urls/planner.ts) is a real, billed GPT call, so it
 * is charged like every other AI call: exactly what OpenAI billed, converted to
 * credits, once per run, under its own idempotency key. Nothing is charged when
 * no call was made (no custom instruction, so no planner) or nothing was billed.
 */
import { sumCosts } from "@/lib/ai-pricing";
import { isImageFinderRun } from "@/lib/enrich/image-finder/agent";
import { isLensRun } from "@/lib/enrich/lens/run";
import { SOURCE_URLS_PLANNER_OPENAI_MODEL } from "@/lib/enrich/models";
import { defaultSourceUrlsPlan, type SourceUrlsPlan } from "@/lib/enrich/source-urls/plan";
import { planSourceUrls } from "@/lib/enrich/source-urls/planner";
import type { PlannerColumn } from "@/lib/enrich/source-urls/planner-skill";
import { productFields } from "@/lib/enrich/source-urls/skill";
import { usesGoogleSourceUrls } from "@/lib/enrich/source-urls/agent";
import { SOURCE_URLS_COLUMN_ID } from "@/types";
import type { ProjectRow } from "@/lib/storage-helpers";
import { settleProviderUsage, type UsageSettlement } from "./credits";
import { usageDetails } from "./enrich-row";
import { buildRowSources } from "./row-sources";
import type { CatalogJobSettings } from "./types";

/** Rows looked at for sample values, and how many values one column shows the planner. */
const SAMPLE_ROWS_SCANNED = 50;
const SAMPLES_PER_COLUMN = 3;

/** The Source URLs column's custom instruction, trimmed. */
export function sourceUrlsInstructionOf(settings: Pick<CatalogJobSettings, "enrichmentColumns">): string {
  return (settings.enrichmentColumns.find((c) => c.id === SOURCE_URLS_COLUMN_ID)?.customInstruction ?? "").trim();
}

/**
 * A run needs a plan when Source URLs runs on Google and the owner wrote an
 * instruction. Without an instruction there is nothing to plan: every row asks
 * the default query, and no planner call is made or charged.
 */
export function needsSourceUrlsPlan(settings: CatalogJobSettings): boolean {
  const kind = settings.kind ?? "product";
  return (
    usesGoogleSourceUrls(kind, settings.enabledColumns) &&
    !isLensRun(kind, settings.enabledColumns) &&
    sourceUrlsInstructionOf(settings) !== ""
  );
}

/**
 * The ticked columns with a few sample values each, taken from the rows this
 * run will process and read exactly as the row agent reads them (same labels,
 * images left out).
 */
export function collectPlannerColumns(
  rows: ProjectRow[],
  settings: CatalogJobSettings
): { columns: PlannerColumn[]; hasPhoto: boolean } {
  const enrichmentColumnIds = new Set(settings.enrichmentColumns.map((c) => c.id));
  const labels: Record<string, string> = { ...(settings.sourceColumnLabels ?? {}) };
  for (const col of settings.enrichmentColumns) if (col.label) labels[col.id] ??= col.label;
  const imageFinder = isImageFinderRun(settings.kind ?? "product", settings.enabledColumns);

  const columns = new Map<string, PlannerColumn>();
  let hasPhoto = false;
  for (const row of rows.slice(0, SAMPLE_ROWS_SCANNED)) {
    const { productData, sourceImageUrls } = buildRowSources(row, settings.sourceColumns, enrichmentColumnIds, labels, {
      pagesAsLeads: imageFinder,
    });
    if (sourceImageUrls.length > 0) hasPhoto = true;
    for (const field of productFields(productData)) {
      const column = columns.get(field.name) ?? { name: field.name, samples: [] };
      columns.set(field.name, column);
      if (column.samples.length < SAMPLES_PER_COLUMN && !column.samples.includes(field.value)) {
        column.samples.push(field.value);
      }
    }
  }
  return { columns: [...columns.values()], hasPhoto };
}

/**
 * Writes the run's plan. Never throws: a planner problem gives the default
 * plan, and whatever OpenAI billed is recorded on the plan for the charge.
 */
export async function prepareSourceUrlsPlan(params: {
  settings: CatalogJobSettings;
  rows: ProjectRow[];
  shouldCancel?: () => Promise<boolean>;
}): Promise<SourceUrlsPlan> {
  const { columns, hasPhoto } = collectPlannerColumns(params.rows, params.settings);
  let plan: SourceUrlsPlan;
  let costs: Awaited<ReturnType<typeof planSourceUrls>>["costs"] = [];
  try {
    ({ plan, costs } = await planSourceUrls({
      instruction: sourceUrlsInstructionOf(params.settings),
      columns,
      hasPhoto,
      shouldCancel: params.shouldCancel,
    }));
  } catch (error) {
    // planSourceUrls does not throw; this keeps a job alive if that ever changes.
    plan = defaultSourceUrlsPlan(error instanceof Error ? error.message.slice(0, 200) : "planner failed");
  }
  const totals = sumCosts(costs);
  if (costs.length > 0 && totals.totalCost > 0) {
    plan.billing = {
      credits: totals.totalCredits,
      cost: totals.totalCost,
      tokens: totals.totalTokens,
      billedAttempts: costs.length,
      details: usageDetails(costs),
    };
  }
  return plan;
}

export function sourceUrlsPlanIdempotencyKey(runId: string): string {
  return `catalog_intelligence:${runId}:plan`;
}

/**
 * Charges the planner once for the run (idempotent: asking again changes
 * nothing). The call is already made and billed to us, so if the balance
 * cannot cover it the rest of the balance is taken and `balanceExhausted`
 * tells the run to pause.
 */
export async function chargeSourceUrlsPlan(params: {
  runId: string;
  sessionId: string;
  workspaceId: string;
  settings: CatalogJobSettings;
  plan: SourceUrlsPlan;
}): Promise<UsageSettlement | null> {
  const billing = params.plan.billing;
  if (!billing || billing.credits <= 0) return null;
  return settleProviderUsage({
    ownerUserId: params.settings.ownerUserId,
    workspaceId: params.workspaceId,
    actorUserId: params.settings.actorUserId,
    amount: billing.credits,
    operation: "catalog_intelligence",
    entityType: "catalog_plan",
    entityId: params.sessionId,
    idempotencyKey: sourceUrlsPlanIdempotencyKey(params.runId),
    details: {
      sessionId: params.sessionId,
      runId: params.runId,
      planner: "source-urls",
      model: params.plan.model ?? SOURCE_URLS_PLANNER_OPENAI_MODEL,
      steps: params.plan.steps.length,
      source: params.plan.source,
      billedAttempts: billing.billedAttempts,
      totalCost: billing.cost,
      totalTokens: billing.tokens,
      ...(billing.details ?? {}),
      fullCredits: billing.credits,
    },
  });
}
