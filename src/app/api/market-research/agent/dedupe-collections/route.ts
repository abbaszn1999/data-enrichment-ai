import { NextRequest, NextResponse } from "next/server";
import {
  agentDedupeCollectionsBodySchema,
  jsonError,
  requireMrWrite,
} from "@/lib/market-research/api-schema";
import { checkCollectionDuplicates } from "@/lib/market-research/dedupe-collections";
import { loadProjectSliceAdmin, saveProjectSliceAdmin } from "@/lib/market-research/storage-admin";
import type { ProposedCollection } from "@/components/market-research/workspace-data";

export const maxDuration = 300;

// Manual Recheck only. The automatic check runs at the end of the
// collections job (see mr-collections-session.ts). Never removes anything
// server-side — flagging is `status: "duplicate"`; the merchant removes
// flagged rows with "Remove duplicates" in Tab 5.
export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = agentDedupeCollectionsBodySchema.safeParse(json);
  if (!parsed.success) {
    return jsonError("Invalid dedupe payload", 400);
  }

  const auth = await requireMrWrite(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  try {
    const existingSlice = await loadProjectSliceAdmin<ProposedCollection[]>(
      auth.admin,
      parsed.data.workspaceId,
      parsed.data.projectId,
      "collections"
    ).catch(() => null);
    const collections: ProposedCollection[] = Array.isArray(existingSlice) ? existingSlice : [];

    const result = await checkCollectionDuplicates(
      auth.admin,
      parsed.data.workspaceId,
      collections
    );
    if (result.collections.length > 0) {
      await saveProjectSliceAdmin(
        auth.admin,
        parsed.data.workspaceId,
        parsed.data.projectId,
        "collections",
        result.collections
      );
    }

    return NextResponse.json(result, { headers: auth.headers });
  } catch (err) {
    console.error("[api/market-research/agent/dedupe-collections] Error:", err);
    const msg = err instanceof Error ? err.message : "Failed to check for duplicate collections";
    return jsonError(msg, 500);
  }
}
