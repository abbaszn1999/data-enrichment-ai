import type { KeywordRow } from "./providers/keyword-provider";
import type { SearchIntent } from "./providers/semrush-codes";
import type { MarketResearchPersisted } from "@/components/market-research/persistence";
import type { MarketResearchProject } from "@/components/market-research/mock-data";
import type {
  CollectionContent,
  CollectionLink,
  GeneratedArticle,
  MarketResearchProduct,
  ProposedCollection,
  StoreBlog,
  StrategyArticle,
} from "@/components/market-research/workspace-data";

export type ProbeSeedInput = { id: string; term: string };

export type ProbeSeedResult =
  | {
      seedId: string;
      failed: false;
      volume: number;
      keywordDifficulty: number;
      cpcUsd: number;
      intents: SearchIntent[];
      keywordIdeasTotal: number;
      keywordIdeasTotalVolume: number;
      sampleKeywords: string[];
    }
  | { seedId: string; failed: true };

export type ProbeResponse = {
  market: string;
  database: string;
  probeCostUsd: number;
  chargedUsd?: number;
  results: ProbeSeedResult[];
};

export type ExtractSeedStart = {
  seedId: string;
  term: string;
  runId: string;
  datasetId?: string;
  pages: number;
  estimatedRows: number;
  estimatedCostUsd: number;
};

export type ExtractStartResponse = {
  extractId: string;
  database: string;
  heldUsd?: number;
  seeds: ExtractSeedStart[];
};

export type ExtractPollSeed = {
  seedId: string;
  term: string;
  runId: string;
  datasetId?: string;
  status: "running" | "succeeded" | "failed" | "aborted";
  rows: KeywordRow[];
  nextCursor?: string;
  error?: string;
  rowsReturned?: number;
};

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

export async function loadMrStateApi(
  workspaceId: string
): Promise<MarketResearchPersisted> {
  const response = await fetch(
    `/api/market-research/state?workspaceId=${encodeURIComponent(workspaceId)}`
  );
  const data = await readJson<{ state: MarketResearchPersisted }>(response);
  return data.state;
}

export async function saveMrStateApi(
  workspaceId: string,
  state: MarketResearchPersisted
): Promise<void> {
  const response = await fetch("/api/market-research/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, state }),
  });
  await readJson(response);
}

export async function createMrProjectApi(
  workspaceId: string,
  input: {
    name: string;
    storeLabel?: string;
    highlightedCollectionIds?: string[];
  }
): Promise<Pick<MarketResearchProject, "id" | "name">> {
  const response = await fetch("/api/market-research/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, ...input }),
  });
  const data = await readJson<{ project: { id: string; name: string } }>(
    response
  );
  return data.project;
}

export async function deleteMrProjectApi(
  workspaceId: string,
  projectId: string
): Promise<void> {
  const response = await fetch("/api/market-research/projects", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, projectId }),
  });
  await readJson(response);
}

export async function probeSeedsApi(
  workspaceId: string,
  projectId: string,
  market: string,
  seeds: ProbeSeedInput[],
  attemptId: string
): Promise<ProbeResponse> {
  const response = await fetch("/api/market-research/probe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, projectId, market, seeds, attemptId }),
  });
  return readJson<ProbeResponse>(response);
}

export async function startExtractApi(
  workspaceId: string,
  projectId: string,
  market: string,
  seeds: Array<ProbeSeedInput & { rawKeywordEstimate: number }>
): Promise<ExtractStartResponse> {
  const response = await fetch("/api/market-research/extract/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, projectId, market, seeds }),
  });
  return readJson<ExtractStartResponse>(response);
}

export async function pollExtractApi(
  workspaceId: string,
  projectId: string,
  extractId: string,
  cursors?: Array<{
    seedId: string;
    cursor?: string;
    status?: ExtractPollSeed["status"];
  }>
): Promise<{
  seeds: ExtractPollSeed[];
  allDone: boolean;
  rowsReturned: number;
  settledUsd?: number;
  billingPending?: boolean;
  sample?: import("./map-keywords").DisplayKeyword[];
}> {
  const response = await fetch("/api/market-research/extract/poll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, projectId, extractId, cursors }),
  });
  return readJson(response);
}

