import { NextRequest, NextResponse } from "next/server";
import {
  agentAnalyzeBodySchema,
  jsonError,
  requireMrWrite,
  workspaceIdSchema,
  projectIdSchema,
} from "@/lib/market-research/api-schema";
import { fetchStoreCatalog } from "@/lib/market-research/agent/store-catalog";
import { loadProjectSliceAdmin } from "@/lib/market-research/storage-admin";
import type { Stage1Checkpoint } from "@/lib/market-research/agent/stage1-niche-discovery";
import { loadActiveJobForSession, loadJobRun } from "@/lib/jobs/repo";

export const maxDuration = 300;

type NichesSlice = {
  niches: unknown[];
  structuredNiches: unknown[];
  excludedItems?: unknown[];
  agentConclusion?: string;
  isAiGenerated?: boolean;
};

export async function GET(request: NextRequest) {
  const workspaceId = workspaceIdSchema.safeParse(
    request.nextUrl.searchParams.get("workspaceId")
  );
  const projectId = projectIdSchema.safeParse(
    request.nextUrl.searchParams.get("projectId")
  );
  if (!workspaceId.success || !projectId.success) {
    return jsonError("Invalid analyze status query", 400);
  }
  const auth = await requireMrWrite(workspaceId.data);
  if (!auth.ok) return auth.response;

  const job = await loadActiveJobForSession(auth.admin, {
    kind: "mr_stage1",
    sessionId: projectId.data,
    workspaceId: workspaceId.data,
  });
  const niches = await loadProjectSliceAdmin<NichesSlice>(
    auth.admin,
    workspaceId.data,
    projectId.data,
    "niches"
  ).catch(() => null);

  if (job) {
    const checkpoint = await loadProjectSliceAdmin<Stage1Checkpoint>(
      auth.admin,
      workspaceId.data,
      projectId.data,
      "stage1-job"
    ).catch(() => null);
    const total = Math.max(checkpoint?.candidates.length ?? 1, 1);
    const done = checkpoint?.offset ?? 0;
    return NextResponse.json(
      {
        pending: true,
        jobId: job.id,
        status: job.status,
        progress: checkpoint?.tree ? Math.min(1, done / total) : 0.05,
      },
      { headers: auth.headers }
    );
  }

  const latestId = request.nextUrl.searchParams.get("jobId");
  if (latestId) {
    const finished = await loadJobRun(auth.admin, latestId);
    if (finished?.status === "failed") {
      return jsonError(finished.last_error || "Store analysis failed", 500);
    }
  }

  return NextResponse.json(
    {
      pending: false,
      niches: niches?.niches ?? [],
      structuredNiches: niches?.structuredNiches ?? [],
      excludedItems: niches?.excludedItems ?? [],
      agentConclusion: niches?.agentConclusion ?? "",
      beats: [],
      isAiGenerated: niches?.isAiGenerated ?? false,
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

  const parsed = agentAnalyzeBodySchema.safeParse(json);
  if (!parsed.success) {
    return jsonError("Invalid analyze payload", 400);
  }

  const auth = await requireMrWrite(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  if (!parsed.data.projectId) {
    return jsonError("A project is required to analyze the store", 400);
  }

  try {
    await fetchStoreCatalog(auth.admin, parsed.data.workspaceId);
    const existing = await loadActiveJobForSession(auth.admin, {
      kind: "mr_stage1",
      sessionId: parsed.data.projectId,
      workspaceId: parsed.data.workspaceId,
    });
    if (existing) {
      return NextResponse.json(
        { pending: true, jobId: existing.id },
        { headers: auth.headers }
      );
    }

    const { data: workspace } = await auth.admin
      .from("workspaces")
      .select("slug")
      .eq("id", parsed.data.workspaceId)
      .maybeSingle();
    const { insertJobRun } = await import("@/lib/jobs/repo");
    const { dispatchJob } = await import("@/lib/jobs/dispatch");
    const { removeProjectSliceAdmin } = await import("@/lib/market-research/storage-admin");
    // A new Analyze builds a new tree. The session also refuses a checkpoint
    // written by another job, so a failed delete cannot reuse the old tree.
    await removeProjectSliceAdmin(
      auth.admin,
      parsed.data.workspaceId,
      parsed.data.projectId,
      "stage1-job"
    ).catch((err) => console.error("[analyze] Failed to clear Tab 1 checkpoint:", err));
    const job = await insertJobRun(auth.admin, {
      workspaceId: parsed.data.workspaceId,
      kind: "mr_stage1",
      sessionId: parsed.data.projectId,
      createdBy: auth.user.id,
      targetIds: [],
      settings: {
        projectId: parsed.data.projectId,
        workspaceSlug: workspace?.slug,
      },
    });
    await dispatchJob(job.id, "mr_stage1");
    return NextResponse.json(
      { pending: true, jobId: job.id },
      { headers: auth.headers }
    );
  } catch (err) {
    console.error("[api/market-research/agent/analyze] Error:", err);
    const msg = err instanceof Error ? err.message : "Failed to analyze store";
    const status = msg.includes("No active store integration") ? 400 : 500;
    return jsonError(msg, status);
  }
}
