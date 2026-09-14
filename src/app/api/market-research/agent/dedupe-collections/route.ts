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
        { collections: [], duplicateCount: 0, dedupeCheckFailed: false },
        { headers: auth.headers }
      );
    }

    // The merchant's existing live-store PLP roster — already fetched
    // elsewhere in Stage 5 (see cluster/route.ts) but previously discarded
    // after only reading `storeName`. Reused here as the comparison set.
    let existingCollections: Array<{ id: string; name: string; description?: string }> = [];
    let catalogFetchFailed = false;
    try {
      const catalog = await fetchStoreCatalog(auth.admin, parsed.data.workspaceId);
      existingCollections = [...catalog.collections, ...catalog.storeBrands].map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description || undefined,
      }));
    } catch {
      // No live catalog available (e.g. store integration briefly
      // unreachable). This must NOT be treated the same as "verified — the
      // store genuinely has zero collections": every "new" collection below
      // gets stamped dedupeCheckStatus "unknown" instead of silently staying
      // "new" as if it had been cleared.
      catalogFetchFailed = true;
    }

    const newCollections = collections
      .filter((c) => c.status === "new")
      .map((c) => ({ id: c.id, name: c.name }));

    let duplicateIds = new Set<string>();
    let matchesById = new Map<string, Array<{ id: string; name: string }>>();
    let geminiCheckFailed = false;
    if (!catalogFetchFailed && existingCollections.length > 0 && newCollections.length > 0) {
      const result = await runDuplicateCollectionExclusion(
        newCollections,
        existingCollections
      );
      duplicateIds = result.duplicateIds;
      matchesById = result.matchesById;
      geminiCheckFailed = !result.checked;
    }

    // True whenever we could not actually verify "new" collections against
    // the live catalog — either the catalog fetch failed, or it succeeded
    // but the Gemini comparison itself failed. A genuinely empty live
    // catalog (fetch succeeded, zero collections) is NOT a failure: there is
    // truly nothing to be a duplicate of.
    const dedupeCheckFailed = catalogFetchFailed || geminiCheckFailed;

    const updated: ProposedCollection[] = collections.map((c) => {
      if (duplicateIds.has(c.id)) {
        const matches = matchesById.get(c.id) ?? [];
        return {
          ...c,
          status: "duplicate" as const,
          dedupeCheckStatus: "ok" as const,
          ...(matches.length > 0
            ? { duplicateMatches: matches, existingName: matches[0].name }
            : {}),
        };
      }
      if (c.status === "new") {
        return {
          ...c,
          dedupeCheckStatus: dedupeCheckFailed ? ("unknown" as const) : ("ok" as const),
        };
      }
      return c;
    });

    await saveProjectSliceAdmin(
      auth.admin,
      parsed.data.workspaceId,
      parsed.data.projectId,
      "collections",
      updated
    ).catch((err) => console.error("[dedupe-collections] Error saving collections slice:", err));

    return NextResponse.json(
      { collections: updated, duplicateCount: duplicateIds.size, dedupeCheckFailed },
      { headers: auth.headers }
    );
  } catch (err) {
    console.error("[api/market-research/agent/dedupe-collections] Error:", err);
    const msg = err instanceof Error ? err.message : "Failed to check for duplicate collections";
    return jsonError(msg, 500);
  }
}