export type ExtractStatusResponse = {
  extract: {
    id: string;
    status: string;
    billingStatus: string;
    rowsReturned: number;
    heldUsd: number;
    actualUsd: number;
    createdAt: string;
  } | null;
  seeds: Array<{
    seedId: string;
    term: string;
    status: string;
    rowsReturned: number;
    pages: number;
  }>;
  sample?: import("./map-keywords").DisplayKeyword[];
};

export async function extractStatusApi(
  workspaceId: string,
  projectId: string,
  extractId?: string
): Promise<ExtractStatusResponse> {
  const params = new URLSearchParams({ workspaceId, projectId });
  if (extractId) params.set("extractId", extractId);
  const response = await fetch(
    `/api/market-research/extract/status?${params.toString()}`
  );
  return readJson<ExtractStatusResponse>(response);
}

export async function cancelExtractApi(
  workspaceId: string,
  projectId: string,
  extractId: string
): Promise<{ rowsReturned: number; settledUsd: number }> {
  const response = await fetch("/api/market-research/extract/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, projectId, extractId }),
  });
  return readJson(response);
}

export type PushCollectionsStoreResult = {
  id: string;
  name: string;
  storeTitle?: string;
  handle?: string;
  storeCollectionId?: string;
  success: boolean;
  error?: string;
};

export async function pushCollectionsApi(
  workspaceId: string,
  projectId: string,
  collectionIds: string[]
): Promise<{
  chargedUsd: number;
  duplicate?: boolean;
  storeResults?: PushCollectionsStoreResult[];
}> {
  const response = await fetch("/api/market-research/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, projectId, collectionIds }),
  });
  return readJson(response);
}

// ─── Internal link graph as a cursor job ──────────────────────────────────
//
// Builds the link graph for the given (just-pushed) collection ids and
// persists it server-side page by page, so the "Links" column in Tab 6 fills
// in progressively while the user is still on the push animation / Tab 5.
// The canonical collection list (with real storeHandles) is loaded from
// storage server-side — only the target ids travel over the wire, so a
// 10k-collection push never risks a giant request body.

export type BuildInternalLinksPageResponse = {
  offset: number;
  nextOffset: number;
  done: boolean;
  processed: number;
  total: number;
  linksByCollectionId: Record<string, CollectionLink[]>;
};

export async function buildInternalLinksPageApi(
  workspaceId: string,
  projectId: string,
  collectionIds: string[],
  offset: number
): Promise<BuildInternalLinksPageResponse> {
  const response = await fetch("/api/market-research/agent/internal-links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, projectId, collectionIds, offset }),
  });
  return readJson(response);
}

/**
 * Fire-and-forget from the caller's perspective — a failure on any page just
 * means on-page generation falls back to building that page's links inline,
 * as it always used to. `onProgress` is called after every page so the
 * caller can merge the new links in and show a "Links x/y" badge.
 */
export async function runBuildInternalLinksLoop(
  workspaceId: string,
  projectId: string,
  collectionIds: string[],
  onProgress?: (state: BuildInternalLinksPageResponse) => void,
  isCancelled?: () => boolean
): Promise<void> {
  if (collectionIds.length === 0) return;
  let offset = 0;
  let guard = 0;
  const MAX_CALLS = 500;
  for (;;) {
    if (isCancelled?.() || guard >= MAX_CALLS) break;
    const res = await buildInternalLinksPageApi(
      workspaceId,
      projectId,
      collectionIds,
      offset
    );
    onProgress?.(res);
    guard += 1;
    if (res.done) break;
    offset = res.nextOffset;
  }
}

export async function syncSeoApi(
  workspaceId: string,
  projectId: string,
  collectionIds?: string[]
): Promise<{
  ok: boolean;
  syncedCount: number;
  results?: Array<{ collectionId: string; ok: boolean; error?: string }>;
  errors?: string[];
}> {
  const response = await fetch("/api/market-research/sync-seo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, projectId, collectionIds }),
  });
  return readJson(response);
}

