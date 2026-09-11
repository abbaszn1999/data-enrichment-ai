import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, requireFaRead, requireFaWrite, workspaceIdSchema } from "@/lib/free-assessment/api-schema";
import {
  loadFaPersistedState,
  saveFaPersistedState,
} from "@/lib/free-assessment/server-persist";
import type { MarketResearchPersisted } from "@/components/free-assessment/persistence";

const putBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  state: z.object({
    projects: z.array(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(120),
        status: z.enum(["active", "completed"]),
        storeLabel: z.string().max(200),
        highlightedCollectionIds: z.array(z.string().max(120)).max(200),
      })
    ).max(20),
    activeProjectId: z.string().uuid().optional(),
  }).passthrough(),
});

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  const parsed = workspaceIdSchema.safeParse(workspaceId);
  if (!parsed.success) return jsonError("workspaceId is required", 400);

  const auth = await requireFaRead(parsed.data);
  if (!auth.ok) return auth.response;

  try {
    const state = await loadFaPersistedState(auth.admin, parsed.data);
    return NextResponse.json({ state }, { headers: auth.headers });
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

  const parsed = putBodySchema.safeParse(json);
  if (!parsed.success) return jsonError("Invalid state payload", 400);

  const auth = await requireFaWrite(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  try {
    await saveFaPersistedState(
      auth.admin,
      parsed.data.workspaceId,
      auth.user.id,
      parsed.data.state as MarketResearchPersisted
    );
    return NextResponse.json({ ok: true }, { headers: auth.headers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save projects" },
      { status: 500, headers: auth.headers }
    );
  }
}
