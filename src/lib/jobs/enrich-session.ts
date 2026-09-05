import { createAdminClient } from "@/lib/supabase-admin";
import { createCheckpointGate, ENRICH_CHECKPOINT } from "./checkpoint";
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
import { catalogRowStoreEnabled } from "@/lib/catalog/flag";
import { patchCatalogSessionRows } from "@/lib/catalog/session-rows";
import {
  applyPrimaryEnrichmentToGroup,
  collapseToPrimaryRowIds,
  resolveProductGroupColumn,
} from "@/lib/catalog/product-groups";
import type { CatalogJobSettings } from "./types";

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

  const groupColumn = resolveProductGroupColumn({
    saved: project.productGroupColumn,
    columns: project.columns,
    rows: project.rows,
    kind: settings.kind,
  });
  const byId = new Map(project.rows.map((row) => [row.id, row]));
  const processed = new Set(
    (Array.isArray(settings.processedRowIds) ? settings.processedRowIds : []).map(String)
  );
  const pending = catalogPendingRowIds(
    collapseToPrimaryRowIds(run.target_ids, project.rows, groupColumn),
    project.rows,
    [...processed]
  );

  // Durable progress is the last checkpointed blob + processedRowIds, not
  // whatever heartbeat counts happened to land before a crash.
  let completed = 0;
  let failed = 0;
  for (const rowId of processed) {
    const row = byId.get(rowId);
    if (!row) continue;
    if (row.status === "done") completed += 1;
    else if (row.status === "error") failed += 1;
  }
  let pausedNoCredits = false;
  let stopObserved = false;
  const gate = createCheckpointGate(ENRICH_CHECKPOINT);

  const persistCold = async () => {
    settings.processedRowIds = [...processed];
    const enrichedCount = project.rows.filter((row) => row.status === "done").length;
    await saveProjectJsonAdmin(run.workspace_id, run.session_id, project, admin);
    await admin
      .from("catalog_sessions")
      .update({
        enriched_count: enrichedCount,
        status: "enriching",
        updated_at: new Date().toISOString(),
      })
      .eq("id", run.session_id)
      .eq("workspace_id", run.workspace_id);
    await touchJobHeartbeat(admin, run.id, { completed, failed, settings });
    gate.markFlushed();
  };

  // Serialize mutations. Hot state is the session row + heartbeat; the full
  // project.json blob flushes on the checkpoint budget and on terminal states.
  let writeQueue: Promise<void> = Promise.resolve();
  const commit = (mutate: () => string[]): Promise<void> => {
    const operation = writeQueue.then(async () => {
      const patchedRowIds = mutate();
      if (patchedRowIds.length > 0 && catalogRowStoreEnabled()) {
        const patches = patchedRowIds
          .map((id) => byId.get(id))
          .filter((row): row is NonNullable<typeof row> => Boolean(row))
          .map((row) => ({
            id: row.id,
            status: row.status,
            errorMessage: row.errorMessage,
            originalData: row.originalData,
            enrichedData: row.enrichedData,
            matchType: row.matchType,
          }));
        if (patches.length > 0) {
          await patchCatalogSessionRows(admin, run.session_id, patches);
        }
      }
      gate.noteCompletedRow();
      await touchJobHeartbeat(admin, run.id, { completed, failed });
      if (gate.shouldFlush()) await persistCold();
    });
    writeQueue = operation.catch(() => undefined);
    return operation;
  };

  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      if (stopObserved) return;
      if (await isJobCancelRequested(admin, run.id)) {
        stopObserved = true;
        return;
      }
      const index = nextIndex;
      nextIndex += 1;
      if (index >= pending.length) return;
      const rowId = pending[index]!;

      const outcome = options?.processRow
        ? await options.processRow(rowId)
        : await (async () => {
            const row = byId.get(rowId);
            if (!row) {
              return {
                ok: false as const,
                rowId,
                error: "Row not found",
              };
            }
            return processCatalogRow({
              sessionId: run.session_id,
              workspaceId: run.workspace_id,
              row,
              settings,
            });
          })();

      let charged: Awaited<ReturnType<typeof chargeCatalogRow>> | null = null;
      if (outcome.ok) {
        charged = await chargeCatalogRow({
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
      }

      await commit(() => {
        const row = byId.get(outcome.rowId);
        if (!row) {
          processed.add(outcome.rowId);
          return [outcome.rowId];
        }
        if (!outcome.ok) {
          row.status = "error";
          row.errorMessage = outcome.error;
          failed += 1;
          processed.add(outcome.rowId);
          return [outcome.rowId];
        }
        if (charged && !charged.ok) {
          row.status = "error";
          row.errorMessage = charged.error;
          if (charged.noCredits) {
            // Do not mark as processed — a future run should retry this row
            // once credits are topped up.
            pausedNoCredits = true;
            stopObserved = true;
          } else {
            failed += 1;
            processed.add(outcome.rowId);
          }
          return [outcome.rowId];
        }
        processed.add(outcome.rowId);
        const split = splitEnriched(outcome.data);
        if (Object.keys(split.originalPatches).length > 0) {
          row.originalData = { ...row.originalData, ...split.originalPatches };
        }
        if (Object.keys(split.enriched).length > 0) {
          row.enrichedData = { ...(row.enrichedData ?? {}), ...split.enriched };
        }
        row.status = "done";
        row.errorMessage = undefined;
        completed += 1;
        const siblings = applyPrimaryEnrichmentToGroup(
          project.rows,
          outcome.rowId,
          groupColumn
        );
        return [outcome.rowId, ...siblings];
      });

      if (pausedNoCredits) return;
    }
  };

  const workerCount = Math.min(JOB_BATCH_SIZE, pending.length || 1);
  if (pending.length > 0) {
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  }
  await writeQueue.catch(() => undefined);
  // Always flush drained in-flight rows before finishing — Stop must not
  // discard AI replies that were already charged.
  await persistCold();

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

  if (await isJobCancelRequested(admin, run.id)) {
    const enrichedCount = project.rows.filter((row) => row.status === "done").length;
    await admin
      .from("catalog_sessions")
      .update({
        enriched_count: enrichedCount,
        status: "completed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", run.session_id)
      .eq("workspace_id", run.workspace_id);
    await finishJobRun(admin, run.id, {
      status: "cancelled",
      completedCount: completed,
      failedCount: failed,
    });
    return;
  }

  const enrichedCount = project.rows.filter((row) => row.status === "done").length;
  await admin
    .from("catalog_sessions")
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