export type AgentAnalyzeResponse = {
  storeName: string;
  provider: string;
  baseUrl: string;
  isMock: boolean;
  niches: Array<{ id: string; name: string; summary: string }>;
  structuredNiches: Array<{
    id: string;
    name: string;
    productCount: number;
    collections: Array<{
      id: string;
      name: string;
      productCount: number;
      description: string;
      plpPath: string;
      lastSyncedLabel?: string;
    }>;
  }>;
  agentConclusion: string;
  beats: Array<{ at: number; text: string }>;
  isAiGenerated: boolean;
};

export async function analyzeStoreApi(
  workspaceId: string,
  projectId?: string
): Promise<AgentAnalyzeResponse> {
  const response = await fetch("/api/market-research/agent/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, projectId }),
  });
  return readJson<AgentAnalyzeResponse>(response);
}

export type AgentChatResponse = {
  reply: string;
  updatedNiches?: Array<{ id: string; name: string; summary: string }>;
  updatedStructuredNiches?: Array<{
    id: string;
    name: string;
    productCount: number;
    collections: Array<any>;
  }>;
};

export async function chatAgentApi(
  workspaceId: string,
  projectId: string | undefined,
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>,
  userMessage: string,
  currentNiches?: Array<{ id: string; name: string; summary: string }>,
  opts?: {
    stage?: number;
    market?: string;
    selectedCollectionIds?: string[];
    seedRows?: Array<any>;
    probes?: Record<string, any>;
  }
): Promise<AgentChatResponse> {
  const response = await fetch("/api/market-research/agent/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      projectId,
      stage: opts?.stage ?? 1,
      market: opts?.market,
      messages,
      userMessage,
      currentNiches,
      selectedCollectionIds: opts?.selectedCollectionIds,
      seedRows: opts?.seedRows,
      probes: opts?.probes,
    }),
  });
  return readJson<AgentChatResponse>(response);
}

export type AgentSeedsResponse = {
  seedRows: Array<{
    id: string;
    collectionId: string;
    broadSeedVariation: string;
    canonicalNicheSeed: string;
    selectedCollection: string;
    broadParentNiche: string;
    productCount: number;
    variationType: any;
    scopeMatch: any;
  }>;
  isAiGenerated: boolean;
};

// ─── Paginated product fetch (Tab 2 -> Tab 3) ──────────────────────────────

export type ProductFetchCursor = {
  collectionIndex: number;
  shopifyAfter: string | null;
  wooPage: number;
  totalFetched: number;
  perCollectionFetched: Record<string, number>;
  done: boolean;
};

export type ProductsFetchResponse = {
  cursor: ProductFetchCursor;
  fetchedThisCall: number;
  totalFetched: number;
  done: boolean;
  productCountByCollectionId: Record<string, number>;
};

export async function fetchProductsPageApi(
  workspaceId: string,
  projectId: string,
  selectedCollections: Array<{
    id: string;
    name: string;
    description?: string;
    productCount?: number;
    parentNicheName?: string;
  }>,
  cursor: ProductFetchCursor | null
): Promise<ProductsFetchResponse> {
  const response = await fetch("/api/market-research/products/fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, projectId, selectedCollections, cursor }),
  });
  return readJson<ProductsFetchResponse>(response);
}

/**
 * Drives `fetchProductsPageApi` to completion, calling `onProgress` after
 * every page. Sequential by design — pagination cursors are stateful per
 * collection, so calls must never overlap.
 */
export async function runProductsFetchLoop(
  workspaceId: string,
  projectId: string,
  selectedCollections: Array<{
    id: string;
    name: string;
    description?: string;
    productCount?: number;
    parentNicheName?: string;
  }>,
  onProgress?: (state: { totalFetched: number; done: boolean }) => void,
  isCancelled?: () => boolean
): Promise<Record<string, number>> {
  let cursor: ProductFetchCursor | null = null;
  let productCountByCollectionId: Record<string, number> = {};
  let guard = 0;
  const MAX_CALLS = 200; // 200 * ~40s budget covers far more than the 20k cap ever needs

  do {
    if (isCancelled?.()) break;
    const res = await fetchProductsPageApi(
      workspaceId,
      projectId,
      selectedCollections,
      cursor
    );
    cursor = res.cursor;
    productCountByCollectionId = res.productCountByCollectionId;
    onProgress?.({ totalFetched: res.totalFetched, done: res.done });
    guard += 1;
  } while (!cursor.done && guard < MAX_CALLS);

  return productCountByCollectionId;
}

