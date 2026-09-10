import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  jsonError,
  projectIdSchema,
  requireFaAdmin,
  requireFaWrite,
  workspaceIdSchema,
} from "@/lib/free-assessment/api-schema";
import { MAX_MARKET_RESEARCH_PROJECTS } from "@/components/free-assessment/mock-data";
import {
  createFaProjectRow,
  deleteFaProjectRow,
} from "@/lib/free-assessment/server-persist";

const bodySchema = z.object({
  workspaceId: workspaceIdSchema,
  name: z.string().min(1).max(120),
  storeLabel: z.string().max(200).optional(),
  highlightedCollectionIds: z.array(z.string().max(120)).max(50).optional(),
});

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return jsonError("Invalid project payload", 400);

  const auth = await requireFaWrite(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  const { count } = await auth.admin
    .from("fa_projects")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", parsed.data.workspaceId);
  if ((count ?? 0) >= MAX_MARKET_RESEARCH_PROJECTS) {
    return NextResponse.json(
      { error: `Limit of ${MAX_MARKET_RESEARCH_PROJECTS} projects reached` },
      { status: 409, headers: auth.headers }
    );
  }

  try {
    const project = await createFaProjectRow(auth.admin, {
      workspaceId: parsed.data.workspaceId,
      userId: auth.user.id,
      name: parsed.data.name,
      storeLabel: parsed.data.storeLabel || "Uploaded catalog",
      highlightedCollectionIds: parsed.data.highlightedCollectionIds ?? [],
    });
    return NextResponse.json({ project }, { status: 201, headers: auth.headers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create project" },
      { status: 500, headers: auth.headers }
    );
  }
}

const deleteBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
});

export async function DELETE(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = deleteBodySchema.safeParse(json);
  if (!parsed.success) return jsonError("Invalid delete payload", 400);

  const auth = await requireFaAdmin(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  try {
    const deleted = await deleteFaProjectRow(
      auth.admin,
      parsed.data.workspaceId,
      parsed.data.projectId
    );
    if (!deleted) return jsonError("Project not found", 404);
    return NextResponse.json({ ok: true }, { headers: auth.headers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete project" },
      { status: 500, headers: auth.headers }
    );
  }
}
