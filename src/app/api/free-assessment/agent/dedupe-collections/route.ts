import { NextRequest, NextResponse } from "next/server";
import {
  agentDedupeCollectionsBodySchema,
  jsonError,
  requireFaWrite,
} from "@/lib/free-assessment/api-schema";
import { runDuplicateCollectionExclusion } from "@/lib/free-assessment/agent/stage5-duplicate-exclusion";
import { loadProjectSliceAdmin, saveProjectSliceAdmin } from "@/lib/free-assessment/storage-admin";
import type { ProposedCollection } from "@/components/free-assessment/workspace-data";
import type { MockNiche, NicheReading } from "@/components/free-assessment/mock-data";

export const maxDuration = 60;

type NichesSlicePayload = { niches: NicheReading[]; structuredNiches: MockNiche[] };

// Stage 5 Phase 3 — runs once, after the Phase 2 clustering cursor loop has
// fully finished (see runClusterCollectionsLoop in client.ts). Free
// Assessment has no live store integration, so the merchant's "existing"
// PLPs are the AI-organized version of their uploaded Tab 1 sheet — the
// same `structuredNiches[].collections` already loaded (and discarded
// after only reading niche names) by cluster/route.ts. Never removes
// anything server-side — flagging is `status: "duplicate"`; the merchant
// removes flagged rows manually via the "Remove Duplicates" button in Tab 5.
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

  const auth = await requireFaWrite(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  try {
    const [existingSlice, nichesSlice] = await Promise.all([
      loadProjectSliceAdmin<ProposedCollection[]>(
        auth.admin,
        parsed.data.workspaceId,
        parsed.data.projectId,
        "collections"
      ).catch(() => null),
      loadProjectSliceAdmin<NichesSlicePayload>(
        auth.admin,
        parsed.data.workspaceId,
        parsed.data.projectId,
        "niches"
      ).catch(() => null),
    ]);
    const collections: ProposedCollection[] = Array.isArray(existingSlice) ? existingSlice : [];

    if (collections.length === 0) {
      return NextResponse.json(
        { collections: [], duplicateCount: 0 },
        { headers: auth.headers }
      );
    }

    const existingCollections = (nichesSlice?.structuredNiches ?? []).flatMap((niche) =>
      niche.collections.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description || undefined,
      }))
    );

    let duplicateIds = new Set<string>();
    if (existingCollections.length > 0) {
      const newCollections = collections
        .filter((c) => c.status === "new")
        .map((c) => ({ id: c.id, name: c.name }));
      duplicateIds = await runDuplicateCollectionExclusion(newCollections, existingCollections);
    }

    const updated: ProposedCollection[] = collections.map((c) =>
      duplicateIds.has(c.id) ? { ...c, status: "duplicate" as const } : c
    );

    await saveProjectSliceAdmin(
      auth.admin,
      parsed.data.workspaceId,
      parsed.data.projectId,
      "collections",
      updated
    ).catch((err) => console.error("[fa-dedupe-collections] Error saving collections slice:", err));

    return NextResponse.json(
      { collections: updated, duplicateCount: duplicateIds.size },
      { headers: auth.headers }
    );
  } catch (err) {
    console.error("[api/free-assessment/agent/dedupe-collections] Error:", err);
    const msg = err instanceof Error ? err.message : "Failed to check for duplicate collections";
    return jsonError(msg, 500);
  }
}