// ─── Embedding passes (Tab 3 -> 4 products, Tab 4 -> 5 terms) ─────────────

export type EmbedPassResponse = {
  offset: number;
  nextOffset: number;
  done: boolean;
  processed: number;
  embedded: number;
  skipped: number;
  total: number;
};

export async function embedProductsPageApi(
  workspaceId: string,
  projectId: string,
  collectionIds: string[],
  offset: number
): Promise<EmbedPassResponse> {
  const response = await fetch("/api/market-research/embeddings/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, projectId, collectionIds, offset }),
  });
  return readJson<EmbedPassResponse>(response);
}

export async function runEmbedProductsLoop(
  workspaceId: string,
  projectId: string,
  collectionIds: string[],
  onProgress?: (state: EmbedPassResponse) => void,
  isCancelled?: () => boolean
): Promise<void> {
  let offset = 0;
  let guard = 0;
  const MAX_CALLS = 200;
  for (;;) {
    if (isCancelled?.() || guard >= MAX_CALLS) break;
    const res = await embedProductsPageApi(workspaceId, projectId, collectionIds, offset);
    onProgress?.(res);
    guard += 1;
    if (res.done) break;
    offset = res.nextOffset;
  }
}

export async function embedTermsPageApi(
  workspaceId: string,
  projectId: string,
  offset: number
): Promise<EmbedPassResponse> {
  const response = await fetch("/api/market-research/embeddings/terms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, projectId, offset }),
  });
  return readJson<EmbedPassResponse>(response);
}

export async function runEmbedTermsLoop(
  workspaceId: string,
  projectId: string,
  onProgress?: (state: EmbedPassResponse) => void,
  isCancelled?: () => boolean
): Promise<void> {
  let offset = 0;
  let guard = 0;
  const MAX_CALLS = 200;
  for (;;) {
    if (isCancelled?.() || guard >= MAX_CALLS) break;
    const res = await embedTermsPageApi(workspaceId, projectId, offset);
    onProgress?.(res);
    guard += 1;
    if (res.done) break;
    offset = res.nextOffset;
  }
}

// ─── Stage 4 classification over the full extract archive ────────────────

export type ClassifyArchiveResponse = {
  offset: number;
  nextOffset: number;
  done: boolean;
  processed: number;
  total: number;
  categoryCount: number;
  informationalCount: number;
  excludedCount: number;
  isAiGenerated: boolean;
};

export async function classifyArchivePageApi(
  workspaceId: string,
  projectId: string,
  offset: number
): Promise<ClassifyArchiveResponse> {
  const response = await fetch("/api/market-research/agent/intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, projectId, mode: "archive", offset }),
  });
  return readJson<ClassifyArchiveResponse>(response);
}

export async function runClassifyArchiveLoop(
  workspaceId: string,
  projectId: string,
  onProgress?: (state: ClassifyArchiveResponse) => void,
  isCancelled?: () => boolean
): Promise<ClassifyArchiveResponse | null> {
  let offset = 0;
  let guard = 0;
  const MAX_CALLS = 500;
  let last: ClassifyArchiveResponse | null = null;
  for (;;) {
    if (isCancelled?.() || guard >= MAX_CALLS) break;
    const res = await classifyArchivePageApi(workspaceId, projectId, offset);
    last = res;
    onProgress?.(res);
    guard += 1;
    if (res.done) break;
    offset = res.nextOffset;
  }
  return last;
}

// ─── Stage 5 clustering as a cursor job ───────────────────────────────────

export type ClusterPageResponse = {
  offset: number;
  nextOffset: number;
  done: boolean;
  processed: number;
  total: number;
  collections: ProposedCollection[];
  summary: {
    totalCollections: number;
    newCount: number;
    existingCount: number;
    mergeCount: number;
    totalVolume: number;
  };
  isAiGenerated: boolean;
};

