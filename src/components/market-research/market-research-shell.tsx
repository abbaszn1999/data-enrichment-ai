"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Settings, Store, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageLoader } from "@/components/brand/page-loader";
import { useAuth } from "@/hooks/use-auth";
import { useWallet } from "@/hooks/use-wallet";
import { useWorkspace } from "@/hooks/use-workspace";
import { useRole } from "@/hooks/use-role";
import { useWorkspaceStore } from "@/store/workspace-store";
import { previewBalance } from "@/lib/market-research/billing";
import {
  analyzeStoreApi,
  buildContentPlanApi,
  cancelExtractApi,
  chatAgentApi,
  createMrProjectApi,
  deleteMrProjectApi,
  fetchStoreBlogsApi,
  generateSeedsApi,
  loadMrStateApi,
  loadProjectProductsApi,
  pollExtractApi,
  extractStatusApi,
  probeSeedsApi,
  dedupeCollectionsApi,
  pushCollectionsApi,
  runBuildInternalLinksLoop,
  runClassifyArchiveLoop,
  runClusterCollectionsLoop,
  runEmbedProductsLoop,
  runEmbedTermsLoop,
  runOnPageGenerationLoop,
  runProductsFetchLoop,
  saveMrStateApi,
  startExtractApi,
  syncArticlesApi,
  syncSeoApi,
  writeArticleApi,
  type ArticleSyncResponse,
} from "@/lib/market-research/client";
import {
  actualExtractCostUsd,
  collectionPushCostUsd,
  estimateProbeCostUsd,
} from "@/lib/market-research/cost";
import {
  assignUuidProjectIds,
  DEFAULT_SKU_FLOOR,
} from "@/lib/market-research/project-state";
import { clearSelectedContent } from "@/lib/market-research/collection-sheet";
import {
  appendKeywordRows,
  applyKeywordClassifications,
  toExtractedKeyword,
} from "@/lib/market-research/map-keywords";
import type {
  CollectionContent,
  CollectionLink,
  ExtractedKeyword,
  MarketResearchProduct,
  ProposedCollection,
} from "./workspace-data";
import {
  AgentPanel,
  type Stage1ChatMessage,
} from "./agent-panel";
import { AnalysisInvite } from "./analysis-invite";
import { NewProjectOverlay } from "./new-project-overlay";
import {
  clampOpenedStage,
  emptyMarketResearchState,
  isMarketResearchMigrated,
  loadMarketResearchState,
  markMarketResearchMigrated,
  saveMarketResearchState,
  type MarketResearchPersisted,
} from "./persistence";
import { ProjectsSidebar } from "./projects-sidebar";
import { StageScopePanel } from "./stage-scope-panel";
import { StageSelectPanel } from "./stage-select-panel";
import { StageSeedsPanel } from "./stage-seeds-panel";
import { InsufficientFundsDialog } from "./insufficient-funds-dialog";
import { DeepWorkspace } from "./deep-workspace";
import { WorkspaceStepper } from "./workspace-stepper";
import {
  RunTimeline,
  StageStepper,
  type StageReceipt,
  type StageStep,
  type StageStepStatus,
} from "./run-timeline";
import {
  DEFAULT_MARKET,
  MAX_MARKET_RESEARCH_PROJECTS,
  PROBE_BEATS,
  STAGE1_ANALYSIS_BEATS,
  STAGE1_ANALYSIS_MS,
  STAGE1_NICHE_READINGS,
  STAGE2_PREP_BEATS,
  STAGE2_PREP_MS,
  STAGE3_PREP_BEATS,
  STAGE3_PREP_MS,
  STAGE_META,
  collectionNamesForIds,
  countProductsForCollections,
  createInitialProjects,
  createManualSeedRow,
  estimateSelection,
  formatProductCount,
  formatUsd,
  getSeedRowsForCollections,
  groupSeedRowsByCanonical,
  marketLabel,
  probeAgentReady,
  stage1AgentConclusion,
  stage2AgentReady,
  stage3AgentReady,
  type MarketResearchProject,
  type MarketResearchStage,
  type MockExcludedItem,
  type MockNiche,
  type MockSeedRow,
  type NicheReading,
  type SeedProbe,
} from "./mock-data";
import {
  ANALYZE_MS,
  CLUSTER_MS,
  CONTENT_MS,
  STRATEGY_MS,
  USD_PER_COLLECTION,
  buildCollectionContent,
  EMPTY_ON_PAGE_INSTRUCTIONS,
  clampWorkspaceTab,
  briefStageFromFlow,
  isWorkspaceTab,
  maxTab,
  pulledCountForSeed,
  filterKeywords,
  DEFAULT_SHEET_FILTERS,
  type FlowTab,
  type GeneratedArticle,
  type KeywordFilters,
  type OnPageInstructions,
  type SeedExtractProgress,
  type SheetKeywordFilters,
  type StoreBlog,
  type StrategyArticle,
  type WorkspaceTab,
  ARTICLE_GENERATION_CONCURRENCY,
  ARTICLE_SYNC_BATCH_SIZE,
} from "./workspace-data";

const DEFAULT_STORE = "Demo Shopify store";
const EMPTY_IDS: string[] = [];
const EMPTY_EXCLUDED_ITEMS: MockExcludedItem[] = [];

function msgId() {
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Only clear re-read intent — a full pass is expensive, so anything looser
 * asks for confirmation instead of firing automatically.
 */
function looksLikeReanalyzeRequest(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /re-?read|re-?scan|re-?analy|read (it|the site|the store) again|analyze again|scan again|another pass|start over/.test(
      t
    ) ||
    /أعد التحليل|حلل مرة أخرى|أعد قراءة|إعادة التحليل|حلل الموقع مرة/.test(text)
  );
}

/** Softer signals that the Stage 1 read is wrong — we offer a re-read chip. */
function looksLikeReadDisagreement(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /not only|don'?t only|do not only|i don'?t sell|i do not sell|not just|that'?s wrong|incorrect|missing/.test(
      t
    ) || /لست أبيع|لا أبيع فقط|مش بس|غلط|خطأ|ناقص|ليس فقط/.test(text)
  );
}

function mockAgentReply(
  text: string,
  storeLabel: string,
  stage: MarketResearchStage
): string {
  if (looksLikeReanalyzeRequest(text) || looksLikeReadDisagreement(text)) {
    return `Noted for ${storeLabel}. I can run a full re-read with that correction in mind — confirm below and I’ll start another pass.`;
  }
  if (stage === 2) {
    if (/select|collection|catalog|نطاق|مجموعة/i.test(text)) {
      return "In Stage 2 you’re choosing source collections under the Stage 1 niches — not the final niche to dominate. Press Next when the selection feels right to generate broad seed variations.";
    }
    if (/next|seed|stage 3|بذور|التالي/i.test(text)) {
      return "Select at least one collection, then press Next on the right. I’ll open Stage 3 and build broad seed rows from those collections only.";
    }
    return "This catalog view is built from the Stage 1 niche read we locked. Ask about any collection, or go back to Stage 1 if the niches feel wrong.";
  }
  if (stage === 3) {
    if (/narrow|aviator|polarized|stem|long-?tail|ضيق/i.test(text)) {
      return "Those narrower styles and long-tails stay out of Stage 3 on purpose. We only prepare broad seed wording here — deep research comes after you pick a niche later.";
    }
    return "These rows are broad seed variations from your Stage 2 catalog scope — one wording per row for later demand checks. Go back to Select if you want to change the source collections.";
  }
  if (/eyewear|sunglasses|نظارات/i.test(text)) {
    return "On this first read, Eyewear looks like a real parent niche — sunglasses and related optical products. Challenge it anytime, or press Next when you’re ready for catalog scope.";
  }
  if (/toy|ألعاب/i.test(text)) {
    return "Toys showed up as a broad parent niche (toys in general). If that’s incomplete, ask me to re-read — or press Next when the Stage 1 picture feels right.";
  }
  if (/watch|ساعات/i.test(text)) {
    return "Watches appeared as a separate parent niche beside Eyewear and Toys. Discuss freely, then use Next to open catalog scope.";
  }
  if (/next|stage 2|catalog|التالي/i.test(text)) {
    return "When you’re happy with these parent niches, press Next on the right. I’ll open Stage 2 and expand them into collections in the background.";
  }
  return `I can speak from this Stage 1 website read of ${storeLabel}: the parent niches on the right. Ask about any of them, correct me, re-read the store, or press Next when you’re ready.`;
}

/**
 * Market Research shell — Stage 1 conversational niche read.
 * Stage 2 appears only after Next (new tab), while the agent prepares catalog scope.
 */
