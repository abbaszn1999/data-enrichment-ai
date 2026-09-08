import { NextRequest, NextResponse } from "next/server";
import {
  agentInternalLinksBodySchema,
  jsonError,
  requireMrWrite,
} from "@/lib/market-research/api-schema";
import {
  fetchStoreCatalog,
  type StoreCollectionItem,
} from "@/lib/market-research/agent/store-catalog";
import {
  buildInternalLinkGraph,
  type InternalLinkGraph,
} from "@/lib/market-research/agent/internal-links";
import {
  loadProjectSliceAdmin,
  saveProjectSliceAdmin,
} from "@/lib/market-research/storage-admin";
import type { ProposedCollection } from "@/components/market-research/workspace-data";

export const maxDuration = 60;

// One page of the target collection ids per call. Each page is chunked into
// Gemini judgement batches of 10 sources, 5 batches running concurrently —
// 200 collections/page is 20 batches, 4 waves at concurrency 5, comfortably
// inside the route's time budget even with 10k+ pushed collections.
const PAGE_SIZE = 200;

/**
 * Builds the internal link graph for a page of a project's pushed collections
 * and merges it into the "internal-links" slice, so it is ready before the
 * user clicks "Generate" in Tab 6. Triggered right after collections are
 * pushed to the store (see handlePushToStore in market-research-shell.tsx),
 * and looped by the client (runBuildInternalLinksLoop) until `done`.
 *
 * The canonical collection list is loaded from storage rather than trusted
 * from the request body, so every href the engine emits reflects the real
 * storeHandle the push step persisted — not whatever the client happened to
 * have in memory when this call was queued.
 */
export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = agentInternalLinksBodySchema.safeParse(json);
  if (!parsed.success) {
    return jsonError("Invalid internal-links payload", 400);
  }

  const auth = await requireMrWrite(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  try {
    const [catalogResult, workspaceRow, allProposedRaw] = await Promise.all([
      fetchStoreCatalog(auth.admin, parsed.data.workspaceId).catch(() => null),
      auth.admin
        .from("workspaces")
        .select("collection_prefix")
        .eq("id", parsed.data.workspaceId)
        .maybeSingle(),
      loadProjectSliceAdmin<ProposedCollection[]>(
        auth.admin,
        parsed.data.workspaceId,
        parsed.data.projectId,
        "collections"
      ).catch(() => null),
    ]);

    const storeCollections: StoreCollectionItem[] = catalogResult?.collections || [];
    const provider = catalogResult?.provider;
    const collectionPrefix =
      (workspaceRow?.data?.collection_prefix ?? "AI").trim() || "AI";
    const allProposed: ProposedCollection[] = Array.isArray(allProposedRaw)
      ? allProposedRaw
      : [];

    const total = parsed.data.collectionIds.length;
    const offset = Math.min(parsed.data.offset, total);
    const pageIds = parsed.data.collectionIds.slice(offset, offset + PAGE_SIZE);
    const nextOffset = offset + pageIds.length;
    const done = nextOffset >= total;

    const proposedById = new Map(allProposed.map((c) => [c.id, c]));
    const sourceCollections = pageIds
      .map((id) => proposedById.get(id))
      .filter((c): c is ProposedCollection => Boolean(c));

    let pageLinks: InternalLinkGraph = {};
    if (sourceCollections.length > 0) {
      const apiKey = process.env.GEMINI_API_KEY?.trim();
      pageLinks = await buildInternalLinkGraph({
        proposed: allProposed.length > 0 ? allProposed : sourceCollections,
        sourceCollections,
        storeCollections,
        collectionPrefix,
        provider,
        disableAi: !apiKey,
      });
    }

    if (Object.keys(pageLinks).length > 0) {
      const existing = await loadProjectSliceAdmin<InternalLinkGraph>(
        auth.admin,
        parsed.data.workspaceId,
        parsed.data.projectId,
        "internal-links"
      ).catch(() => null);

      const merged: InternalLinkGraph = { ...(existing ?? {}), ...pageLinks };

      await saveProjectSliceAdmin(
        auth.admin,
        parsed.data.workspaceId,
        parsed.data.projectId,
        "internal-links",
        merged
      ).catch((err) =>
        console.error("[internal-links] Error saving internal-links slice:", err)
      );
    }

    return NextResponse.json(
      {
        offset,
        nextOffset,
        done,
        processed: pageIds.length,
        total,
        linksByCollectionId: pageLinks,
      },
      { headers: auth.headers }
    );
  } catch (err) {
    console.error("[api/market-research/agent/internal-links] Error:", err);
    const msg =
      err instanceof Error ? err.message : "Failed to build internal links";
    return jsonError(msg, 500);
  }
}
