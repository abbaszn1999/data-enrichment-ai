import { createAdminClient } from "@/lib/supabase-admin";
import { JOB_BATCH_SIZE } from "./config";
import {
  catalogPendingRowIds,
  chargeCatalogRow,
  processCatalogRow,
  type EnrichRowOutcome,
} from "./enrich-row";
import { runJobWithFailureGuard } from "./guard";
import { notifyJobEvent } from "./notify";
import {
  finishJobRun,
  isJobCancelRequested,
  loadJobRun,
  markJobRunning,
  touchJobHeartbeat,
} from "./repo";
import {
  loadProjectJsonAdmin,
  saveProjectJsonAdmin,
} from "./project-json";
import type { CatalogJobSettings } from "./types";
import type { ProjectRow } from "@/lib/storage-helpers";

function splitEnriched(data: Record<string, unknown>): {
  enriched: Record<string, unknown>;
  originalPatches: Record<string, string>;
} {
  const enriched: Record<string, unknown> = {};
  const originalPatches: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith("existing__")) {
      originalPatches[key.replace("existing__", "")] = String(value ?? "");
    } else {
      enriched[key] = value;
    }
  }
  return { enriched, originalPatches };
}

export async function runEnrichSession(
  runId: string,
  options?: { processRow?: (rowId: string) => Promise<EnrichRowOutcome> }
): Promise<void> {
  await runJobWithFailureGuard(runId, () => runEnrichSessionInner(runId, options));
}

async function runEnrichSessionInner(
  runId: string,
  options?: { processRow?: (rowId: string) => Promise<EnrichRowOutcome> }
): Promise<void> {
  const admin = createAdminClient();
  const run = await loadJobRun(admin, runId);
  if (!run) {
    console.error("[jobs/catalog] missing run", runId);
    return;
  }
  if (run.kind !== "catalog") {
    console.error("[jobs/catalog] wrong kind", run.kind);
    return;
  }
  if (run.status === "cancelled") return;

  await markJobRunning(admin, run.id);
  const settings = run.settings as CatalogJobSettings;
  const project = await loadProjectJsonAdmin(run.workspace_id, run.session_id, admin);
  if (!project) {
    const failed = await finishJobRun(admin, run.id, {
      status: "failed",
      completedCount: 0,
      failedCount: run.target_ids.length,
      lastError: "Project data not found",
    });
    if (failed) await notifyJobEvent(failed, "failed", admin);
    return;
  }

  const byId = new Map(project.rows.map((row) => [row.id, row]));
  const processed = new Set(
    (Array.isArray(settings.processedRowIds) ? settings.processedRowIds : []).map(String)
  );
  const pending = catalogPendingRowIds(run.target_ids, project.rows, [...processed]);

  let completed = run.completed_count;
  let failed = run.failed_count;
  let pausedNoCredits = false;

  for (let i = 0; i < pending.length; i += JOB_BATCH_SIZE) {
    if (await isJobCancelRequested(admin, run.id)) {
      const cancelled = await finishJobRun(admin, run.id, {
        status: "cancelled",
        completedCount: completed,
        failedCount: failed,
      });
      void cancelled;
      return;
    }

    const batchIds = pending.slice(i, i + JOB_BATCH_SIZE);
    const outcomes = await Promise.all(
      batchIds.map((id) => {
        if (options?.processRow) return options.processRow(id);
        const row = byId.get(id);
        if (!row) {
          return Promise.resolve({
            ok: false as const,
            rowId: id,
            error: "Row not found",
          });
        }
        return processCatalogRow({
          sessionId: run.session_id,
          workspaceId: run.workspace_id,
          row,
          settings,
        });
      })
    );

    const persisted: ProjectRow[] = [];
    for (const outcome of outcomes) {
      const row = byId.get(outcome.rowId);
      if (!row) continue;
      if (!outcome.ok) {
        row.status = "error";
        row.errorMessage = outcome.error;
        failed += 1;
        persisted.push(row);
        continue;
      }
      const split = splitEnriched(outcome.data);
      if (Object.keys(split.originalPatches).length > 0) {
        row.originalData = { ...row.originalData, ...split.originalPatches };
      }
      if (Object.keys(split.enriched).length > 0) {
        row.enrichedData = { ...(row.enrichedData ?? {}), ...split.enriched };
      }
      row.status = "done";
      row.errorMessage = undefined;
      persisted.push(row);
    }

    await saveProjectJsonAdmin(run.workspace_id, run.session_id, project, admin);

    for (const outcome of outcomes) {
      processed.add(outcome.rowId);
      if (!outcome.ok) continue;
      const charged = await chargeCatalogRow({
        runId: run.id,
        sessionId: run.session_id,
        workspaceId: run.workspace_id,
        rowId: outcome.rowId,
        rowIndex: byId.get(outcome.rowId)?.rowIndex ?? 0,
        credits: outcome.credits,
        cost: outcome.cost,
        tokens: outcome.tokens,
        settings,
      });
      if (!charged.ok && charged.noCredits) {
        pausedNoCredits = true;
        break;
      }
      completed += 1;
    }

    settings.processedRowIds = [...processed];

    const enrichedCount = project.rows.filter((row) => row.status === "done").length;
    await admin
      .from("import_sessions")
      .update({
        enriched_count: enrichedCount,
        status: "enriching",
        updated_at: new Date().toISOString(),
      })
      .eq("id", run.session_id)
      .eq("workspace_id", run.workspace_id);

    await touchJobHeartbeat(admin, run.id, {
      completed,
      failed,
      settings,
    });

    if (pausedNoCredits) {
      const paused = await finishJobRun(admin, run.id, {
        status: "paused_no_credits",
        completedCount: completed,
        failedCount: failed,
        lastError: "Out of credits",
      });
      if (paused) await notifyJobEvent(paused, "paused_no_credits", admin);
      return;
    }
  }

  if (await isJobCancelRequested(admin, run.id)) {
    await finishJobRun(admin, run.id, {
      status: "cancelled",
      completedCount: completed,
      failedCount: failed,
    });
    return;
  }

  const enrichedCount = project.rows.filter((row) => row.status === "done").length;
  await admin
    .from("import_sessions")
    .update({
      enriched_count: enrichedCount,
      status: "completed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", run.session_id)
    .eq("workspace_id", run.workspace_id);

  const finished = await finishJobRun(admin, run.id, {
    status: failed > 0 && completed === 0 ? "failed" : "completed",
    completedCount: completed,
    failedCount: failed,
    lastError: failed > 0 && completed === 0 ? "All selected rows failed" : null,
  });
  if (finished) {
    await notifyJobEvent(
      finished,
      finished.status === "failed" ? "failed" : "completed",
      admin
    );
  }
}
