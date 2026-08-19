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
import { Loader2, Settings, Store, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useWallet } from "@/hooks/use-wallet";
import { useWorkspace } from "@/hooks/use-workspace";
import { useWorkspaceStore } from "@/store/workspace-store";
import { previewBalance } from "@/lib/market-research/billing";
import {
  analyzeStoreApi,
  cancelExtractApi,
  chatAgentApi,
  classifyIntentApi,
  clusterCollectionsApi,
  createMrProjectApi,
  deleteMrProjectApi,
  generateOnPageApi,
  generateSeedsApi,
  loadMrStateApi,
  pollExtractApi,
  probeSeedsApi,
  pushCollectionsApi,
  saveMrStateApi,
  startExtractApi,
  syncSeoApi,
} from "@/lib/market-research/client";
import {
  actualExtractCostUsd,
  collectionPushCostUsd,
} from "@/lib/market-research/cost";
import { assignUuidProjectIds } from "@/lib/market-research/project-state";
import {
  applySampleWeights,
  mergeKeywordSample,
  toExtractedKeyword,
} from "@/lib/market-research/map-keywords";
import type {
  CollectionContent,
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
  MOCK_NICHES,
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
  buildContentStrategy,
  buildExtractedKeywords,
  buildProposedCollections,
  EMPTY_ON_PAGE_INSTRUCTIONS,
  clampWorkspaceTab,
  briefStageFromFlow,
  isWorkspaceTab,
  maxTab,
  pulledCountForSeed,
  type FlowTab,
  type OnPageInstructions,
  type SeedExtractProgress,
  type WorkspaceTab,
} from "./workspace-data";

