import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireWrAuth } from "@/lib/website-restructure/auth";
import { jsonError, putStateBodySchema, workspaceIdSchema } from "@/lib/website-restructure/api-schema";
import {
  getWrProjectsCreatedTotal,
  loadWrProjects,
  updateWrProjectState,
} from "@/lib/website-restructure/server-persist";
import { WR_STORAGE_BUCKET } from "@/lib/website-restructure/storage";
import { getWrProjectLimit, type WrProjectRow } from "@/lib/website-restructure/types";

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour — regenerated on every state load

/** Attaches short-lived signed URLs to every uploaded image/logo across all
 *  projects in one batched call, so the chat panel can render thumbnails
 *  without a private-bucket round trip per image. */
async function withSignedUrls(
  admin: SupabaseClient,
  projects: WrProjectRow[]
): Promise<Array<WrProjectRow & { state: WrProjectRow["state"] & { imageUrls: Record<string, string> } }>> {
  const allPaths = new Set<string>();
  for (const p of projects) {
    for (const img of p.state.images) allPaths.add(img.storagePath);
    if (p.state.logo) allPaths.add(p.state.logo.storagePath);
  }
  const urlByPath = new Map<string, string>();
  if (allPaths.size > 0) {
    const { data } = await admin.storage
      .from(WR_STORAGE_BUCKET)
      .createSignedUrls(Array.from(allPaths), SIGNED_URL_TTL_SECONDS);
    (data ?? []).forEach((row) => {
      if (row?.signedUrl && row.path) urlByPath.set(row.path, row.signedUrl);
    });
  }
  return projects.map((p) => {
    const imageUrls: Record<string, string> = {};
    for (const img of p.state.images) {
      const url = urlByPath.get(img.storagePath);
      if (url) imageUrls[img.id] = url;
    }
    if (p.state.logo) {
      const url = urlByPath.get(p.state.logo.storagePath);
      if (url) imageUrls[p.state.logo.id] = url;
    }
    return { ...p, state: { ...p.state, imageUrls } };
  });
}

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  const parsed = workspaceIdSchema.safeParse(workspaceId);
  if (!parsed.success) return jsonError("workspaceId is required", 400);

  const auth = await requireWrAuth({ workspaceId: parsed.data });
  if (!auth.ok) return auth.response;

  try {
    const projects = await loadWrProjects(auth.admin, parsed.data);
    const withUrls = await withSignedUrls(auth.admin, projects);
    const planName = (auth.ctx.plan?.name as string | undefined) ?? null;
    const projectLimit = getWrProjectLimit(planName);
    const projectsCreatedTotal = await getWrProjectsCreatedTotal(auth.admin, parsed.data);
    return NextResponse.json(
      { projects: withUrls, projectLimit, projectsCreatedTotal },
      { headers: auth.headers }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load projects" },
      { status: 500, headers: auth.headers }
    );
  }
}

export async function PUT(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = putStateBodySchema.safeParse(json);
  if (!parsed.success) return jsonError("Invalid state payload", 400);

  const auth = await requireWrAuth({ workspaceId: parsed.data.workspaceId, requireWrite: true });
  if (!auth.ok) return auth.response;

  try {
    const ok = await updateWrProjectState(
      auth.admin,
      parsed.data.workspaceId,
      parsed.data.projectId,
      parsed.data.state
    );
    if (!ok) return jsonError("Project not found", 404);
    return NextResponse.json({ ok: true }, { headers: auth.headers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save state" },
      { status: 500, headers: auth.headers }
    );
  }
}
