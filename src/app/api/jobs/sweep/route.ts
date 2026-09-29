import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { JOB_HEARTBEAT_STALE_MINUTES, JOB_SWEEP_LIMIT } from "@/lib/jobs/config";
import { dispatchJob } from "@/lib/jobs/dispatch";
import { notifyIfMissing } from "@/lib/jobs/notify";
import { claimStaleJobRuns, mapJobRun } from "@/lib/jobs/repo";
import { isTerminalJobStatus } from "@/lib/jobs/types";
import { CATALOG_WORKER_STALE_MS } from "@/lib/jobs/config";
import { recoverStaleCatalogRun } from "@/lib/jobs/catalog-recovery";
import { expireStaleHeldExtracts as expireStaleMrHeldExtracts } from "@/lib/market-research/extract-advance";
import { expireStaleHeldExtracts as expireStaleFaHeldExtracts } from "@/lib/free-assessment/extract-advance";
import { expireElapsedTrials } from "@/lib/trial-server";

import { cronSecretFromEnv, cronSecretMatches } from "@/lib/auth/cron-secret";

export const maxDuration = 60;

/**
 * Accepts the app env secret when set; otherwise verifies the bearer against
 * the Vault secret pg_cron sends (verify_jobs_cron_secret, service_role only),
 * so a missing env var can no longer silently switch off job recovery.
 */
async function authorized(request: NextRequest): Promise<boolean> {
  const secret = cronSecretFromEnv();
  if (secret) return cronSecretMatches(request, secret);
  const presented =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!presented) return false;
  const { data, error } = await createAdminClient().rpc("verify_jobs_cron_secret", {
    p_secret: presented,
  });
  if (error) {
    console.error("[jobs/sweep] secret verification failed", error.message);
    return false;
  }
  return data === true;
}

export async function POST(request: NextRequest) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Catalog orchestrators ping every 30s, so they can be recovered well
  // before the generic 10-minute threshold — including runs stuck queued
  // and runs where Stop was pressed after the worker had already died.
  let catalogRecovered = 0;
  const { data: catalogActive } = await admin
    .from("job_runs")
    .select("*")
    .eq("kind", "catalog")
    .in("status", ["queued", "running"])
    .lte("heartbeat_at", new Date(Date.now() - CATALOG_WORKER_STALE_MS).toISOString())
    .limit(JOB_SWEEP_LIMIT);
  for (const row of catalogActive ?? []) {
    try {
      const before = mapJobRun(row as Record<string, unknown>);
      // Returns the same object when the run is not actually dead (e.g. it is
      // waiting in Render's queue for a free slot).
      const after = await recoverStaleCatalogRun(admin, before);
      if (after !== before) catalogRecovered += 1;
    } catch (error) {
      console.error(
        "[jobs/sweep] catalog recovery failed",
        error instanceof Error ? error.message : error
      );
    }
  }

  const stale = await claimStaleJobRuns(
    admin,
    JOB_HEARTBEAT_STALE_MINUTES,
    JOB_SWEEP_LIMIT
  );

  const dispatched: string[] = [];
  for (const run of stale) {
    await dispatchJob(run.id, run.kind);
    dispatched.push(run.id);
  }

  const { data: terminal } = await admin
    .from("job_runs")
    .select("*")
    .in("status", ["completed", "failed", "paused_no_credits"])
    .gte("updated_at", new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
    .limit(50);

  let notified = 0;
  for (const row of terminal ?? []) {
    const run = mapJobRun(row as Record<string, unknown>);
    if (!isTerminalJobStatus(run.status) || run.status === "cancelled") continue;
    await notifyIfMissing(run, admin);
    notified += 1;
  }

  let expiredExtracts = 0;
  try {
    expiredExtracts = await expireStaleMrHeldExtracts(admin);
  } catch (error) {
    console.error(
      "[jobs/sweep] expire held mr extracts failed",
      error instanceof Error ? error.message : error
    );
  }

  let expiredFaExtracts = 0;
  try {
    expiredFaExtracts = await expireStaleFaHeldExtracts(admin);
  } catch (error) {
    console.error(
      "[jobs/sweep] expire held fa extracts failed",
      error instanceof Error ? error.message : error
    );
  }

  let expiredTrials = 0;
  try {
    expiredTrials = await expireElapsedTrials();
  } catch (error) {
    console.error(
      "[jobs/sweep] expire elapsed trials failed",
      error instanceof Error ? error.message : error
    );
  }

  return NextResponse.json({
    ok: true,
    catalogRecovered,
    dispatched: dispatched.length,
    ids: dispatched,
    notified,
    expiredExtracts,
    expiredFaExtracts,
    expiredTrials,
  });
}
