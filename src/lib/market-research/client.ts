import type { KeywordRow } from "./providers/keyword-provider";
import type { SearchIntent } from "./providers/semrush-codes";
import type { MarketResearchPersisted } from "@/components/market-research/persistence";
import type { MarketResearchProject } from "@/components/market-research/mock-data";
import type {
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
  cursors: Array<{
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
}> {
  const response = await fetch("/api/market-research/extract/poll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, projectId, extractId, cursors }),
  });
  return readJson(response);
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

export async function pushCollectionsApi(
  workspaceId: string,
  projectId: string,
  collectionIds: string[]
): Promise<{ chargedUsd: number; duplicate?: boolean }> {
  const response = await fetch("/api/market-research/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, projectId, collectionIds }),
  });
  return readJson(response);
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
  products?: MarketResearchProduct[];
};

export async function generateSeedsApi(
  workspaceId: string,
  projectId: string | undefined,
  selectedCollections: Array<{
    id: string;
    name: string;
    description?: string;
    productCount: number;
    parentNicheName: string;
  }>
): Promise<AgentSeedsResponse> {
  const response = await fetch("/api/market-research/agent/seeds", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, projectId, selectedCollections }),
  });
  return readJson<AgentSeedsResponse>(response);
}

export type AgentIntentResponse = {
  classified: Array<{
    id: string;
    keyword: string;
    sheet: "category" | "informational" | "excluded";
    confidence: number;
    reason: string;
    plpConcept?: string;
  }>;
  summary: {
    total: number;
    categoryCount: number;
    informationalCount: number;
    excludedCount: number;
  };
  isAiGenerated: boolean;
};

export async function classifyIntentApi(
  workspaceId: string,
  projectId: string | undefined,
  keywords: Array<{
    id: string;
    keyword: string;
    seed?: string;
    volume?: number;
    difficulty?: number;
    intents?: string[];
  }>,
  context?: {
    parentNiches?: string[];
    collections?: string[];
  }
): Promise<AgentIntentResponse> {
  const response = await fetch("/api/market-research/agent/intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      projectId,
      parentNiches: context?.parentNiches,
      collections: context?.collections,
      keywords,
    }),
  });
  return readJson<AgentIntentResponse>(response);
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

export async function clusterCollectionsApi(
  workspaceId: string,
  projectId: string | undefined,
  keywords: Array<{
    id: string;
    keyword: string;
    seed?: string;
    volume?: number;
    difficulty?: number;
    plpConcept?: string;
    reason?: string;
  }>,
  context?: {
    parentNiches?: string[];
    seedRows?: Array<{
      id: string;
      canonicalNicheSeed: string;
      broadSeedVariation: string;
      selectedCollection: string;
      broadParentNiche: string;
      productCount: number;
      scopeMatch: string;
    }>;
  }
): Promise<AgentClusterResponse> {
  const response = await fetch("/api/market-research/agent/cluster", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      projectId,
      parentNiches: context?.parentNiches,
      seedRows: context?.seedRows,
      keywords,
    }),
  });
  return readJson<AgentClusterResponse>(response);
}

export type AgentOnPageResponse = {
  contentById: Record<
    string,
    {
      collectionId: string;
      seoTitle: string;
      seoDescription: string;
      collectionDescription: string;
      faqs: Array<{ q: string; a: string }>;
      links: Array<{ label: string; href: string }>;
    }
  >;
  isAiGenerated: boolean;
};

export async function generateOnPageApi(
  workspaceId: string,
  projectId: string | undefined,
  collections: Array<{
    id: string;
    name: string;
    headKeyword: string;
    parentNiche: string;
    volume: number;
    difficulty: number;
    productCount: number;
    keywordCount: number;
    status: "new" | "existing" | "merge";
    existingName?: string;
  }>,
  context?: {
    parentNiches?: string[];
    customInstructions?: {
      seoTitle?: string;
      seoDescription?: string;
      collectionDescription?: string;
      faq?: string;
    };
  }
): Promise<AgentOnPageResponse> {
  const response = await fetch("/api/market-research/agent/on-page", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      projectId,
      parentNiches: context?.parentNiches,
      customInstructions: context?.customInstructions,
      collections,
    }),
  });
  return readJson<AgentOnPageResponse>(response);
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
  },
  blogs?: StoreBlog[]
): Promise<{ article: GeneratedArticle; cost: number }> {
  const response = await fetch("/api/market-research/agent/article", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, projectId, article, blogs }),
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

