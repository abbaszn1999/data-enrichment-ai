import { NextRequest, NextResponse } from "next/server";
import {
  jsonError,
  requireFaWrite,
  workspaceIdSchema,
  projectIdSchema,
} from "@/lib/free-assessment/api-schema";
import { insertJobRun, loadActiveJobForSession, loadJobRun } from "@/lib/jobs/repo";
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
    return NextResponse.json({ pending: false, status: "completed" }, { headers: auth.headers });
  }
  const total = Number(job.settings.total ?? 0);
  return NextResponse.json(
    {
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

export async function POST(request: NextRequest) {
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
  const existing = await loadActiveJobForSession(auth.admin, {
    kind: "fa_classify",
    sessionId: projectId.data,
    workspaceId: workspaceId.data,
  });
  if (existing) {
    return NextResponse.json({ jobId: existing.id }, { headers: auth.headers });
  }
  const job = await insertJobRun(auth.admin, {
    workspaceId: workspaceId.data,
    kind: "fa_classify",
    sessionId: projectId.data,
    createdBy: auth.user.id,
    targetIds: [],
    settings: { projectId: projectId.data, phase: "classify", total: 0 },
  });
  await dispatchJob(job.id, "fa_classify");
  return NextResponse.json({ jobId: job.id }, { headers: auth.headers });
}
