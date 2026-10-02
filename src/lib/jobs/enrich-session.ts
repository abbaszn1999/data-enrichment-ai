import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase-admin";
import { createCheckpointGate, ENRICH_CHECKPOINT } from "./checkpoint";
import {
  CATALOG_HEARTBEAT_INTERVAL_MS,
  ENRICH_ROW_TIMEOUT_SECONDS,
  IMAGE_FINDER_ROW_TIMEOUT_SECONDS,
  JOB_BATCH_SIZE,
} from "./config";
import { withRowBackstop } from "./row-backstop";
import {
  catalogPendingRowIds,
  chargeCatalogRow,
  processCatalogRow,
  PROVIDER_UNAVAILABLE_JOB_ERROR,
  type CatalogRowContext,
  type EnrichRowOutcome,
} from "./enrich-row";
import { isImageFinderRun } from "@/lib/enrich/image-finder/agent";
import { PRODUCT_MODE_COLUMN_IDS } from "@/types";
import { rowsNeedingRecheck, SheetDomainLearner } from "@/lib/enrich/image-finder/sheet-learning";
import { runJobWithFailureGuard } from "./guard";
import { notifyJobEvent } from "./notify";
import {
  finishJobRun,
  loadJobRun,
  markJobRunning,
  readJobControl,
  touchJobHeartbeat,
  type JobControl,
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

/**
 * Retries a write that records a finished row or its charge. These only ever
 * run after OpenAI has billed the row, so a transient database blip must not
 * turn into paid-for work that was never saved or never charged.
 */
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        console.warn(`[jobs/catalog] ${label} failed; retrying`, {
          attempt,
          message: error instanceof Error ? error.message : String(error),
        });
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
  }
  throw lastError;
}

export type CatalogProcessRow = (
  rowId: string,
  context: CatalogRowContext & { imageFinder: boolean }
) => Promise<EnrichRowOutcome>;

export async function runEnrichSession(
  runId: string,
  options?: { processRow?: CatalogProcessRow }
): Promise<void> {
  // Every orchestrator start (first dispatch, Render retry, or a resume after
  // a dead heartbeat) owns the run under a fresh token; see readJobControl.
  const workerToken = randomUUID();
  await runJobWithFailureGuard(
    runId,
    () => runEnrichSessionInner(runId, workerToken, options),
    { workerToken }
  );
}

async function runEnrichSessionInner(
  runId: string,
  workerToken: string,
  options?: { processRow?: CatalogProcessRow }
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
  if (run.status !== "queued" && run.status !== "running") return;

  await markJobRunning(admin, run.id, null, workerToken);

  // Keeps the heartbeat fresh however long a single row takes, so a stale
  // heartbeat reliably means this process is gone (see catalog-recovery.ts).
  const pinger = setInterval(() => {
    void touchJobHeartbeat(admin, run.id, undefined, workerToken).catch((error) =>
      console.error("[jobs/catalog] heartbeat ping failed", run.id, error)
    );
  }, CATALOG_HEARTBEAT_INTERVAL_MS);
  (pinger as { unref?: () => void }).unref?.();

  try {
    await runCatalogWork(admin, run, workerToken, options);
  } finally {
    clearInterval(pinger);
  }
}

