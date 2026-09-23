import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchStoreCatalog } from "@/lib/market-research/agent/store-catalog";
import {
  buildUnifiedProductText,
  runStage5CollectionClustering,
} from "@/lib/market-research/agent/stage5-collection-clusterer";
import {
  contentHash,
  embedTexts,
  embeddingsAvailable,
  encodeVectorInt8,
  termEmbedText,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
} from "@/lib/market-research/agent/embeddings";
import {
  appendEmbeddingsShardAdmin,
  loadClassifiedCategoryTerms,
  loadEmbeddingsMap,
  loadExtractRowsAdmin,
  loadProjectProducts,
  loadProjectSliceAdmin,
  mergeById,
  saveProjectSliceAdmin,
  type EmbeddingShardItem,
} from "@/lib/market-research/storage-admin";
import { archiveRowsByPhrase, filterClassifiedTerms } from "@/lib/market-research/sheet-filters";
import {
  normalizeKeywordFilters,
  type MarketResearchProduct,
  type ProposedCollection,
} from "@/components/market-research/workspace-data";
import type { MockNiche, MockSeedRow, NicheReading } from "@/components/market-research/mock-data";
import { chunk, runWithConcurrency } from "@/lib/sync/core/batch-executor";

/**
 * One saved wave. Stage 5 sends these as 5 requests of 10 terms at once,
 * then this page is saved before the next wave starts.
 */
const PAGE_SIZE = 50;
const OPENAI_BATCH_SIZE = 256;
const EMBED_CONCURRENCY = 5;

type SeedsSlicePayload = { seedRows: MockSeedRow[]; manualSeeds: MockSeedRow[] };
type NichesSlicePayload = { niches: NicheReading[]; structuredNiches: MockNiche[] };
type CategoryTerm = Awaited<ReturnType<typeof loadClassifiedCategoryTerms>>[number];

export type CollectionsFilters = {
  minVolume?: number;
  maxKd?: number;
  questionsOnly?: boolean;
  query?: string;
};

/** Everything a collections run needs, loaded once per job instead of once per wave. */
export type CollectionsContext = {
  storeName: string;
  surviving: CategoryTerm[];
  byPhrase: ReturnType<typeof archiveRowsByPhrase>;
  seedRows: MockSeedRow[];
  seedRowById: Map<string, MockSeedRow>;
  parentNiches: string[];
  products: MarketResearchProduct[];
  termVectors: Map<string, number[]>;
  productVectors: Map<string, number[]>;
};

async function embedMissing<T extends { id: string; text: string; collectionId?: string }>(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  kind: "terms" | "products",
  pending: T[],
  into: Map<string, number[]>
): Promise<void> {
  if (pending.length === 0 || !embeddingsAvailable()) return;
  const run = await runWithConcurrency(
    chunk(pending, OPENAI_BATCH_SIZE),
    async (batch) => {
      const vectors = await embedTexts(batch.map((item) => item.text));
      return batch.map((item, index) => ({ item, vector: vectors[index] }));
    },
    { concurrency: EMBED_CONCURRENCY }
  );
  const shard: EmbeddingShardItem[] = [];
  for (const rows of run.successes) {
    for (const { item, vector } of rows) {
      if (!vector) continue;
      into.set(item.id, vector);
      shard.push({
        id: item.id,
        hash: contentHash(item.text),
        vector: encodeVectorInt8(vector),
        ...(item.collectionId ? { collectionId: item.collectionId } : {}),
      });
    }
  }
  if (shard.length > 0) {
    await appendEmbeddingsShardAdmin(
      admin,
      workspaceId,
      projectId,
      kind,
      shard,
      EMBEDDING_MODEL,
      EMBEDDING_DIMENSIONS
    ).catch((err) => console.error(`[collections] Failed to save ${kind} embeddings:`, err));
  }
}

