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
import { useParams } from "next/navigation";
import { Loader2, Store } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useWorkspace } from "@/hooks/use-workspace";
import { chargeWallet } from "@/lib/mock-wallet";
import {
  AgentPanel,
  type Stage1ChatMessage,
} from "./agent-panel";
import { AnalysisInvite } from "./analysis-invite";
import { NewProjectOverlay } from "./new-project-overlay";
import {
  clampOpenedStage,
  loadMarketResearchState,
  saveMarketResearchState,
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
  PROBE_MS,
  STAGE1_ANALYSIS_BEATS,
  STAGE1_ANALYSIS_MS,
  STAGE1_NICHE_READINGS,
  STAGE2_PREP_BEATS,
  STAGE2_PREP_MS,
  STAGE3_PREP_BEATS,
  STAGE3_PREP_MS,
  STAGE_META,
  buildSeedProbe,
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
  type MockSeedRow,
  type NicheReading,
  type SeedProbe,
} from "./mock-data";
import {
  ANALYZE_MS,
  CLUSTER_MS,
  CONTENT_MS,
  EXTRACT_MS,
  USD_PER_COLLECTION,
  buildCollectionContent,
  buildExtractedKeywords,
  buildProposedCollections,
  clampWorkspaceTab,
  collectionCharge,
  briefStageFromFlow,
  isWorkspaceTab,
  maxTab,
  pulledCountForSeed,
  type CollectionContent,
  type FlowTab,
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
  const params = useParams();
  const slug = params.workspaceSlug as string;
  const { user } = useAuth();
  const {
    workspace,
    hasIntegration,
    isLoading: wsLoading,
  } = useWorkspace(slug, user);
  const walletKey = workspace?.id ?? slug;

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
  const [paidCollectionProjectIds, setPaidCollectionProjectIds] = useState<
    Set<string>
  >(() => new Set());
  const [contentReadyIds, setContentReadyIds] = useState<Set<string>>(
    () => new Set()
  );
  const [pushedIds, setPushedIds] = useState<Set<string>>(() => new Set());
  const [customInstructionByProject, setCustomInstructionByProject] = useState<
    Record<string, string>
  >({});
  const [extracting, setExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState(0);
  const [seedProgress, setSeedProgress] = useState<SeedExtractProgress[]>([]);
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [clustering, setClustering] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [contentById, setContentById] = useState<
    Record<string, CollectionContent>
  >({});
  const [reviewFlow, setReviewFlow] = useState<FlowTab | null>(null);
  const [probingIds, setProbingIds] = useState<string[]>([]);
  const probeGen = useRef(0);
  const extractGen = useRef(0);
  const analyzeGen = useRef(0);
  const clusterGen = useRef(0);
  const contentGen = useRef(0);
  const analysisGen = useRef(0);
  const stage2Gen = useRef(0);
  const stage3Gen = useRef(0);
  const pendingAutoAnalyzeId = useRef<string | null>(null);

  useEffect(() => {
    const saved = loadMarketResearchState(slug);
    if (saved && saved.projects.length > 0) {
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
      setMarketByProject(saved.marketByProject ?? {});
      setProbesByProject(saved.probesByProject ?? {});
      setManualSeedsByProject(saved.manualSeedsByProject ?? {});
      setCommittedProjectIds(new Set(saved.committedProjectIds ?? []));
      setWorkspaceTabByProject(saved.workspaceTabByProject ?? {});
      setOpenedWorkspaceByProject(saved.openedWorkspaceByProject ?? {});
      setClusterSelectionByProject(saved.clusterSelectionByProject ?? {});
      setPaidCollectionProjectIds(
        new Set(saved.paidCollectionProjectIds ?? [])
      );
      setContentReadyIds(new Set(saved.contentReadyIds ?? []));
      setPushedIds(new Set(saved.pushedIds ?? []));
      setCustomInstructionByProject(saved.customInstructionByProject ?? {});
      const opened = clampOpenedStage(
        saved.openedMaxByProject?.[last.id],
        1
      );
      const preferred = clampOpenedStage(
        saved.stageByProject?.[last.id],
        1
      );
      setStage(Math.min(preferred, opened) as MarketResearchStage);
      // Projects that already opened later stages are treated as ready.
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
      // Rehydrate empty chat for completed Stage 1 reads.
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
    } else {
      setProjects([]);
      setActiveProjectId("");
      setCreateOpen(true);
    }
    setHydrated(true);
  }, [slug]);

  useEffect(() => {
    if (!hydrated) return;
    saveMarketResearchState(slug, {
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
      marketByProject,
      probesByProject,
      manualSeedsByProject,
      committedProjectIds: Array.from(committedProjectIds),
      workspaceTabByProject,
      openedWorkspaceByProject,
      clusterSelectionByProject,
      paidCollectionProjectIds: Array.from(paidCollectionProjectIds),
      contentReadyIds: Array.from(contentReadyIds),
      pushedIds: Array.from(pushedIds),
      customInstructionByProject,
    });
  }, [
    hydrated,
    slug,
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
    marketByProject,
    probesByProject,
    manualSeedsByProject,
    committedProjectIds,
    workspaceTabByProject,
    openedWorkspaceByProject,
    clusterSelectionByProject,
    paidCollectionProjectIds,
    contentReadyIds,
    pushedIds,
    customInstructionByProject,
  ]);

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
  const lockedViewStage = reviewFlow
    ? (briefStageFromFlow(reviewFlow) ?? stage)
    : stage;

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
  const customInstruction = activeProject
    ? (customInstructionByProject[activeProject.id] ?? "")
    : "";
  const clusterSelection = activeProject
    ? (clusterSelectionByProject[activeProject.id] ?? EMPTY_IDS)
    : EMPTY_IDS;
  const stage3Rows = useMemo(() => {
    const generated = getSeedRowsForCollections(stage3Scope);
    const inScope = new Set(stage3Scope);
    return [
      ...generated,
      ...manualSeeds.filter((row) => inScope.has(row.collectionId)),
    ];
  }, [stage3Scope, manualSeeds]);
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
  const extractedKeywords = useMemo(
    () => buildExtractedKeywords(selectedSeedRows, activeProbes),
    [selectedSeedRows, activeProbes]
  );
  const proposedCollections = useMemo(
    () => buildProposedCollections(selectedSeedRows, extractedKeywords),
    [selectedSeedRows, extractedKeywords]
  );

  useEffect(() => {
    if (!activeProject || !contentReady || generating) return;
    const selected = proposedCollections.filter((row) =>
      clusterSelection.includes(row.id)
    );
    const next: Record<string, CollectionContent> = {};
    for (const row of selected) {
      next[row.id] = buildCollectionContent(row, customInstruction);
    }
    setContentById(next);
  }, [
    activeProject?.id,
    contentReady,
    generating,
    clusterSelection,
    proposedCollections,
    customInstruction,
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

    return [
      {
        stage: 1,
        status: stage1Status,
        detail:
          stage1Status === "done"
            ? "Parent niches read from the live site"
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
    ];
  }, [
    activeProject,
    analyzing,
    openedMax,
    preparingStage2,
    preparingStage3,
    stage1DoneForActive,
    stage2ReadyForActive,
    stage3ReadyForActive,
    stage3Rows.length,
    stage3Stale,
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
        detail: `${selectionEstimate.uniqueKeywords.toLocaleString("en-US")} unique keywords on the current selection · ${formatUsd(selectionEstimate.usd)}`,
      });
    }
    if (committedForActive) {
      list.push({
        id: "r5",
        stage: 3,
        title: `Extracted · ${formatUsd(selectionEstimate.usd)}`,
        detail: `Wallet charge for keyword extract, intent and matching in ${marketLabel(activeMarket)}`,
      });
    }
    return list;
  }, [
    activeMarket,
    activeNiches,
    activeProbes,
    activeProject,
    committedForActive,
    openedMax,
    seedSelection.length,
    selectionEstimate,
    stage1DoneForActive,
    stage3ReadyForActive,
    stage3Rows,
    stage3Scope,
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
      toast.success("Website read complete", {
        description: "Discuss with the agent, then press Next when ready.",
      });
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
      if (opts?.freshChat) {
        setChatByProject((prev) => ({ ...prev, [projectId]: [] }));
      }

      const gen = ++analysisGen.current;
      setAnalyzing(true);
      setAnalysisProgress(0);

      const posted = new Set<number>();
      const started = performance.now();

      const tick = () => {
        if (analysisGen.current !== gen) return;
        const p = Math.min(1, (performance.now() - started) / STAGE1_ANALYSIS_MS);
        setAnalysisProgress(p);
        for (let i = 0; i < STAGE1_ANALYSIS_BEATS.length; i++) {
          const beat = STAGE1_ANALYSIS_BEATS[i];
          if (p >= beat.at && !posted.has(i)) {
            posted.add(i);
            appendAgent(projectId, beat.text);
          }
        }
        if (p >= 1) {
          completeAnalysis(projectId, storeLabel);
          return;
        }
        window.requestAnimationFrame(tick);
      };
      window.requestAnimationFrame(tick);
    },
    [activeProject, appendAgent, completeAnalysis]
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
          toast.success("Catalog scope ready", {
            description: "Review collections on the right.",
          });
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

      const posted = new Set<number>();
      const started = performance.now();
      const rows = getSeedRowsForCollections(collectionIds);
      const rowIds = new Set(rows.map((r) => r.id));
      setStage3ScopeByProject((prev) => ({
        ...prev,
        [projectId]: [...collectionIds],
      }));
      // Drop picks that no longer exist in the new snapshot.
      setSeedSelectionByProject((prev) => {
        const current = prev[projectId];
        if (!current) return prev;
        const kept = current.filter((id) => rowIds.has(id));
        if (kept.length === current.length) return prev;
        return { ...prev, [projectId]: kept };
      });

      const tick = () => {
        if (stage3Gen.current !== gen) return;
        const p = Math.min(1, (performance.now() - started) / STAGE3_PREP_MS);
        for (let i = 0; i < STAGE3_PREP_BEATS.length; i++) {
          const beat = STAGE3_PREP_BEATS[i];
          if (p >= beat.at && !posted.has(i)) {
            posted.add(i);
            appendAgent(projectId, beat.text);
          }
        }
        if (p >= 1) {
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
          toast.success("Seed variations ready", {
            description: "Review the Stage 3 table on the right.",
          });
          return;
        }
        window.requestAnimationFrame(tick);
      };
      window.requestAnimationFrame(tick);
    },
    [appendAgent]
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

  /** Stage 3b — metered demand probe (counts + volume + samples only). */
  const runProbe = (rowIds: string[]) => {
    if (!activeProject || rowIds.length === 0) return;
    const projectId = activeProject.id;
    const market = activeMarket;
    const targets = stage3Rows.filter((row) => rowIds.includes(row.id));
    if (targets.length === 0) return;

    const gen = ++probeGen.current;
    setProbingIds(targets.map((row) => row.id));
    appendAgent(projectId, PROBE_BEATS[0].text);

    const started = performance.now();
    const posted = new Set<number>([0]);

    const tick = () => {
      if (probeGen.current !== gen) return;
      const p = Math.min(1, (performance.now() - started) / PROBE_MS);
      for (let i = 0; i < PROBE_BEATS.length; i++) {
        if (p >= PROBE_BEATS[i].at && !posted.has(i)) {
          posted.add(i);
          appendAgent(projectId, PROBE_BEATS[i].text);
        }
      }
      if (p >= 1) {
        const results: Record<string, SeedProbe> = {};
        targets.forEach((row) => {
          results[row.id] = buildSeedProbe(row, market);
        });
        setProbesByProject((prev) => ({
          ...prev,
          [projectId]: { ...(prev[projectId] ?? {}), ...results },
        }));
        setProbingIds([]);
        clearCommitment(projectId);
        const picked = new Set(seedSelection);
        const estimate = estimateSelection(
          stage3Rows.filter((row) => picked.has(row.id) || results[row.id]),
          { ...activeProbes, ...results }
        );
        appendAgent(
          projectId,
          probeAgentReady(targets.length, estimate, market)
        );
        toast.success("Demand check complete", {
          description: `${targets.length} seeds checked in ${marketLabel(market)}.`,
        });
        return;
      }
      window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
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

  const handleExtract = () => {
    if (!activeProject) return;
    const projectId = activeProject.id;
    const charged = chargeWallet(
      walletKey,
      selectionEstimate.usd,
      `Keyword extract · ${selectionEstimate.uniqueKeywords.toLocaleString("en-US")} keywords`,
      "Market research"
    );
    if (!charged) {
      toast.error("Not enough wallet balance", {
        description: `This extract costs ${formatUsd(selectionEstimate.usd)}. Add funds, or trim the selection with the budget cap.`,
      });
      return;
    }
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
    toast.success("Extract started", {
      description: `${formatUsd(selectionEstimate.usd)} charged from your wallet.`,
    });
    startExtractRun(projectId);
  };

  const startExtractRun = (projectId: string) => {
    const gen = ++extractGen.current;
    const seeds = selectedSeedRows;
    setExtracting(true);
    setExtractProgress(0);
    setSeedProgress(
      seeds.map((seed) => ({
        seedId: seed.id,
        seed: seed.broadSeedVariation,
        cap: pulledCountForSeed(seed, activeProbes),
        pulled: 0,
      }))
    );
    const started = performance.now();
    const tick = () => {
      if (extractGen.current !== gen) return;
      const p = Math.min(1, (performance.now() - started) / EXTRACT_MS);
      setExtractProgress(p);
      setSeedProgress(
        seeds.map((seed) => {
          const cap = pulledCountForSeed(seed, activeProbes);
          return {
            seedId: seed.id,
            seed: seed.broadSeedVariation,
            cap,
            pulled: Math.round(cap * p),
          };
        })
      );
      if (p >= 1) {
        setExtracting(false);
        return;
      }
      window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
  };

  const unlockWorkspaceTab = (projectId: string, tab: WorkspaceTab) => {
    setOpenedWorkspaceByProject((prev) => ({
      ...prev,
      [projectId]: maxTab(prev[projectId] ?? "extract", tab),
    }));
    setWorkspaceTabByProject((prev) => ({ ...prev, [projectId]: tab }));
  };

  const handleAnalyze = () => {
    if (!activeProject) return;
    const projectId = activeProject.id;
    unlockWorkspaceTab(projectId, "analyze");
    const gen = ++analyzeGen.current;
    setAnalyzeLoading(true);
    window.setTimeout(() => {
      if (analyzeGen.current !== gen) return;
      setAnalyzeLoading(false);
    }, ANALYZE_MS);
  };

  const handleNextCollections = () => {
    if (!activeProject) return;
    const projectId = activeProject.id;
    unlockWorkspaceTab(projectId, "collections");
    const gen = ++clusterGen.current;
    setClustering(true);
    window.setTimeout(() => {
      if (clusterGen.current !== gen) return;
      setClustering(false);
    }, CLUSTER_MS);
  };

  const handleStartWorking = () => {
    if (!activeProject) return;
    const projectId = activeProject.id;
    const count = clusterSelection.length;
    if (count === 0) return;
    const usd = collectionCharge(count);
    const charged = chargeWallet(
      walletKey,
      usd,
      `Collection build · ${count} collection${count === 1 ? "" : "s"}`,
      "Market research"
    );
    if (!charged) {
      toast.error("Not enough wallet balance", {
        description: `Start working costs ${formatUsd(usd)}. Add funds or select fewer collections.`,
      });
      return;
    }
    setPaidCollectionProjectIds((prev) => {
      const next = new Set(prev);
      next.add(projectId);
      return next;
    });
    unlockWorkspaceTab(projectId, "content");
    toast.success("Working started", {
      description: `${formatUsd(usd)} charged · ${formatUsd(USD_PER_COLLECTION)} per collection.`,
    });
  };

  const handleStartContent = () => {
    if (!activeProject) return;
    const gen = ++contentGen.current;
    const selected = proposedCollections.filter((row) =>
      clusterSelection.includes(row.id)
    );
    setGenerating(true);
    setContentById({});
    const instruction = customInstruction;
    let i = 0;
    const step = () => {
      if (contentGen.current !== gen) return;
      const row = selected[i];
      if (!row) {
        setGenerating(false);
        setContentReadyIds((prev) => {
          const next = new Set(prev);
          next.add(activeProject.id);
          return next;
        });
        return;
      }
      setContentById((prev) => ({
        ...prev,
        [row.id]: buildCollectionContent(row, instruction),
      }));
      i += 1;
      window.setTimeout(step, Math.max(280, CONTENT_MS / Math.max(selected.length, 1)));
    };
    window.setTimeout(step, 400);
  };

  const handlePush = () => {
    if (!activeProject) return;
    setPushedIds((prev) => {
      const next = new Set(prev);
      next.add(activeProject.id);
      return next;
    });
    toast.success("Pushed to storefront", {
      description: "Collection content is queued. Preview still opens from Customize.",
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
  };

  const handleDeleteNiche = (id: string) => {
    updateNiches((current) => current.filter((niche) => niche.id !== id));
  };

  const handleAddNiche = (name: string) => {
    updateNiches((current) => [
      ...current,
      {
        id: `niche-${Date.now()}`,
        name,
        summary: "Added by you — the first read didn’t surface this space.",
        edited: true,
      },
    ]);
    if (activeProject) {
      appendAgent(
        activeProject.id,
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
    toast.info("Website read stopped");
  };

  useEffect(() => {
    if (analyzing && stage !== 1) setStage(1);
  }, [analyzing, stage]);

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

    setChatBusy(true);
    window.setTimeout(() => {
      setChatBusy(false);
      appendAgent(
        projectId,
        mockAgentReply(text, activeProject.storeLabel, stage)
      );
    }, 650);
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
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
          <Store className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="space-y-1 max-w-sm">
          <h1 className="text-lg font-semibold tracking-tight">
            Connect a store first
          </h1>
          <p className="text-sm text-muted-foreground">
            Market research needs a CMS integration (Shopify or WooCommerce),
            same as Sync.
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="mt-1">
          <Link href={`/w/${slug}/settings`}>Open settings</Link>
        </Button>
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

  const handleCreateProjectAndAnalyze = (name: string) => {
    if (atProjectCap) {
      toast.error("Limit reached", {
        description: `Your plan allows up to ${MAX_MARKET_RESEARCH_PROJECTS} market research projects.`,
      });
      return;
    }
    const project: MarketResearchProject = {
      id: `proj-${Date.now()}`,
      name,
      status: "active",
      storeLabel: activeProject?.storeLabel ?? DEFAULT_STORE,
      highlightedCollectionIds: ["sunglasses", "womens-sunglasses"],
    };
    pendingAutoAnalyzeId.current = project.id;
    setProjects((prev) => [...prev, project]);
    setActiveProjectId(project.id);
    setOpenedMaxByProject((prev) => ({ ...prev, [project.id]: 1 }));
    setProjectFilter("active");
    setStage(1);
    setProjectsOpen(false);
    setInviteOpen(false);
    setChatByProject((prev) => ({ ...prev, [project.id]: [] }));
    toast.success("Project created", { description: project.name });
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
    setProbingIds([]);
    setExtracting(false);
    setAnalyzeLoading(false);
    setClustering(false);
    setGenerating(false);
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
                    chargedUsd={selectionEstimate.usd}
                    onAnalyze={handleAnalyze}
                    analyzeLoading={analyzeLoading}
                    onNextCollections={handleNextCollections}
                    collections={proposedCollections}
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
                    instruction={customInstruction}
                    onInstruction={(value) =>
                      setCustomInstructionByProject((prev) => ({
                        ...prev,
                        [activeProject.id]: value,
                      }))
                    }
                    contentById={contentById}
                    generating={generating}
                    contentReady={contentReady}
                    pushed={contentPushed}
                    onStartContent={handleStartContent}
                    onPush={handlePush}
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
          openedStageByProject={openedMaxByProject}
          atProjectCap={atProjectCap}
        />
      ) : null}
    </div>
  );
}
