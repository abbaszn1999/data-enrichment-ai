import { NextRequest, NextResponse } from "next/server";
import { requireWrAuth } from "@/lib/website-restructure/auth";
import {
  createProjectBodySchema,
  jsonError,
  patchProjectBodySchema,
  projectRefBodySchema,
} from "@/lib/website-restructure/api-schema";
import { canAdvanceWrPhase, getWrProjectLimit } from "@/lib/website-restructure/types";
import {
  createWrProject,
  deleteWrProject,
  getWrProjectRow,
  loadWrProjects,
  releaseWrProjectSlot,
  renameWrProject,
  reserveWrProjectSlot,
  setWrProjectStatus,
} from "@/lib/website-restructure/server-persist";
import { loadIntegration } from "@/lib/growth-sync/repo";

// Forward-only wizard transitions a client may request explicitly (e.g. "I'm
// done uploading images" / "skip logo"). Anything else — including entry into
// "building" — is only ever set by build/chat routes, never by the client.
const CLIENT_ADVANCEABLE_PHASES = new Set(["awaiting_images", "awaiting_logo", "awaiting_competitors"]);

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = createProjectBodySchema.safeParse(json);
  if (!parsed.success) return jsonError("Invalid project payload", 400);

  const auth = await requireWrAuth({ workspaceId: parsed.data.workspaceId, requireWrite: true });
  if (!auth.ok) return auth.response;

  const planName = (auth.ctx.plan?.name as string | undefined) ?? null;
  const limit = getWrProjectLimit(planName);

  // Reserve the lifetime slot atomically before creating the row: this counts
  // every project the workspace has ever created, so deleting old ones never
  // frees up a new slot (see `wr_try_reserve_project_slot`).
  const reserved = await reserveWrProjectSlot(auth.admin, parsed.data.workspaceId, limit);
  if (!reserved) {
    return NextResponse.json(
      {
        error: `Your plan allows up to ${limit} Website Restructure project${limit === 1 ? "" : "s"} in total. Deleting an existing project won't free up a new slot — upgrade your plan to create more.`,
      },
      { status: 409, headers: auth.headers }
    );
  }

  try {
    const integration = await loadIntegration(auth.admin, parsed.data.workspaceId);
    const project = await createWrProject(auth.admin, {
      workspaceId: parsed.data.workspaceId,
      userId: auth.user.id,
      name: parsed.data.name,
      provider: integration?.provider ?? "",
    });
    return NextResponse.json({ project }, { status: 201, headers: auth.headers });
  } catch (error) {
    await releaseWrProjectSlot(auth.admin, parsed.data.workspaceId);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create project" },
      { status: 500, headers: auth.headers }
    );
  }
}

export async function DELETE(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = projectRefBodySchema.safeParse(json);
  if (!parsed.success) return jsonError("Invalid delete payload", 400);

  const auth = await requireWrAuth({
    workspaceId: parsed.data.workspaceId,
    requireWrite: true,
    requireAdmin: true,
  });
  if (!auth.ok) return auth.response;

  try {
    const deleted = await deleteWrProject(auth.admin, parsed.data.workspaceId, parsed.data.projectId);
    if (!deleted) return jsonError("Project not found", 404);
    return NextResponse.json({ ok: true }, { headers: auth.headers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete project" },
      { status: 500, headers: auth.headers }
    );
  }
}

export async function PATCH(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = patchProjectBodySchema.safeParse(json);
  if (!parsed.success) return jsonError("Invalid update payload", 400);

  const auth = await requireWrAuth({ workspaceId: parsed.data.workspaceId, requireWrite: true });
  if (!auth.ok) return auth.response;

  try {
    if (parsed.data.name) {
      await renameWrProject(auth.admin, parsed.data.workspaceId, parsed.data.projectId, parsed.data.name);
    }
    if (parsed.data.status) {
      await setWrProjectStatus(auth.admin, parsed.data.workspaceId, parsed.data.projectId, parsed.data.status);
    }
    if (parsed.data.phase) {
      if (!CLIENT_ADVANCEABLE_PHASES.has(parsed.data.phase)) {
        return jsonError("This phase cannot be set directly", 400);
      }
      const current = await getWrProjectRow(auth.admin, parsed.data.workspaceId, parsed.data.projectId);
      if (!current) return jsonError("Project not found", 404);
      if (!canAdvanceWrPhase(current.phase, parsed.data.phase)) {
        return jsonError(`Cannot move from ${current.phase} to ${parsed.data.phase}`, 409);
      }
      await auth.admin
        .from("wr_projects")
        .update({ phase: parsed.data.phase })
        .eq("workspace_id", parsed.data.workspaceId)
        .eq("id", parsed.data.projectId);
    }
    const project = await getWrProjectRow(auth.admin, parsed.data.workspaceId, parsed.data.projectId);
    if (!project) return jsonError("Project not found", 404);
    return NextResponse.json({ project }, { headers: auth.headers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update project" },
      { status: 500, headers: auth.headers }
    );
  }
}

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return jsonError("workspaceId is required", 400);

  const auth = await requireWrAuth({ workspaceId });
  if (!auth.ok) return auth.response;

  try {
    const projects = await loadWrProjects(auth.admin, workspaceId);
    return NextResponse.json({ projects }, { headers: auth.headers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load projects" },
      { status: 500, headers: auth.headers }
    );
  }
}
