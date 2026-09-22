import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchStoreCatalog } from "@/lib/market-research/agent/store-catalog";
import { runStage5CollectionClustering } from "@/lib/market-research/agent/stage5-collection-clusterer";
import {
  loadClassifiedCategoryTerms,
  loadEmbeddingsMap,
  loadExtractRowsAdmin,
  loadProjectProducts,
  loadProjectSliceAdmin,
  mergeById,
  saveProjectSliceAdmin,
} from "@/lib/market-research/storage-admin";
import { archiveRowsByPhrase, filterClassifiedTerms } from "@/lib/market-research/sheet-filters";
import { normalizeKeywordFilters, type ProposedCollection } from "@/components/market-research/workspace-data";
import type { MockNiche, MockSeedRow, NicheReading } from "@/components/market-research/mock-data";

/**
 * One saved wave. Stage 5 sends these as 5 requests of 10 terms at once,
 * then this page is saved before the next wave starts.
 */
const PAGE_SIZE = 50;

type SeedsSlicePayload = { seedRows: MockSeedRow[]; manualSeeds: MockSeedRow[] };
type NichesSlicePayload = { niches: NicheReading[]; structuredNiches: MockNiche[] };

export async function advanceMrCollectionsPage(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  offset: number,
  filters?: {
    minVolume?: number;
    maxKd?: number;
    questionsOnly?: boolean;
    query?: string;
  }
) {
  let storeName = "Ecommerce Store";
  try {
    const catalog = await fetchStoreCatalog(admin, workspaceId);
    storeName = catalog.storeName || storeName;
  } catch {
    // Matching can proceed without the live store name.
  }

  const [terms, archiveRows, seedsSlice, nichesSlice, products] = await Promise.all([
    loadClassifiedCategoryTerms(admin, workspaceId, projectId),
    loadExtractRowsAdmin(admin, workspaceId, projectId),
    loadProjectSliceAdmin<SeedsSlicePayload>(admin, workspaceId, projectId, "seeds").catch(
      () => null
    ),
    loadProjectSliceAdmin<NichesSlicePayload>(admin, workspaceId, projectId, "niches").catch(
      () => null
    ),
    loadProjectProducts(admin, workspaceId, projectId),
  ]);

  const byPhrase = archiveRowsByPhrase(archiveRows);
  const surviving = filterClassifiedTerms(terms, byPhrase, normalizeKeywordFilters(filters));
  const total = surviving.length;
  const start = Math.min(offset, total);
  const page = surviving.slice(start, start + PAGE_SIZE);
  const nextOffset = start + page.length;
  const done = nextOffset >= total;

  const seedRows = [...(seedsSlice?.seedRows ?? []), ...(seedsSlice?.manualSeeds ?? [])];
  const seedRowById = new Map(seedRows.map((row) => [row.id, row]));
  const parentNiches = (nichesSlice?.structuredNiches ?? []).map((niche) => niche.name);

  let collections: ProposedCollection[] = [];
  if (page.length > 0) {
    const collectionIdByKeywordId: Record<string, string> = {};
    for (const term of page) {
      collectionIdByKeywordId[term.id] = seedRowById.get(term.seedId)?.collectionId ?? "";
    }
    const [termEmbeddings, productEmbeddings] = await Promise.all([
      loadEmbeddingsMap(admin, workspaceId, projectId, "terms"),
      loadEmbeddingsMap(admin, workspaceId, projectId, "products"),
    ]);
    const result = await runStage5CollectionClustering({
      storeName,
      parentNiches,
      products,
      seedRows,
      keywords: page.map((term) => {
        const archiveRow =
          byPhrase.get(term.id.trim().toLowerCase()) ??
          byPhrase.get(term.keyword.trim().toLowerCase());
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
      termVectors: new Map([...termEmbeddings.entries()].map(([id, value]) => [id, value.vector])),
      productVectors: new Map(
        [...productEmbeddings.entries()].map(([id, value]) => [id, value.vector])
      ),
    });
    collections = result.collections;
  }

  const existing = await loadProjectSliceAdmin<ProposedCollection[]>(
    admin,
    workspaceId,
    projectId,
    "collections"
  ).catch(() => null);
  const existingList = Array.isArray(existing) ? existing : [];
  const carryOver =
    start === 0
      ? existingList.filter((collection) =>
          Boolean(collection.storeHandle || collection.storeCollectionId)
        )
      : existingList;
  const merged = mergeById(carryOver, collections);
  merged.sort((a, b) => b.volume - a.volume || a.name.localeCompare(b.name));
  await saveProjectSliceAdmin(admin, workspaceId, projectId, "collections", merged);

  return { offset: start, nextOffset, done, total, collections: merged };
}
