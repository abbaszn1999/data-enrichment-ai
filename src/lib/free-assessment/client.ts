import type { KeywordRow } from "./providers/keyword-provider";
import type { SearchIntent } from "./providers/semrush-codes";
import type { MarketResearchPersisted } from "@/components/free-assessment/persistence";
import type { MarketResearchProject } from "@/components/free-assessment/mock-data";
import type { ProposedCollection } from "@/components/free-assessment/workspace-data";
import type { AssessmentPlpRow } from "@/components/free-assessment/assessment-csv";

/**
 * Free-assessment API prefix. Wallet lives here so it never hits /api/wallet
 * (Growth Engine).
 */
export const FREE_ASSESSMENT_API = "/api/free-assessment";

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

export async function loadFaStateApi(
  workspaceId: string
): Promise<MarketResearchPersisted> {
  const response = await fetch(
    `${FREE_ASSESSMENT_API}/state?workspaceId=${encodeURIComponent(workspaceId)}`
  );
  const data = await readJson<{ state: MarketResearchPersisted }>(response);
  return data.state;
}

export async function saveFaStateApi(
  workspaceId: string,
  state: MarketResearchPersisted
): Promise<void> {
  const response = await fetch(`${FREE_ASSESSMENT_API}/state`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, state }),
  });
  await readJson(response);
}

export async function createFaProjectApi(
  workspaceId: string,
  input: {
    name: string;
    storeLabel?: string;
    highlightedCollectionIds?: string[];
  }
): Promise<Pick<MarketResearchProject, "id" | "name">> {
  const response = await fetch(`${FREE_ASSESSMENT_API}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, ...input }),
  });
  const data = await readJson<{ project: { id: string; name: string } }>(
    response
  );
  return data.project;
}

export async function deleteFaProjectApi(
  workspaceId: string,
  projectId: string
): Promise<void> {
  const response = await fetch(`${FREE_ASSESSMENT_API}/projects`, {
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
  const response = await fetch(`${FREE_ASSESSMENT_API}/probe`, {
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
  const response = await fetch(`${FREE_ASSESSMENT_API}/extract/start`, {
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
  const response = await fetch(`${FREE_ASSESSMENT_API}/extract/poll`, {
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
    `${FREE_ASSESSMENT_API}/extract/status?${params.toString()}`
  );
  return readJson<ExtractStatusResponse>(response);
}

export async function cancelExtractApi(
  workspaceId: string,
  projectId: string,
  extractId: string
): Promise<{ rowsReturned: number; settledUsd: number }> {
  const response = await fetch(`${FREE_ASSESSMENT_API}/extract/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, projectId, extractId }),
  });
  return readJson(response);
}

export type AgentAnalyzeResponse = {
  rowCount: number;
  niches: Array<{ id: string; name: string; summary: string }>;
  structuredNiches: Array<{
    id: string;
    name: string;
    productCount: number;
    collections: Array<{
      id: string;
      name: string;
      productCount: number;
      description?: string;
    }>;
  }>;
  agentConclusion: string;
  beats: Array<{ at: number; text: string }>;
  isAiGenerated: boolean;
};

export async function analyzeSheetApi(
  workspaceId: string,
  projectId: string | undefined,
  plpRows: AssessmentPlpRow[]
): Promise<AgentAnalyzeResponse> {
  const response = await fetch(`${FREE_ASSESSMENT_API}/agent/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      projectId,
      plpRows: plpRows.map((row) => ({
        name: row.name,
        pageType: row.pageType,
        skuCount: row.skuCount,
        description: row.description || undefined,
      })),
    }),
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
    plpRows?: AssessmentPlpRow[];
  }
): Promise<AgentChatResponse> {
  const response = await fetch(`${FREE_ASSESSMENT_API}/agent/chat`, {
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
      plpRows: opts?.plpRows,
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

export async function generateSeedsApi(
  workspaceId: string,
  projectId: string | undefined,
  storeLabel: string | undefined,
  selectedCollections: Array<{
    id: string;
    name: string;
    description?: string;
    productCount: number;
    parentNicheName: string;
    nicheFullySelected?: boolean;
  }>
): Promise<AgentSeedsResponse> {
  const response = await fetch(`${FREE_ASSESSMENT_API}/agent/seeds`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, projectId, storeLabel, selectedCollections }),
  });
  return readJson<AgentSeedsResponse>(response);
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
  const response = await fetch(`${FREE_ASSESSMENT_API}/agent/intent`, {
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
  const response = await fetch(`${FREE_ASSESSMENT_API}/agent/cluster`, {
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
  const response = await fetch(`${FREE_ASSESSMENT_API}/agent/dedupe-collections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, projectId }),
  });
  return readJson<DedupeCollectionsResponse>(response);
}