export async function loadCollectionsContext(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  filters?: CollectionsFilters
): Promise<CollectionsContext> {
  let storeName = "Ecommerce Store";
  try {
    const catalog = await fetchStoreCatalog(admin, workspaceId);
    storeName = catalog.storeName || storeName;
  } catch {
    // Matching can proceed without the live store name.
  }

  const [terms, archiveRows, seedsSlice, nichesSlice, products, termEmbeddings, productEmbeddings] =
    await Promise.all([
      loadClassifiedCategoryTerms(admin, workspaceId, projectId),
      loadExtractRowsAdmin(admin, workspaceId, projectId),
      loadProjectSliceAdmin<SeedsSlicePayload>(admin, workspaceId, projectId, "seeds").catch(
        () => null
      ),
      loadProjectSliceAdmin<NichesSlicePayload>(admin, workspaceId, projectId, "niches").catch(
        () => null
      ),
      loadProjectProducts(admin, workspaceId, projectId),
      loadEmbeddingsMap(admin, workspaceId, projectId, "terms"),
      loadEmbeddingsMap(admin, workspaceId, projectId, "products"),
    ]);

  const byPhrase = archiveRowsByPhrase(archiveRows);
  const surviving = filterClassifiedTerms(terms, byPhrase, normalizeKeywordFilters(filters));
  const seedRows = [...(seedsSlice?.seedRows ?? []), ...(seedsSlice?.manualSeeds ?? [])];
  const seedRowById = new Map(seedRows.map((row) => [row.id, row]));
  const parentNiches = (nichesSlice?.structuredNiches ?? []).map((niche) => niche.name);

  const termVectors = new Map(
    [...termEmbeddings.entries()].map(([id, value]) => [id, value.vector])
  );
  const productVectors = new Map(
    [...productEmbeddings.entries()].map(([id, value]) => [id, value.vector])
  );

  // Vectors written by the browser-driven passes may be missing or not yet
  // readable. Embed whatever is missing here so matching never silently
  // falls back to lexical scoring for part of the run.
  const scopedCollectionIds = new Set<string>();
  const missingTerms: Array<{ id: string; text: string; collectionId: string }> = [];
  for (const term of surviving) {
    const collectionId = seedRowById.get(term.seedId)?.collectionId ?? "";
    if (!collectionId) continue;
    scopedCollectionIds.add(collectionId);
    if (termVectors.has(term.id)) continue;
    const text = termEmbedText(term.keyword);
    if (text) missingTerms.push({ id: term.id, text, collectionId });
  }
  const missingProducts = products
    .filter(
      (product) =>
        !productVectors.has(product.id) &&
        product.collectionIds.some((cid) => scopedCollectionIds.has(cid))
    )
    .map((product) => ({ id: product.id, text: buildUnifiedProductText(product) }))
    .filter((item) => item.text);
  await embedMissing(admin, workspaceId, projectId, "terms", missingTerms, termVectors);
  await embedMissing(admin, workspaceId, projectId, "products", missingProducts, productVectors);

  return {
    storeName,
    surviving,
    byPhrase,
    seedRows,
    seedRowById,
    parentNiches,
    products,
    termVectors,
    productVectors,
  };
}

/**
 * Match one wave of terms and merge it into the collections list. Pass the
 * list returned by the previous wave as `previous`; `null` loads the saved
 * slice (first wave of a resumed job).
 */
export async function advanceMrCollectionsPage(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  offset: number,
  context: CollectionsContext,
  previous: ProposedCollection[] | null
) {
  const total = context.surviving.length;
  const start = Math.min(offset, total);
  const page = context.surviving.slice(start, start + PAGE_SIZE);
  const nextOffset = start + page.length;
  const done = nextOffset >= total;

  let collections: ProposedCollection[] = [];
  if (page.length > 0) {
    const collectionIdByKeywordId: Record<string, string> = {};
    for (const term of page) {
      collectionIdByKeywordId[term.id] =
        context.seedRowById.get(term.seedId)?.collectionId ?? "";
    }
    const result = await runStage5CollectionClustering({
      storeName: context.storeName,
      parentNiches: context.parentNiches,
      products: context.products,
      seedRows: context.seedRows,
      keywords: page.map((term) => {
        const archiveRow =
          context.byPhrase.get(term.id.trim().toLowerCase()) ??
          context.byPhrase.get(term.keyword.trim().toLowerCase());
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
      termVectors: context.termVectors,
      productVectors: context.productVectors,
    });
    collections = result.collections;
  }

  let existingList = previous;
  if (!existingList) {
    const existing = await loadProjectSliceAdmin<ProposedCollection[]>(
      admin,
      workspaceId,
      projectId,
      "collections"
    ).catch(() => null);
    existingList = Array.isArray(existing) ? existing : [];
  }
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