async function runCatalogWork(
  admin: ReturnType<typeof createAdminClient>,
  run: NonNullable<Awaited<ReturnType<typeof loadJobRun>>>,
  workerToken: string,
  options?: { processRow?: CatalogProcessRow }
): Promise<void> {
  const settings = run.settings as CatalogJobSettings;
  const project = await loadProjectJsonAdmin(run.workspace_id, run.session_id, admin);
  if (!project) {
    const failed = await finishJobRun(
      admin,
      run.id,
      {
        status: "failed",
        completedCount: 0,
        failedCount: run.target_ids.length,
        lastError: "Project data not found",
      },
      { workerToken, onlyIfActive: true }
    );
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
  // Rows this run already finished. Recorded right after each row is saved
  // (see commit), so a resume never processes — or has OpenAI bill — a
  // finished row a second time.
  const processed = new Set(
    (Array.isArray(settings.processedRowIds) ? settings.processedRowIds : []).map(String)
  );
  const pending = catalogPendingRowIds(
    collapseToPrimaryRowIds(run.target_ids, project.rows, groupColumn),
    project.rows,
    [...processed]
  );

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
  // Another orchestrator now owns this run: leave it completely alone.
  let superseded = false;
  // An unrecoverable write failure; the run ends as failed after in-flight rows drain.
  let fatalError: string | null = null;
  // Our AI provider account is out of quota: every remaining row would fail the
  // same way, so stop and leave them pending rather than marking them errors.
  let providerUnavailable = false;
  const gate = createCheckpointGate(ENRICH_CHECKPOINT);
  const rowStore = catalogRowStoreEnabled();

  const readControl = async (): Promise<JobControl> => {
    try {
      const control = await readJobControl(admin, run.id, workerToken);
      if (control.superseded) superseded = true;
      if (control.stop) stopObserved = true;
      return control;
    } catch (error) {
      // A failed read is not a Stop: keep working and check again next row.
      console.warn("[jobs/catalog] control read failed", run.id, error);
      return { stop: false, superseded: false };
    }
  };
  const shouldHalt = () => stopObserved || superseded || pausedNoCredits || providerUnavailable || fatalError !== null;

  // Image Finder: websites that verified this sheet's products guide later
  // rows. The final re-check of Not-found rows is billed under its own
  // `:recheck` key and runs the same agent again (see image-finder/agent.ts).
  const imageFinder = isImageFinderRun(settings.kind ?? "product", settings.enabledColumns);
  const imageFinderRecheckEnabled = imageFinder;
  const learner = imageFinder
    ? SheetDomainLearner.fromRows(project.rows.filter((row) => row.status === "done"))
    : null;
  const domainsTriedByRow = new Map<string, string[]>();

  /**
   * One row, isolated: a row that throws (a Render row task that exhausted its
   * retries, a network error) becomes a failed row instead of taking the whole
   * run — and every other in-flight row — down with it.
   */
  const rowTimeoutMs =
    (imageFinder ? IMAGE_FINDER_ROW_TIMEOUT_SECONDS : ENRICH_ROW_TIMEOUT_SECONDS) * 1000;
  const runRow = async (rowId: string, context: CatalogRowContext): Promise<EnrichRowOutcome> => {
    const work = async (): Promise<EnrichRowOutcome> => {
      if (options?.processRow) return options.processRow(rowId, { ...context, imageFinder });
      const row = byId.get(rowId);
      if (!row) return { ok: false as const, rowId, error: "Row not found" };
      return processCatalogRow({
        sessionId: run.session_id,
        workspaceId: run.workspace_id,
        row,
        settings,
        // Stop lets the in-flight row finish with a result; it only prevents
        // new attempts and new research rounds.
        shouldCancel: async () => {
          const control = await readControl();
          return control.stop || control.superseded;
        },
        context,
      });
    };
    try {
      return await withRowBackstop(work(), rowTimeoutMs, () => {
        console.error("[jobs/catalog] row timed out", { runId: run.id, rowId, rowTimeoutMs });
        return {
          ok: false as const,
          rowId,
          error: "This row took too long and was skipped. Run it again to retry.",
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Row processing failed";
      console.error("[jobs/catalog] row crashed", { runId: run.id, rowId, message });
      return { ok: false as const, rowId, error: message };
    }
  };

  /**
   * Charges exactly what OpenAI billed for this row: the full cost of a
   * result, or — for a row that failed or was stopped — the calls already
   * billed before it ended. Returns null when there is nothing to charge.
   * Idempotent per run and row, so a retry never double-charges.
   */
  const chargeRow = async (outcome: EnrichRowOutcome, recheck: boolean) => {
    const usage = outcome.ok ? outcome : outcome.billed;
    if (!usage) return null;
    try {
      return await withRetry("charge", () =>
        chargeCatalogRow({
          runId: run.id,
          sessionId: run.session_id,
          workspaceId: run.workspace_id,
          rowId: outcome.rowId,
          rowIndex: byId.get(outcome.rowId)?.rowIndex ?? 0,
          credits: usage.credits,
          cost: usage.cost,
          tokens: usage.tokens,
          billedAttempts: usage.billedAttempts,
          details: usage.details,
          settings,
          recheck,
          ...(outcome.ok ? {} : { unfinished: true }),
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Credit deduction failed";
      console.error("[jobs/catalog] charge failed after retries", { runId: run.id, rowId: outcome.rowId, message });
      return { ok: false as const, noCredits: false, error: `Could not record the charge: ${message}` };
    }
  };

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
    await touchJobHeartbeat(admin, run.id, { completed, failed, settings }, workerToken);
    gate.markFlushed();
  };

  // Serialize mutations. Hot state (row data + this run's processed list and
  // counts) is written for every finished row; the full project.json blob
  // flushes on the checkpoint budget and on terminal states.
  let writeQueue: Promise<void> = Promise.resolve();
  const commit = (mutate: () => string[]): Promise<void> => {
    const operation = writeQueue.then(async () => {
      const patchedRowIds = mutate();
      if (patchedRowIds.length > 0 && rowStore) {
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
          await withRetry("row save", () => patchCatalogSessionRows(admin, run.session_id, patches));
        }
      }
      gate.noteCompletedRow();
      if (rowStore) {
        // Row data is already durable in catalog_session_rows, so this run's
        // processed list can be recorded with it — that is what the progress
        // bar counts and what a resume skips.
        settings.processedRowIds = [...processed];
        await withRetry("progress save", () =>
          touchJobHeartbeat(admin, run.id, { completed, failed, settings }, workerToken)
        );
      } else {
        await withRetry("progress save", () =>
          touchJobHeartbeat(admin, run.id, { completed, failed }, workerToken)
        );
      }
      if (gate.shouldFlush()) await persistCold();
    });
    writeQueue = operation.catch(() => undefined);
    return operation;
  };

  const commitOrFail = async (mutate: () => string[]) => {
    try {
      await commit(mutate);
    } catch (error) {
      fatalError = `Could not save results: ${error instanceof Error ? error.message : String(error)}`;
      console.error("[jobs/catalog] commit failed after retries", { runId: run.id, fatalError });
    }
  };

  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      if (shouldHalt()) return;
      await readControl();
      if (shouldHalt()) return;
      const index = nextIndex;
      nextIndex += 1;
      if (index >= pending.length) return;
      const rowId = pending[index]!;

      const learnedDomains = learner?.top() ?? [];
      domainsTriedByRow.set(rowId, learnedDomains);
      const outcome = await runRow(rowId, learnedDomains.length > 0 ? { learnedDomains } : {});
      // A worker that lost the run still charges what OpenAI billed for its
      // row (idempotent per run and row), but writes nothing else.
      const charged = await chargeRow(outcome, false);
      if (superseded) return;

      await commitOrFail(() => {
        const row = byId.get(outcome.rowId);
        if (!row) {
          processed.add(outcome.rowId);
          return [outcome.rowId];
        }
        if (!outcome.ok) {
          // AI work already billed was charged above; the customer is out of credits.
          if ((charged && !charged.ok && charged.noCredits) || (charged?.ok && charged.outOfCredits)) {
            pausedNoCredits = true;
            stopObserved = true;
          }
          if (outcome.cancelled) {
            // Stop was clicked mid-row: leave it pending (not processed, not
            // failed) so a future run picks it up, exactly like the
            // out-of-credits pause below.
            stopObserved = true;
            return [];
          }
          if (outcome.providerUnavailable) {
            providerUnavailable = true;
            return [];
          }
          row.status = "error";
          row.errorMessage = outcome.billed && charged?.ok
            ? `${outcome.error} (${outcome.billed.credits} credits charged for the AI work already done)`
            : outcome.error;
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
        // Image Finder ran out of credits on this row: what was left of the
        // balance was taken and the finished result is kept below; the run
        // pauses so the remaining rows wait for a top-up.
        if (charged?.ok && charged.outOfCredits) {
          pausedNoCredits = true;
          stopObserved = true;
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
      if (learner && outcome.ok && (!charged || charged.ok)) learner.addRow(outcome.data);
    }
  };

  const workerCount = Math.min(JOB_BATCH_SIZE, pending.length || 1);
  if (pending.length > 0) {
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  }
  await writeQueue.catch(() => undefined);

  if (imageFinderRecheckEnabled && learner && !shouldHalt()) {
    await recheckNotFoundRows();
    await writeQueue.catch(() => undefined);
  }

  async function recheckNotFoundRows(): Promise<void> {
    const rechecked = new Set((settings.recheckedRowIds ?? []).map(String));
    const learnedDomains = learner!.top();
    const candidates = rowsNeedingRecheck({
      rows: project!.rows,
      targetIds: collapseToPrimaryRowIds(run.target_ids, project!.rows, groupColumn),
      rechecked,
      learnedDomains,
      domainsTriedByRow,
    });
    if (candidates.length === 0) return;
    console.log("[jobs/catalog] Image Finder final re-check", { rows: candidates.length, learnedDomains });

    let next = 0;
    const recheckWorker = async () => {
      while (!shouldHalt()) {
        await readControl();
        if (shouldHalt()) return;
        const index = next;
        next += 1;
        if (index >= candidates.length) return;
        const rowId = candidates[index]!;
        rechecked.add(rowId);
        settings.recheckedRowIds = [...rechecked];

        const outcome = await runRow(rowId, { learnedDomains, recheck: true });
        const charged = await chargeRow(outcome, true);
        if (superseded) return;
        if ((charged && !charged.ok && charged.noCredits) || (charged?.ok && charged.outOfCredits)) {
          pausedNoCredits = true;
        }
        if (!outcome.ok) {
          // A failed re-check keeps the first pass's Not-found result.
          if (outcome.cancelled) stopObserved = true;
          if (outcome.providerUnavailable) providerUnavailable = true;
          continue;
        }
        if (charged && !charged.ok) continue;
        // A re-check that still found nothing keeps the first pass's Not-found
        // note, which lists what every tier tried; it is charged either way.
        const recheckImages = outcome.data[PRODUCT_MODE_COLUMN_IDS.images];
        if (!Array.isArray(recheckImages) || recheckImages.length === 0) continue;
        await commitOrFail(() => {
          const row = byId.get(rowId);
          if (!row) return [];
          const split = splitEnriched(outcome.data);
          row.enrichedData = { ...(row.enrichedData ?? {}), ...split.enriched };
          return [rowId, ...applyPrimaryEnrichmentToGroup(project!.rows, rowId, groupColumn)];
        });
        learner!.addRow(outcome.data);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(JOB_BATCH_SIZE, candidates.length) }, () => recheckWorker())
    );
  }

  // Superseded: the new owner resumes from what this worker already saved;
  // writing the blob or a final status here would clobber its work.
  if (superseded) {
    console.warn("[jobs/catalog] run taken over by another orchestrator; exiting", run.id);
    return;
  }

  // Always flush drained in-flight rows before finishing — Stop must not
  // discard AI replies that were already charged.
  await withRetry("final save", persistCold);

  const finish = (params: Parameters<typeof finishJobRun>[2]) =>
    finishJobRun(admin, run.id, params, { workerToken, onlyIfActive: true });

  if (fatalError) {
    const crashed = await finish({
      status: "failed",
      completedCount: completed,
      failedCount: failed,
      lastError: fatalError,
    });
    if (crashed) await notifyJobEvent(crashed, "failed", admin);
    return;
  }

  if (pausedNoCredits) {
    const paused = await finish({
      status: "paused_no_credits",
      completedCount: completed,
      failedCount: failed,
      lastError: "Out of credits",
    });
    if (paused) await notifyJobEvent(paused, "paused_no_credits", admin);
    return;
  }

  const enrichedCount = project.rows.filter((row) => row.status === "done").length;
  const markSessionCompleted = () =>
    admin
      .from("catalog_sessions")
      .update({
        enriched_count: enrichedCount,
        status: "completed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", run.session_id)
      .eq("workspace_id", run.workspace_id);

  if (providerUnavailable) {
    await markSessionCompleted();
    const stopped = await finish({
      status: "failed",
      completedCount: completed,
      failedCount: failed,
      lastError: PROVIDER_UNAVAILABLE_JOB_ERROR,
    });
    if (stopped) await notifyJobEvent(stopped, "failed", admin);
    return;
  }

  if (stopObserved || (await readControl()).stop) {
    await markSessionCompleted();
    await finish({
      status: "cancelled",
      completedCount: completed,
      failedCount: failed,
    });
    return;
  }

  await markSessionCompleted();
  const finished = await finish({
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