const DEFAULT_STORE = "Demo Shopify store";
const EMPTY_IDS: string[] = [];

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
    hasIntegration,
    isLoading: wsLoading,
  } = useWorkspace(slug, user);
  const workspaceId = workspace?.id ?? "";
  const { wallet } = useWallet(workspaceId || null);
  const invalidateWallet = useWorkspaceStore((s) => s.invalidateWallet);
  const persistReady = useRef(false);
  const persistRemote = useRef(false);
  const skipPersistSave = useRef(true);

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
  const [productsByProject, setProductsByProject] = useState<
    Record<string, MarketResearchProduct[]>
  >({});
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
  const [extracting, setExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState(0);
  const [seedProgress, setSeedProgress] = useState<SeedExtractProgress[]>([]);
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [clustering, setClustering] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [strategyLoading, setStrategyLoading] = useState(false);
  const [contentByIdByProject, setContentByIdByProject] = useState<
    Record<string, Record<string, CollectionContent>>
  >({});
  const [pushingCollectionsByProject, setPushingCollectionsByProject] =
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
  const analyzeGen = useRef(0);
  const clusterGen = useRef(0);
  const contentGen = useRef(0);
  const strategyGen = useRef(0);
  const analysisGen = useRef(0);
  const stage2Gen = useRef(0);
  const stage3Gen = useRef(0);
  const pendingAutoAnalyzeId = useRef<string | null>(null);

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
    setProductsByProject(saved.productsByProject ?? {});
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
    setPaidCollectionProjectIds(new Set(saved.paidCollectionProjectIds ?? []));
    setContentReadyIds(new Set(saved.contentReadyIds ?? []));
    setPushedIds(new Set(saved.pushedIds ?? []));
    setAnalyzedProjectIds(new Set(saved.analyzedProjectIds ?? []));
    setStrategyReadyIds(new Set(saved.strategyReadyIds ?? []));
    setStrategyApprovedIds(new Set(saved.strategyApprovedIds ?? []));
    setCustomInstructionByProject(saved.customInstructionByProject ?? {});
    setExtractChargeByProject(saved.extractChargeByProject ?? {});
    setExtractRowsByProject(saved.extractRowsByProject ?? {});
    setKeywordsByProject(saved.keywordsByProject ?? {});
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
      productsByProject,
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
      paidCollectionProjectIds: Array.from(paidCollectionProjectIds),
      contentReadyIds: Array.from(contentReadyIds),
      pushedIds: Array.from(pushedIds),
      analyzedProjectIds: Array.from(analyzedProjectIds),
      strategyReadyIds: Array.from(strategyReadyIds),
      strategyApprovedIds: Array.from(strategyApprovedIds),
      customInstructionByProject,
      extractChargeByProject,
      extractRowsByProject,
      keywordsByProject,
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
      productsByProject,
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
      paidCollectionProjectIds,
      contentReadyIds,
      pushedIds,
      analyzedProjectIds,
      strategyReadyIds,
      strategyApprovedIds,
      customInstructionByProject,
      extractChargeByProject,
      extractRowsByProject,
      keywordsByProject,
    ]
  );

  useEffect(() => {
    if (!hydrated || !persistReady.current) return;
    saveMarketResearchState(slug, persistedSnapshot);
    if (skipPersistSave.current) {
      skipPersistSave.current = false;
      return;
    }
    if (!workspaceId || !persistRemote.current) return;
    const timer = window.setTimeout(() => {
      void saveMrStateApi(workspaceId, persistedSnapshot).catch(() => undefined);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [hydrated, slug, workspaceId, persistedSnapshot]);

  useEffect(() => {
    if (!hydrated) return;
    if (projects.length === 0) setCreateOpen(true);
  }, [hydrated, projects.length]);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? projects[0],
    [projects, activeProjectId]
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
  const collectionsPaid = Boolean(
    activeProject && paidCollectionProjectIds.has(activeProject.id)
  );
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
    if (!activeProject) return MOCK_NICHES;
    const projectNiches = nichesByProject[activeProject.id];
    const structured = structuredNichesByProject[activeProject.id];

    if (Array.isArray(projectNiches) && projectNiches.length > 0) {
      const structuredMap = new Map(
        (Array.isArray(structured) ? structured : MOCK_NICHES).map((sn) => [
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

    return MOCK_NICHES;
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
  const extractedKeywords = useMemo(() => {
    if (activeProject && keywordsByProject[activeProject.id]?.length) {
      return keywordsByProject[activeProject.id];
    }
    if (activeProject && committedProjectIds.has(activeProject.id)) {
      return buildExtractedKeywords(selectedSeedRows, activeProbes);
    }
    return [];
  }, [
    activeProject,
    keywordsByProject,
    committedProjectIds,
    selectedSeedRows,
    activeProbes,
  ]);
  const proposedCollections = useMemo(() => {
    if (
      activeProject &&
      proposedCollectionsByProject[activeProject.id] &&
      proposedCollectionsByProject[activeProject.id].length > 0
    ) {
      return proposedCollectionsByProject[activeProject.id];
    }
    return buildProposedCollections(selectedSeedRows, extractedKeywords);
  }, [
    activeProject,
    proposedCollectionsByProject,
    selectedSeedRows,
    extractedKeywords,
  ]);
  const selectedCollections = useMemo(
    () =>
      proposedCollections.filter((row) => clusterSelection.includes(row.id)),
    [proposedCollections, clusterSelection]
  );
  const strategyArticles = useMemo(
    () =>
      buildContentStrategy(
        selectedCollections.length > 0
          ? selectedCollections
          : proposedCollections,
        extractedKeywords
      ),
    [selectedCollections, proposedCollections, extractedKeywords]
  );

  const contentById = useMemo(() => {
    if (!activeProject) return {};
    return contentByIdByProject[activeProject.id] ?? {};
  }, [activeProject, contentByIdByProject]);

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
            ? "Extracting phrase keywords from Apify…"
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
        detail: `Wallet charge for Apify keyword rows in ${marketLabel(activeMarket)}`,
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
      if (!activeProject) return;
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
          setAnalysisProgress(1);
          completeAnalysis(projectId, storeLabel);
        }
      })();
    },
    [activeProject, workspaceId, appendAgent, completeAnalysis]
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
        structuredNichesByProject[projectId] ?? MOCK_NICHES;
      const selectedScopeCollections: Array<{
        id: string;
        name: string;
        description?: string;
        productCount: number;
        parentNicheName: string;
      }> = [];

      for (const niche of currentStructured) {
        for (const col of niche.collections) {
          if (collectionIds.includes(col.id)) {
            selectedScopeCollections.push({
              id: col.id,
              name: col.name,
              description: col.description,
              productCount: col.productCount,
              parentNicheName: niche.name,
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
          if (Array.isArray(res.products) && res.products.length > 0) {
            setProductsByProject((prev) => ({
              ...prev,
              [projectId]: res.products!,
            }));
          }
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
        } catch (err) {
          if (stage3Gen.current !== gen) return;
          console.error("[startStage3Prep] Failed to generate seeds:", err);
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
            stage3AgentReady(collectionIds.length, fallbackRows.length)
          );
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

  const handleNextFromStage1 = () => {
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
    if (!activeProject || rowIds.length === 0) return;
    if (!workspaceId) {
      toast.error("Workspace is still loading");
      return;
    }
    const projectId = activeProject.id;
    const market = activeMarket;
    const targets = stage3Rows.filter((row) => rowIds.includes(row.id));
    if (targets.length === 0) return;

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
        description: "Could not retrieve seed metrics. Please try again.",
      });
    }
  };

  const handleAddManualSeed = (term: string, canonicalKey: string) => {
    if (!activeProject) return;
    const reference = stage3Rows.find(
      (row) => row.canonicalNicheSeed === canonicalKey
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
      `Added “${term}” to the ${canonicalKey} family as your own broad seed. It has no demand data yet — run a check when you’re ready.`
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

  const handleExtract = async () => {
    if (!activeProject) return;
    if (!workspaceId) {
      toast.error("Workspace is still loading");
      return;
    }
    const projectId = activeProject.id;
    const balance = await previewBalance(workspaceId);
    if (balance < selectionEstimate.usd) {
      toast.error("Not enough wallet balance", {
        description: `This extract is estimated at ${formatUsd(selectionEstimate.usd)}. Add funds, or trim the selection.`,
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
    setExtracting(true);
    setExtractProgress(0);

    const seeds = selectedSeedRows.filter(
      (row) => activeProbes[row.id] && !activeProbes[row.id].failed
    );
    setSeedProgress(
      seeds.map((seed) => ({
        seedId: seed.id,
        seed: seed.broadSeedVariation,
        cap: pulledCountForSeed(seed, activeProbes),
        pulled: 0,
      }))
    );

    try {
      const started = await startExtractApi(
        workspaceId,
        projectId,
        activeMarket,
        seeds.map((seed) => ({
          id: seed.id,
          term: seed.broadSeedVariation,
          rawKeywordEstimate: activeProbes[seed.id]?.rawKeywords ?? 0,
        }))
      );
      if (extractGen.current !== gen) return;
      extractRunIds.current = started.seeds.map((seed) => seed.runId);
      extractIdRef.current = started.extractId;

      const pollState = started.seeds.map((seed) => ({
        id: seed.seedId,
        term: seed.term,
        runId: seed.runId,
        datasetId: seed.datasetId,
        pages: seed.pages,
        cursor: undefined as string | undefined,
        status: "running" as "running" | "succeeded" | "failed" | "aborted",
        pulled: 0,
      }));
      const pulledBySeed: Record<string, number> = {};
      let sample: ExtractedKeyword[] = [];
      let rowsReturned = 0;

      const tick = async () => {
        if (extractGen.current !== gen) return;
        const poll = await pollExtractApi(
          workspaceId,
          projectId,
          started.extractId,
          pollState.map((seed) => ({
            seedId: seed.id,
            cursor: seed.cursor,
            status: seed.status,
          }))
        );
        if (extractGen.current !== gen) return;

        for (const row of poll.seeds) {
          const local = pollState.find((seed) => seed.id === row.seedId);
          if (!local) continue;
          local.status =
            row.status === "succeeded" && row.nextCursor
              ? "running"
              : row.status;
          local.cursor = row.nextCursor;
          local.datasetId = row.datasetId ?? local.datasetId;
          if (row.rows.length > 0) {
            const mapped = row.rows.map((keyword, index) =>
              toExtractedKeyword(keyword, row.seedId, local.pulled + index)
            );
            local.pulled += row.rows.length;
            pulledBySeed[row.seedId] = local.pulled;
            rowsReturned += row.rows.length;
            sample = mergeKeywordSample(sample, mapped);
          }
        }

        const caps = pollState.reduce((sum, seed) => {
          const match = seeds.find((row) => row.id === seed.id);
          return sum + (match ? pulledCountForSeed(match, activeProbes) : seed.pages * 100);
        }, 0);
        const pulled = pollState.reduce((sum, seed) => sum + seed.pulled, 0);
        setExtractProgress(caps ? Math.min(1, pulled / caps) : 0);
        setSeedProgress(
          pollState.map((seed) => {
            const match = seeds.find((row) => row.id === seed.id);
            return {
              seedId: seed.id,
              seed: seed.term,
              cap: match ? pulledCountForSeed(match, activeProbes) : seed.pages * 100,
              pulled: seed.pulled,
            };
          })
        );
        setKeywordsByProject((prev) => ({
          ...prev,
          [projectId]: applySampleWeights(sample, pulledBySeed),
        }));

        if (poll.allDone) {
          if (poll.billingPending) {
            window.setTimeout(() => {
              void tick();
            }, 2000);
            return;
          }
          setExtracting(false);
          const billed = poll.settledUsd ?? actualExtractCostUsd(poll.rowsReturned);
          settleExtractCharge(projectId, poll.rowsReturned, billed);
          return;
        }

        window.setTimeout(() => {
          void tick();
        }, 800);
      };

      await tick();
    } catch (error) {
      if (extractGen.current !== gen) return;
      setExtracting(false);
      toast.error("Extract failed", {
        description:
          error instanceof Error ? error.message : "Could not start Apify.",
      });
    }
  };

  const handleCancelExtract = async () => {
    extractGen.current += 1;
    setExtracting(false);
    const extractId = extractIdRef.current;
    const projectId = activeProject?.id;
    if (workspaceId && projectId && extractId) {
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
    }
  };

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

    try {
      const parentNiches = (nichesByProject[projectId] ?? activeNiches).map((n) => n.name);
      const collectionNames = Array.from(
        new Set(stage3Rows.map((r) => r.selectedCollection).filter(Boolean))
      );

      const res = await classifyIntentApi(
        workspaceId,
        projectId,
        currentKws.map((k) => ({
          id: k.id,
          keyword: k.keyword,
          seed: k.seed,
          volume: k.volume,
          difficulty: k.difficulty,
        })),
        { parentNiches, collections: collectionNames }
      );

      if (analyzeGen.current !== gen) return;

      const classificationMap = new Map<string, (typeof res.classified)[number]>();
      for (const item of res.classified) {
        classificationMap.set(item.id, item);
      }

      setKeywordsByProject((prev) => {
        const list = prev[projectId] ?? [];
        const updated = list.map((k) => {
          const match = classificationMap.get(k.id);
          if (match) {
            return {
              ...k,
              sheet: match.sheet,
              exclusionReason: match.reason,
              plpConcept: match.plpConcept,
            };
          }
          return k;
        });
        return { ...prev, [projectId]: updated };
      });

      setAnalyzedProjectIds((prev) => {
        const next = new Set(prev);
        next.add(projectId);
        return next;
      });
    } catch (err) {
      if (analyzeGen.current !== gen) return;
      console.error("[handleAnalyze] Error:", err);
      toast.error("Classification error", {
        description: err instanceof Error ? err.message : "Failed to classify keywords",
      });
    } finally {
      if (analyzeGen.current === gen) {
        setAnalyzeLoading(false);
      }
    }
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
    const targetKeywords =
      filteredCategoryKeywords && filteredCategoryKeywords.length > 0
        ? filteredCategoryKeywords
        : (keywordsByProject[projectId] ?? []).filter(
            (k) => k.sheet === "category"
          );

    if (targetKeywords.length === 0) {
      toast.error("No suitable category keywords to cluster");
      return;
    }

    unlockWorkspaceTab(projectId, "collections");
    const gen = ++clusterGen.current;
    setClustering(true);

    try {
      const parentNiches = (nichesByProject[projectId] ?? activeNiches).map(
        (n) => n.name
      );
      const res = await clusterCollectionsApi(
        workspaceId,
        projectId,
        targetKeywords.map((k) => ({
          id: k.id,
          keyword: k.keyword,
          seed: k.seed,
          volume: k.volume,
          difficulty: k.difficulty,
          plpConcept: k.plpConcept,
          reason: k.exclusionReason,
        })),
        {
          parentNiches,
          seedRows: stage3Rows.map((s) => ({
            id: s.id,
            canonicalNicheSeed: s.canonicalNicheSeed,
            broadSeedVariation: s.broadSeedVariation,
            selectedCollection: s.selectedCollection,
            broadParentNiche: s.broadParentNiche,
            productCount: s.productCount,
            scopeMatch: s.scopeMatch,
          })),
        }
      );

      if (clusterGen.current !== gen) return;

      setProposedCollectionsByProject((prev) => ({
        ...prev,
        [projectId]: res.collections,
      }));

      setClusterSelectionByProject((prev) => ({
        ...prev,
        [projectId]: res.collections.map((c) => c.id),
      }));
    } catch (err) {
      if (clusterGen.current !== gen) return;
      console.error("[handleNextCollections] Error:", err);
      const fallback = buildProposedCollections(selectedSeedRows, targetKeywords);
      setProposedCollectionsByProject((prev) => ({
        ...prev,
        [projectId]: fallback,
      }));
      setClusterSelectionByProject((prev) => ({
        ...prev,
        [projectId]: fallback.map((c) => c.id),
      }));
      toast.error("Clustering fallback used", {
        description:
          err instanceof Error ? err.message : "Clustered using heuristic fallback",
      });
    } finally {
      if (clusterGen.current === gen) {
        setClustering(false);
      }
    }
  };

  const handlePushToStore = async (ids?: string[]) => {
    if (!activeProject || !workspaceId) return;
    const projectId = activeProject.id;
    const targetIds =
      ids && ids.length > 0
        ? ids
        : clusterSelectionByProject[projectId] ?? [];
    if (targetIds.length === 0) return;

    setPushingCollectionsByProject((prev) => ({ ...prev, [projectId]: true }));
    const usd = collectionPushCostUsd(targetIds.length);

    try {
      await pushCollectionsApi(workspaceId, projectId, targetIds);
      invalidateWallet();

      setPaidCollectionProjectIds((prev) => {
        const next = new Set(prev);
        next.add(projectId);
        return next;
      });
      setPushedIds((prev) => {
        const next = new Set(prev);
        next.add(projectId);
        return next;
      });

      window.setTimeout(() => {
        setPushingCollectionsByProject((prev) => ({
          ...prev,
          [projectId]: false,
        }));
        unlockWorkspaceTab(projectId, "content");
      }, 3200);
    } catch (error) {
      setPushingCollectionsByProject((prev) => ({
        ...prev,
        [projectId]: false,
      }));
      toast.error("Not enough wallet balance", {
        description:
          error instanceof Error
            ? error.message
            : `Publishing costs ${formatUsd(usd)}. Add funds or select fewer collections.`,
      });
    }
  };

  const handleStartWorking = () => {
    handlePushToStore();
  };

  const handleStartContent = async () => {
    if (!activeProject) return;
    if (!workspaceId) {
      toast.error("Workspace is still loading");
      return;
    }
    const projectId = activeProject.id;
    const gen = ++contentGen.current;
    const selected = proposedCollections.filter((row) =>
      clusterSelection.includes(row.id)
    );
    if (selected.length === 0) {
      toast.error("No collections selected to generate copy");
      return;
    }

    setGenerating(true);
    setContentByIdByProject((prev) => ({ ...prev, [projectId]: {} }));
    const instructions = customInstructions;

    try {
      const parentNiches = (nichesByProject[projectId] ?? activeNiches).map(
        (n) => n.name
      );

      const res = await generateOnPageApi(
        workspaceId,
        projectId,
        selected.map((c) => ({
          id: c.id,
          name: c.name,
          headKeyword: c.headKeyword,
          parentNiche: c.parentNiche,
          volume: c.volume,
          difficulty: c.difficulty,
          productCount: c.productCount,
          keywordCount: c.keywordCount,
          status: c.status,
          existingName: c.existingName,
        })),
        {
          parentNiches,
          customInstructions: {
            seoTitle: instructions.seoTitle || undefined,
            seoDescription: instructions.seoDescription || undefined,
            collectionDescription: instructions.collectionDescription || undefined,
            faq: instructions.faq || undefined,
          },
        }
      );

      if (contentGen.current !== gen) return;

      setContentByIdByProject((prev) => ({
        ...prev,
        [projectId]: res.contentById,
      }));

      setContentReadyIds((prev) => {
        const next = new Set(prev);
        next.add(projectId);
        return next;
      });
    } catch (err) {
      if (contentGen.current !== gen) return;
      console.error("[handleStartContent] Error:", err);
      // Fallback
      const fallback: Record<string, CollectionContent> = {};
      for (const row of selected) {
        fallback[row.id] = buildCollectionContent(row, instructions);
      }
      setContentByIdByProject((prev) => ({
        ...prev,
        [projectId]: fallback,
      }));
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
      }
    }
  };

  const handleSyncSeo = async () => {
    if (!activeProject || !workspaceId) return;
    const projectId = activeProject.id;
    setSyncingSeoByProject((prev) => ({ ...prev, [projectId]: true }));
    try {
      const res = await syncSeoApi(workspaceId, projectId);
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
    } catch (error) {
      toast.error("Failed to sync SEO to store", {
        description: error instanceof Error ? error.message : "Internal error",
      });
    } finally {
      setSyncingSeoByProject((prev) => ({ ...prev, [projectId]: false }));
    }
  };

  const handlePush = async () => {
    if (!activeProject || !workspaceId) return;
    const ids = [...clusterSelection].sort();
    if (ids.length === 0) return;
    const usd = collectionPushCostUsd(ids.length);
    try {
      const charged = await pushCollectionsApi(
        workspaceId,
        activeProject.id,
        ids
      );
      invalidateWallet();
      setPushedIds((prev) => {
        const next = new Set(prev);
        next.add(activeProject.id);
        return next;
      });
    } catch (error) {
      toast.error("Not enough wallet balance", {
        description:
          error instanceof Error
            ? error.message
            : `Publishing costs ${formatUsd(usd)}. Add funds or select fewer collections.`,
      });
    }
  };

  const runStrategyBuild = (projectId: string) => {
    const gen = ++strategyGen.current;
    setStrategyLoading(true);
    window.setTimeout(() => {
      if (strategyGen.current !== gen) return;
      setStrategyLoading(false);
      setStrategyReadyIds((prev) => {
        const next = new Set(prev);
        next.add(projectId);
        return next;
      });
    }, STRATEGY_MS);
  };

  const handleNextStrategy = () => {
    if (!activeProject) return;
    const projectId = activeProject.id;
    unlockWorkspaceTab(projectId, "strategy");
    if (!strategyReadyIds.has(projectId)) {
      runStrategyBuild(projectId);
    }
  };

  const handleBuildStrategy = () => {
    if (!activeProject) return;
    runStrategyBuild(activeProject.id);
  };

  const handleApproveStrategy = () => {
    if (!activeProject) return;
    setStrategyApprovedIds((prev) => {
      const next = new Set(prev);
      next.add(activeProject.id);
      return next;
    });
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
        const current = prev[projectId] ?? MOCK_NICHES;
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
    if (!activeProject || analyzing || preparingStage2 || preparingStage3) {
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
        setChatBusy(false);
        appendAgent(
          projectId,
          mockAgentReply(text, activeProject.storeLabel, stage)
        );
      }
    })();
  };

  if (wsLoading || !hydrated) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!hasIntegration) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
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
    if (atProjectCap) {
      toast.error("Limit reached", {
        description: `Your plan allows up to ${MAX_MARKET_RESEARCH_PROJECTS} market research projects.`,
      });
      return;
    }
    setCreateOpen(true);
  };

  const handleCreateProjectAndAnalyze = async (name: string) => {
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
    extractGen.current += 1;
    analyzeGen.current += 1;
    clusterGen.current += 1;
    contentGen.current += 1;
    strategyGen.current += 1;
    setProbingIds([]);
    setExtracting(false);
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
    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, name } : p))
    );
    toast.success("Project renamed", { description: name });
  };

  const handleToggleComplete = (id: string, completed: boolean) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, status: completed ? "completed" : "active" } : p
      )
    );
    setProjectFilter(completed ? "completed" : "active");
    toast.success(completed ? "Project marked complete" : "Project reopened");
  };

  const handleDeleteProject = (id: string) => {
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
    <div className="flex h-full min-h-0 gap-2 overflow-hidden bg-muted/25 p-2">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/70 bg-background shadow-sm">
        <div className="relative flex flex-1 min-h-0 overflow-hidden">
          {activeProject ? (
            <AnalysisInvite
              open={inviteOpen && !analyzing && !createOpen && !inWorkspace}
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
            required={namingRequired}
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
                  readOnly={reviewingBrief}
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
                        onChange={(next) => {
                          if (isWorkspaceTab(next)) {
                            setReviewFlow(null);
                            setWorkspaceTabByProject((prev) => ({
                              ...prev,
                              [activeProject.id]: next,
                            }));
                            return;
                          }
                          setReviewFlow(next);
                        }}
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
                      readOnly={reviewingBrief}
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
                        readOnly={reviewingBrief}
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
                        readOnly={reviewingBrief}
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
                    onTab={(next) => {
                      if (isWorkspaceTab(next)) {
                        setReviewFlow(null);
                        setWorkspaceTabByProject((prev) => ({
                          ...prev,
                          [activeProject.id]: next,
                        }));
                        return;
                      }
                      setReviewFlow(next);
                    }}
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
                    analyzed={analyzed}
                    onNextCollections={handleNextCollections}
                    collectionsGenerated={Boolean(
                      proposedCollections.length > 0 ||
                        (activeProject &&
                          (openedMaxByProject[activeProject.id] ?? 1) >= 5)
                    )}
                    onCancelExtract={handleCancelExtract}
                    keywordsCsvHref={
                      workspaceId && committedForActive
                        ? `/api/market-research/extract/download?workspaceId=${workspaceId}&projectId=${activeProject.id}`
                        : undefined
                    }
                    collections={proposedCollections}
                    products={productsByProject[activeProject.id] ?? []}
                    clustering={clustering}
                    selectedCollectionIds={clusterSelection}
                    onChangeSelected={(ids) =>
                      setClusterSelectionByProject((prev) => ({
                        ...prev,
                        [activeProject.id]: ids,
                      }))
                    }
                    collectionsPaid={collectionsPaid}
                    onStartWorking={handleStartWorking}
                    onPushToStore={handlePushToStore}
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
                    generating={generating}
                    contentReady={contentReady}
                    pushed={contentPushed}
                    syncingSeo={Boolean(
                      activeProject && syncingSeoByProject[activeProject.id]
                    )}
                    seoSynced={Boolean(
                      activeProject && seoSyncedProjectIds.has(activeProject.id)
                    )}
                    onStartContent={handleStartContent}
                    onPush={handlePush}
                    onSyncSeo={handleSyncSeo}
                    pushCostUsd={collectionPushCostUsd(clusterSelection.length)}
                    onNextStrategy={handleNextStrategy}
                    strategyArticles={strategyArticles}
                    strategyLoading={strategyLoading}
                    strategyReady={strategyReady}
                    strategyApproved={strategyApproved}
                    onBuildStrategy={handleBuildStrategy}
                    onApproveStrategy={handleApproveStrategy}
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
        />
      ) : null}
    </div>
  );
}