export async function clusterCollectionsPageApi(
  workspaceId: string,
  projectId: string,
  offset: number
): Promise<ClusterPageResponse> {
  const response = await fetch("/api/market-research/agent/cluster", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, projectId, mode: "archive", offset }),
  });
  return readJson<ClusterPageResponse>(response);
}

export async function runClusterCollectionsLoop(
  workspaceId: string,
  projectId: string,
  onProgress?: (state: ClusterPageResponse) => void,
  isCancelled?: () => boolean
): Promise<ClusterPageResponse | null> {
  let offset = 0;
  let guard = 0;
  const MAX_CALLS = 500;
  let last: ClusterPageResponse | null = null;
  for (;;) {
    if (isCancelled?.() || guard >= MAX_CALLS) break;
    const res = await clusterCollectionsPageApi(workspaceId, projectId, offset);
    last = res;
    onProgress?.(res);
    guard += 1;
    if (res.done) break;
    offset = res.nextOffset;
  }
  return last;
}

// ─── Stage 5 Phase 3: duplicate-collection exclusion (runs once, after the
// cursor loop above is fully done) ─────────────────────────────────────────

export type DedupeCollectionsResponse = {
  collections: ProposedCollection[];
  duplicateCount: number;
};

export async function dedupeCollectionsApi(
  workspaceId: string,
  projectId: string
): Promise<DedupeCollectionsResponse> {
  const response = await fetch("/api/market-research/agent/dedupe-collections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, projectId }),
  });
  return readJson<DedupeCollectionsResponse>(response);
}

/**
 * Read-only snapshot of every fetched product for a project (merged across
 * shards). For display only — never fed back through autosave.
 */
export async function loadProjectProductsApi(
  workspaceId: string,
  projectId: string
): Promise<MarketResearchProduct[]> {
  const response = await fetch(
    `/api/market-research/products/list?workspaceId=${encodeURIComponent(workspaceId)}&projectId=${encodeURIComponent(projectId)}`
  );
  const data = await readJson<{ products: MarketResearchProduct[] }>(response);
  return data.products;
}

export async function generateSeedsApi(
  workspaceId: string,
  projectId: string | undefined,
  selectedCollections: Array<{
    id: string;
    name: string;
    description?: string;
    productCount: number;
    parentNicheName: string;
    nicheFullySelected?: boolean;
  }>
): Promise<AgentSeedsResponse> {
  const response = await fetch("/api/market-research/agent/seeds", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, projectId, selectedCollections }),
  });
  return readJson<AgentSeedsResponse>(response);
}

export type AgentClusterResponse = {
  collections: ProposedCollection[];
  summary: {
    totalCollections: number;
    newCount: number;
    existingCount: number;
    mergeCount: number;
    totalVolume: number;
  };
  isAiGenerated: boolean;
};

// ─── Stage 6 on-page copywriting as a cursor job ──────────────────────────
//
// "Generate" only has to run the Gemini copywriting pass now — the internal
// link graph was already built (or is still being built) by
// runBuildInternalLinksLoop right after push. The route resolves ids against
// the canonical "collections" slice server-side, so only ids travel here.

export type OnPageInstructionsContext = {
  seoTitle?: string;
  seoDescription?: string;
  collectionDescription?: string;
  faq?: string;
};

export type OnPageGenerationPageResponse = {
  offset: number;
  nextOffset: number;
  done: boolean;
  processed: number;
  total: number;
  contentById: Record<string, CollectionContent>;
  isAiGenerated: boolean;
};

export async function generateOnPagePageApi(
  workspaceId: string,
  projectId: string,
  collectionIds: string[],
  offset: number,
  context?: {
    parentNiches?: string[];
    customInstructions?: OnPageInstructionsContext;
  }
): Promise<OnPageGenerationPageResponse> {
  const response = await fetch("/api/market-research/agent/on-page", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      projectId,
      parentNiches: context?.parentNiches,
      customInstructions: context?.customInstructions,
      collectionIds,
      offset,
    }),
  });
  return readJson<OnPageGenerationPageResponse>(response);
}

