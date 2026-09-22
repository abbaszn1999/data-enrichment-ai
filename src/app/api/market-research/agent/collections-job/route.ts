import { NextRequest, NextResponse } from "next/server";
import {
  jsonError,
  requireMrWrite,
  workspaceIdSchema,
  projectIdSchema,
} from "@/lib/market-research/api-schema";
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
    return jsonError("Invalid collections status query", 400);
  }
  const auth = await requireMrWrite(workspaceId.data);
  if (!auth.ok) return auth.response;
  const jobId = request.nextUrl.searchParams.get("jobId");
  const job = jobId
    ? await loadJobRun(auth.admin, jobId)
    : await loadActiveJobForSession(auth.admin, {
        kind: "mr_collections",
        sessionId: projectId.data,
        workspaceId: workspaceId.data,
      });
  if (!job || job.status === "completed") {
    return NextResponse.json({ pending: false, status: "completed" }, { headers: auth.headers });
  }
  if (job.status === "failed") {
    return jsonError(job.last_error || "Collection matching failed", 500);
  }
  return NextResponse.json(
    {
      pending: true,
      status: job.status,
      done: job.completed_count,
      total: Number(job.settings.total ?? 0),
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
  const body = json as { workspaceId?: string; projectId?: string; filters?: unknown };
  const workspaceId = workspaceIdSchema.safeParse(body.workspaceId);
  const projectId = projectIdSchema.safeParse(body.projectId);
  if (!workspaceId.success || !projectId.success) {
    return jsonError("Invalid collections job", 400);
  }
  const auth = await requireMrWrite(workspaceId.data);
  if (!auth.ok) return auth.response;
  const existing = await loadActiveJobForSession(auth.admin, {
    kind: "mr_collections",
    sessionId: projectId.data,
    workspaceId: workspaceId.data,
  });
  if (existing) {
    return NextResponse.json({ jobId: existing.id }, { headers: auth.headers });
  }
  const job = await insertJobRun(auth.admin, {
    workspaceId: workspaceId.data,
    kind: "mr_collections",
    sessionId: projectId.data,
    createdBy: auth.user.id,
    targetIds: [],
    settings: { projectId: projectId.data, filters: body.filters ?? {}, total: 0 },
  });
  await dispatchJob(job.id, "mr_collections");
  return NextResponse.json({ jobId: job.id }, { headers: auth.headers });
}
