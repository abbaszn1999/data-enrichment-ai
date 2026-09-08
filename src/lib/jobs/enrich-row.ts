import { sumCosts } from "@/lib/ai-pricing";
import { enrichRow, type EnrichSettings } from "@/lib/enrich";
import {
  resolveEnrichmentModel,
  type CategoryItem,
  type ContentLength,
  type EnrichmentColumnType,
  type WritingTone,
} from "@/types";
import { createAdminClient } from "@/lib/supabase-admin";
import { deductCreditsIdempotent, isInsufficientCredits } from "./credits";
import { JOB_ROW_ATTEMPTS } from "./config";
import { loadProjectJsonAdmin } from "./project-json";
import { loadJobRun } from "./repo";
import type { CatalogJobSettings } from "./types";
import type { ProjectRow } from "@/lib/storage-helpers";

const MAX_FIELD_CHARS = 800;

export type EnrichRowOutcome =
  | {
      ok: true;
      rowId: string;
      data: Record<string, unknown>;
      originalPatches: Record<string, string>;
      credits: number;
      cost: number;
      tokens: number;
    }
  | {
      ok: false;
      rowId: string;
      error: string;
      noCredits?: boolean;
    };

export function catalogCreditIdempotencyKey(runId: string, rowId: string): string {
  return `catalog_intelligence:${runId}:${rowId}`;
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

export function buildRowSourceData(
  row: ProjectRow,
  sourceColumns: string[],
  enrichmentColumnIds: Set<string>
): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const col of sourceColumns) {
    if (enrichmentColumnIds.has(col)) {
      const val = row.enrichedData?.[col];
      if (val !== undefined && val !== null && val !== "") {
        if (Array.isArray(val)) {
          filtered[col] = val
            .map((item) =>
              typeof item === "object" && item !== null
                ? String(
                    (item as { uri?: string; imageUrl?: string; pageUrl?: string; title?: string }).uri ||
                      (item as { imageUrl?: string }).imageUrl ||
                      (item as { pageUrl?: string }).pageUrl ||
                      (item as { title?: string }).title ||
                      JSON.stringify(item)
                  )
                : String(item)
            )
            .join(", ");
        } else {
          filtered[col] = String(val);
        }
      }
    } else if (row.originalData[col] !== undefined) {
      filtered[col] = row.originalData[col];
    }
    if (filtered[col] && filtered[col].length > MAX_FIELD_CHARS) {
      filtered[col] = filtered[col].slice(0, MAX_FIELD_CHARS);
    }
  }
  return filtered;
}

export async function processCatalogRow(params: {
  sessionId: string;
  workspaceId: string;
  row: ProjectRow;
  settings: CatalogJobSettings;
}): Promise<EnrichRowOutcome> {
  const { row, settings } = params;
  const enrichSettings: EnrichSettings = {
    enrichmentModel: resolveEnrichmentModel(settings.enrichmentModel),
    outputLanguage: settings.outputLanguage || "English",
  };
  const enrichmentColumnIds = new Set(settings.enrichmentColumns.map((c) => c.id));
  const productData = buildRowSourceData(row, settings.sourceColumns, enrichmentColumnIds);

  let lastError = "Enrichment failed";
  for (let attempt = 1; attempt <= JOB_ROW_ATTEMPTS; attempt += 1) {
    try {
      const enriched = await enrichRow({
        productData,
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
          itemCount: c.itemCount,
          maxChars: c.maxChars,
          customInstruction: c.customInstruction,
          writingTone: c.writingTone as WritingTone | undefined,
          contentLength: c.contentLength as ContentLength | undefined,
        })),
        settings: enrichSettings,
        kind: settings.kind,
        cmsType: settings.cmsType,
        workspaceCategories: settings.workspaceCategories as CategoryItem[] | undefined,
        categoriesRawRows: settings.categoriesRawRows,
      });
      const costs = sumCosts(enriched.costs);
      return {
        ok: true,
        rowId: row.id,
        data: enriched.data as Record<string, unknown>,
        originalPatches: {},
        credits: costs.totalCredits,
        cost: costs.totalCost,
        tokens: costs.totalTokens,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Enrichment failed";
      if (attempt < JOB_ROW_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  return { ok: false, rowId: row.id, error: lastError };
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
  settings: CatalogJobSettings;
}): Promise<{ ok: true; remaining?: number } | { ok: false; noCredits: boolean; error: string }> {
  if (params.credits <= 0) return { ok: true };
  const result = await deductCreditsIdempotent({
    ownerUserId: params.settings.ownerUserId,
    workspaceId: params.workspaceId,
    actorUserId: params.settings.actorUserId,
    amount: params.credits,
    operation: "catalog_intelligence",
    entityType: params.settings.kind === "plp" ? "catalog_plp_row" : "catalog_row",
    entityId: params.rowId,
    idempotencyKey: catalogCreditIdempotencyKey(params.runId, params.rowId),
    details: {
      sessionId: params.sessionId,
      rowIndex: params.rowIndex,
      enrichmentModel: params.settings.enrichmentModel,
      totalCost: params.cost,
      totalTokens: params.tokens,
    },
  });
  if (!result.success) {
    return {
      ok: false,
      noCredits: isInsufficientCredits(result.error),
      error: result.error || "Credit deduction failed",
    };
  }
  return { ok: true, remaining: result.remaining };
}

export type CatalogRowTaskInput = {
  runId: string;
  rowId: string;
};

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
  });
}