export async function runOnPageGenerationLoop(
  workspaceId: string,
  projectId: string,
  collectionIds: string[],
  context?: {
    parentNiches?: string[];
    customInstructions?: OnPageInstructionsContext;
  },
  onProgress?: (state: OnPageGenerationPageResponse) => void,
  isCancelled?: () => boolean
): Promise<OnPageGenerationPageResponse | null> {
  let offset = 0;
  let guard = 0;
  const MAX_CALLS = 500;
  let last: OnPageGenerationPageResponse | null = null;
  for (;;) {
    if (isCancelled?.() || guard >= MAX_CALLS) break;
    const res = await generateOnPagePageApi(
      workspaceId,
      projectId,
      collectionIds,
      offset,
      context
    );
    last = res;
    onProgress?.(res);
    guard += 1;
    if (res.done) break;
    offset = res.nextOffset;
  }
  return last;
}

// ─── Stage 7: content plan and articles ──────────────────────────────────────

export type AgentStrategyResponse = {
  articles: StrategyArticle[];
  isAiGenerated: boolean;
  droppedByCap: number;
  mergedByIntent: number;
};

export async function buildContentPlanApi(
  workspaceId: string,
  projectId: string | undefined,
  keywords: Array<{
    id: string;
    keyword: string;
    sheet?: string;
    volume?: number;
    difficulty?: number;
    seedId?: string;
    seed?: string;
  }>,
  context?: {
    parentNiches?: string[];
    collections?: Array<{
      id: string;
      name: string;
      headKeyword?: string;
      parentNiche?: string;
      volume?: number;
      productCount?: number;
      storeHandle?: string;
    }>;
  }
): Promise<AgentStrategyResponse> {
  const response = await fetch("/api/market-research/agent/strategy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      projectId,
      keywords,
      parentNiches: context?.parentNiches,
      collections: context?.collections,
    }),
  });
  return readJson<AgentStrategyResponse>(response);
}

export type StoreBlogsResponse = {
  blogs: StoreBlog[];
  provider: string | null;
  /** Storefront origin, used to render clickable absolute collection links. */
  storeUrl: string;
  /** False when the store's token cannot read or write blog content. */
  contentAccess: boolean;
  scopeWarning?: string | null;
};

export async function fetchStoreBlogsApi(
  workspaceId: string
): Promise<StoreBlogsResponse> {
  const response = await fetch(
    `/api/market-research/blogs?workspaceId=${encodeURIComponent(workspaceId)}`
  );
  return readJson<StoreBlogsResponse>(response);
}

export async function writeArticleApi(
  workspaceId: string,
  projectId: string | undefined,
  article: {
    id: string;
    title: string;
    keyword: string;
    type: "guide" | "comparison" | "faq" | "roundup";
    volume?: number;
    difficulty?: number;
    linksOut?: Array<{ anchor: string; url: string; collectionName: string }>;
    skuLinks?: Array<{ anchor: string; url: string; productName: string }>;
  },
  blogs?: StoreBlog[],
  storeUrl?: string
): Promise<{ article: GeneratedArticle; cost: number }> {
  const response = await fetch("/api/market-research/agent/article", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, projectId, article, blogs, storeUrl }),
  });
  return readJson<{ article: GeneratedArticle; cost: number }>(response);
}

export type ArticleSyncResponse = {
  ok: boolean;
  syncedCount: number;
  timeZone: string;
  results: Array<{
    articleId: string;
    ok: boolean;
    scheduledAt?: string;
    storeArticleId?: string;
    storeHandle?: string;
    coverApplied?: boolean;
    /** The article was already on the store's calendar, so it was not re-created. */
    alreadySynced?: boolean;
    error?: string;
  }>;
};

export async function syncArticlesApi(
  workspaceId: string,
  projectId: string,
  articles: Array<{
    articleId: string;
    title: string;
    seoTitle?: string;
    seoDescription?: string;
    blogTitle?: string;
    bodyHtml: string;
    featuredImage?: { url: string; alt: string };
  }>
): Promise<ArticleSyncResponse> {
  const response = await fetch("/api/market-research/articles/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, projectId, articles }),
  });
  return readJson<ArticleSyncResponse>(response);
}

