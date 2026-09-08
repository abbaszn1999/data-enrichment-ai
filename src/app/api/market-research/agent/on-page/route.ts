import { NextRequest, NextResponse } from "next/server";
import {
  agentOnPageBodySchema,
  jsonError,
  requireMrWrite,
} from "@/lib/market-research/api-schema";
import {
  fetchStoreCatalog,
  type StoreCollectionItem,
} from "@/lib/market-research/agent/store-catalog";
import { runStage6OnPageGeneration } from "@/lib/market-research/agent/stage6-on-page-generator";
import {
  loadProjectSliceAdmin,
  saveProjectSliceAdmin,
} from "@/lib/market-research/storage-admin";
import type { InternalLinkGraph } from "@/lib/market-research/agent/internal-links";
import type {
  CollectionContent,
  ProposedCollection,
} from "@/components/market-research/workspace-data";

export const maxDuration = 60;

// One page of the selected collection ids per call. Each page is chunked
// into Gemini copywriting batches of 10, 5 batches running concurrently —
// smaller than the link engine's page because each call's output (title,
// meta, description, FAQs) is much heavier per collection.
const PAGE_SIZE = 100;

/**
 * "Generate" is now a SEO-only pass: the canonical collection list (with real
 * storeHandles) and the precomputed internal-link graph are both loaded from
 * storage rather than trusted from the request body, so this route only ever
 * needs the ids of the collections to write copy for. Looped by the client
 * (runOnPageGenerationLoop) until `done`, so a 10k-collection store keeps
 * filling the content table in the background instead of dying at 60s.
 */
export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = agentOnPageBodySchema.safeParse(json);
  if (!parsed.success) {
    return jsonError("Invalid on-page payload", 400);
  }

  const auth = await requireMrWrite(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  try {
    let storeName = "Ecommerce Store";
    let storeCollections: StoreCollectionItem[] = [];
    let provider: string | undefined;
    try {
      const catalog = await fetchStoreCatalog(auth.admin, parsed.data.workspaceId);
      storeName = catalog.storeName || storeName;
      storeCollections = catalog.collections || [];
      provider = catalog.provider;
    } catch {
      // Proceed even if catalog fetch fails
    }

    // Internal links must match the handles the push step actually created, and
    // those carry the workspace naming prefix.
    const { data: workspaceRow } = await auth.admin
      .from("workspaces")
      .select("collection_prefix")
      .eq("id", parsed.data.workspaceId)
      .maybeSingle();
    const collectionPrefix =
      (workspaceRow?.collection_prefix ?? "AI").trim() || "AI";

    const allProposed = await loadProjectSliceAdmin<ProposedCollection[]>(
      auth.admin,
      parsed.data.workspaceId,
      parsed.data.projectId,
      "collections"
    ).catch(() => null);
    const proposedById = new Map(
      (Array.isArray(allProposed) ? allProposed : []).map((c) => [c.id, c])
    );

    const total = parsed.data.collectionIds.length;
    const offset = Math.min(parsed.data.offset, total);
    const pageIds = parsed.data.collectionIds.slice(offset, offset + PAGE_SIZE);
    const nextOffset = offset + pageIds.length;
    const done = nextOffset >= total;

    const pageCollections = pageIds
      .map((id) => proposedById.get(id))
      .filter((c): c is ProposedCollection => Boolean(c));

    // The link graph is normally already built in the background right after
    // the collections were pushed (see /api/market-research/agent/internal-links
    // and handlePushToStore). Reusing it here means "Generate" only has to run
    // the Gemini copywriting pass. If the precomputed slice is missing or empty
    // — e.g. the background pass hasn't finished yet — leave it undefined so
    // runStage6OnPageGeneration falls back to building it inline, as before.
    let precomputedLinks: InternalLinkGraph | undefined;
    try {
      const saved = await loadProjectSliceAdmin<InternalLinkGraph>(
        auth.admin,
        parsed.data.workspaceId,
        parsed.data.projectId,
        "internal-links"
      );
      if (saved && Object.keys(saved).length > 0) {
        precomputedLinks = saved;
      }
    } catch (err) {
      console.warn("[on-page] Could not load internal-links slice:", err);
    }

    let pageContentById: Record<string, CollectionContent> = {};
    if (pageCollections.length > 0) {
      const result = await runStage6OnPageGeneration({
        storeName,
        parentNiches: parsed.data.parentNiches,
        collections: pageCollections,
        allStoreCollections: storeCollections,
        customInstructions: parsed.data.customInstructions,
        collectionPrefix,
        provider,
        internalLinks: precomputedLinks,
      });
      pageContentById = result.contentById;
    }

    if (Object.keys(pageContentById).length > 0) {
      const existingContent = await loadProjectSliceAdmin<
        Record<string, CollectionContent>
      >(
        auth.admin,
        parsed.data.workspaceId,
        parsed.data.projectId,
        "content"
      ).catch(() => null);

      const mergedContent: Record<string, CollectionContent> = {
        ...(existingContent ?? {}),
        ...pageContentById,
      };

      await saveProjectSliceAdmin(
        auth.admin,
        parsed.data.workspaceId,
        parsed.data.projectId,
        "content",
        mergedContent
      ).catch((err) => console.error("[on-page] Error saving content slice:", err));
    }

    return NextResponse.json(
      {
        offset,
        nextOffset,
        done,
        processed: pageIds.length,
        total,
        contentById: pageContentById,
        isAiGenerated: Object.keys(pageContentById).length > 0,
      },
      { headers: auth.headers }
    );
  } catch (err) {
    console.error("[api/market-research/agent/on-page] Error:", err);
    const msg = err instanceof Error ? err.message : "Failed to generate on-page content";
    return jsonError(msg, 500);
  }
}
