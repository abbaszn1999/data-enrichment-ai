import { NextRequest, NextResponse } from "next/server";
import {
  agentClusterBodySchema,
  jsonError,
  requireMrWrite,
} from "@/lib/market-research/api-schema";
import { fetchStoreCatalog } from "@/lib/market-research/agent/store-catalog";
import { runStage5CollectionClustering } from "@/lib/market-research/agent/stage5-collection-clusterer";
import {
  loadClassifiedCategoryTerms,
  loadExtractRowsAdmin,
  loadProjectSliceAdmin,
  loadProjectProducts,
  loadEmbeddingsMap,
  saveProjectSliceAdmin,
  mergeById,
} from "@/lib/market-research/storage-admin";
import type { ProposedCollection } from "@/components/market-research/workspace-data";
import type { MockNiche, MockSeedRow, NicheReading } from "@/components/market-research/mock-data";

export const maxDuration = 60;

// One page of the classified/category archive per call. Each page is
// chunked into Gemini batches of 10 keywords, 5 batches running concurrently
// — 200 keywords/page is 20 batches, 4 waves at concurrency 5, comfortably
// inside the route's time budget even with thousands of surviving terms.
const PAGE_SIZE = 200;

type SeedsSlicePayload = { seedRows: MockSeedRow[]; manualSeeds: MockSeedRow[] };
type NichesSlicePayload = { niches: NicheReading[]; structuredNiches: MockNiche[] };

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = agentClusterBodySchema.safeParse(json);
  if (!parsed.success) {
    return jsonError("Invalid cluster payload", 400);
  }

  const auth = await requireMrWrite(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  try {
    let storeName = "Ecommerce Store";
    try {
      const catalog = await fetchStoreCatalog(auth.admin, parsed.data.workspaceId);
      storeName = catalog.storeName || storeName;
    } catch {
      // Proceed even if catalog fetch fails
    }

    const [terms, archiveRows, seedsSlice, nichesSlice, products] = await Promise.all([
      loadClassifiedCategoryTerms(auth.admin, parsed.data.workspaceId, parsed.data.projectId),
      loadExtractRowsAdmin(auth.admin, parsed.data.workspaceId, parsed.data.projectId),
      loadProjectSliceAdmin<SeedsSlicePayload>(
        auth.admin,
        parsed.data.workspaceId,
        parsed.data.projectId,
        "seeds"
      ).catch(() => null),
      loadProjectSliceAdmin<NichesSlicePayload>(
        auth.admin,
        parsed.data.workspaceId,
        parsed.data.projectId,
        "niches"
      ).catch(() => null),
      loadProjectProducts(auth.admin, parsed.data.workspaceId, parsed.data.projectId),
    ]);

    const total = terms.length;
    const offset = Math.min(parsed.data.offset, total);
    const page = terms.slice(offset, offset + PAGE_SIZE);
    const nextOffset = offset + page.length;
    const done = nextOffset >= total;

    const byPhrase = new Map(archiveRows.map((r) => [r.phrase, r]));
    const seedRows = [...(seedsSlice?.seedRows ?? []), ...(seedsSlice?.manualSeeds ?? [])];
    const seedRowById = new Map(seedRows.map((r) => [r.id, r]));
    const parentNiches = (nichesSlice?.structuredNiches ?? []).map((n) => n.name);

    let result: {
      collections: ProposedCollection[];
      summary: { totalCollections: number; newCount: number; existingCount: number; mergeCount: number; totalVolume: number };
      isAiGenerated: boolean;
    } = {
      collections: [],
      summary: { totalCollections: 0, newCount: 0, existingCount: 0, mergeCount: 0, totalVolume: 0 },
      isAiGenerated: false,
    };

    if (page.length > 0) {
      const collectionIdByKeywordId: Record<string, string> = {};
      for (const term of page) {
        collectionIdByKeywordId[term.id] = seedRowById.get(term.seedId)?.collectionId ?? "";
      }

      const [termEmbeddings, productEmbeddings] = await Promise.all([
        loadEmbeddingsMap(auth.admin, parsed.data.workspaceId, parsed.data.projectId, "terms"),
        loadEmbeddingsMap(auth.admin, parsed.data.workspaceId, parsed.data.projectId, "products"),
      ]);
      const termVectors = new Map(
        [...termEmbeddings.entries()].map(([id, v]) => [id, v.vector])
      );
      const productVectors = new Map(
        [...productEmbeddings.entries()].map(([id, v]) => [id, v.vector])
      );

      result = await runStage5CollectionClustering({
        storeName,
        parentNiches,
        products,
        seedRows,
        keywords: page.map((term) => {
          const archiveRow = byPhrase.get(term.id);
          return {
            id: term.id,
            keyword: term.keyword,
            seed: term.seedId,
            volume: archiveRow?.volume ?? 0,
            difficulty: archiveRow?.difficulty ?? 0,
            plpConcept: term.plpConcept,
            reason: term.reason,
          };
        }),
        collectionIdByKeywordId,
        termVectors,
        productVectors,
      });
    }

    // Merge, never overwrite: each cursor call adds/updates its own page's
    // collections into whatever the slice already holds from earlier pages.
    let merged: ProposedCollection[] = [];
    if (parsed.data.projectId) {
      const existing = await loadProjectSliceAdmin<ProposedCollection[]>(
        auth.admin,
        parsed.data.workspaceId,
        parsed.data.projectId,
        "collections"
      ).catch(() => null);
      merged = mergeById(
        Array.isArray(existing) ? existing : [],
        result.collections
      );
      merged.sort((a, b) => b.volume - a.volume || a.name.localeCompare(b.name));

      await saveProjectSliceAdmin(
        auth.admin,
        parsed.data.workspaceId,
        parsed.data.projectId,
        "collections",
        merged
      ).catch((err) => console.error("[cluster] Error saving collections slice:", err));
    } else {
      merged = result.collections;
    }

    const totalVolume = merged.reduce((sum, c) => sum + c.volume, 0);

    return NextResponse.json(
      {
        offset,
        nextOffset,
        done,
        processed: page.length,
        total,
        collections: merged,
        summary: {
          totalCollections: merged.length,
          newCount: merged.filter((c) => c.status === "new").length,
          existingCount: merged.filter((c) => c.status === "existing").length,
          mergeCount: merged.filter((c) => c.status === "merge").length,
          totalVolume,
        },
        isAiGenerated: result.isAiGenerated,
      },
      { headers: auth.headers }
    );
  } catch (err) {
    console.error("[api/market-research/agent/cluster] Error:", err);
    const msg = err instanceof Error ? err.message : "Failed to cluster collections";
    return jsonError(msg, 500);
  }
}
