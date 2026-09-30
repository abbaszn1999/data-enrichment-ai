import { NextRequest, NextResponse } from "next/server";
import { withAiWalletBilling } from "@/lib/billing/ai-wallet-billing";
import {
  jsonError,
  requireFaWrite,
  workspaceIdSchema,
  projectIdSchema,
} from "@/lib/free-assessment/api-schema";
import { loadActiveJobForSession, loadJobRun, startOrReuseJobRun } from "@/lib/jobs/repo";
import { dispatchJob } from "@/lib/jobs/dispatch";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const workspaceId = workspaceIdSchema.safeParse(
    request.nextUrl.searchParams.get("workspaceId")
  );
  const projectId = projectIdSchema.safeParse(
    request.nextUrl.searchParams.get("projectId")
  );
  if (!workspaceId.success || !projectId.success) {
    return jsonError("Invalid classify status query", 400);
  }
  const auth = await requireFaWrite(workspaceId.data);
  if (!auth.ok) return auth.response;
  const jobId = request.nextUrl.searchParams.get("jobId");
  const job = jobId
    ? await loadJobRun(auth.admin, jobId)
    : await loadActiveJobForSession(auth.admin, {
        kind: "fa_classify",
        sessionId: projectId.data,
        workspaceId: workspaceId.data,
      });
  if (!job) {
    return NextResponse.json({ pending: false, status: "idle" }, { headers: auth.headers });
  }
  const total = Number(job.settings.total ?? 0);
  return NextResponse.json(
    {
      jobId: job.id,
      pending: job.status === "queued" || job.status === "running",
      status: job.status,
      phase: job.settings.phase === "same-intent" ? "same-intent" : "classify",
      done: job.completed_count,
      total,
      error: job.last_error,
    },
    { headers: auth.headers }
  );
}

async function handlePost(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }
  const body = json as { workspaceId?: string; projectId?: string };
  const workspaceId = workspaceIdSchema.safeParse(body.workspaceId);
  const projectId = projectIdSchema.safeParse(body.projectId);
  if (!workspaceId.success || !projectId.success) {
    return jsonError("Invalid classify job", 400);
  }
  const auth = await requireFaWrite(workspaceId.data);
  if (!auth.ok) return auth.response;
  const { job, reused } = await startOrReuseJobRun(auth.admin, {
    workspaceId: workspaceId.data,
    kind: "fa_classify",
    sessionId: projectId.data,
    createdBy: auth.user.id,
    targetIds: [],
    settings: { projectId: projectId.data, phase: "classify", total: 0 },
  });
  if (!reused) await dispatchJob(job.id, "fa_classify");
  return NextResponse.json({ jobId: job.id }, { headers: auth.headers });
}

export const POST = withAiWalletBilling("free-assessment", "fa_classify_job", handlePost);
