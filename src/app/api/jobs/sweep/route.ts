import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { JOB_HEARTBEAT_STALE_MINUTES, JOB_SWEEP_LIMIT } from "@/lib/jobs/config";
import { dispatchJob } from "@/lib/jobs/dispatch";
import { notifyIfMissing } from "@/lib/jobs/notify";
import { claimStaleJobRuns, mapJobRun } from "@/lib/jobs/repo";
import { isTerminalJobStatus } from "@/lib/jobs/types";

import { cronSecretFromEnv, cronSecretMatches } from "@/lib/auth/cron-secret";

export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const secret = cronSecretFromEnv();
  if (!secret) return false;
  return cronSecretMatches(request, secret);
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    if (!cronSecretFromEnv()) {
      return NextResponse.json({ error: "Scheduler not configured" }, { status: 503 });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
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

  return NextResponse.json({
    ok: true,
    dispatched: dispatched.length,
    ids: dispatched,
    notified,
  });
}