export function MarketResearchShell() {
  const router = useRouter();
  const params = useParams();
  const slug = params.workspaceSlug as string;
  const { user } = useAuth();
  const {
    workspace,
    role,
    hasIntegration,
    isLoading: wsLoading,
  } = useWorkspace(slug, user);
  const { canEdit, canAdmin } = useRole(role);
  const workspaceId = workspace?.id ?? "";
  const { wallet } = useWallet(workspaceId || null);
  const invalidateWallet = useWorkspaceStore((s) => s.invalidateWallet);
  const persistReady = useRef(false);
  const persistRemote = useRef(false);
  const skipPersistSave = useRef(true);

  const [insufficientFundsDialog, setInsufficientFundsDialog] = useState<{
    open: boolean;
    requiredAmount: number;
    currentBalance: number | null;
    actionName?: string;
  }>({
    open: false,
    requiredAmount: 0,
    currentBalance: 0,
  });

  const [hydrated, setHydrated] = useState(false);
  const [projects, setProjects] = useState<MarketResearchProject[]>(() =>
    createInitialProjects()
  );
  const [activeProjectId, setActiveProjectId] = useState("");
  const [stage, setStage] = useState<MarketResearchStage>(1);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [projectFilter, setProjectFilter] = useState<"active" | "completed">(
    "active"
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [stage1DoneIds, setStage1DoneIds] = useState<Set<string>>(
    () => new Set()
  );
  /** Highest stage opened via Next — Stage 2 tab never appears until this ≥ 2. */
  const [openedMaxByProject, setOpenedMaxByProject] = useState<
    Record<string, MarketResearchStage>
  >({});
  const [stageByProject, setStageByProject] = useState<
    Record<string, MarketResearchStage>
  >({});
  const [analyzing, setAnalyzing] = useState(false);
  const [preparingStage2, setPreparingStage2] = useState(false);
  const [preparingStage3, setPreparingStage3] = useState(false);
  const [stage2ReadyIds, setStage2ReadyIds] = useState<Set<string>>(
    () => new Set()
  );
  const [stage3ReadyIds, setStage3ReadyIds] = useState<Set<string>>(
    () => new Set()
  );
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteDismissedIds, setInviteDismissedIds] = useState<Set<string>>(
    () => new Set()
  );
  const [chatByProject, setChatByProject] = useState<
    Record<string, Stage1ChatMessage[]>
  >({});
  const [chatBusy, setChatBusy] = useState(false);
  /** Collection ids each Stage 3 snapshot was generated from. */
  const [stage3ScopeByProject, setStage3ScopeByProject] = useState<
    Record<string, string[]>
  >({});
  const [seedSelectionByProject, setSeedSelectionByProject] = useState<
    Record<string, string[]>
  >({});
  const [rereadPendingIds, setRereadPendingIds] = useState<Set<string>>(
    () => new Set()
  );
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [nichesByProject, setNichesByProject] = useState<
    Record<string, NicheReading[]>
  >({});
  const [structuredNichesByProject, setStructuredNichesByProject] = useState<
    Record<string, MockNiche[]>
  >({});
  /** Non-taxonomic PLPs the Stage 1 taxonomy agent excluded — visible in
   *  Tab 2, never selectable, zero SKUs. */
  const [taxonomyExcludedByProject, setTaxonomyExcludedByProject] = useState<
    Record<string, MockExcludedItem[]>
  >({});
  /** Minimum SKUs a category/subcategory/PLP needs to be selectable in Tab
   *  2 — persistent per-project setting (default 100), promoted from a
   *  client-only QA test control. */
  const [skuFloorByProject, setSkuFloorByProject] = useState<
    Record<string, number>
  >({});
  const [productsByProject, setProductsByProject] = useState<
    Record<string, MarketResearchProduct[]>
  >({});
  /**
   * Real fetched-per-collection product counts from the paginated fetch
   * (Tab 2 -> 3), keyed by collectionId. Not persisted/autosaved — it's a
   * display cache; the source of truth is the sharded products manifest.
   */
  const [productCountByCollectionIdByProject, setProductCountByCollectionIdByProject] =
    useState<Record<string, Record<string, number>>>({});
  const [productFetchProgressByProject, setProductFetchProgressByProject] =
    useState<Record<string, { fetched: number; done: boolean } | undefined>>({});
  /** Product embedding pass, driven alongside the Apify extract poll (Tab 3 -> 4). */
  const [productEmbedProgressByProject, setProductEmbedProgressByProject] = useState<
    Record<string, { embedded: number; total: number; done: boolean } | undefined>
  >({});
  /** Category-term embedding pass, driven during the Tab 4 -> 5 loading. */
  const [termEmbedProgressByProject, setTermEmbedProgressByProject] = useState<
    Record<string, { embedded: number; total: number; done: boolean } | undefined>
  >({});
  const productEmbedGen = useRef<Record<string, number>>({});
  const termEmbedGen = useRef<Record<string, number>>({});
  const [seedRowsByProject, setSeedRowsByProject] = useState<
    Record<string, MockSeedRow[]>
  >({});
  const [marketByProject, setMarketByProject] = useState<
    Record<string, string>
  >({});
  const [probesByProject, setProbesByProject] = useState<
    Record<string, Record<string, SeedProbe>>
  >({});
  const [manualSeedsByProject, setManualSeedsByProject] = useState<
    Record<string, MockSeedRow[]>
  >({});
  const [committedProjectIds, setCommittedProjectIds] = useState<Set<string>>(
    () => new Set()
  );
  const [workspaceTabByProject, setWorkspaceTabByProject] = useState<
    Record<string, WorkspaceTab>
  >({});
  const [openedWorkspaceByProject, setOpenedWorkspaceByProject] = useState<
    Record<string, WorkspaceTab>
  >({});
  const [clusterSelectionByProject, setClusterSelectionByProject] = useState<
    Record<string, string[]>
  >({});
  const [proposedCollectionsByProject, setProposedCollectionsByProject] = useState<
    Record<string, ProposedCollection[]>
  >({});
  const [paidCollectionProjectIds, setPaidCollectionProjectIds] = useState<
    Set<string>
  >(() => new Set());
  /**
   * Which collection ids inside each project have actually been pushed and
   * paid for. Per-collection, not per-project: a partial push failure must
   * not lock out retrying the ones that failed, or publishing collections
   * added to the project afterward. `paidCollectionProjectIds` above is kept
   * only so already-migrated projects (pre-dating this field) still read as
   * fully paid; new writes always go through this map.
   */
  const [paidCollectionIdsByProject, setPaidCollectionIdsByProject] = useState<
    Record<string, string[]>
  >({});
  const [contentReadyIds, setContentReadyIds] = useState<Set<string>>(
    () => new Set()
  );
  const [pushedIds, setPushedIds] = useState<Set<string>>(() => new Set());
  const [analyzedProjectIds, setAnalyzedProjectIds] = useState<Set<string>>(
    () => new Set()
  );
  const [strategyReadyIds, setStrategyReadyIds] = useState<Set<string>>(
    () => new Set()
  );
  const [strategyApprovedIds, setStrategyApprovedIds] = useState<Set<string>>(
    () => new Set()
  );
  const [customInstructionByProject, setCustomInstructionByProject] = useState<
    Record<string, OnPageInstructions>
  >({});
  const [extractChargeByProject, setExtractChargeByProject] = useState<
    Record<string, number>
  >({});
  const [extractRowsByProject, setExtractRowsByProject] = useState<
    Record<string, number>
  >({});
  const [keywordsByProject, setKeywordsByProject] = useState<
    Record<string, ExtractedKeyword[]>
  >({});
  const [sheetFiltersByProject, setSheetFiltersByProject] = useState<
    Record<string, SheetKeywordFilters>
  >({});
  const [extractIdByProject, setExtractIdByProject] = useState<
    Record<string, string>
  >({});
  const [extractingProjectId, setExtractingProjectId] = useState<string | null>(
    null
  );
  const [extractProgress, setExtractProgress] = useState(0);
  const [seedProgress, setSeedProgress] = useState<SeedExtractProgress[]>([]);
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [clustering, setClustering] = useState(false);
  /** Live progress across the Stage 5 cluster cursor job's offset pages. */
  const [clusterProgress, setClusterProgress] = useState<{
    processed: number;
    total: number;
  } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [strategyLoading, setStrategyLoading] = useState(false);
  const [contentByIdByProject, setContentByIdByProject] = useState<
    Record<string, Record<string, CollectionContent>>
  >({});
  /**
   * Internal link graph, precomputed in the background right after collections
   * are pushed to the store (see handlePushToStore) so the "Links" column in
   * Tab 6 is already filled by the time the user opens it. Keyed by
   * collectionId, per project.
   */
  const [internalLinksByProject, setInternalLinksByProject] = useState<
    Record<string, Record<string, CollectionLink[]>>
  >({});
  /** Live progress across the background internal-link cursor job's pages. */
  const [linksBuildProgressByProject, setLinksBuildProgressByProject] =
    useState<Record<string, { processed: number; total: number } | null>>({});
  /** Live progress across the Stage 6 on-page copywriting cursor job's pages. */
  const [contentGenProgress, setContentGenProgress] = useState<{
    processed: number;
    total: number;
  } | null>(null);
  const [strategyByProject, setStrategyByProject] = useState<
    Record<string, StrategyArticle[]>
  >({});
  const [articlesByProject, setArticlesByProject] = useState<
    Record<string, Record<string, GeneratedArticle>>
  >({});
  const [storeBlogs, setStoreBlogs] = useState<StoreBlog[]>([]);
  const [storeUrl, setStoreUrl] = useState("");
  /** Connected store's provider id ("shopify" | "woocommerce" | "wordpress"),
   *  used to build the correct live collection URL pattern in Stage 6. */
  const [storeProvider, setStoreProvider] = useState<string | null>(null);
  const [blogScopeWarning, setBlogScopeWarning] = useState<string | null>(null);
  const [articlesSyncing, setArticlesSyncing] = useState(false);
  const [articlesSyncProgress, setArticlesSyncProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [pushingCollectionsByProject, setPushingCollectionsByProject] =
    useState<Record<string, boolean>>({});
  const [recheckingDuplicatesByProject, setRecheckingDuplicatesByProject] =
    useState<Record<string, boolean>>({});
  const [syncingSeoByProject, setSyncingSeoByProject] = useState<
    Record<string, boolean>
  >({});
  const [seoSyncedProjectIds, setSeoSyncedProjectIds] = useState<Set<string>>(
    () => new Set()
  );
  const [reviewFlow, setReviewFlow] = useState<FlowTab | null>(null);
  const [probingIds, setProbingIds] = useState<string[]>([]);
  const probeGen = useRef(0);
  const extractGen = useRef(0);
  const extractRunIds = useRef<string[]>([]);
  const extractIdRef = useRef("");
  const resumedExtract = useRef(new Set<string>());
  const resumedArticles = useRef(new Set<string>());
  const articleInFlight = useRef(new Set<string>());
  const generateArticlesRef = useRef<(ids: string[]) => Promise<void>>(
    async () => undefined
  );
  const analyzeGen = useRef(0);
  const clusterGen = useRef(0);
  const contentGen = useRef(0);
  const linksGen = useRef<Record<string, number>>({});
  const strategyGen = useRef(0);
  const analysisGen = useRef(0);
  const stage2Gen = useRef(0);
  const stage3Gen = useRef(0);
  const pendingAutoAnalyzeId = useRef<string | null>(null);
  const productsHydratedFor = useRef<Record<string, boolean>>({});

  const applySaved = useCallback((saved: MarketResearchPersisted) => {
    if (saved.projects.length === 0) {
      setProjects([]);
      setActiveProjectId("");
      setCreateOpen(true);
      return;
    }
    setProjects(saved.projects);
    const last =
      saved.projects.find((p) => p.id === saved.activeProjectId) ??
      saved.projects[0];
    setActiveProjectId(last.id);
    setProjectFilter(last.status);
    setStage1DoneIds(new Set(saved.stage1DoneIds));
    setOpenedMaxByProject(saved.openedMaxByProject ?? {});
    setStageByProject(saved.stageByProject ?? {});
    setChatByProject(saved.chatByProject ?? {});
    setStage3ScopeByProject(saved.stage3ScopeByProject ?? {});
    setSeedSelectionByProject(saved.seedSelectionByProject ?? {});
    setNichesByProject(saved.nichesByProject ?? {});
    setStructuredNichesByProject(saved.structuredNichesByProject ?? {});
    setTaxonomyExcludedByProject(saved.taxonomyExcludedByProject ?? {});
    setSkuFloorByProject(saved.skuFloorByProject ?? {});
    setSeedRowsByProject(saved.seedRowsByProject ?? {});
    setMarketByProject(saved.marketByProject ?? {});
    setProbesByProject(saved.probesByProject ?? {});
    setManualSeedsByProject(saved.manualSeedsByProject ?? {});
    setCommittedProjectIds(new Set(saved.committedProjectIds ?? []));
    setWorkspaceTabByProject(saved.workspaceTabByProject ?? {});
    setOpenedWorkspaceByProject(saved.openedWorkspaceByProject ?? {});
    setClusterSelectionByProject(saved.clusterSelectionByProject ?? {});
    setProposedCollectionsByProject(saved.proposedCollectionsByProject ?? {});
    setContentByIdByProject(saved.contentByIdByProject ?? {});
    setStrategyByProject(saved.strategyByProject ?? {});
    setArticlesByProject(saved.articlesByProject ?? {});
    setInternalLinksByProject(saved.internalLinksByProject ?? {});
    setPaidCollectionProjectIds(new Set(saved.paidCollectionProjectIds ?? []));
    setPaidCollectionIdsByProject(saved.paidCollectionIdsByProject ?? {});
    setContentReadyIds(new Set(saved.contentReadyIds ?? []));
    setPushedIds(new Set(saved.pushedIds ?? []));
    setAnalyzedProjectIds(new Set(saved.analyzedProjectIds ?? []));
    setStrategyReadyIds(new Set(saved.strategyReadyIds ?? []));
    setStrategyApprovedIds(new Set(saved.strategyApprovedIds ?? []));
    setCustomInstructionByProject(saved.customInstructionByProject ?? {});
    setExtractChargeByProject(saved.extractChargeByProject ?? {});
    setExtractRowsByProject(saved.extractRowsByProject ?? {});
    setKeywordsByProject(saved.keywordsByProject ?? {});
    setSheetFiltersByProject(saved.sheetFiltersByProject ?? {});
    setExtractIdByProject(saved.extractIdByProject ?? {});
    const opened = clampOpenedStage(saved.openedMaxByProject?.[last.id], 1);
    const preferred = clampOpenedStage(saved.stageByProject?.[last.id], 1);
    setStage(Math.min(preferred, opened) as MarketResearchStage);
    const openedEntries = Object.entries(saved.openedMaxByProject ?? {});
    setStage2ReadyIds(
      new Set(openedEntries.filter(([, s]) => s >= 2).map(([id]) => id))
    );
    setStage3ReadyIds(
      new Set(openedEntries.filter(([, s]) => s >= 3).map(([id]) => id))
    );
    setCreateOpen(false);
    setProjectsOpen(false);
    if (!saved.stage1DoneIds.includes(last.id)) {
      setInviteOpen(true);
    }
    const existingChat = saved.chatByProject?.[last.id] ?? [];
    if (saved.stage1DoneIds.includes(last.id) && existingChat.length === 0) {
      setChatByProject((prev) => ({
        ...prev,
        [last.id]: [
          {
            id: msgId(),
            role: "agent",
            text: stage1AgentConclusion(last.storeLabel),
          },
        ],
      }));
    }
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    persistReady.current = false;
    persistRemote.current = false;
    skipPersistSave.current = true;
    resumedArticles.current = new Set();
    setHydrated(false);

    const finish = (saved: MarketResearchPersisted | null) => {
      if (cancelled) return;
      if (saved && saved.projects.length > 0) applySaved(saved);
      else applySaved(emptyMarketResearchState());
      persistReady.current = true;
      skipPersistSave.current = true;
      setHydrated(true);
    };

    void (async () => {
      try {
        const remote = await loadMrStateApi(workspaceId);
        if (cancelled) return;
        if (remote.projects.length > 0) {
          persistRemote.current = true;
          markMarketResearchMigrated(slug);
          finish(remote);
          return;
        }
        const local = loadMarketResearchState(slug);
        if (local && local.projects.length > 0 && !isMarketResearchMigrated(slug)) {
          const migrated = assignUuidProjectIds(local);
          try {
            await saveMrStateApi(workspaceId, migrated);
            markMarketResearchMigrated(slug);
          } catch {
            // Keep the local snapshot if the first upload fails.
          }
          persistRemote.current = true;
          finish(migrated);
          return;
        }
        persistRemote.current = true;
        finish(emptyMarketResearchState());
      } catch {
        persistRemote.current = false;
        finish(loadMarketResearchState(slug));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceId, slug, applySaved]);

  const persistedSnapshot = useMemo<MarketResearchPersisted>(
    () => ({
      projects,
      activeProjectId,
      stage1DoneIds: Array.from(stage1DoneIds),
      openedMaxByProject,
      stageByProject: {
        ...stageByProject,
        ...(activeProjectId ? { [activeProjectId]: stage } : {}),
      },
      chatByProject,
      stage3ScopeByProject,
      seedSelectionByProject,
      nichesByProject,
      structuredNichesByProject,
      taxonomyExcludedByProject,
      skuFloorByProject,
      // Never round-tripped through autosave: a project's real product
      // records can run into the tens of thousands, far past what a JSON
      // blob (or localStorage) should carry, and a stale client copy could
      // clobber the sharded `products-shards/` store that is now the real
      // source of truth. `productsByProject` stays purely in-memory,
      // populated on demand via `loadProjectProductsApi` for display only.
      productsByProject: {},
      seedRowsByProject,
      marketByProject,
      probesByProject,
      manualSeedsByProject,
      committedProjectIds: Array.from(committedProjectIds),
      workspaceTabByProject,
      openedWorkspaceByProject,
      clusterSelectionByProject,
      proposedCollectionsByProject,
      contentByIdByProject,
      strategyByProject,
      articlesByProject,
      // Server-owned (written by the background link-build job and by
      // Stage 6/7 generation, loaded fresh in loadMrPersistedState) — kept
      // here only so it round-trips through the localStorage cache; never
      // written back through saveMrPersistedState's heavySlices.
      internalLinksByProject,
      paidCollectionProjectIds: Array.from(paidCollectionProjectIds),
      paidCollectionIdsByProject,
      contentReadyIds: Array.from(contentReadyIds),
      pushedIds: Array.from(pushedIds),
      analyzedProjectIds: Array.from(analyzedProjectIds),
      strategyReadyIds: Array.from(strategyReadyIds),
      strategyApprovedIds: Array.from(strategyApprovedIds),
      customInstructionByProject,
      extractChargeByProject,
      extractRowsByProject,
      keywordsByProject,
      sheetFiltersByProject,
      extractIdByProject,
    }),
    [
      projects,
      activeProjectId,
      stage1DoneIds,
      openedMaxByProject,
      stageByProject,
      stage,
      chatByProject,
      stage3ScopeByProject,
      seedSelectionByProject,
      nichesByProject,
      structuredNichesByProject,
      taxonomyExcludedByProject,
      skuFloorByProject,
      seedRowsByProject,
      marketByProject,
      probesByProject,
      manualSeedsByProject,
      committedProjectIds,
      workspaceTabByProject,
      openedWorkspaceByProject,
      clusterSelectionByProject,
      proposedCollectionsByProject,
      contentByIdByProject,
      strategyByProject,
      articlesByProject,
      internalLinksByProject,
      paidCollectionProjectIds,
      paidCollectionIdsByProject,
      contentReadyIds,
      pushedIds,
      analyzedProjectIds,
      strategyReadyIds,
      strategyApprovedIds,
      customInstructionByProject,
      extractChargeByProject,
      extractRowsByProject,
      keywordsByProject,
      sheetFiltersByProject,
      extractIdByProject,
    ]
  );

  useEffect(() => {
    if (!hydrated || !persistReady.current) return;
    saveMarketResearchState(slug, persistedSnapshot);
    if (skipPersistSave.current) {
      skipPersistSave.current = false;
      return;
    }
    if (!canEdit || !workspaceId || !persistRemote.current) return;
    const timer = window.setTimeout(() => {
      void saveMrStateApi(workspaceId, persistedSnapshot).catch(() => undefined);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [hydrated, slug, workspaceId, persistedSnapshot, canEdit]);

  useEffect(() => {
    if (!hydrated || !canEdit) return;
    if (projects.length === 0) setCreateOpen(true);
  }, [hydrated, projects.length, canEdit]);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? projects[0],
    [projects, activeProjectId]
  );
  const extracting = Boolean(
    activeProject && extractingProjectId === activeProject.id
  );

  const stage1DoneForActive = Boolean(
    activeProject && stage1DoneIds.has(activeProject.id)
  );
  const pendingStage1 = Boolean(
    activeProject && !stage1DoneForActive && !analyzing
  );
  const openedMax: MarketResearchStage = activeProject
    ? clampOpenedStage(openedMaxByProject[activeProject.id], 1)
    : 1;
  const visibleStages = ([1, 2, 3] as MarketResearchStage[]).filter(
    (s) => s <= openedMax
  );
  const stage2ReadyForActive = Boolean(
    activeProject && stage2ReadyIds.has(activeProject.id)
  );
  const stage3ReadyForActive = Boolean(
    activeProject && stage3ReadyIds.has(activeProject.id)
  );
  /** Stage 3 is a snapshot of the scope confirmed at Next, not the live selection. */
  const stage3Scope = useMemo(
    () => (activeProject ? (stage3ScopeByProject[activeProject.id] ?? []) : []),
    [activeProject, stage3ScopeByProject]
  );
  const activeNiches = useMemo(
    () =>
      activeProject
        ? (nichesByProject[activeProject.id] ?? STAGE1_NICHE_READINGS)
        : STAGE1_NICHE_READINGS,
    [activeProject, nichesByProject]
  );
  const activeMarket = activeProject
    ? (marketByProject[activeProject.id] ?? DEFAULT_MARKET)
    : DEFAULT_MARKET;
  const activeSkuFloor = activeProject
    ? (skuFloorByProject[activeProject.id] ?? DEFAULT_SKU_FLOOR)
    : DEFAULT_SKU_FLOOR;
  const activeExcludedItems = activeProject
    ? (taxonomyExcludedByProject[activeProject.id] ?? EMPTY_EXCLUDED_ITEMS)
    : EMPTY_EXCLUDED_ITEMS;
  const activeProbes = useMemo(
    () => (activeProject ? (probesByProject[activeProject.id] ?? {}) : {}),
    [activeProject, probesByProject]
  );
  const manualSeeds = useMemo(
    () => (activeProject ? (manualSeedsByProject[activeProject.id] ?? []) : []),
    [activeProject, manualSeedsByProject]
  );
  const committedForActive = Boolean(
    activeProject && committedProjectIds.has(activeProject.id)
  );
  const workspaceTab: WorkspaceTab = activeProject
    ? clampWorkspaceTab(workspaceTabByProject[activeProject.id], "extract")
    : "extract";
  const openedWorkspace: WorkspaceTab = activeProject
    ? clampWorkspaceTab(openedWorkspaceByProject[activeProject.id], "extract")
    : "extract";
  const inWorkspace = committedForActive;
  const reviewingBrief = Boolean(
    inWorkspace && reviewFlow && !isWorkspaceTab(reviewFlow)
  );
  const showWorkspace = inWorkspace && !reviewingBrief;
  const [workspaceScene, setWorkspaceScene] = useState(showWorkspace);
  const skipWorkspaceAnim = useRef(true);
  const currentStage: MarketResearchStage = Math.min(
    stage,
    openedMax
  ) as MarketResearchStage;
  const lockedViewStage: MarketResearchStage = reviewFlow
    ? (briefStageFromFlow(reviewFlow) ?? currentStage)
    : currentStage;

  useLayoutEffect(() => {
    if (!hydrated) {
      setWorkspaceScene(showWorkspace);
      return;
    }
    if (skipWorkspaceAnim.current) {
      skipWorkspaceAnim.current = false;
      setWorkspaceScene(showWorkspace);
      return;
    }
    if (!showWorkspace) {
      setWorkspaceScene(false);
      return;
    }
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setWorkspaceScene(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [hydrated, showWorkspace]);
  // Legacy projects recorded "paid" as a whole-project boolean before this
  // field existed. Treat those as every collection currently proposed being
  // paid so nothing regresses for existing customers; new pushes always
  // write into paidCollectionIdsByProject directly.
  const paidCollectionIds = useMemo(() => {
    if (!activeProject) return [] as string[];
    const explicit = paidCollectionIdsByProject[activeProject.id];
    if (explicit && explicit.length > 0) return explicit;
    if (paidCollectionProjectIds.has(activeProject.id)) {
      return (proposedCollectionsByProject[activeProject.id] ?? []).map((c) => c.id);
    }
    return [] as string[];
  }, [
    activeProject,
    paidCollectionIdsByProject,
    paidCollectionProjectIds,
    proposedCollectionsByProject,
  ]);
  const contentReady = Boolean(
    activeProject && contentReadyIds.has(activeProject.id)
  );
  const contentPushed = Boolean(
    activeProject && pushedIds.has(activeProject.id)
  );
  const analyzed = Boolean(
    activeProject && analyzedProjectIds.has(activeProject.id)
  );
  const strategyReady = Boolean(
    activeProject && strategyReadyIds.has(activeProject.id)
  );
  const strategyApproved = Boolean(
    activeProject && strategyApprovedIds.has(activeProject.id)
  );
  const customInstructions = activeProject
    ? (customInstructionByProject[activeProject.id] ??
      EMPTY_ON_PAGE_INSTRUCTIONS)
    : EMPTY_ON_PAGE_INSTRUCTIONS;
  const clusterSelection = activeProject
    ? (clusterSelectionByProject[activeProject.id] ?? EMPTY_IDS)
    : EMPTY_IDS;
  const activeStructuredNiches = useMemo(() => {
    if (!activeProject) return [];
    const projectNiches = nichesByProject[activeProject.id];
    const structured = structuredNichesByProject[activeProject.id];

    if (Array.isArray(projectNiches) && projectNiches.length > 0) {
      const structuredMap = new Map(
        (Array.isArray(structured) ? structured : []).map((sn) => [
          sn.id,
          sn,
        ])
      );
      return projectNiches.map((niche) => {
        const match = structuredMap.get(niche.id);
        if (match) {
          return {
            ...match,
            name: niche.name,
          };
        }
        return {
          id: niche.id,
          name: niche.name,
          productCount: 0,
          collections: [],
        };
      });
    }

    if (Array.isArray(structured) && structured.length > 0) {
      return structured;
    }

    return [];
  }, [activeProject, nichesByProject, structuredNichesByProject]);
  const activeSeedRows = useMemo(
    () =>
      activeProject
        ? (seedRowsByProject[activeProject.id] ?? [])
        : [],
    [activeProject, seedRowsByProject]
  );
  const stage3Rows = useMemo(() => {
    const generated = getSeedRowsForCollections(
      stage3Scope,
      activeStructuredNiches,
      activeSeedRows
    );
    const inScope = new Set(stage3Scope);
    return [
      ...generated,
      ...manualSeeds.filter((row) => inScope.has(row.collectionId)),
    ];
  }, [stage3Scope, activeStructuredNiches, activeSeedRows, manualSeeds]);
  const stage3Stale = useMemo(() => {
    if (!activeProject || !stage3ReadyForActive) return false;
    const current = [...activeProject.highlightedCollectionIds].sort();
    const snapshot = [...stage3Scope].sort();
    return (
      current.length !== snapshot.length ||
      current.some((id, i) => id !== snapshot[i])
    );
  }, [activeProject, stage3ReadyForActive, stage3Scope]);
  const seedSelection = activeProject
    ? (seedSelectionByProject[activeProject.id] ?? [])
    : [];
  const selectedSeedRows = useMemo(() => {
    const picked = new Set(seedSelection);
    return stage3Rows.filter((row) => picked.has(row.id));
  }, [stage3Rows, seedSelection]);
  const extractedKeywords = activeProject
    ? (keywordsByProject[activeProject.id] ?? [])
    : [];
  const appliedSheetFilters = useMemo(
    () =>
      activeProject
        ? (sheetFiltersByProject[activeProject.id] ?? DEFAULT_SHEET_FILTERS)
        : DEFAULT_SHEET_FILTERS,
    [activeProject, sheetFiltersByProject]
  );
  const proposedCollections = activeProject
    ? (proposedCollectionsByProject[activeProject.id] ?? [])
    : [];

  const hydrateProjectProducts = useCallback(
    async (projectId: string, force = false) => {
      if (!workspaceId) return;
      if (!force && productsHydratedFor.current[projectId]) return;
      productsHydratedFor.current[projectId] = true;
      try {
        const products = await loadProjectProductsApi(workspaceId, projectId);
        setProductsByProject((prev) => ({ ...prev, [projectId]: products }));
      } catch (err) {
        productsHydratedFor.current[projectId] = false;
        console.error("[hydrateProjectProducts] Failed:", err);
      }
    },
    [workspaceId]
  );

  useEffect(() => {
    if (!hydrated || !activeProject) return;
    const projectId = activeProject.id;
    const needsCatalog =
      workspaceTab === "collections" || proposedCollections.length > 0;
    if (!needsCatalog) return;
    void hydrateProjectProducts(projectId);
  }, [
    hydrated,
    activeProject,
    workspaceTab,
    proposedCollections.length,
    hydrateProjectProducts,
  ]);
  const selectedCollections = useMemo(
    () =>
      proposedCollections.filter((row) => clusterSelection.includes(row.id)),
    [proposedCollections, clusterSelection]
  );
  const strategyArticles = useMemo(() => {
    if (!activeProject) return [] as StrategyArticle[];
    return strategyByProject[activeProject.id] ?? [];
  }, [activeProject, strategyByProject]);
  const generatedArticles = useMemo(() => {
    if (!activeProject) return {} as Record<string, GeneratedArticle>;
    return articlesByProject[activeProject.id] ?? {};
  }, [activeProject, articlesByProject]);

  // The storefront domain is also needed by Stage 6 (the live-collection link
  // icon and the sitemap export), so this now fires as soon as Tab 6 unlocks
  // rather than waiting for Stage 7's content plan. The blog list itself is
  // still only used by Stage 7, but it's cheap to fetch alongside storeUrl.
  useEffect(() => {
    const needsStoreUrl = openedWorkspace === "content" || openedWorkspace === "strategy";
    if (!workspaceId || !needsStoreUrl || storeUrl) return;
    let cancelled = false;
    fetchStoreBlogsApi(workspaceId)
      .then((res) => {
        if (cancelled) return;
        setStoreBlogs(res.blogs ?? []);
        setStoreUrl(res.storeUrl ?? "");
        setStoreProvider(res.provider ?? null);
        setBlogScopeWarning(res.scopeWarning ?? null);
      })
      .catch(() => {
        // Article generation still works without a blog list.
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, openedWorkspace, storeUrl]);

  const contentById = useMemo(() => {
    if (!activeProject) return {};
    return contentByIdByProject[activeProject.id] ?? {};
  }, [activeProject, contentByIdByProject]);

  const internalLinksById = useMemo(() => {
    if (!activeProject) return {};
    return internalLinksByProject[activeProject.id] ?? {};
  }, [activeProject, internalLinksByProject]);

  const linksBuildProgress = useMemo(() => {
    if (!activeProject) return null;
    return linksBuildProgressByProject[activeProject.id] ?? null;
  }, [activeProject, linksBuildProgressByProject]);

  // Read off the content itself rather than a session flag, so the button stays
  // off after a refresh and comes back on the moment copy is regenerated or a
  // row failed and still needs a retry.
  const seoAllSynced = useMemo(() => {
    const rows = Object.values(contentById);
    if (rows.length === 0) return false;
    return rows.every((row) => Boolean(row.seoSyncedAt) && !row.seoSyncError);
  }, [contentById]);

  useEffect(() => {
    if (!activeProject || !contentReady || generating) return;
    const existing = contentByIdByProject[activeProject.id];
    if (existing && Object.keys(existing).length > 0) return;

    const selected = proposedCollections.filter((row) =>
      clusterSelection.includes(row.id)
    );
    if (selected.length === 0) return;

    const next: Record<string, CollectionContent> = {};
    for (const row of selected) {
      next[row.id] = buildCollectionContent(row, customInstructions);
    }
    setContentByIdByProject((prev) => ({
      ...prev,
      [activeProject.id]: next,
    }));
  }, [
    activeProject?.id,
    contentReady,
    generating,
    clusterSelection,
    proposedCollections,
    customInstructions,
    contentByIdByProject,
  ]);
  const rereadPending = Boolean(
    activeProject && rereadPendingIds.has(activeProject.id)
  );
  const selectionEstimate = useMemo(() => {
    const picked = new Set(seedSelection);
    return estimateSelection(
      stage3Rows.filter((row) => picked.has(row.id)),
      activeProbes
    );
  }, [seedSelection, stage3Rows, activeProbes]);

  const effectiveOpenedStageByProject = useMemo<Record<string, MarketResearchStage>>(() => {
    const map: Record<string, MarketResearchStage> = {};
    for (const project of projects) {
      const id = project.id;
      let s: MarketResearchStage = clampOpenedStage(openedMaxByProject[id], 1);
      if (committedProjectIds.has(id)) {
        s = Math.max(s, 4) as MarketResearchStage;
        const wsTab = openedWorkspaceByProject[id];
        if (strategyApprovedIds.has(id) || pushedIds.has(id) || wsTab === "strategy") {
          s = 7;
        } else if (contentReadyIds.has(id) || wsTab === "content") {
          s = 6;
        } else if ((proposedCollectionsByProject[id] ?? []).length > 0 || wsTab === "collections") {
          s = 5;
        }
      }
      map[id] = s;
    }
    return map;
  }, [
    projects,
    openedMaxByProject,
    committedProjectIds,
    openedWorkspaceByProject,
    strategyApprovedIds,
    pushedIds,
    contentReadyIds,
    proposedCollectionsByProject,
  ]);

  const timelineSteps = useMemo<StageStep[]>(() => {
    const stage1Status: StageStepStatus = analyzing
      ? "running"
      : stage1DoneForActive
        ? "done"
        : "pending";
    const stage2Status: StageStepStatus = preparingStage2
      ? "running"
      : stage2ReadyForActive
        ? "done"
        : openedMax >= 2
          ? "pending"
          : "locked";
    const stage3Status: StageStepStatus = preparingStage3
      ? "running"
      : stage3ReadyForActive && !stage3Stale
        ? "done"
        : openedMax >= 3
          ? "pending"
          : "locked";
    const stage4Status: StageStepStatus = extracting || analyzeLoading
      ? "running"
      : (extractedKeywords.length > 0 || committedForActive)
        ? "done"
        : openedMax >= 4 || inWorkspace
          ? "pending"
          : "locked";
    const stage5Status: StageStepStatus = clustering
      ? "running"
      : proposedCollections.length > 0
        ? "done"
        : openedMax >= 5 || (inWorkspace && openedWorkspace !== "extract")
          ? "pending"
          : "locked";
    const stage6Status: StageStepStatus = generating
      ? "running"
      : contentReady
        ? "done"
        : openedMax >= 6 || (inWorkspace && (openedWorkspace === "content" || openedWorkspace === "strategy"))
          ? "pending"
          : "locked";
    const stage7Status: StageStepStatus = strategyLoading
      ? "running"
      : (strategyApproved || contentPushed)
        ? "done"
        : openedMax >= 7 || (inWorkspace && openedWorkspace === "strategy")
          ? "pending"
          : "locked";

    return [
      {
        stage: 1,
        status: stage1Status,
        detail:
          stage1Status === "done"
            ? `${activeNiches.length} parent niches aligned`
            : stage1Status === "running"
              ? "Reading navigation and collection pages"
              : "Not started yet",
      },
      {
        stage: 2,
        status: stage2Status,
        detail:
          stage2Status === "locked"
            ? "Opens after you accept the Stage 1 read"
            : stage2Status === "running"
              ? "Expanding niches into existing collections"
              : `${activeProject?.highlightedCollectionIds.length ?? 0} collections selected`,
      },
      {
        stage: 3,
        status: stage3Status,
        detail:
          stage3Status === "locked"
            ? "Opens after you confirm catalog scope"
            : stage3Status === "running"
              ? "Drafting broad seed variations"
              : stage3Stale
                ? "Scope changed — regenerate to refresh"
                : `${stage3Rows.length} seed rows ready`,
      },
      {
        stage: 4,
        status: stage4Status,
        detail:
          extracting
            ? "Extracting phrase keywords…"
            : analyzeLoading
              ? "Classifying search intent with Gemini 3.7 Flash…"
              : extractedKeywords.length > 0
                ? `${extractedKeywords.length} keywords extracted & classified`
                : stage4Status === "locked"
                  ? "Phrase extraction & intent classification"
                  : "Ready for keyword extraction",
      },
      {
        stage: 5,
        status: stage5Status,
        detail:
          clustering
            ? "Clustering commercial opportunities with AI…"
            : proposedCollections.length > 0
              ? `${proposedCollections.length} candidate collections discovered`
              : stage5Status === "locked"
                ? "Semantic clustering & catalog matching"
                : "Ready to cluster collections",
      },
      {
        stage: 6,
        status: stage6Status,
        detail:
          generating
            ? "Generating on-page SEO copy & FAQs…"
            : contentReady
              ? "SEO titles, meta & collection copy ready"
              : stage6Status === "locked"
                ? "On-page SEO copy, descriptions & FAQs"
                : "Ready to generate copy",
      },
      {
        stage: 7,
        status: stage7Status,
        detail:
          strategyLoading
            ? "Building content strategy roadmap…"
            : strategyApproved || contentPushed
              ? "Content roadmap finalized & ready"
              : strategyReady
                ? "Content strategy roadmap ready for review"
                : stage7Status === "locked"
                  ? "Content roadmap & publishing"
                  : "Ready for strategy roadmap",
      },
    ];
  }, [
    activeNiches.length,
    activeProject,
    analyzing,
    analyzeLoading,
    clustering,
    committedForActive,
    contentPushed,
    contentReady,
    extractedKeywords.length,
    generating,
    inWorkspace,
    openedMax,
    openedWorkspace,
    preparingStage2,
    preparingStage3,
    proposedCollections.length,
    stage1DoneForActive,
    stage2ReadyForActive,
    stage3ReadyForActive,
    stage3Rows.length,
    stage3Stale,
    strategyApproved,
    strategyLoading,
    strategyReady,
    extracting,
  ]);

  const timelineReceipts = useMemo<StageReceipt[]>(() => {
    if (!activeProject) return [];
    const list: StageReceipt[] = [];
    if (stage1DoneForActive) {
      list.push({
        id: "r1",
        stage: 1,
        title: `Website read locked · ${activeNiches.length} parent niches`,
        detail: activeNiches.map((n) => n.name).join(", "),
      });
    }
    if (openedMax >= 3 && stage3Scope.length > 0) {
      list.push({
        id: "r2",
        stage: 2,
        title: `Catalog scope confirmed · ${stage3Scope.length} collections`,
        detail: `${formatProductCount(countProductsForCollections(stage3Scope))} products · ${collectionNamesForIds(stage3Scope).slice(0, 4).join(", ")}`,
      });
    }
    if (stage3ReadyForActive) {
      list.push({
        id: "r3",
        stage: 3,
        title: `Seed variations generated · ${stage3Rows.length} rows`,
        detail: `${groupSeedRowsByCanonical(stage3Rows).length} canonical seeds · ${seedSelection.length} selected for demand validation`,
      });
    }
    const probedCount = Object.keys(activeProbes).length;
    if (probedCount > 0) {
      list.push({
        id: "r4",
        stage: 3,
        title: `Demand checked · ${probedCount} seeds in ${marketLabel(activeMarket)}`,
        detail: `${selectionEstimate.billedKeywords.toLocaleString("en-US")} billed rows on the current selection · ${formatUsd(selectionEstimate.usd)}`,
      });
    }
    if (committedForActive) {
      list.push({
        id: "r5",
        stage: 4,
        title: `Extracted · ${formatUsd(
          extractChargeByProject[activeProject.id] ?? selectionEstimate.usd
        )}`,
        detail: `Wallet charge for keyword extraction in ${marketLabel(activeMarket)}`,
      });
    }
    if (extractedKeywords.length > 0) {
      const catCount = extractedKeywords.filter((k) => k.sheet === "category").length;
      const infoCount = extractedKeywords.filter((k) => k.sheet === "informational").length;
      const exclCount = extractedKeywords.filter((k) => k.sheet === "excluded").length;
      list.push({
        id: "r6",
        stage: 4,
        title: `Keywords classified · ${extractedKeywords.length} terms`,
        detail: `${catCount} category (PLP) · ${infoCount} informational · ${exclCount} excluded`,
      });
    }
    if (proposedCollections.length > 0) {
      list.push({
        id: "r7",
        stage: 5,
        title: `Collections clustered · ${proposedCollections.length} collections`,
        detail: proposedCollections.map((c) => c.name).slice(0, 4).join(", "),
      });
    }
    if (contentReady) {
      list.push({
        id: "r8",
        stage: 6,
        title: "On-page content generated",
        detail: "SEO titles, meta descriptions, collection descriptions & FAQs ready",
      });
    }
    if (strategyApproved || contentPushed) {
      list.push({
        id: "r9",
        stage: 7,
        title: contentPushed ? "Pushed to store catalog" : "Strategy roadmap approved",
        detail: "Content strategy action plan finalized",
      });
    }
    return list;
  }, [
    activeMarket,
    activeNiches,
    activeProbes,
    activeProject,
    committedForActive,
    contentPushed,
    contentReady,
    extractedKeywords,
    extractChargeByProject,
    openedMax,
    proposedCollections,
    seedSelection.length,
    selectionEstimate,
    stage1DoneForActive,
    stage3ReadyForActive,
    stage3Rows,
    stage3Scope,
    strategyApproved,
  ]);

  const appendAgent = useCallback((projectId: string, text: string) => {
    setChatByProject((prev) => ({
      ...prev,
      [projectId]: [
        ...(prev[projectId] ?? []),
        { id: msgId(), role: "agent", text },
      ],
    }));
  }, []);

  const appendUser = useCallback((projectId: string, text: string) => {
    setChatByProject((prev) => ({
      ...prev,
      [projectId]: [
        ...(prev[projectId] ?? []),
        { id: msgId(), role: "user", text },
      ],
    }));
  }, []);

  const completeAnalysis = useCallback(
    (projectId: string, storeLabel: string) => {
      setAnalyzing(false);
      setStage1DoneIds((prev) => {
        const next = new Set(prev);
        next.add(projectId);
        return next;
      });
      appendAgent(
        projectId,
        `${stage1AgentConclusion(storeLabel, nichesByProject[projectId] ?? STAGE1_NICHE_READINGS)}\n\nWhen this read feels right, press Next on the right — I’ll open catalog scope and keep working from these niches. Names wrong or a niche missing? Edit them directly on the right instead of paying for another pass.`
      );
    },
    [appendAgent, nichesByProject]
  );

  const startAnalysis = useCallback(
    (opts?: { freshChat?: boolean }) => {
      if (!canEdit || !activeProject) return;
      const projectId = activeProject.id;
      const storeLabel = activeProject.storeLabel;
      setInviteOpen(false);
      setStage(1);
      setStageByProject((prev) => ({ ...prev, [projectId]: 1 }));
      // Re-read resets later stages for this project.
      setOpenedMaxByProject((prev) => ({ ...prev, [projectId]: 1 }));
      setStage2ReadyIds((prev) => {
        if (!prev.has(projectId)) return prev;
        const next = new Set(prev);
        next.delete(projectId);
        return next;
      });
      setStage3ReadyIds((prev) => {
        if (!prev.has(projectId)) return prev;
        const next = new Set(prev);
        next.delete(projectId);
        return next;
      });
      setPreparingStage2(false);
      setPreparingStage3(false);
      stage2Gen.current += 1;
      stage3Gen.current += 1;
      setStage3ScopeByProject((prev) => {
        if (!(projectId in prev)) return prev;
        const next = { ...prev };
        delete next[projectId];
        return next;
      });
      setSeedSelectionByProject((prev) => {
        if (!(projectId in prev)) return prev;
        const next = { ...prev };
        delete next[projectId];
        return next;
      });
      setProbesByProject((prev) => {
        if (!(projectId in prev)) return prev;
        const next = { ...prev };
        delete next[projectId];
        return next;
      });
      setManualSeedsByProject((prev) => {
        if (!(projectId in prev)) return prev;
        const next = { ...prev };
        delete next[projectId];
        return next;
      });
      setNichesByProject((prev) => {
        if (!(projectId in prev)) return prev;
        const next = { ...prev };
        delete next[projectId];
        return next;
      });
      setStructuredNichesByProject((prev) => {
        if (!(projectId in prev)) return prev;
        const next = { ...prev };
        delete next[projectId];
        return next;
      });
      setTaxonomyExcludedByProject((prev) => {
        if (!(projectId in prev)) return prev;
        const next = { ...prev };
        delete next[projectId];
        return next;
      });
      setSeedRowsByProject((prev) => {
        if (!(projectId in prev)) return prev;
        const next = { ...prev };
        delete next[projectId];
        return next;
      });
      setCommittedProjectIds((prev) => {
        if (!prev.has(projectId)) return prev;
        const next = new Set(prev);
        next.delete(projectId);
        return next;
      });
      probeGen.current += 1;
      setProbingIds([]);
      setRereadPendingIds((prev) => {
        if (!prev.has(projectId)) return prev;
        const next = new Set(prev);
        next.delete(projectId);
        return next;
      });
      setStage1DoneIds((prev) => {
        if (!prev.has(projectId)) return prev;
        const next = new Set(prev);
        next.delete(projectId);
        return next;
      });
      setStage(1);
      setStageByProject((prev) => ({ ...prev, [projectId]: 1 }));
      setOpenedMaxByProject((prev) => ({ ...prev, [projectId]: 1 }));
      if (opts?.freshChat) {
        setChatByProject((prev) => ({ ...prev, [projectId]: [] }));
      }

      const gen = ++analysisGen.current;
      setAnalyzing(true);
      setAnalysisProgress(0.1);

      appendAgent(
        projectId,
        `Starting a first read of ${storeLabel}. Looking at what the website appears to sell across navigation and collections…`
      );

      if (!workspaceId) {
        // Mock fallback if no workspace
        window.setTimeout(() => {
          if (analysisGen.current !== gen) return;
          completeAnalysis(projectId, storeLabel);
        }, 1500);
        return;
      }

      void (async () => {
        try {
          const res = await analyzeStoreApi(workspaceId, projectId);
          if (analysisGen.current !== gen) return;

          setNichesByProject((prev) => ({ ...prev, [projectId]: res.niches }));
          setStructuredNichesByProject((prev) => ({
            ...prev,
            [projectId]: res.structuredNiches,
          }));
          setTaxonomyExcludedByProject((prev) => ({
            ...prev,
            [projectId]: res.excludedItems ?? [],
          }));
          if (res.storeName && res.storeName !== "Connected Store" && res.storeName !== "Demo Store") {
            setProjects((prev) =>
              prev.map((p) =>
                p.id === projectId ? { ...p, storeLabel: res.storeName } : p
              )
            );
          }
          setAnalysisProgress(1);
          setAnalyzing(false);
          setStage1DoneIds((prev) => {
            const next = new Set(prev);
            next.add(projectId);
            return next;
          });
          appendAgent(
            projectId,
            `${res.agentConclusion}\n\nWhen this read feels right, press Next on the right — I’ll open catalog scope and keep working from these niches. Names wrong or a niche missing? Edit them directly on the right instead of paying for another pass.`
          );
        } catch (err) {
          if (analysisGen.current !== gen) return;
          console.error("[startAnalysis] Failed to run agent:", err);
          // A failed analyze must never mark Stage 1 "done" on the
          // hard-coded demo eyewear niches — that would silently hand the
          // customer someone else's catalog read and let them pay for
          // Stage 3+ against niches that were never actually theirs.
          // Surface the error and leave Stage 1 retryable instead.
          setAnalysisProgress(0);
          setAnalyzing(false);
          appendAgent(
            projectId,
            `I couldn't analyze ${storeLabel} — the request failed, so I'm not going to guess at your catalog with placeholder niches. Press Analyze again to retry.`
          );
          toast.error("Store analysis failed", {
            description:
              err instanceof Error ? err.message : "Please try again.",
          });
        }
      })();
    },
    [activeProject, workspaceId, appendAgent, completeAnalysis, canEdit]
  );

  const startStage2Prep = useCallback(
    (projectId: string) => {
      const gen = ++stage2Gen.current;
      setPreparingStage2(true);
      setStage2ReadyIds((prev) => {
        if (!prev.has(projectId)) return prev;
        const next = new Set(prev);
        next.delete(projectId);
        return next;
      });

      const posted = new Set<number>();
      const started = performance.now();

      const tick = () => {
        if (stage2Gen.current !== gen) return;
        const p = Math.min(1, (performance.now() - started) / STAGE2_PREP_MS);
        for (let i = 0; i < STAGE2_PREP_BEATS.length; i++) {
          const beat = STAGE2_PREP_BEATS[i];
          if (p >= beat.at && !posted.has(i)) {
            posted.add(i);
            appendAgent(projectId, beat.text);
          }
        }
        if (p >= 1) {
          setPreparingStage2(false);
          setStage2ReadyIds((prev) => {
            const next = new Set(prev);
            next.add(projectId);
            return next;
          });
          appendAgent(projectId, stage2AgentReady());
          return;
        }
        window.requestAnimationFrame(tick);
      };
      window.requestAnimationFrame(tick);
    },
    [appendAgent]
  );

  const startStage3Prep = useCallback(
    (projectId: string, collectionIds: string[]) => {
      const gen = ++stage3Gen.current;
      setPreparingStage3(true);
      setStage3ReadyIds((prev) => {
        if (!prev.has(projectId)) return prev;
        const next = new Set(prev);
        next.delete(projectId);
        return next;
      });

      const currentStructured =
        structuredNichesByProject[projectId] ?? [];
      const selectedIdSet = new Set(collectionIds);
      const selectedScopeCollections: Array<{
        id: string;
        name: string;
        description?: string;
        productCount: number;
        parentNicheName: string;
        nicheFullySelected: boolean;
      }> = [];

      for (const niche of currentStructured) {
        // Whole niche was picked as a unit (Stage 2's "select all" toggle)
        // vs. the customer hand-picked only some of its PLPs.
        const nicheFullySelected =
          niche.collections.length > 0 &&
          niche.collections.every((c) => selectedIdSet.has(c.id));

        for (const col of niche.collections) {
          if (selectedIdSet.has(col.id)) {
            selectedScopeCollections.push({
              id: col.id,
              name: col.name,
              description: col.description,
              productCount: col.productCount,
              parentNicheName: niche.name,
              nicheFullySelected,
            });
          }
        }
      }

      appendAgent(
        projectId,
        "Analyzing selected catalog collections to prepare broad niche seed variations…"
      );

      if (!workspaceId) {
        const rows = getSeedRowsForCollections(collectionIds, currentStructured);
        const rowIds = new Set(rows.map((r) => r.id));
        setStage3ScopeByProject((prev) => ({
          ...prev,
          [projectId]: [...collectionIds],
        }));
        setSeedSelectionByProject((prev) => {
          const current = prev[projectId];
          if (!current) return prev;
          const kept = current.filter((id) => rowIds.has(id));
          return { ...prev, [projectId]: kept };
        });
        setPreparingStage3(false);
        setStage3ReadyIds((prev) => {
          const next = new Set(prev);
          next.add(projectId);
          return next;
        });
        appendAgent(
          projectId,
          stage3AgentReady(collectionIds.length, rows.length)
        );
        return;
      }

      void (async () => {
        try {
          const res = await generateSeedsApi(
            workspaceId,
            projectId,
            selectedScopeCollections.length > 0
              ? selectedScopeCollections
              : collectionIds.map((cid) => ({
                  id: cid,
                  name: cid,
                  productCount: 100,
                  parentNicheName: "General",
                }))
          );
          if (stage3Gen.current !== gen) return;

          const rows = res.seedRows;
          const rowIds = new Set(rows.map((r) => r.id));
          setSeedRowsByProject((prev) => ({ ...prev, [projectId]: rows }));
          setStage3ScopeByProject((prev) => ({
            ...prev,
            [projectId]: [...collectionIds],
          }));
          setSeedSelectionByProject((prev) => {
            const current = prev[projectId];
            if (!current) return prev;
            const kept = current.filter((id) => rowIds.has(id));
            return { ...prev, [projectId]: kept };
          });

          // Real product records are no longer returned inline (a selected
          // collection can hold 20,000+ SKUs) — page through the real
          // catalog now, in the same loading state, so the Products column
          // and later embedding passes have real fetched counts rather than
          // the catalog's advertised number.
          const scopeForFetch =
            selectedScopeCollections.length > 0
              ? selectedScopeCollections
              : collectionIds.map((cid) => ({ id: cid, name: cid }));

          setProductFetchProgressByProject((prev) => ({
            ...prev,
            [projectId]: { fetched: 0, done: false },
          }));

          try {
            const productCountByCollectionId = await runProductsFetchLoop(
              workspaceId,
              projectId,
              scopeForFetch,
              (state) => {
                if (stage3Gen.current !== gen) return;
                setProductFetchProgressByProject((prev) => ({
                  ...prev,
                  [projectId]: { fetched: state.totalFetched, done: state.done },
                }));
              },
              () => stage3Gen.current !== gen
            );
            if (stage3Gen.current === gen) {
              setProductCountByCollectionIdByProject((prev) => ({
                ...prev,
                [projectId]: productCountByCollectionId,
              }));
            }
          } catch (fetchErr) {
            console.error("[startStage3Prep] Product fetch failed:", fetchErr);
          }

          // Best-effort display snapshot for the Tab 5 products sheet. Never
          // autosaved back — the sharded store is the source of truth.
          void loadProjectProductsApi(workspaceId, projectId)
            .then((products) => {
              if (stage3Gen.current !== gen) return;
              setProductsByProject((prev) => ({ ...prev, [projectId]: products }));
            })
            .catch((err) => console.error("[startStage3Prep] Product snapshot load failed:", err));

          setPreparingStage3(false);
          setStage3ReadyIds((prev) => {
            const next = new Set(prev);
            next.add(projectId);
            return next;
          });
          appendAgent(
            projectId,
            stage3AgentReady(collectionIds.length, rows.length)
          );
        } catch (err) {
          if (stage3Gen.current !== gen) return;
          console.error("[startStage3Prep] Failed to generate seeds:", err);
          // The AI seed generation call failed — the basic heuristic below
          // covers the customer so Stage 3 isn't a hard dead end, but it
          // must never be presented as the normal AI-generated read. Both
          // the chat message and a toast name the degradation explicitly.
          const fallbackRows = getSeedRowsForCollections(
            collectionIds,
            currentStructured
          );
          const rowIds = new Set(fallbackRows.map((r) => r.id));
          setSeedRowsByProject((prev) => ({
            ...prev,
            [projectId]: fallbackRows,
          }));
          setStage3ScopeByProject((prev) => ({
            ...prev,
            [projectId]: [...collectionIds],
          }));
          setSeedSelectionByProject((prev) => {
            const current = prev[projectId];
            if (!current) return prev;
            const kept = current.filter((id) => rowIds.has(id));
            return { ...prev, [projectId]: kept };
          });
          setPreparingStage3(false);
          setStage3ReadyIds((prev) => {
            const next = new Set(prev);
            next.add(projectId);
            return next;
          });
          appendAgent(
            projectId,
            `The seed-generation agent call failed, so I fell back to a basic keyword pattern instead of a real AI read (${fallbackRows.length} seed${fallbackRows.length === 1 ? "" : "s"} from ${collectionIds.length} collection${collectionIds.length === 1 ? "" : "s"}). Review these carefully, or retry Stage 3 for a proper agent pass.`
          );
          toast.warning("Seed generation degraded", {
            description:
              "The AI agent call failed — using a basic fallback instead. Retry Stage 3 for a full agent pass.",
          });
        }
      })();
    },
    [workspaceId, structuredNichesByProject, appendAgent]
  );

  const setViewStage = (s: MarketResearchStage) => {
    setStage(s);
    if (!activeProjectId) return;
    setStageByProject((prev) => ({ ...prev, [activeProjectId]: s }));
  };

  const handleFlowTab = (next: FlowTab) => {
    if (!activeProject) return;
    if (isWorkspaceTab(next)) {
      setReviewFlow(null);
      setWorkspaceTabByProject((prev) => ({
        ...prev,
        [activeProject.id]: next,
      }));
      return;
    }
    setReviewFlow(next);
    const briefStage = briefStageFromFlow(next);
    if (briefStage) setViewStage(briefStage);
  };

  const handleNextFromStage1 = () => {
    if (!canEdit) return;
    if (!activeProject || !stage1DoneForActive || analyzing) return;
    const projectId = activeProject.id;
    const alreadyOpened = openedMax >= 2;

    setOpenedMaxByProject((prev) => ({
      ...prev,
      [projectId]: Math.max(prev[projectId] ?? 1, 2) as MarketResearchStage,
    }));
    setViewStage(2);

    if (alreadyOpened && stage2ReadyForActive) {
      appendAgent(
        projectId,
        "Opening catalog scope again — built from the Stage 1 niches we already locked."
      );
      return;
    }

    startStage2Prep(projectId);
  };

  const handleNextFromStage2 = () => {
    if (!canEdit) return;
    if (
      !activeProject ||
      !stage2ReadyForActive ||
      preparingStage2 ||
      preparingStage3
    ) {
      return;
    }
    const projectId = activeProject.id;
    const collectionIds = activeProject.highlightedCollectionIds;
    if (collectionIds.length === 0) {
      toast.error("Select at least one collection");
      return;
    }

    const alreadyOpened = openedMax >= 3;
    setOpenedMaxByProject((prev) => ({
      ...prev,
      [projectId]: Math.max(prev[projectId] ?? 1, 3) as MarketResearchStage,
    }));
    setViewStage(3);

    if (alreadyOpened && stage3ReadyForActive && !stage3Stale) {
      appendAgent(
        projectId,
        `Reopening Stage 3 with the same catalog scope (${collectionIds.length} collection${collectionIds.length === 1 ? "" : "s"}) — nothing changed, so the seed rows stand.`
      );
      return;
    }

    startStage3Prep(projectId, collectionIds);
  };

  /** Any change to what would be charged invalidates a prior confirmation. */
  const clearCommitment = (projectId: string) => {
    setCommittedProjectIds((prev) => {
      if (!prev.has(projectId)) return prev;
      const next = new Set(prev);
      next.delete(projectId);
      return next;
    });
  };

  /** Stage 3b — Apify seed-term analysis. Billed per returned seed in chunks of 10 for instant live updates. */
  const runProbe = async (rowIds: string[]) => {
    if (!canEdit || !activeProject || rowIds.length === 0) return;
    if (!workspaceId) {
      toast.error("Workspace is still loading");
      return;
    }
    const projectId = activeProject.id;
    const market = activeMarket;
    const targets = stage3Rows.filter((row) => rowIds.includes(row.id));
    if (targets.length === 0) return;

    const totalEstCost = estimateProbeCostUsd(targets.length);
    const balance = await previewBalance(workspaceId);
    if (balance < totalEstCost) {
      setInsufficientFundsDialog({
        open: true,
        requiredAmount: totalEstCost,
        currentBalance: balance,
        actionName: `Demand check for ${targets.length} seed${targets.length === 1 ? "" : "s"}`,
      });
      return;
    }

    const gen = ++probeGen.current;
    setProbingIds(targets.map((row) => row.id));
    appendAgent(projectId, PROBE_BEATS[0].text);

    const CHUNK_SIZE = 10;
    const chunks: (typeof targets)[] = [];
    for (let i = 0; i < targets.length; i += CHUNK_SIZE) {
      chunks.push(targets.slice(i, i + CHUNK_SIZE));
    }

    const allResults: Record<string, SeedProbe> = {};
    let totalCostUsd = 0;
    let failedChunks = 0;
    let lastErrorMessage: string | null = null;

    for (let i = 0; i < chunks.length; i++) {
      if (probeGen.current !== gen) return;
      const chunk = chunks[i];
      const chunkIds = new Set(chunk.map((r) => r.id));

      try {
        const response = await probeSeedsApi(
          workspaceId,
          projectId,
          market,
          chunk.map((row) => ({ id: row.id, term: row.broadSeedVariation })),
          crypto.randomUUID()
        );
        if (probeGen.current !== gen) return;

        totalCostUsd += response.probeCostUsd ?? 0;
        const chunkResults: Record<string, SeedProbe> = {};
        for (const row of response.results) {
          if (row.failed) {
            chunkResults[row.seedId] = {
              seedId: row.seedId,
              market,
              rawKeywords: 0,
              searchVolume: 0,
              sampleKeywords: [],
              checkedAt: Date.now(),
              failed: true,
            };
            continue;
          }
          chunkResults[row.seedId] = {
            seedId: row.seedId,
            market,
            rawKeywords: row.keywordIdeasTotal,
            searchVolume: row.volume,
            sampleKeywords: row.sampleKeywords.slice(0, 5),
            checkedAt: Date.now(),
          };
        }

        Object.assign(allResults, chunkResults);

        // Immediately update UI with this chunk's live results
        setProbesByProject((prev) => ({
          ...prev,
          [projectId]: { ...(prev[projectId] ?? {}), ...chunkResults },
        }));

        // Remove the processed batch from probingIds so its spinners disappear and results show instantly
        setProbingIds((prev) => prev.filter((id) => !chunkIds.has(id)));

        // Live wallet balance update
        invalidateWallet();
      } catch (error) {
        if (probeGen.current !== gen) return;
        failedChunks++;
        const msg = error instanceof Error ? error.message : "Could not retrieve seed metrics.";
        lastErrorMessage = msg;
        if (
          msg.toLowerCase().includes("balance") ||
          msg.toLowerCase().includes("funds") ||
          msg.includes("402")
        ) {
          setInsufficientFundsDialog({
            open: true,
            requiredAmount: totalEstCost,
            currentBalance: wallet?.balance ?? 0,
            actionName: `Demand check for ${targets.length} seed${targets.length === 1 ? "" : "s"}`,
          });
        }
        const failedResult: Record<string, SeedProbe> = {};
        for (const row of chunk) {
          failedResult[row.id] = {
            seedId: row.id,
            market,
            rawKeywords: 0,
            searchVolume: 0,
            sampleKeywords: [],
            checkedAt: Date.now(),
            failed: true,
          };
        }
        Object.assign(allResults, failedResult);
        setProbesByProject((prev) => ({
          ...prev,
          [projectId]: { ...(prev[projectId] ?? {}), ...failedResult },
        }));
        setProbingIds((prev) => prev.filter((id) => !chunkIds.has(id)));
        console.error(`[runProbe] Batch ${i + 1}/${chunks.length} failed:`, error);
      }
    }

    if (probeGen.current !== gen) return;
    setProbingIds([]);
    clearCommitment(projectId);

    const picked = new Set(seedSelection);
    const estimate = estimateSelection(
      stage3Rows.filter((row) => picked.has(row.id) || allResults[row.id]),
      { ...activeProbes, ...allResults }
    );
    appendAgent(
      projectId,
      probeAgentReady(targets.length, estimate, market)
    );

    if (failedChunks > 0 && failedChunks === chunks.length) {
      toast.error("Demand check failed", {
        description: lastErrorMessage || "Could not retrieve seed metrics. Please try again.",
      });
    }
  };

  const handleAddManualSeed = (term: string, collectionId: string) => {
    if (!canEdit || !activeProject) return;
    // Keyed by collectionId, not the canonical NAME — two different PLPs can
    // legitimately share the same canonical seed name (e.g. two collections
    // that both distill to "Smartphones"), so only the PLP id reliably
    // identifies which family the term should join.
    const reference = stage3Rows.find(
      (row) => row.collectionId === collectionId
    );
    if (!reference) return;
    const row = createManualSeedRow(term, reference);
    setManualSeedsByProject((prev) => ({
      ...prev,
      [activeProject.id]: [...(prev[activeProject.id] ?? []), row],
    }));
    setSeedSelectionByProject((prev) => ({
      ...prev,
      [activeProject.id]: [...(prev[activeProject.id] ?? []), row.id],
    }));
    clearCommitment(activeProject.id);
    appendAgent(
      activeProject.id,
      `Added “${term}” to the ${reference.canonicalNicheSeed} family (${reference.selectedCollection}) as your own broad seed. It has no demand data yet — run a check when you’re ready.`
    );
  };

  const settleExtractCharge = (
    projectId: string,
    rowsReturned: number,
    amount = actualExtractCostUsd(rowsReturned)
  ) => {
    setExtractRowsByProject((prev) => ({ ...prev, [projectId]: rowsReturned }));
    setExtractChargeByProject((prev) => ({ ...prev, [projectId]: amount }));
    invalidateWallet();
  };

  const rememberExtractId = (projectId: string, extractId: string) => {
    extractIdRef.current = extractId;
    setExtractIdByProject((prev) => ({ ...prev, [projectId]: extractId }));
    resumedExtract.current.add(projectId);
  };

  const runExtractPollLoop = async (input: {
    gen: number;
    workspaceId: string;
    projectId: string;
    extractId: string;
    seedCaps: Array<{ id: string; term: string; cap: number }>;
    initialSample?: ExtractedKeyword[];
  }) => {
    const pollState = input.seedCaps.map((seed) => ({
      id: seed.id,
      term: seed.term,
      cap: seed.cap,
      cursor: undefined as string | undefined,
      status: "running" as "running" | "succeeded" | "failed" | "aborted",
      pulled: 0,
    }));
    let sample: ExtractedKeyword[] = input.initialSample ?? [];
    // Safety caps so a stuck billing settlement or a persistently unreachable
    // poll endpoint can't spin this loop forever in an open tab — both used
    // to retry indefinitely with no failure cap.
    let billingPendingAttempts = 0;
    const MAX_BILLING_PENDING_ATTEMPTS = 60; // 60 * 2s = 2 minutes
    let consecutiveFailures = 0;
    const MAX_CONSECUTIVE_FAILURES = 20; // 20 * 800ms = 16s of unbroken failures

    const giveUp = (message: string) => {
      setExtractingProjectId((id) => (id === input.projectId ? null : id));
      toast.error("Extract status unknown", { description: message });
    };

    const tick = async () => {
      if (extractGen.current !== input.gen) return;
      try {
        const poll = await pollExtractApi(
          input.workspaceId,
          input.projectId,
          input.extractId,
          pollState.map((seed) => ({
            seedId: seed.id,
            cursor: seed.cursor,
            status: seed.status,
          }))
        );
        if (extractGen.current !== input.gen) return;
        consecutiveFailures = 0;

        for (const row of poll.seeds) {
          const local = pollState.find((seed) => seed.id === row.seedId);
          if (!local) continue;
          local.status =
            row.status === "succeeded" && row.nextCursor ? "running" : row.status;
          local.cursor = row.nextCursor;
          const returned =
            typeof row.rowsReturned === "number" ? row.rowsReturned : local.pulled;
          if (row.rows.length > 0) {
            const mapped = row.rows.map((keyword, index) =>
              toExtractedKeyword(keyword, row.seedId, local.pulled + index)
            );
            sample = appendKeywordRows(sample, mapped);
            local.pulled = Math.max(local.pulled + row.rows.length, returned);
          } else {
            local.pulled = Math.max(local.pulled, returned);
          }
        }

        const caps = pollState.reduce((sum, seed) => sum + seed.cap, 0);
        const pulled = pollState.reduce((sum, seed) => sum + seed.pulled, 0);
        setExtractProgress(caps ? Math.min(1, pulled / caps) : 0);
        setSeedProgress(
          pollState.map((seed) => ({
            seedId: seed.id,
            seed: seed.term,
            cap: seed.cap,
            pulled: seed.pulled,
          }))
        );
        if (sample.length > 0) {
          setKeywordsByProject((prev) => ({
            ...prev,
            [input.projectId]: sample,
          }));
        }

        if (poll.allDone) {
          if (poll.billingPending) {
            billingPendingAttempts += 1;
            if (billingPendingAttempts >= MAX_BILLING_PENDING_ATTEMPTS) {
              giveUp(
                "Billing settlement is taking longer than expected. Your keywords are safe — refresh the page in a moment to see the final charge."
              );
              return;
            }
            window.setTimeout(() => {
              void tick();
            }, 2000);
            return;
          }
          const status = await extractStatusApi(
            input.workspaceId,
            input.projectId,
            input.extractId
          ).catch(() => null);
          const archiveSample = status?.sample ?? poll.sample;
          const finalSample =
            (archiveSample?.length ?? 0) >= sample.length
              ? (archiveSample ?? sample)
              : sample;
          if (finalSample.length > 0) {
            setKeywordsByProject((prev) => ({
              ...prev,
              [input.projectId]: finalSample,
            }));
          }
          setExtractingProjectId((id) =>
            id === input.projectId ? null : id
          );
          settleExtractCharge(
            input.projectId,
            poll.rowsReturned,
            poll.settledUsd ?? actualExtractCostUsd(poll.rowsReturned)
          );
          return;
        }
      } catch (err) {
        if (extractGen.current !== input.gen) return;
        consecutiveFailures += 1;
        console.error("[runExtractPollLoop] Poll failed:", err);
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          giveUp(
            "Couldn't reach the extract status endpoint. Your keywords collected so far were kept — refresh the page to check the latest status."
          );
          return;
        }
      }

      window.setTimeout(() => {
        void tick();
      }, 800);
    };

    await tick();
  };

  const handleExtract = async () => {
    if (!canEdit || !activeProject) return;
    if (!workspaceId) {
      toast.error("Workspace is still loading");
      return;
    }
    const projectId = activeProject.id;
    const balance = await previewBalance(workspaceId);
    if (balance < selectionEstimate.usd) {
      setInsufficientFundsDialog({
        open: true,
        requiredAmount: selectionEstimate.usd,
        currentBalance: balance,
        actionName: `Keyword extraction for ${selectedSeedRows.length} seed${selectedSeedRows.length === 1 ? "" : "s"}`,
      });
      return;
    }

    const gen = ++extractGen.current;
    setCommittedProjectIds((prev) => {
      const next = new Set(prev);
      next.add(projectId);
      return next;
    });
    setWorkspaceTabByProject((prev) => ({ ...prev, [projectId]: "extract" }));
    setOpenedWorkspaceByProject((prev) => ({
      ...prev,
      [projectId]: "extract",
    }));
    setOpenedMaxByProject((prev) => ({
      ...prev,
      [projectId]: Math.max(prev[projectId] ?? 1, 4) as MarketResearchStage,
    }));
    setStageByProject((prev) => ({
      ...prev,
      [projectId]: 4,
    }));
    setStage(4);
    setAnalyzedProjectIds((prev) => {
      if (!prev.has(projectId)) return prev;
      const next = new Set(prev);
      next.delete(projectId);
      return next;
    });
    setKeywordsByProject((prev) => ({ ...prev, [projectId]: [] }));
    setSheetFiltersByProject((prev) => ({
      ...prev,
      [projectId]: DEFAULT_SHEET_FILTERS,
    }));
    setExtractingProjectId(projectId);
    setExtractProgress(0);

    const seeds = selectedSeedRows.filter(
      (row) => activeProbes[row.id] && !activeProbes[row.id].failed
    );
    const seedCaps = seeds.map((seed) => ({
      id: seed.id,
      term: seed.broadSeedVariation,
      cap: pulledCountForSeed(seed, activeProbes),
    }));
    setSeedProgress(
      seedCaps.map((seed) => ({
        seedId: seed.id,
        seed: seed.term,
        cap: seed.cap,
        pulled: 0,
      }))
    );

    // Embed the products behind the selected terms now, in the same loading
    // state as the Apify extract poll below — the two have nothing to do
    // with each other, so running them together uses otherwise-dead wait
    // time instead of adding a second sequential wait after extraction.
    const embedGenId = (productEmbedGen.current[projectId] ?? 0) + 1;
    productEmbedGen.current[projectId] = embedGenId;
    const embedCollectionIds = Array.from(
      new Set(seeds.map((seed) => seed.collectionId).filter(Boolean))
    );
    if (embedCollectionIds.length > 0) {
      setProductEmbedProgressByProject((prev) => ({
        ...prev,
        [projectId]: { embedded: 0, total: 0, done: false },
      }));
      void runEmbedProductsLoop(
        workspaceId,
        projectId,
        embedCollectionIds,
        (state) => {
          if (productEmbedGen.current[projectId] !== embedGenId) return;
          setProductEmbedProgressByProject((prev) => ({
            ...prev,
            [projectId]: {
              embedded: (prev[projectId]?.embedded ?? 0) + state.embedded,
              total: state.total,
              done: state.done,
            },
          }));
        },
        () => productEmbedGen.current[projectId] !== embedGenId
      ).catch((err) => console.error("[handleExtract] Product embedding pass failed:", err));
    }

    // Tracks whether the Apify job actually started on the server. Only
    // then is committedProjectIds a durable fact (real billed work is now
    // running) — if startExtractApi itself never succeeds, the catch below
    // rolls the speculative commitment back so the customer can retry.
    let started: Awaited<ReturnType<typeof startExtractApi>> | undefined;
    try {
      started = await startExtractApi(
        workspaceId,
        projectId,
        activeMarket,
        seeds.map((seed) => ({
          id: seed.id,
          term: seed.broadSeedVariation,
          rawKeywordEstimate: activeProbes[seed.id]?.rawKeywords ?? 0,
        }))
      );
      if (extractGen.current !== gen) {
        setExtractingProjectId((id) => (id === projectId ? null : id));
        await cancelExtractApi(
          workspaceId,
          projectId,
          started.extractId
        ).catch(() => undefined);
        return;
      }
      extractRunIds.current = started.seeds.map((seed) => seed.runId);
      rememberExtractId(projectId, started.extractId);
      await runExtractPollLoop({
        gen,
        workspaceId,
        projectId,
        extractId: started.extractId,
        seedCaps: started.seeds.map((seed) => {
          const match = seedCaps.find((row) => row.id === seed.seedId);
          return {
            id: seed.seedId,
            term: seed.term,
            cap: match?.cap ?? seed.pages * 100,
          };
        }),
      });
    } catch (error) {
      if (extractGen.current !== gen) return;
      setExtractingProjectId((id) => (id === projectId ? null : id));
      if (!started) {
        // The Apify job never actually started — no billed work is running,
        // so the speculative commitment and stage-4 navigation above must
        // be rolled back, or the customer is locked out of ever retrying
        // Extract for this project again.
        setCommittedProjectIds((prev) => {
          if (!prev.has(projectId)) return prev;
          const next = new Set(prev);
          next.delete(projectId);
          return next;
        });
        setStageByProject((prev) => ({ ...prev, [projectId]: 3 }));
        setStage(3);
      }
      toast.error("Extract failed", {
        description:
          error instanceof Error ? error.message : "Could not start extraction.",
      });
    }
  };

  const handleCancelExtract = async () => {
    extractGen.current += 1;
    const projectId = extractingProjectId ?? activeProject?.id;
    setExtractingProjectId((id) => (id === projectId ? null : id));
    if (!workspaceId || !projectId) return;
    let extractId =
      extractIdRef.current || extractIdByProject[projectId] || "";
    if (!extractId) {
      const status = await extractStatusApi(workspaceId, projectId).catch(
        () => null
      );
      extractId = status?.extract?.id ?? "";
    }
    if (!extractId) return;
    try {
      const cancelled = await cancelExtractApi(
        workspaceId,
        projectId,
        extractId
      );
      settleExtractCharge(
        projectId,
        cancelled.rowsReturned,
        cancelled.settledUsd
      );
    } catch {
      // Polling already stopped via extractGen.
    }
  };

  useEffect(() => {
    if (!hydrated || !workspaceId || !canEdit || !activeProject) return;
    const projectId = activeProject.id;
    if (extractingProjectId) return;
    if (resumedExtract.current.has(projectId)) return;

    let cancelled = false;
    void (async () => {
      try {
        const status = await extractStatusApi(
          workspaceId,
          projectId
        );
        if (cancelled) return;
        if (!status.extract) {
          resumedExtract.current.add(projectId);
          return;
        }
        rememberExtractId(projectId, status.extract.id);
        if (status.sample?.length) {
          setKeywordsByProject((prev) => {
            const current = prev[projectId] ?? [];
            if (status.sample!.length <= current.length) return prev;
            return {
              ...prev,
              [projectId]: status.sample ?? [],
            };
          });
        }
        const active =
          status.extract.status === "running" ||
          status.extract.billingStatus === "held";
        if (!active) {
          resumedExtract.current.add(projectId);
          if (status.extract.rowsReturned > 0) {
            settleExtractCharge(
              projectId,
              status.extract.rowsReturned,
              status.extract.actualUsd ||
                actualExtractCostUsd(status.extract.rowsReturned)
            );
          }
          return;
        }

        const gen = ++extractGen.current;
        setCommittedProjectIds((prev) => {
          const next = new Set(prev);
          next.add(projectId);
          return next;
        });
        setExtractingProjectId(projectId);
        const seedCaps = status.seeds.map((seed) => {
          const match = selectedSeedRows.find((row) => row.id === seed.seedId);
          return {
            id: seed.seedId,
            term: seed.term,
            cap: match
              ? pulledCountForSeed(match, activeProbes)
              : Math.max(seed.pages * 100, seed.rowsReturned, 1),
          };
        });
        setSeedProgress(
          seedCaps.map((seed) => ({
            seedId: seed.id,
            seed: seed.term,
            cap: seed.cap,
            pulled:
              status.seeds.find((row) => row.seedId === seed.id)?.rowsReturned ??
              0,
          }))
        );
        await runExtractPollLoop({
          gen,
          workspaceId,
          projectId,
          extractId: status.extract.id,
          seedCaps,
          initialSample: keywordsByProject[projectId],
        });
      } catch {
        resumedExtract.current.delete(projectId);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    hydrated,
    workspaceId,
    canEdit,
    activeProject?.id,
    extractingProjectId,
  ]);

  const unlockWorkspaceTab = (projectId: string, tab: WorkspaceTab) => {
    setOpenedWorkspaceByProject((prev) => ({
      ...prev,
      [projectId]: maxTab(prev[projectId] ?? "extract", tab),
    }));
    setWorkspaceTabByProject((prev) => ({ ...prev, [projectId]: tab }));
    const stageNum: MarketResearchStage =
      tab === "strategy" ? 7 : tab === "content" ? 6 : tab === "collections" ? 5 : 4;
    setOpenedMaxByProject((prev) => ({
      ...prev,
      [projectId]: Math.max(prev[projectId] ?? 1, stageNum) as MarketResearchStage,
    }));
    setStageByProject((prev) => ({
      ...prev,
      [projectId]: stageNum,
    }));
    setStage(stageNum);
  };

  const handleAnalyze = async () => {
    if (!activeProject) return;
    if (!workspaceId) {
      toast.error("Workspace is still loading");
      return;
    }
    const projectId = activeProject.id;
    const currentKws = keywordsByProject[projectId] ?? [];
    if (currentKws.length === 0) {
      toast.error("No keywords to analyze");
      return;
    }

    const gen = ++analyzeGen.current;
    setAnalyzeLoading(true);
    setAnalyzeProgress({ done: 0, total: currentKws.length });
    let totalDegraded = 0;

    // Classification now runs server-side as a cursor job over the FULL
    // extract archive (not just a stale Extract-tab cache) — a
    // 20k-keyword extract is 40+ pages at 500/page, each internally batched
    // at 100 keywords/batch with concurrency 5. The client just loops on
    // `offset` until `done`, same pattern as the Apify extract poll.
    try {
      const result = await runClassifyArchiveLoop(
        workspaceId,
        projectId,
        (state) => {
          if (analyzeGen.current !== gen) return;
          setAnalyzeProgress({ done: state.nextOffset, total: state.total });
          totalDegraded += state.degradedCount ?? 0;
          if (state.classifications?.length) {
            setKeywordsByProject((prev) => ({
              ...prev,
              [projectId]: applyKeywordClassifications(
                prev[projectId] ?? [],
                state.classifications ?? []
              ),
            }));
          }
        },
        () => analyzeGen.current !== gen
      );
      if (analyzeGen.current !== gen) return;

      if (!result) {
        toast.error("Classification error", {
          description: "Could not classify keywords. Please try again.",
        });
        return;
      }

      // The route overlays verdicts onto the stored "keywords" slice by
      // text as it goes; pull the refreshed sample back into the UI.
      try {
        const state = await loadMrStateApi(workspaceId);
        if (analyzeGen.current !== gen) return;
        const refreshed = state.keywordsByProject?.[projectId];
        if (Array.isArray(refreshed) && refreshed.length > 0) {
          setKeywordsByProject((prev) => ({ ...prev, [projectId]: refreshed }));
        }
      } catch (refreshErr) {
        console.error("[handleAnalyze] Failed to refresh sample:", refreshErr);
      }

      setAnalyzedProjectIds((prev) => {
        const next = new Set(prev);
        next.add(projectId);
        return next;
      });

      // Some keywords couldn't be verdicted by Gemini even after the
      // hardened retries + targeted re-request, and used the regex
      // heuristic instead. They're flagged per-row in the table below —
      // this toast is what makes sure it's never silently invisible, the
      // exact class of bug that used to let a heuristic guess pass as if
      // Gemini had classified it.
      if (totalDegraded > 0) {
        toast.warning("Some keywords used a fallback guess", {
          description: `${totalDegraded} keyword${totalDegraded === 1 ? "" : "s"} couldn't be verified by Gemini and used a rule-based guess instead. Look for the "Estimated" tag in the table below.`,
        });
      }
    } catch (err) {
      if (analyzeGen.current !== gen) return;
      console.error("[handleAnalyze] Error:", err);
      toast.error("Classification error", {
        description: "Could not classify keywords. Please try again.",
      });
    } finally {
      if (analyzeGen.current === gen) {
        setAnalyzeLoading(false);
        setAnalyzeProgress(null);
      }
    }
  };

  const handleApplySheetFilters = (
    sheet: "category" | "informational",
    filters: KeywordFilters
  ) => {
    if (!activeProject) return;
    const projectId = activeProject.id;
    setSheetFiltersByProject((prev) => ({
      ...prev,
      [projectId]: {
        ...(prev[projectId] ?? DEFAULT_SHEET_FILTERS),
        [sheet]: filters,
      },
    }));
  };

  const handleNextCollections = async (
    filteredCategoryKeywords?: ExtractedKeyword[]
  ) => {
    if (!activeProject) return;
    if (!workspaceId) {
      toast.error("Workspace is still loading");
      return;
    }
    const projectId = activeProject.id;
    const categoryFilters =
      sheetFiltersByProject[projectId]?.category ?? DEFAULT_SHEET_FILTERS.category;
    const targetKeywords =
      filteredCategoryKeywords && filteredCategoryKeywords.length > 0
        ? filteredCategoryKeywords
        : filterKeywords(
            keywordsByProject[projectId] ?? [],
            categoryFilters,
            "category"
          );

    if (targetKeywords.length === 0) {
      toast.error("No suitable category keywords to cluster");
      return;
    }

    unlockWorkspaceTab(projectId, "collections");
    const gen = ++clusterGen.current;
    setClustering(true);
    setClusterProgress(null);

    // Embed every surviving category term with its PLP context before
    // clustering — Stage 5 Phase 1 needs vectors to do collection-scoped
    // cosine matching instead of the slower lexical fallback. Runs in the
    // same Tab 4 -> 5 loading state, before the cluster cursor job starts.
    const termEmbedGenId = (termEmbedGen.current[projectId] ?? 0) + 1;
    termEmbedGen.current[projectId] = termEmbedGenId;
    setTermEmbedProgressByProject((prev) => ({
      ...prev,
      [projectId]: { embedded: 0, total: 0, done: false },
    }));
    try {
      await runEmbedTermsLoop(
        workspaceId,
        projectId,
        (state) => {
          if (termEmbedGen.current[projectId] !== termEmbedGenId) return;
          setTermEmbedProgressByProject((prev) => ({
            ...prev,
            [projectId]: {
              embedded: (prev[projectId]?.embedded ?? 0) + state.embedded,
              total: state.total,
              done: state.done,
            },
          }));
        },
        () => termEmbedGen.current[projectId] !== termEmbedGenId,
        categoryFilters
      );
    } catch (embedErr) {
      console.error("[handleNextCollections] Term embedding pass failed:", embedErr);
    }
    if (clusterGen.current !== gen) return;

    // Stage 5 runs over the classified category archive after the Tab 4
    // Apply filters (volume / KD / query), not the unfiltered set.
    try {
      const result = await runClusterCollectionsLoop(
        workspaceId,
        projectId,
        (state) => {
          if (clusterGen.current !== gen) return;
          setProposedCollectionsByProject((prev) => ({
            ...prev,
            [projectId]: state.collections,
          }));
          setClusterProgress({ processed: state.nextOffset, total: state.total });
        },
        () => clusterGen.current !== gen,
        categoryFilters
      );
      if (clusterGen.current !== gen) return;

      if (!result) {
        throw new Error("Clustering did not return a result");
      }

      setClusterSelectionByProject((prev) => ({
        ...prev,
        [projectId]: result.collections.map((c) => c.id),
      }));

      // Stage 5 Phase 3 — one extra pass, still inside the same loading
      // state, that flags any of the collections just proposed above whose
      // shopper-intent coverage duplicates something already live in the
      // merchant's store. Never blocks or fails the tab, but a failed check
      // is never silently treated as "cleared" either — those collections
      // come back stamped dedupeCheckStatus "unknown" and publish is
      // blocked server-side until the merchant retries.
      try {
        const dedupeResult = await dedupeCollectionsApi(workspaceId, projectId);
        if (clusterGen.current !== gen) return;
        if (dedupeResult.collections.length > 0) {
          setProposedCollectionsByProject((prev) => ({
            ...prev,
            [projectId]: dedupeResult.collections,
          }));
        }
        if (dedupeResult.dedupeCheckFailed) {
          toast.warning("Couldn't fully verify duplicates", {
            description:
              "The live catalog or AI comparison failed for some collections. They won't be publishable until you retry the duplicate check.",
          });
        }
      } catch (dedupeErr) {
        console.error("[handleNextCollections] Duplicate-collection check failed:", dedupeErr);
        toast.warning("Couldn't verify duplicates", {
          description:
            "The duplicate check request failed. Please retry it from Tab 5 before publishing.",
        });
      }
      void hydrateProjectProducts(projectId, true);
    } catch (err) {
      if (clusterGen.current !== gen) return;
      console.error("[handleNextCollections] Error:", err);
      toast.error("Clustering failed", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      if (clusterGen.current === gen) {
        setClustering(false);
      }
    }
  };

  // Manual retry for collections stamped dedupeCheckStatus "unknown" (the
  // live catalog fetch or the Gemini comparison failed on the automatic
  // pass in handleNextCollections). Publishing stays blocked server-side
  // until this clears them.
  const handleRecheckDuplicates = async () => {
    if (!canEdit || !activeProject || !workspaceId) return;
    const projectId = activeProject.id;
    setRecheckingDuplicatesByProject((prev) => ({ ...prev, [projectId]: true }));
    try {
      const dedupeResult = await dedupeCollectionsApi(workspaceId, projectId);
      if (dedupeResult.collections.length > 0) {
        setProposedCollectionsByProject((prev) => ({
          ...prev,
          [projectId]: dedupeResult.collections,
        }));
      }
      if (dedupeResult.dedupeCheckFailed) {
        toast.warning("Still couldn't verify duplicates", {
          description:
            "The live catalog or AI comparison failed again. Please try again shortly.",
        });
      } else {
        toast.success("Duplicate check complete");
      }
    } catch (err) {
      console.error("[handleRecheckDuplicates] Error:", err);
      toast.error("Duplicate check failed", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setRecheckingDuplicatesByProject((prev) => ({ ...prev, [projectId]: false }));
    }
  };

  const handlePushToStore = async (ids?: string[]) => {
    if (!canEdit || !activeProject || !workspaceId) return;
    const projectId = activeProject.id;
    const targetIds =
      ids && ids.length > 0
        ? ids
        : clusterSelectionByProject[projectId] ?? [];
    if (targetIds.length === 0) return;

    const usd = collectionPushCostUsd(targetIds.length);
    const balance = await previewBalance(workspaceId);
    if (balance < usd) {
      setInsufficientFundsDialog({
        open: true,
        requiredAmount: usd,
        currentBalance: balance,
        actionName: `Publishing ${targetIds.length} collection${targetIds.length === 1 ? "" : "s"} to store`,
      });
      return;
    }

    setPushingCollectionsByProject((prev) => ({ ...prev, [projectId]: true }));

    try {
      const pushResult = await pushCollectionsApi(workspaceId, projectId, targetIds);
      invalidateWallet();

      // Only the collections the store actually confirmed creating are paid.
      // A partial failure must not lock the failed ones out of a retry, and
      // must not falsely mark unrelated/never-attempted ids as pushed.
      const successfulIds =
        pushResult.pushedIds ??
        (pushResult.storeResults ?? []).filter((r) => r.success).map((r) => r.id);
      if (successfulIds.length > 0) {
        setPaidCollectionIdsByProject((prev) => {
          const existing = prev[projectId] ?? [];
          const next = Array.from(new Set([...existing, ...successfulIds]));
          return { ...prev, [projectId]: next };
        });
        setPushedIds((prev) => {
          const next = new Set(prev);
          next.add(projectId);
          return next;
        });
      }
      if ((pushResult.failedCount ?? 0) > 0) {
        toast.error(
          `${pushResult.failedCount} collection${pushResult.failedCount === 1 ? "" : "s"} failed to publish`,
          {
            description: "You were not charged for the ones that failed. Select them again to retry.",
          }
        );
      }

      // The server just assigned real store handles to these collections; mirror
      // that into local state before using it, otherwise the link graph would
      // treat every collection pushed in this batch as unresolved (no verified
      // href) and none of them could link to each other.
      const handleById = new Map(
        (pushResult.storeResults ?? [])
          .filter((r) => r.success && r.handle)
          .map((r) => [r.id, r.handle as string])
      );
      if (handleById.size > 0) {
        setProposedCollectionsByProject((prev) => {
          const list = prev[projectId] ?? [];
          if (list.length === 0) return prev;
          return {
            ...prev,
            [projectId]: list.map((c) =>
              handleById.has(c.id)
                ? { ...c, storeHandle: handleById.get(c.id) }
                : c
            ),
          };
        });
      }

      // Kick off internal-link graph building in the background now that these
      // collections have real store handles, so the "Links" column in Tab 6 is
      // already filled by the time the tab unlocks. Fire-and-forget: a failure
      // here just means on-page generation falls back to building it inline.
      // A resumable cursor loop rather than one call, so a 10k-collection push
      // keeps filling the Links column instead of dying at 60 seconds. A
      // second push for the same project supersedes an in-flight build.
      if (successfulIds.length > 0) {
        const gen = (linksGen.current[projectId] = (linksGen.current[projectId] ?? 0) + 1);
        setLinksBuildProgressByProject((prev) => ({
          ...prev,
          [projectId]: { processed: 0, total: successfulIds.length },
        }));
        runBuildInternalLinksLoop(
          workspaceId,
          projectId,
          successfulIds,
          (page) => {
            if (linksGen.current[projectId] !== gen) return;
            setInternalLinksByProject((prev) => ({
              ...prev,
              [projectId]: {
                ...(prev[projectId] ?? {}),
                ...page.linksByCollectionId,
              },
            }));
            setLinksBuildProgressByProject((prev) => ({
              ...prev,
              [projectId]: page.done
                ? null
                : { processed: page.nextOffset, total: page.total },
            }));
          },
          () => linksGen.current[projectId] !== gen
        ).catch((err) => {
          console.error("[handlePushToStore] Internal link build failed:", err);
          if (linksGen.current[projectId] === gen) {
            setLinksBuildProgressByProject((prev) => ({ ...prev, [projectId]: null }));
          }
        });
      }

      // Only clear the selection down to the ids that actually failed, so a
      // partial failure leaves the failed collections selected and ready to
      // retry instead of silently dropping them from view.
      setClusterSelectionByProject((prev) => ({
        ...prev,
        [projectId]: (prev[projectId] ?? []).filter(
          (id) => !successfulIds.includes(id)
        ),
      }));

      window.setTimeout(() => {
        setPushingCollectionsByProject((prev) => ({
          ...prev,
          [projectId]: false,
        }));
        if (successfulIds.length > 0) {
          unlockWorkspaceTab(projectId, "content");
        }
      }, 3200);
    } catch (error) {
      setPushingCollectionsByProject((prev) => ({
        ...prev,
        [projectId]: false,
      }));
      const msg = error instanceof Error ? error.message : `Publishing costs ${formatUsd(usd)}. Add funds or select fewer collections.`;
      if (
        msg.toLowerCase().includes("balance") ||
        msg.toLowerCase().includes("funds") ||
        msg.includes("402")
      ) {
        setInsufficientFundsDialog({
          open: true,
          requiredAmount: usd,
          currentBalance: wallet?.balance ?? 0,
          actionName: `Publishing ${targetIds.length} collection${targetIds.length === 1 ? "" : "s"} to store`,
        });
      } else {
        toast.error("Publish failed", { description: msg });
      }
    }
  };

  const handleStartWorking = () => {
    handlePushToStore();
  };

  const handleStartContent = async (ids: string[]) => {
    if (!canEdit || !activeProject) return;
    if (!workspaceId) {
      toast.error("Workspace is still loading");
      return;
    }
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    const selected = proposedCollections.filter((row) => uniqueIds.includes(row.id));
    if (selected.length === 0) {
      toast.error("No collections selected to generate copy");
      return;
    }

    const projectId = activeProject.id;
    const gen = ++contentGen.current;
    const selectedIds = selected.map((c) => c.id);

    setGenerating(true);
    setContentByIdByProject((prev) => ({
      ...prev,
      [projectId]: clearSelectedContent(prev[projectId] ?? {}, selectedIds),
    }));
    setContentGenProgress({ processed: 0, total: selected.length });
    const instructions = customInstructions;

    // A collection with no content by the time the loop ends — whether from a
    // network failure or the guard tripping — still needs something to show
    // rather than staying blank forever. Returns how many rows were filled so
    // the caller can decide whether the degradation needs to be surfaced.
    const fillMissingWithFallback = (): number => {
      let missingCount = 0;
      setContentByIdByProject((prev) => {
        const current = prev[projectId] ?? {};
        const missing = selected.filter((row) => !current[row.id]);
        missingCount = missing.length;
        if (missing.length === 0) return prev;
        const filled = { ...current };
        for (const row of missing) {
          filled[row.id] = buildCollectionContent(row, instructions);
        }
        return { ...prev, [projectId]: filled };
      });
      return missingCount;
    };

    let totalDegraded = 0;

    try {
      const parentNiches = (nichesByProject[projectId] ?? activeNiches).map(
        (n) => n.name
      );

      await runOnPageGenerationLoop(
        workspaceId,
        projectId,
        selectedIds,
        {
          parentNiches,
          customInstructions: {
            seoTitle: instructions.seoTitle || undefined,
            seoDescription: instructions.seoDescription || undefined,
            collectionDescription: instructions.collectionDescription || undefined,
            faq: instructions.faq || undefined,
          },
        },
        (page) => {
          if (contentGen.current !== gen) return;
          totalDegraded += page.degradedCount ?? 0;
          setContentByIdByProject((prev) => ({
            ...prev,
            [projectId]: {
              ...(prev[projectId] ?? {}),
              ...page.contentById,
            },
          }));
          setContentGenProgress(
            page.done ? null : { processed: page.nextOffset, total: page.total }
          );
        },
        () => contentGen.current !== gen
      );

      if (contentGen.current !== gen) return;

      const missingCount = fillMissingWithFallback();

      setContentReadyIds((prev) => {
        const next = new Set(prev);
        next.add(projectId);
        return next;
      });

      // Some collections never got a real AI pass — surface this instead of
      // quietly shipping templated copy as if it were the normal AI result.
      if (totalDegraded > 0 || missingCount > 0) {
        const degradedTotal = totalDegraded + missingCount;
        toast.warning("Some collections used fallback copy", {
          description: `${degradedTotal} of ${selected.length} collection${selected.length === 1 ? "" : "s"} fell back to a standard template because the AI writer failed for them. Review and regenerate those before publishing.`,
        });
      }
    } catch (err) {
      if (contentGen.current !== gen) return;
      console.error("[handleStartContent] Error:", err);
      fillMissingWithFallback();
      setContentReadyIds((prev) => {
        const next = new Set(prev);
        next.add(projectId);
        return next;
      });
      toast.error("AI generation failed, fallback applied", {
        description:
          err instanceof Error ? err.message : "Applied standard copy template",
      });
    } finally {
      if (contentGen.current === gen) {
        setGenerating(false);
        setContentGenProgress(null);
      }
    }
  };

  const handleSyncSeo = async () => {
    if (!canEdit || !activeProject || !workspaceId) return;
    const projectId = activeProject.id;
    setSyncingSeoByProject((prev) => ({ ...prev, [projectId]: true }));
    try {
      const res = await syncSeoApi(workspaceId, projectId);

      // Stamp each row with its own outcome. This lives on the content slice,
      // so the table still reports the truth after a refresh.
      const results = res.results ?? [];
      if (results.length > 0) {
        const syncedAt = Date.now();
        setContentByIdByProject((prev) => {
          const current = prev[projectId];
          if (!current) return prev;
          const next = { ...current };
          for (const result of results) {
            const content = next[result.collectionId];
            if (!content) continue;
            next[result.collectionId] = result.ok
              ? { ...content, seoSyncedAt: syncedAt, seoSyncError: undefined }
              : { ...content, seoSyncError: result.error ?? "Sync failed" };
          }
          return { ...prev, [projectId]: next };
        });
      }

      const failed = results.filter((row) => !row.ok);
      if (failed.length > 0) {
        toast.warning(
          `${failed.length} collection${failed.length === 1 ? "" : "s"} could not be synced`,
          { description: failed[0].error }
        );
      } else {
        setSeoSyncedProjectIds((prev) => {
          const next = new Set(prev);
          next.add(projectId);
          return next;
        });
        toast.success(
          res.syncedCount > 0
            ? `Synced SEO copy for ${res.syncedCount} collection${res.syncedCount === 1 ? "" : "s"} to store`
            : "SEO copy and descriptions saved to store"
        );
      }
    } catch (error) {
      toast.error("Failed to sync SEO to store", {
        description: error instanceof Error ? error.message : "Internal error",
      });
    } finally {
      setSyncingSeoByProject((prev) => ({ ...prev, [projectId]: false }));
    }
  };

  const handlePush = async () => {
    if (!canEdit || !activeProject || !workspaceId) return;
    const projectId = activeProject.id;
    const ids = [...clusterSelection].sort();
    if (ids.length === 0) return;
    const usd = collectionPushCostUsd(ids.length);
    try {
      const pushResult = await pushCollectionsApi(workspaceId, projectId, ids);
      invalidateWallet();
      const successfulIds =
        pushResult.pushedIds ??
        (pushResult.storeResults ?? []).filter((r) => r.success).map((r) => r.id);
      if (successfulIds.length > 0) {
        setPaidCollectionIdsByProject((prev) => {
          const existing = prev[projectId] ?? [];
          const next = Array.from(new Set([...existing, ...successfulIds]));
          return { ...prev, [projectId]: next };
        });
        setPushedIds((prev) => {
          const next = new Set(prev);
          next.add(projectId);
          return next;
        });
      }
      if ((pushResult.failedCount ?? 0) > 0) {
        toast.error(
          `${pushResult.failedCount} collection${pushResult.failedCount === 1 ? "" : "s"} failed to publish`,
          {
            description: "You were not charged for the ones that failed. Select them again to retry.",
          }
        );
      }
    } catch (error) {
      toast.error("Not enough wallet balance", {
        description:
          error instanceof Error
            ? error.message
            : `Publishing costs ${formatUsd(usd)}. Add funds or select fewer collections.`,
      });
    }
  };

  const runStrategyBuild = async (projectId: string) => {
    if (!canEdit) return;
    if (!workspaceId) {
      toast.error("Workspace is still loading");
      return;
    }

    const informational = filterKeywords(
      extractedKeywords,
      sheetFiltersByProject[projectId]?.informational ??
        DEFAULT_SHEET_FILTERS.informational,
      "informational"
    );
    if (informational.length === 0) {
      toast.error("No informational keywords to plan articles from");
      return;
    }

    const gen = ++strategyGen.current;
    setStrategyLoading(true);

    try {
      const res = await buildContentPlanApi(
        workspaceId,
        projectId,
        informational.map((row) => ({
          id: row.id,
          keyword: row.keyword,
          sheet: row.sheet,
          volume: row.volume,
          difficulty: row.difficulty,
          seedId: row.seedId,
          seed: row.seed,
        })),
        {
          parentNiches: (nichesByProject[projectId] ?? activeNiches).map(
            (n) => n.name
          ),
          collections: proposedCollections.map((row) => ({
            id: row.id,
            name: row.name,
            headKeyword: row.headKeyword,
            parentNiche: row.parentNiche,
            volume: row.volume,
            productCount: row.productCount,
            storeHandle: row.storeHandle,
          })),
        }
      );

      if (strategyGen.current !== gen) return;

      setStrategyByProject((prev) => ({ ...prev, [projectId]: res.articles }));
      setStrategyReadyIds((prev) => new Set(prev).add(projectId));

      if (res.droppedByCap > 0 || res.mergedByIntent > 0) {
        const notes: string[] = [];
        if (res.mergedByIntent > 0) {
          notes.push(
            `${res.mergedByIntent} near-duplicate keyword${
              res.mergedByIntent === 1 ? "" : "s"
            } folded into an existing article`
          );
        }
        if (res.droppedByCap > 0) {
          notes.push(
            `${res.droppedByCap} lower-volume keyword${
              res.droppedByCap === 1 ? "" : "s"
            } left out of this plan`
          );
        }
        toast.info(`Planned ${res.articles.length} articles`, {
          description: `${notes.join(" · ")}.`,
        });
      }

      // Titles that fell back to the deterministic form because the Gemini
      // titling batch failed must be called out — they're weaker than a real
      // AI title and shouldn't be mistaken for one.
      if (res.degradedCount > 0) {
        toast.warning("Some article titles used a fallback", {
          description: `${res.degradedCount} of ${res.articles.length} article title${res.degradedCount === 1 ? "" : "s"} couldn't be generated by AI and used a plain fallback title instead.`,
        });
      }
    } catch (err) {
      if (strategyGen.current !== gen) return;
      console.error("[runStrategyBuild] Error:", err);
      toast.error("Could not build the content plan", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      if (strategyGen.current === gen) setStrategyLoading(false);
    }
  };

  const handleNextStrategy = () => {
    if (!activeProject) return;
    const projectId = activeProject.id;
    unlockWorkspaceTab(projectId, "strategy");
    if (!strategyReadyIds.has(projectId)) {
      void runStrategyBuild(projectId);
    }
  };

  const handleBuildStrategy = () => {
    if (!canEdit || !activeProject) return;
    void runStrategyBuild(activeProject.id);
  };

  const patchStrategyRows = (
    projectId: string,
    ids: string[],
    patch: Partial<StrategyArticle>
  ) => {
    const idSet = new Set(ids);
    setStrategyByProject((prev) => ({
      ...prev,
      [projectId]: (prev[projectId] ?? []).map((row) =>
        idSet.has(row.id) ? { ...row, ...patch } : row
      ),
    }));
  };

  const handleGenerateArticles = async (ids: string[]) => {
    if (!canEdit || !activeProject || !workspaceId || ids.length === 0) return;
    const projectId = activeProject.id;
    const rows = (strategyByProject[projectId] ?? []).filter((row) =>
      ids.includes(row.id)
    );
    if (rows.length === 0) return;

    patchStrategyRows(projectId, ids, { status: "generating", error: undefined });

    // A shared cursor over the queue gives us exactly three in flight at once:
    // each finished article immediately pulls the next one.
    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(ARTICLE_GENERATION_CONCURRENCY, rows.length) },
      async () => {
        while (cursor < rows.length) {
          const row = rows[cursor];
          cursor += 1;
          if (articleInFlight.current.has(row.id)) continue;
          articleInFlight.current.add(row.id);

          try {
            const res = await writeArticleApi(
              workspaceId,
              projectId,
              {
                id: row.id,
                title: row.title,
                keyword: row.keyword,
                type: row.type,
                volume: row.volume,
                difficulty: row.difficulty,
                linksOut: row.linksOut,
                skuLinks: row.skuLinks,
              },
              storeBlogs,
              storeUrl
            );

            setArticlesByProject((prev) => ({
              ...prev,
              [projectId]: {
                ...(prev[projectId] ?? {}),
                [res.article.articleId]: res.article,
              },
            }));
            patchStrategyRows(projectId, [row.id], {
              status: "ready",
              category: res.article.blogTitle,
              error: undefined,
            });
          } catch (err) {
            console.error("[handleGenerateArticles] Error:", err);
            patchStrategyRows(projectId, [row.id], {
              status: "failed",
              error: err instanceof Error ? err.message : "Writing failed",
            });
          } finally {
            articleInFlight.current.delete(row.id);
          }
        }
      }
    );

    await Promise.all(workers);
  };

  generateArticlesRef.current = handleGenerateArticles;

  useEffect(() => {
    if (!hydrated || !canEdit || !workspaceId || !activeProject) return;
    const projectId = activeProject.id;
    if (resumedArticles.current.has(projectId)) return;
    const rows = strategyByProject[projectId] ?? [];
    if (rows.length === 0) return;
    const generated = articlesByProject[projectId] ?? {};
    const pendingIds = rows
      .filter((row) => row.status === "generating" && !generated[row.id])
      .map((row) => row.id);
    resumedArticles.current.add(projectId);
    if (pendingIds.length === 0) return;
    void generateArticlesRef.current(pendingIds);
  }, [
    hydrated,
    canEdit,
    workspaceId,
    activeProject,
    strategyByProject,
    articlesByProject,
  ]);

  const handleSyncArticles = async (ids: string[]) => {
    if (!canEdit || !activeProject || !workspaceId || ids.length === 0) return;
    const projectId = activeProject.id;
    const generated = articlesByProject[projectId] ?? {};
    const rows = (strategyByProject[projectId] ?? []).filter(
      (row) => ids.includes(row.id) && generated[row.id]
    );
    if (rows.length === 0) return;

    setArticlesSyncing(true);
    patchStrategyRows(projectId, rows.map((row) => row.id), {
      status: "syncing",
    });

    // Declared outside the try so a batch that fails halfway does not roll back
    // the rows that already reached the store.
    const scheduledIds: string[] = [];

    try {
      // The endpoint accepts 50 articles per call and creates them one by one,
      // so a large plan is sent in sequential batches: parallel calls would
      // trip Shopify's rate limit and one giant call would hit the function
      // timeout. Batches run in order so the publishing calendar stays dense.
      const batches: (typeof rows)[] = [];
      for (let i = 0; i < rows.length; i += ARTICLE_SYNC_BATCH_SIZE) {
        batches.push(rows.slice(i, i + ARTICLE_SYNC_BATCH_SIZE));
      }

      const failedById = new Map<string, string>();
      let syncedCount = 0;
      let timeZone = "UTC";
      const results: ArticleSyncResponse["results"] = [];

      for (const [index, batch] of batches.entries()) {
        if (batches.length > 1) {
          setArticlesSyncProgress({ done: index, total: batches.length });
        }
        const res = await syncArticlesApi(
          workspaceId,
          projectId,
          batch.map((row) => {
            const article = generated[row.id];
            return {
              articleId: row.id,
              title: row.title,
              seoTitle: article.seoTitle,
              seoDescription: article.seoDescription,
              blogTitle: article.blogTitle,
              bodyHtml: article.bodyHtml,
              featuredImage: article.featuredImage,
            };
          })
        );
        results.push(...res.results);
        syncedCount += res.syncedCount;
        timeZone = res.timeZone;
      }

      for (const result of results) {
        if (result.ok) {
          scheduledIds.push(result.articleId);
          // Keep the store ids in client state: this snapshot is written back
          // over the stored slice, so dropping them would lose the record that
          // the article is already on the store's calendar.
          setArticlesByProject((prev) => {
            const current = prev[projectId]?.[result.articleId];
            if (!current) return prev;
            return {
              ...prev,
              [projectId]: {
                ...prev[projectId],
                [result.articleId]: {
                  ...current,
                  scheduledAt: result.scheduledAt ?? current.scheduledAt,
                  storeArticleId: result.storeArticleId ?? current.storeArticleId,
                  storeHandle: result.storeHandle ?? current.storeHandle,
                },
              },
            };
          });
        } else {
          failedById.set(result.articleId, result.error ?? "Upload failed");
        }
      }

      if (scheduledIds.length > 0) {
        patchStrategyRows(projectId, scheduledIds, {
          status: "scheduled",
          error: undefined,
        });
        // Anything reaching the store's calendar completes Stage 7.
        setStrategyApprovedIds((prev) => new Set(prev).add(projectId));
      }
      for (const [articleId, message] of failedById) {
        patchStrategyRows(projectId, [articleId], {
          status: "ready",
          error: message,
        });
      }

      if (syncedCount > 0) {
        toast.success(
          `${syncedCount} article${syncedCount === 1 ? "" : "s"} scheduled`,
          {
            description: `One per day in ${timeZone}, at a different time each day.`,
          }
        );
      }
      if (failedById.size > 0) {
        toast.error(`${failedById.size} article(s) could not be uploaded`, {
          description: [...failedById.values()][0],
        });
      }
    } catch (err) {
      console.error("[handleSyncArticles] Error:", err);
      const scheduled = new Set(scheduledIds);
      patchStrategyRows(
        projectId,
        rows.map((row) => row.id).filter((id) => !scheduled.has(id)),
        {
          status: "ready",
          error: err instanceof Error ? err.message : "Sync failed",
        }
      );
      toast.error("Could not sync articles to the store", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setArticlesSyncing(false);
      setArticlesSyncProgress(null);
    }
  };

  const handleArticleChange = (
    articleId: string,
    patch: Partial<GeneratedArticle>
  ) => {
    if (!activeProject) return;
    const projectId = activeProject.id;
    setArticlesByProject((prev) => {
      const current = prev[projectId]?.[articleId];
      if (!current) return prev;
      return {
        ...prev,
        [projectId]: {
          ...prev[projectId],
          [articleId]: { ...current, ...patch },
        },
      };
    });
  };

  const handleArticleTitleChange = (articleId: string, title: string) => {
    if (!activeProject) return;
    patchStrategyRows(activeProject.id, [articleId], { title });
  };

  const handleConfirmSpend = handleExtract;

  const updateNiches = (
    updater: (current: NicheReading[]) => NicheReading[]
  ) => {
    if (!activeProject) return;
    const projectId = activeProject.id;
    setNichesByProject((prev) => ({
      ...prev,
      [projectId]: updater(prev[projectId] ?? STAGE1_NICHE_READINGS),
    }));
  };

  const handleRenameNiche = (id: string, name: string) => {
    if (!canEdit) return;
    updateNiches((current) =>
      current.map((niche) =>
        niche.id === id ? { ...niche, name, edited: true } : niche
      )
    );
    if (activeProject) {
      const projectId = activeProject.id;
      setStructuredNichesByProject((prev) => {
        const current = prev[projectId];
        if (!current) return prev;
        return {
          ...prev,
          [projectId]: current.map((sn) =>
            sn.id === id ? { ...sn, name } : sn
          ),
        };
      });
    }
  };

  const handleDeleteNiche = (id: string) => {
    if (!canEdit) return;
    updateNiches((current) => current.filter((niche) => niche.id !== id));
    if (activeProject) {
      const projectId = activeProject.id;
      const removedCollectionIds = new Set<string>();
      setStructuredNichesByProject((prev) => {
        const current = prev[projectId];
        if (!current) return prev;
        const toRemove = current.find((sn) => sn.id === id);
        if (toRemove) {
          toRemove.collections.forEach((c) => removedCollectionIds.add(c.id));
        }
        return {
          ...prev,
          [projectId]: current.filter((sn) => sn.id !== id),
        };
      });
      if (removedCollectionIds.size > 0) {
        setProjects((prev) =>
          prev.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  highlightedCollectionIds: p.highlightedCollectionIds.filter(
                    (cid) => !removedCollectionIds.has(cid)
                  ),
                }
              : p
          )
        );
      }
    }
  };

  const handleAddNiche = (name: string) => {
    if (!canEdit) return;
    const newId = `niche-${Date.now()}`;
    updateNiches((current) => [
      ...current,
      {
        id: newId,
        name,
        summary: "Added by you — the first read didn’t surface this space.",
        edited: true,
      },
    ]);
    if (activeProject) {
      const projectId = activeProject.id;
      setStructuredNichesByProject((prev) => ({
        ...prev,
        [projectId]: [
          ...(prev[projectId] ?? []),
          { id: newId, name, productCount: 0, collections: [] },
        ],
      }));
      appendAgent(
        projectId,
        `Added “${name}” as a parent niche. I’ll carry it into catalog scope without re-reading the site.`
      );
    }
  };

  const handleMergeNiche = (sourceId: string, targetId: string) => {
    if (!canEdit) return;
    updateNiches((current) => {
      const source = current.find((n) => n.id === sourceId);
      if (!source) return current;
      return current
        .filter((niche) => niche.id !== sourceId)
        .map((niche) =>
          niche.id === targetId
            ? {
                ...niche,
                edited: true,
                summary: `${niche.summary} Merged with ${source.name}.`,
              }
            : niche
        );
    });
    if (activeProject) {
      const projectId = activeProject.id;
      setStructuredNichesByProject((prev) => {
        const current = prev[projectId] ?? [];
        const source = current.find((sn) => sn.id === sourceId);
        const target = current.find((sn) => sn.id === targetId);
        if (!source || !target) {
          return {
            ...prev,
            [projectId]: current.filter((sn) => sn.id !== sourceId),
          };
        }
        const existingIds = new Set(target.collections.map((c) => c.id));
        const combinedCollections = [
          ...target.collections,
          ...source.collections.filter((c) => !existingIds.has(c.id)),
        ];
        const combinedProductCount = combinedCollections.reduce(
          (sum, c) => sum + (c.productCount || 0),
          0
        );
        // Preserve the nested subcategory tree only when BOTH sides came from
        // the taxonomy agent — subcategory ids are unique across the whole
        // tree, so this is a plain union. If either side is a legacy flat
        // niche, subcategory grouping can't be reconstructed for the merge,
        // so the result falls back to the flat collections view above.
        const combinedSubcategories =
          Array.isArray(target.subcategories) && Array.isArray(source.subcategories)
            ? [
                ...target.subcategories,
                ...source.subcategories.filter(
                  (sub) => !target.subcategories!.some((t) => t.id === sub.id)
                ),
              ]
            : undefined;
        return {
          ...prev,
          [projectId]: current
            .filter((sn) => sn.id !== sourceId)
            .map((sn) =>
              sn.id === targetId
                ? {
                    ...sn,
                    productCount: combinedProductCount,
                    collections: combinedCollections,
                    subcategories: combinedSubcategories,
                  }
                : sn
            ),
        };
      });
    }
  };

  const cancelAnalysis = () => {
    if (!activeProject || !analyzing) return;
    analysisGen.current += 1;
    setAnalyzing(false);
    setAnalysisProgress(0);
    appendAgent(
      activeProject.id,
      "Stopped the website read. Nothing was saved from this pass — start it again whenever you’re ready."
    );
  };

  useEffect(() => {
    if (analyzing && stage !== 1) setStage(1);
    if (stage > openedMax) setStage(openedMax);
  }, [analyzing, stage, openedMax]);

  useEffect(() => {
    if (!activeProject) return;
    if (pendingAutoAnalyzeId.current !== activeProject.id) return;
    pendingAutoAnalyzeId.current = null;
    startAnalysis({ freshChat: true });
  }, [activeProject, startAnalysis]);

  const handleSendMessage = (text: string) => {
    if (!canEdit || !activeProject || analyzing || preparingStage2 || preparingStage3) {
      return;
    }
    const projectId = activeProject.id;
    appendUser(projectId, text);

    if (
      stage === 1 &&
      (looksLikeReanalyzeRequest(text) || looksLikeReadDisagreement(text))
    ) {
      setChatBusy(true);
      window.setTimeout(() => {
        setChatBusy(false);
        appendAgent(
          projectId,
          `Noted for ${activeProject.storeLabel}. A full re-read replaces this niche picture and reopens the later stages, so I’ll wait for your confirmation below before spending another pass.`
        );
        setRereadPendingIds((prev) => {
          const next = new Set(prev);
          next.add(projectId);
          return next;
        });
      }, 500);
      return;
    }

    if (!workspaceId) {
      setChatBusy(true);
      window.setTimeout(() => {
        setChatBusy(false);
        appendAgent(
          projectId,
          mockAgentReply(text, activeProject.storeLabel, stage)
        );
      }, 650);
      return;
    }

    setChatBusy(true);
    const history = (chatByProject[projectId] ?? []).map((m) => ({
      role: m.role === "agent" ? ("assistant" as const) : ("user" as const),
      content: m.text,
    }));

    void (async () => {
      try {
        const res = await chatAgentApi(
          workspaceId,
          projectId,
          history,
          text,
          activeNiches,
          {
            stage,
            market: activeMarket,
            selectedCollectionIds:
              stage === 2
                ? activeProject.highlightedCollectionIds
                : (stage3ScopeByProject[projectId] ?? activeProject.highlightedCollectionIds),
            seedRows: stage3Rows,
            probes: activeProbes,
          }
        );
        setChatBusy(false);
        appendAgent(projectId, res.reply);
        if (res.updatedNiches && res.updatedNiches.length > 0) {
          setNichesByProject((prev) => ({
            ...prev,
            [projectId]: res.updatedNiches!,
          }));
        }
        if (
          res.updatedStructuredNiches &&
          res.updatedStructuredNiches.length > 0
        ) {
          setStructuredNichesByProject((prev) => ({
            ...prev,
            [projectId]: res.updatedStructuredNiches!,
          }));
        }
      } catch (err) {
        console.error("[handleSendMessage] Chat agent call failed:", err);
        setChatBusy(false);
        appendAgent(
          projectId,
          `${mockAgentReply(text, activeProject.storeLabel, stage)}\n\n(The AI chat call failed, so this is a generic placeholder reply, not a real agent response — your niches were not changed. Try again in a moment.)`
        );
        toast.error("Chat agent call failed", {
          description: "Showing a placeholder reply. Please try again.",
        });
      }
    })();
  };

  if (wsLoading || !hydrated) {
    return <PageLoader />;
  }

  if (!hasIntegration) {
    return (
      <div className="autommerce-dashboard flex flex-1 items-center justify-center p-8 [font-family:var(--brand-font)]">
        <div className="max-w-md text-center space-y-6">
          <div className="mx-auto h-16 w-16 rounded-2xl bg-muted/60 flex items-center justify-center">
            <Unplug className="h-8 w-8 text-muted-foreground" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold">Integration Required</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Connect a platform in Settings to start using Market Research. Once connected,
              the AI agent will analyze your store catalog, navigation, and collections to discover
              lucrative niches and commercial keyword opportunities.
            </p>
          </div>
          <Button onClick={() => router.push(`/w/${slug}/settings`)} className="gap-2">
            <Settings className="h-4 w-4" />
            Go to Settings
          </Button>
        </div>
      </div>
    );
  }

  const atProjectCap = projects.length >= MAX_MARKET_RESEARCH_PROJECTS;
  const namingRequired = projects.length === 0;

  const handleNewProject = () => {
    if (!canEdit) return;
    if (atProjectCap) {
      toast.error("Limit reached", {
        description: `Your plan allows up to ${MAX_MARKET_RESEARCH_PROJECTS} market research projects.`,
      });
      return;
    }
    setCreateOpen(true);
  };

  const handleCreateProjectAndAnalyze = async (name: string) => {
    if (!canEdit) return;
    if (atProjectCap) {
      toast.error("Limit reached", {
        description: `Your plan allows up to ${MAX_MARKET_RESEARCH_PROJECTS} market research projects.`,
      });
      return;
    }
    if (!workspaceId) {
      toast.error("Workspace is still loading");
      return;
    }
    try {
      const created = await createMrProjectApi(workspaceId, {
        name,
        storeLabel: activeProject?.storeLabel ?? DEFAULT_STORE,
        highlightedCollectionIds: ["sunglasses", "womens-sunglasses"],
      });
      const project: MarketResearchProject = {
        id: created.id,
        name: created.name,
        status: "active",
        storeLabel: activeProject?.storeLabel ?? DEFAULT_STORE,
        highlightedCollectionIds: ["sunglasses", "womens-sunglasses"],
      };
      pendingAutoAnalyzeId.current = project.id;
      setProjects((prev) => [...prev, project]);
      setActiveProjectId(project.id);
      setOpenedMaxByProject((prev) => ({ ...prev, [project.id]: 1 }));
      setStageByProject((prev) => ({ ...prev, [project.id]: 1 }));
      setProjectFilter("active");
      setStage(1);
      setProjectsOpen(false);
      setInviteOpen(false);
      setChatByProject((prev) => ({ ...prev, [project.id]: [] }));
      toast.success("Project created", { description: project.name });
    } catch (error) {
      toast.error("Could not create project", {
        description:
          error instanceof Error ? error.message : "Try again in a moment.",
      });
    }
  };

  const handleSelectProject = (id: string) => {
    analysisGen.current += 1;
    stage2Gen.current += 1;
    stage3Gen.current += 1;
    probeGen.current += 1;
    analyzeGen.current += 1;
    clusterGen.current += 1;
    contentGen.current += 1;
    strategyGen.current += 1;
    setProbingIds([]);
    setAnalyzeLoading(false);
    setClustering(false);
    setGenerating(false);
    setStrategyLoading(false);
    setReviewFlow(null);
    setAnalyzing(false);
    setPreparingStage2(false);
    setPreparingStage3(false);
    setActiveProjectId(id);
    const opened = clampOpenedStage(openedMaxByProject[id], 1);
    const preferred = clampOpenedStage(stageByProject[id], opened >= 2 ? 2 : 1);
    setStage(Math.min(preferred, opened) as MarketResearchStage);

    const done = stage1DoneIds.has(id);
    if (done) {
      setInviteOpen(false);
      setChatByProject((prev) => {
        if ((prev[id] ?? []).length > 0) return prev;
        const proj = projects.find((p) => p.id === id);
        if (!proj) return prev;
        return {
          ...prev,
          [id]: [
            {
              id: msgId(),
              role: "agent",
              text: stage1AgentConclusion(proj.storeLabel),
            },
          ],
        };
      });
      return;
    }
    if (!inviteDismissedIds.has(id)) setInviteOpen(true);
    else setInviteOpen(false);
  };

  const handleRenameProject = (id: string, name: string) => {
    if (!canEdit) return;
    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, name } : p))
    );
    toast.success("Project renamed", { description: name });
  };

  const handleToggleComplete = (id: string, completed: boolean) => {
    if (!canEdit) return;
    setProjects((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, status: completed ? "completed" : "active" } : p
      )
    );
    setProjectFilter(completed ? "completed" : "active");
    toast.success(completed ? "Project marked complete" : "Project reopened");
  };

  const handleDeleteProject = (id: string) => {
    if (!canAdmin) return;
    void (async () => {
      if (workspaceId) {
        try {
          await deleteMrProjectApi(workspaceId, id);
        } catch (error) {
          toast.error("Could not delete project", {
            description:
              error instanceof Error ? error.message : "Try again in a moment.",
          });
          return;
        }
      }
      analysisGen.current += 1;
      stage2Gen.current += 1;
      stage3Gen.current += 1;
      setAnalyzing(false);
      setPreparingStage2(false);
      setPreparingStage3(false);
      setProjects((prev) => {
        const next = prev.filter((p) => p.id !== id);
        if (activeProjectId === id) {
          const fallback =
            next.find((p) => p.status === "active") ?? next[0] ?? null;
          setActiveProjectId(fallback?.id ?? "");
          setStage(1);
          if (fallback) {
            setProjectFilter(fallback.status);
            if (!stage1DoneIds.has(fallback.id)) setInviteOpen(true);
            else setInviteOpen(false);
          } else {
            setInviteOpen(false);
          }
        }
        return next;
      });
      setStage1DoneIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setOpenedMaxByProject((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      toast.success("Project deleted");
    })();
  };

  const stage1Messages = activeProject
    ? (chatByProject[activeProject.id] ?? [])
    : [];

  return (
    <div className="autommerce-dashboard market-research-brand flex h-full min-h-0 gap-2 overflow-hidden bg-muted/25 p-2 [font-family:var(--brand-font)]">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/70 bg-background shadow-sm">
        <div className="relative flex flex-1 min-h-0 overflow-hidden">
          {activeProject ? (
            <AnalysisInvite
              open={inviteOpen && canEdit && !analyzing && !createOpen && !inWorkspace}
              storeLabel={activeProject.storeLabel}
              projectName={activeProject.name}
              onRun={() => startAnalysis({ freshChat: true })}
              onDismiss={() => {
                setInviteOpen(false);
                setInviteDismissedIds((prev) => {
                  const next = new Set(prev);
                  next.add(activeProject.id);
                  return next;
                });
              }}
            />
          ) : null}

          <NewProjectOverlay
            open={createOpen}
            onOpenChange={setCreateOpen}
            onCreate={handleCreateProjectAndAnalyze}
            required={namingRequired && canEdit}
            storeLabel={activeProject?.storeLabel ?? DEFAULT_STORE}
          />

          {activeProject ? (
            <div
              className={`mr-stage-frame${workspaceScene ? " is-workspace" : ""}`}
            >
              <div className="mr-agent-cell" aria-hidden={workspaceScene}>
                <div className="mr-agent-inner">
                <AgentPanel
                  stage={lockedViewStage}
                  storeLabel={activeProject.storeLabel}
                  projectName={activeProject.name}
                  analyzingStage1={analyzing}
                  pendingStage1={pendingStage1}
                  stage1Done={stage1DoneForActive}
                  preparingStage2={preparingStage2}
                  preparingStage3={preparingStage3}
                  messages={stage1Messages}
                  onSendMessage={handleSendMessage}
                  chatBusy={chatBusy}
                  readOnly={reviewingBrief || !canEdit}
                  pendingReread={rereadPending}
                  onConfirmReread={() => startAnalysis({ freshChat: false })}
                  onDismissReread={() => {
                    setRereadPendingIds((prev) => {
                      if (!prev.has(activeProject.id)) return prev;
                      const next = new Set(prev);
                      next.delete(activeProject.id);
                      return next;
                    });
                    appendAgent(
                      activeProject.id,
                      "Keeping the current read. Tell me what to adjust in words, or press Next when you’re ready for catalog scope."
                    );
                  }}
                  timeline={
                    <RunTimeline
                      steps={timelineSteps}
                      receipts={timelineReceipts}
                      current={lockedViewStage}
                    />
                  }
                />
                </div>
              </div>

              <div className="mr-pane-cell">
              <section className="mr-pane mr-pane-brief">
                <div className="flex items-center gap-1 border-b border-border/60 px-3 py-2 shrink-0">
                  {reviewingBrief ? (
                    <div className="min-w-0 flex-1 overflow-x-auto">
                      <WorkspaceStepper
                        current={reviewFlow ?? "niches"}
                        opened={openedWorkspace}
                        onChange={handleFlowTab}
                      />
                    </div>
                  ) : (
                  <div
                    role="tablist"
                    aria-label="Market research stages"
                    className="flex items-center gap-1"
                  >
                    {visibleStages.map((s) => {
                      const active = stage === s;
                      const blocked =
                        (preparingStage2 && s !== 2) ||
                        (preparingStage3 && s !== 3);
                      return (
                        <button
                          key={s}
                          type="button"
                          role="tab"
                          id={`mr-stage-tab-${s}`}
                          aria-selected={active}
                          aria-controls="mr-stage-panel"
                          tabIndex={active ? 0 : -1}
                          disabled={blocked}
                          onKeyDown={(e) => {
                            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft")
                              return;
                            e.preventDefault();
                            const index = visibleStages.indexOf(s);
                            const offset = e.key === "ArrowRight" ? 1 : -1;
                            const target =
                              visibleStages[
                                (index + offset + visibleStages.length) %
                                  visibleStages.length
                              ];
                            setViewStage(target);
                            document
                              .getElementById(`mr-stage-tab-${target}`)
                              ?.focus();
                          }}
                          onClick={() => {
                            if (s > openedMax || blocked) return;
                            setViewStage(s);
                          }}
                          className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                            active
                              ? "bg-primary/10 text-primary"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          }`}
                        >
                          <span className="text-muted-foreground/80 mr-1.5">
                            {s}
                          </span>
                          {STAGE_META[s].shortLabel}
                        </button>
                      );
                    })}
                  </div>
                  )}
                  {reviewingBrief ? null : (
                  <div className="ml-auto flex items-center gap-3 px-1">
                    <span className="hidden sm:inline text-[10px] text-muted-foreground">
                      {analyzing
                        ? "Reading website…"
                        : preparingStage2
                          ? "Preparing catalog scope…"
                          : preparingStage3
                            ? "Generating seed variations…"
                            : pendingStage1
                              ? "Stage 1 waiting"
                              : stage3Stale
                                ? "Scope changed · regenerate seeds"
                                : openedMax === 1 && stage1DoneForActive
                                  ? "Discuss niches · Next opens Stage 2"
                                  : openedMax === 2 && stage2ReadyForActive
                                    ? "Select collections · Next opens Stage 3"
                                    : null}
                    </span>
                    <StageStepper current={stage} steps={timelineSteps} />
                  </div>
                  )}
                </div>

                <div
                  id="mr-stage-panel"
                  role="tabpanel"
                  aria-labelledby={`mr-stage-tab-${stage}`}
                  className="flex-1 min-h-0 overflow-hidden p-4 sm:p-5 flex flex-col"
                >
                  {lockedViewStage === 1 && (
                    <StageScopePanel
                      projectId={activeProject.id}
                      storeLabel={activeProject.storeLabel}
                      phase={
                        analyzing
                          ? "running"
                          : stage1DoneForActive
                            ? "done"
                            : "pending"
                      }
                      showNext={
                        stage1DoneForActive && !analyzing && !reviewingBrief
                      }
                      nextLabel={
                        openedMax >= 2
                          ? "Open Stage 2"
                          : "Next · Catalog scope"
                      }
                      nextDisabled={preparingStage2 || preparingStage3}
                      onNext={handleNextFromStage1}
                      progress={analysisProgress}
                      onCancelAnalysis={cancelAnalysis}
                      niches={activeNiches}
                      onRenameNiche={handleRenameNiche}
                      onDeleteNiche={handleDeleteNiche}
                      onAddNiche={handleAddNiche}
                      onMergeNiche={handleMergeNiche}
                      readOnly={reviewingBrief || !canEdit}
                      onStartAnalysis={() => {
                        setInviteDismissedIds((prev) => {
                          if (!prev.has(activeProject.id)) return prev;
                          const next = new Set(prev);
                          next.delete(activeProject.id);
                          return next;
                        });
                        setInviteOpen(true);
                      }}
                    />
                  )}
                  {lockedViewStage === 2 && openedMax >= 2 && (
                    <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
                      <StageSelectPanel
                        project={activeProject}
                        niches={activeStructuredNiches}
                        excludedItems={activeExcludedItems}
                        skuFloor={activeSkuFloor}
                        onChangeSkuFloor={(value) => {
                          setSkuFloorByProject((prev) => ({
                            ...prev,
                            [activeProject.id]: value,
                          }));
                        }}
                        preparing={
                          preparingStage2 || !stage2ReadyForActive
                        }
                        showNext={
                          stage2ReadyForActive &&
                          !preparingStage2 &&
                          !reviewingBrief
                        }
                        nextLabel={
                          stage3Stale
                            ? "Next · Regenerate seeds"
                            : openedMax >= 3
                              ? "Open Stage 3"
                              : "Next · Seed variations"
                        }
                        nextDisabled={preparingStage3}
                        onNext={handleNextFromStage2}
                        readOnly={reviewingBrief || !canEdit}
                        lockedNicheCount={
                          stage1DoneForActive ? activeNiches.length : undefined
                        }
                        onChangeSelection={(collectionIds) => {
                          setProjects((prev) =>
                            prev.map((p) =>
                              p.id === activeProject.id
                                ? {
                                    ...p,
                                    highlightedCollectionIds: collectionIds,
                                  }
                                : p
                            )
                          );
                        }}
                      />
                    </div>
                  )}
                  {lockedViewStage === 3 && openedMax >= 3 && (
                    <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
                      <StageSeedsPanel
                        rows={stage3Rows}
                        preparing={
                          preparingStage3 || !stage3ReadyForActive
                        }
                        stale={stage3Stale}
                        onRegenerate={() =>
                          startStage3Prep(
                            activeProject.id,
                            activeProject.highlightedCollectionIds
                          )
                        }
                        selectedIds={seedSelection}
                        onChangeSelected={(ids) => {
                          setSeedSelectionByProject((prev) => ({
                            ...prev,
                            [activeProject.id]: ids,
                          }));
                          if (!committedProjectIds.has(activeProject.id)) {
                            clearCommitment(activeProject.id);
                          }
                        }}
                        market={activeMarket}
                        onChangeMarket={(next) => {
                          setMarketByProject((prev) => ({
                            ...prev,
                            [activeProject.id]: next,
                          }));
                          clearCommitment(activeProject.id);
                          appendAgent(
                            activeProject.id,
                            `Switched the target market to ${marketLabel(next)}. Existing demand numbers were pulled for a different market, so they now show as stale — re-check the seeds you care about.`
                          );
                        }}
                        probes={activeProbes}
                        probingIds={probingIds}
                        onProbe={runProbe}
                        onAddManualSeed={handleAddManualSeed}
                        onConfirmSpend={handleConfirmSpend}
                        committed={committedForActive}
                        walletHref={`/w/${slug}/wallet`}
                        walletBalance={wallet?.balance ?? null}
                        readOnly={reviewingBrief || !canEdit}
                        productCountByCollectionId={
                          productCountByCollectionIdByProject[activeProject.id] ?? {}
                        }
                        productFetchProgress={
                          productFetchProgressByProject[activeProject.id] ?? null
                        }
                      />
                    </div>
                  )}
                </div>
              </section>
              {inWorkspace ? (
                <div className="mr-pane mr-pane-deep">
                  <DeepWorkspace
                    projectName={activeProject.name}
                    storeLabel={activeProject.storeLabel}
                    tab={workspaceTab}
                    opened={openedWorkspace}
                    onTab={handleFlowTab}
                    seeds={selectedSeedRows}
                    probes={activeProbes}
                    keywords={extractedKeywords}
                    extracting={extracting}
                    extractProgress={extractProgress}
                    seedProgress={seedProgress}
                    chargedUsd={
                      extractChargeByProject[activeProject.id] ??
                      selectionEstimate.usd
                    }
                    onAnalyze={handleAnalyze}
                    analyzeLoading={analyzeLoading}
                    analyzeProgress={analyzeProgress}
                    productEmbedProgress={
                      productEmbedProgressByProject[activeProject.id] ?? null
                    }
                    analyzed={analyzed}
                    appliedSheetFilters={appliedSheetFilters}
                    onApplySheetFilters={handleApplySheetFilters}
                    onNextCollections={handleNextCollections}
                    onCancelExtract={handleCancelExtract}
                    keywordsCsvHref={
                      workspaceId && committedForActive
                        ? `/api/market-research/extract/download?workspaceId=${workspaceId}&projectId=${activeProject.id}`
                        : undefined
                    }
                    collections={proposedCollections}
                    products={productsByProject[activeProject.id] ?? []}
                    workspaceId={workspaceId}
                    projectId={activeProject.id}
                    clustering={clustering}
                    clusterProgress={clusterProgress}
                    termEmbedProgress={
                      termEmbedProgressByProject[activeProject.id] ?? null
                    }
                    selectedCollectionIds={clusterSelection}
                    onChangeSelected={(ids) =>
                      setClusterSelectionByProject((prev) => ({
                        ...prev,
                        [activeProject.id]: ids,
                      }))
                    }
                    paidCollectionIds={paidCollectionIds}
                    onStartWorking={handleStartWorking}
                    onPushToStore={handlePushToStore}
                    onRemoveDuplicates={(ids) => {
                      const idSet = new Set(ids);
                      const projectId = activeProject.id;
                      setProposedCollectionsByProject((prev) => ({
                        ...prev,
                        [projectId]: (prev[projectId] ?? []).filter(
                          (c) => !idSet.has(c.id)
                        ),
                      }));
                      setClusterSelectionByProject((prev) => ({
                        ...prev,
                        [projectId]: (prev[projectId] ?? []).filter(
                          (id) => !idSet.has(id)
                        ),
                      }));
                    }}
                    onRecheckDuplicates={handleRecheckDuplicates}
                    recheckingDuplicates={Boolean(
                      recheckingDuplicatesByProject[activeProject.id]
                    )}
                    pushingCollections={Boolean(
                      pushingCollectionsByProject[activeProject.id]
                    )}
                    walletBalance={wallet?.balance ?? null}
                    walletHref={`/w/${slug}/wallet`}
                    instructions={customInstructions}
                    onInstruction={(field, value) =>
                      setCustomInstructionByProject((prev) => ({
                        ...prev,
                        [activeProject.id]: {
                          ...(prev[activeProject.id] ??
                            EMPTY_ON_PAGE_INSTRUCTIONS),
                          [field]: value,
                        },
                      }))
                    }
                    contentById={contentById}
                    internalLinksById={internalLinksById}
                    linksBuildProgress={linksBuildProgress}
                    generating={generating}
                    contentGenProgress={contentGenProgress}
                    contentReady={contentReady}
                    pushed={contentPushed}
                    syncingSeo={Boolean(
                      activeProject && syncingSeoByProject[activeProject.id]
                    )}
                    seoSynced={
                      seoAllSynced ||
                      Boolean(
                        activeProject &&
                          seoSyncedProjectIds.has(activeProject.id)
                      )
                    }
                    onStartContent={handleStartContent}
                    onPush={handlePush}
                    onSyncSeo={handleSyncSeo}
                    pushCostUsd={collectionPushCostUsd(clusterSelection.length)}
                    onNextStrategy={handleNextStrategy}
                    strategyArticles={strategyArticles}
                    generatedArticles={generatedArticles}
                    storeBlogs={storeBlogs}
                    storeUrl={storeUrl}
                    storeProvider={storeProvider}
                    blogScopeWarning={blogScopeWarning}
                    strategyLoading={strategyLoading}
                    strategyReady={strategyReady}
                    articlesSyncing={articlesSyncing}
                    articlesSyncProgress={articlesSyncProgress}
                    onBuildStrategy={handleBuildStrategy}
                    onGenerateArticles={(ids) => void handleGenerateArticles(ids)}
                    onSyncArticles={(ids) => void handleSyncArticles(ids)}
                    onArticleChange={handleArticleChange}
                    onArticleTitleChange={handleArticleTitleChange}
                    readOnly={!canEdit}
                  />
                </div>
              ) : null}
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8" />
          )}
        </div>
      </div>

      {projects.length > 0 ? (
        <ProjectsSidebar
          open={projectsOpen}
          onOpenChange={setProjectsOpen}
          projects={projects}
          activeProjectId={activeProject?.id ?? ""}
          filter={projectFilter}
          onFilterChange={setProjectFilter}
          onSelectProject={handleSelectProject}
          onNewProject={handleNewProject}
          onRenameProject={handleRenameProject}
          onDeleteProject={handleDeleteProject}
          onToggleComplete={handleToggleComplete}
          openedStageByProject={effectiveOpenedStageByProject}
          atProjectCap={atProjectCap}
          canEdit={canEdit}
          canAdmin={canAdmin}
        />
      ) : null}

      <InsufficientFundsDialog
        open={insufficientFundsDialog.open}
        onOpenChange={(open) =>
          setInsufficientFundsDialog((prev) => ({ ...prev, open }))
        }
        requiredAmount={insufficientFundsDialog.requiredAmount}
        currentBalance={insufficientFundsDialog.currentBalance}
        actionName={insufficientFundsDialog.actionName}
        walletHref={`/w/${slug}/wallet`}
      />
    </div>
  );
}
