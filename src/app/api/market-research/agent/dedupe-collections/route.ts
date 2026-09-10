import { NextRequest, NextResponse } from "next/server";
import {
  agentDedupeCollectionsBodySchema,
  jsonError,
  requireMrWrite,
} from "@/lib/market-research/api-schema";
import { fetchStoreCatalog } from "@/lib/market-research/agent/store-catalog";
import { runDuplicateCollectionExclusion } from "@/lib/market-research/agent/stage5-duplicate-exclusion";
import { loadProjectSliceAdmin, saveProjectSliceAdmin } from "@/lib/market-research/storage-admin";
import type { ProposedCollection } from "@/components/market-research/workspace-data";

export const maxDuration = 60;

// Stage 5 Phase 3 — runs once, after the Phase 2 clustering cursor loop has
// fully finished (see runClusterCollectionsLoop in client.ts). Compares the
// complete final "collections" slice against the merchant's existing live
// store PLPs and flags semantic shopper-intent duplicates. Never removes
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

    if (collections.length === 0) {
      return NextResponse.json(
        { collections: [], duplicateCount: 0 },
        { headers: auth.headers }
      );
    }

    // The merchant's existing live-store PLP roster — already fetched
    // elsewhere in Stage 5 (see cluster/route.ts) but previously discarded
    // after only reading `storeName`. Reused here as the comparison set.
    let existingCollections: Array<{ id: string; name: string; description?: string }> = [];
    try {
      const catalog = await fetchStoreCatalog(auth.admin, parsed.data.workspaceId);
      existingCollections = [...catalog.collections, ...catalog.storeBrands].map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description || undefined,
      }));
    } catch {
      // No live catalog available (e.g. store integration briefly
      // unreachable) — proceed with no duplicates flagged rather than fail
      // the whole request.
    }

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
    ).catch((err) => console.error("[dedupe-collections] Error saving collections slice:", err));

    return NextResponse.json(
      { collections: updated, duplicateCount: duplicateIds.size },
      { headers: auth.headers }
    );
  } catch (err) {
    console.error("[api/market-research/agent/dedupe-collections] Error:", err);
    const msg = err instanceof Error ? err.message : "Failed to check for duplicate collections";
    return jsonError(msg, 500);
  }
}
