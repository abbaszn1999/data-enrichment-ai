"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { PageLoader } from "@/components/brand/page-loader";
import { useAuth } from "@/hooks/use-auth";
import { useFaWallet } from "@/hooks/use-fa-wallet";
import { useWorkspace } from "@/hooks/use-workspace";
import { useRole } from "@/hooks/use-role";
import {
  AgentPanel,
  type Stage1ChatMessage,
} from "./agent-panel";
import { DeepWorkspace } from "./deep-workspace";
import { NewProjectOverlay } from "./new-project-overlay";
import { ProjectsSidebar } from "./projects-sidebar";
import { StagePlpUploadPanel } from "./stage-plp-upload-panel";
import { StageScopePanel } from "./stage-scope-panel";
import { StageSelectPanel } from "./stage-select-panel";
import { StageSeedsPanel } from "./stage-seeds-panel";
import { WorkspaceStepper } from "./workspace-stepper";
import {
  RunTimeline,
  StageStepper,
  type StageReceipt,
  type StageStep,
  type StageStepStatus,
} from "./run-timeline";
import type { AssessmentPlpRow } from "./assessment-csv";
import {
  clampOpenedStage,
  emptyMarketResearchState,
  loadMarketResearchState,
  saveMarketResearchState,
  type MarketResearchPersisted,
} from "./persistence";
import {
  MAX_MARKET_RESEARCH_PROJECTS,
  STAGE_META,
  estimateSelection,
  getSeedRowsForCollections,
  createManualSeedRow,
  type MarketResearchProject,
  type MarketResearchStage,
  type MockNiche,
  type MockSeedRow,
  type NicheReading,
  type SeedProbe,
} from "./mock-data";
import {
  briefStageFromFlow,
  clampWorkspaceTab,
  isWorkspaceTab,
  pulledCountForSeed,
  type ExtractedKeyword,
  type FlowTab,
  type ProposedCollection,
  type SeedExtractProgress,
  type WorkspaceTab,
} from "./workspace-data";
import { InsufficientFundsDialog } from "./insufficient-funds-dialog";
import {
  analyzeSheetApi,
  cancelExtractApi,
  chatAgentApi,
  createFaProjectApi,
  deleteFaProjectApi,
  extractStatusApi,
  generateSeedsApi,
  loadFaStateApi,
  pollExtractApi,
  probeSeedsApi,
  runClassifyArchiveLoop,
  saveFaStateApi,
  startExtractApi,
} from "@/lib/free-assessment/client";
import { previewBalance } from "@/lib/free-assessment/billing";
import { actualExtractCostUsd, estimateProbeCostUsd } from "@/lib/free-assessment/cost";
import {
  appendKeywordRows,
  applyKeywordClassifications,
  toExtractedKeyword,
} from "@/lib/free-assessment/map-keywords";
import { useWorkspaceStore } from "@/store/workspace-store";

const STAGES: MarketResearchStage[] = [1, 2, 3];
const DEFAULT_STORE = "Uploaded catalog";

function newId(): string {
  return crypto.randomUUID();
}

export function FreeAssessmentShell() {
  const params = useParams<{ workspaceSlug: string }>();
  const slug = String(params.workspaceSlug ?? "");
  const { user } = useAuth();
  const { workspace, role, isLoading: wsLoading } = useWorkspace(slug, user);
  const workspaceId = workspace?.id ?? "";
  const permissions = useRole(role);
  const canEdit = permissions.canEdit;
  const canAdmin = permissions.canAdmin;
  const { wallet } = useFaWallet(workspaceId || null);

  const [hydrated, setHydrated] = useState(false);
  const [projects, setProjects] = useState<MarketResearchProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [projectFilter, setProjectFilter] = useState<"active" | "completed">(
    "active"
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [stage, setStage] = useState<MarketResearchStage>(1);
  const [openedMaxByProject, setOpenedMaxByProject] = useState<
    Record<string, MarketResearchStage>
  >({});
  const [stage1DoneIds, setStage1DoneIds] = useState<Set<string>>(new Set());
  const [stage2ReadyIds, setStage2ReadyIds] = useState<Set<string>>(new Set());
  const [stage3ReadyIds, setStage3ReadyIds] = useState<Set<string>>(new Set());
  const [chatByProject, setChatByProject] = useState<
    Record<string, Stage1ChatMessage[]>
  >({});
  const [nichesByProject, setNichesByProject] = useState<
    Record<string, NicheReading[]>
  >({});
  const [structuredNichesByProject, setStructuredNichesByProject] = useState<
    Record<string, MockNiche[]>
  >({});
  const [seedRowsByProject, setSeedRowsByProject] = useState<
    Record<string, MockSeedRow[]>
  >({});
  const [seedSelectionByProject, setSeedSelectionByProject] = useState<
    Record<string, string[]>
  >({});
  const [stage3ScopeByProject, setStage3ScopeByProject] = useState<
    Record<string, string[]>
  >({});
  const [manualSeedsByProject, setManualSeedsByProject] = useState<
    Record<string, MockSeedRow[]>
  >({});
  const [probesByProject, setProbesByProject] = useState<
    Record<string, Record<string, SeedProbe>>
  >({});
  const [marketByProject, setMarketByProject] = useState<Record<string, string>>(
    {}
  );
  const [committedProjectIds, setCommittedProjectIds] = useState<Set<string>>(
    new Set()
  );
  const [workspaceTabByProject, setWorkspaceTabByProject] = useState<
    Record<string, WorkspaceTab>
  >({});
  const [openedWorkspaceByProject, setOpenedWorkspaceByProject] = useState<
    Record<string, WorkspaceTab>
  >({});
  const [keywordsByProject, setKeywordsByProject] = useState<
    Record<string, ExtractedKeyword[]>
  >({});
  const [analyzedProjectIds, setAnalyzedProjectIds] = useState<Set<string>>(
    new Set()
  );
  const [proposedCollectionsByProject, setProposedCollectionsByProject] =
    useState<Record<string, ProposedCollection[]>>({});
  const [clusterSelectionByProject, setClusterSelectionByProject] = useState<
    Record<string, string[]>
  >({});
  const [extractChargeByProject, setExtractChargeByProject] = useState<
    Record<string, number>
  >({});
  const [probingIds, setProbingIds] = useState<string[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState(0);
  const [seedProgress, setSeedProgress] = useState<SeedExtractProgress[]>([]);
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [preparingStage2, setPreparingStage2] = useState(false);
  const [preparingStage3, setPreparingStage3] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [insufficientFundsDialog, setInsufficientFundsDialog] = useState<{
    open: boolean;
    requiredAmount: number;
    currentBalance: number;
    actionName: string;
  }>({ open: false, requiredAmount: 0, currentBalance: 0, actionName: "" });
  const extractIdByProject = useRef<Record<string, string>>({});
  const extractIdRef = useRef("");
  const resumedExtract = useRef(new Set<string>());
  const probeGen = useRef(0);
  const extractGen = useRef(0);
  const analyzeGen = useRef(0);
  const persistReady = useRef(false);
  const persistRemote = useRef(false);
  const skipPersistSave = useRef(true);
  const invalidateFaWallet = useWorkspaceStore((s) => s.invalidateFaWallet);

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;
  const openedMax = clampOpenedStage(
    activeProject ? openedMaxByProject[activeProject.id] : 1,
    1
  );
  const visibleStages = STAGES.filter((s) => s <= Math.min(openedMax, 3));
  const stage1DoneForActive = Boolean(
    activeProject && stage1DoneIds.has(activeProject.id)
  );
  const stage2ReadyForActive = Boolean(
    activeProject && stage2ReadyIds.has(activeProject.id)
  );
  const stage3ReadyForActive = Boolean(
    activeProject && stage3ReadyIds.has(activeProject.id)
  );
  const committedForActive = Boolean(
    activeProject && committedProjectIds.has(activeProject.id)
  );
  const inWorkspace = committedForActive;
  const [reviewFlow, setReviewFlow] = useState<FlowTab | null>(null);
  const reviewingBrief = Boolean(
    inWorkspace && reviewFlow && !isWorkspaceTab(reviewFlow)
  );
  const showWorkspace = inWorkspace && !reviewingBrief;
  const [workspaceScene, setWorkspaceScene] = useState(showWorkspace);
  const skipWorkspaceAnim = useRef(true);
  const workspaceTab: WorkspaceTab = activeProject
    ? clampWorkspaceTab(workspaceTabByProject[activeProject.id] ?? "extract")
    : "extract";
  const openedWorkspace: WorkspaceTab = activeProject
    ? clampWorkspaceTab(openedWorkspaceByProject[activeProject.id] ?? "extract")
    : "extract";

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

  const analyzed = Boolean(
    activeProject && analyzedProjectIds.has(activeProject.id)
  );

  const applySaved = (saved: MarketResearchPersisted) => {
    setProjects(saved.projects ?? []);
    setActiveProjectId(saved.activeProjectId ?? saved.projects?.[0]?.id ?? "");
    setOpenedMaxByProject(saved.openedMaxByProject ?? {});
    setStage1DoneIds(new Set(saved.stage1DoneIds ?? []));
    setStage2ReadyIds(
      new Set(
        Object.entries(saved.openedMaxByProject ?? {})
          .filter(([, s]) => (s ?? 1) >= 2)
          .map(([id]) => id)
      )
    );
    setStage3ReadyIds(
      new Set(
        Object.entries(saved.openedMaxByProject ?? {})
          .filter(([, s]) => (s ?? 1) >= 3)
          .map(([id]) => id)
      )
    );
    setChatByProject(saved.chatByProject ?? {});
    setNichesByProject(saved.nichesByProject ?? {});
    setStructuredNichesByProject(saved.structuredNichesByProject ?? {});
    setSeedRowsByProject(saved.seedRowsByProject ?? {});
    setSeedSelectionByProject(saved.seedSelectionByProject ?? {});
    setStage3ScopeByProject(saved.stage3ScopeByProject ?? {});
    setManualSeedsByProject(saved.manualSeedsByProject ?? {});
    setProbesByProject(saved.probesByProject ?? {});
    setMarketByProject(saved.marketByProject ?? {});
    setCommittedProjectIds(new Set(saved.committedProjectIds ?? []));
    setWorkspaceTabByProject(saved.workspaceTabByProject ?? {});
    setOpenedWorkspaceByProject(saved.openedWorkspaceByProject ?? {});
    setKeywordsByProject(saved.keywordsByProject ?? {});
    setAnalyzedProjectIds(new Set(saved.analyzedProjectIds ?? []));
    setProposedCollectionsByProject(saved.proposedCollectionsByProject ?? {});
    setClusterSelectionByProject(saved.clusterSelectionByProject ?? {});
    setExtractChargeByProject(saved.extractChargeByProject ?? {});
    extractIdByProject.current = { ...(saved.extractIdByProject ?? {}) };
    const last = saved.projects?.find((p) => p.id === saved.activeProjectId);
    const opened = clampOpenedStage(
      last ? saved.openedMaxByProject?.[last.id] : 1,
      1
    );
    const preferred = clampOpenedStage(
      last ? saved.stageByProject?.[last.id] : 1,
      1
    );
    setStage(Math.min(preferred, opened, 5) as MarketResearchStage);
    setCreateOpen((saved.projects ?? []).length === 0);
  };

  // Resume across devices/reloads: the server snapshot (fa_projects.state)
  // is the source of truth; localStorage is only a same-device fallback
  // while the server round-trip is in flight or unreachable.
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    persistReady.current = false;
    persistRemote.current = false;
    skipPersistSave.current = true;
    setHydrated(false);

    const finish = (saved: MarketResearchPersisted | null) => {
      if (cancelled) return;
      applySaved(saved && saved.projects.length > 0 ? saved : emptyMarketResearchState());
      persistReady.current = true;
      skipPersistSave.current = true;
      setHydrated(true);
    };

    if (!workspaceId) {
      finish(loadMarketResearchState(slug));
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const remote = await loadFaStateApi(workspaceId);
        if (cancelled) return;
        persistRemote.current = true;
        if (remote.projects.length > 0) {
          finish(remote);
          return;
        }
        finish(loadMarketResearchState(slug));
      } catch {
        persistRemote.current = false;
        finish(loadMarketResearchState(slug));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug, workspaceId]);

  const persistedSnapshot = useMemo<MarketResearchPersisted>(() => {
    const base = emptyMarketResearchState();
    return {
      ...base,
      projects,
      activeProjectId,
      stage1DoneIds: Array.from(stage1DoneIds),
      openedMaxByProject,
      stageByProject: activeProjectId ? { [activeProjectId]: stage } : {},
      chatByProject,
      nichesByProject,
      structuredNichesByProject,
      seedRowsByProject,
      seedSelectionByProject,
      stage3ScopeByProject,
      manualSeedsByProject,
      probesByProject,
      marketByProject,
      committedProjectIds: Array.from(committedProjectIds),
      workspaceTabByProject,
      openedWorkspaceByProject,
      keywordsByProject,
      analyzedProjectIds: Array.from(analyzedProjectIds),
      proposedCollectionsByProject,
      clusterSelectionByProject,
      extractChargeByProject,
      extractIdByProject: { ...extractIdByProject.current },
    };
  }, [
    projects,
    activeProjectId,
    stage1DoneIds,
    openedMaxByProject,
    stage,
    chatByProject,
    nichesByProject,
    structuredNichesByProject,
    seedRowsByProject,
    seedSelectionByProject,
    stage3ScopeByProject,
    manualSeedsByProject,
    probesByProject,
    marketByProject,
    committedProjectIds,
    workspaceTabByProject,
    openedWorkspaceByProject,
    keywordsByProject,
    analyzedProjectIds,
    proposedCollectionsByProject,
    clusterSelectionByProject,
    extractChargeByProject,
  ]);

  useEffect(() => {
    if (!hydrated || !slug) return;
    saveMarketResearchState(slug, persistedSnapshot);
    if (skipPersistSave.current) {
      skipPersistSave.current = false;
      return;
    }
    if (!canEdit || !workspaceId || !persistRemote.current) return;
    const timer = window.setTimeout(() => {
      void saveFaStateApi(workspaceId, persistedSnapshot).catch(() => undefined);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [hydrated, slug, workspaceId, persistedSnapshot, canEdit]);

  const appendAgent = (projectId: string, text: string) => {
    setChatByProject((prev) => ({
      ...prev,
      [projectId]: [
        ...(prev[projectId] ?? []),
        { id: newId(), role: "agent", text },
      ],
    }));
  };

  const activeNiches = activeProject
    ? (nichesByProject[activeProject.id] ?? [])
    : [];
  const activeStructuredNiches = activeProject
    ? (structuredNichesByProject[activeProject.id] ?? [])
    : [];
  const stage3Scope = activeProject
    ? (stage3ScopeByProject[activeProject.id] ??
      activeProject.highlightedCollectionIds)
    : [];
  const activeSeedRows = activeProject
    ? (seedRowsByProject[activeProject.id] ?? [])
    : [];
  const manualSeeds = activeProject
    ? (manualSeedsByProject[activeProject.id] ?? [])
    : [];
  const seedSelection = activeProject
    ? (seedSelectionByProject[activeProject.id] ?? [])
    : [];
  const activeProbes = activeProject
    ? (probesByProject[activeProject.id] ?? {})
    : {};
  const activeMarket = activeProject
    ? (marketByProject[activeProject.id] ?? "us")
    : "us";
  const extractedKeywords = activeProject
    ? (keywordsByProject[activeProject.id] ?? [])
    : [];

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

  const selectedSeedRows = useMemo(() => {
    const picked = new Set(seedSelection);
    return stage3Rows.filter((row) => picked.has(row.id));
  }, [stage3Rows, seedSelection]);

  const selectionEstimate = useMemo(
    () => estimateSelection(selectedSeedRows, activeProbes),
    [selectedSeedRows, activeProbes]
  );

  const namingRequired = projects.length === 0;
  const atProjectCap = projects.length >= MAX_MARKET_RESEARCH_PROJECTS;

  const setViewStage = (s: MarketResearchStage) => {
    setStage(s);
    if (!activeProjectId) return;
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

  const handleSelectProject = (id: string) => {
    setReviewFlow(null);
    setActiveProjectId(id);
    const opened = clampOpenedStage(openedMaxByProject[id], 1);
    setStage(Math.min(opened, 4) as MarketResearchStage);
  };

  const handleCreateProject = async (name: string) => {
    if (!canEdit || atProjectCap) {
      toast.error("Limit reached", {
        description: `Up to ${MAX_MARKET_RESEARCH_PROJECTS} free assessment projects.`,
      });
      return;
    }
    const localId = newId();
    const project: MarketResearchProject = {
      id: localId,
      name,
      status: "active",
      storeLabel: DEFAULT_STORE,
      highlightedCollectionIds: [],
    };
    setProjects((prev) => [...prev, project]);
    setActiveProjectId(project.id);
    setOpenedMaxByProject((prev) => ({ ...prev, [project.id]: 1 }));
    setStage(1);
    setCreateOpen(false);
    appendAgent(
      project.id,
      `New assessment “${name}”. Upload the PLP sheet on the right — name, page type, and SKU count for every collection, category, and brand page. No live store is connected here.`
    );
    if (!workspaceId) return;
    try {
      const created = await createFaProjectApi(workspaceId, {
        name,
        storeLabel: DEFAULT_STORE,
      });
      if (created.id === localId) return;
      setProjects((prev) =>
        prev.map((p) => (p.id === localId ? { ...p, id: created.id } : p))
      );
      setActiveProjectId((prev) => (prev === localId ? created.id : prev));
      setOpenedMaxByProject((prev) => {
        const { [localId]: value, ...rest } = prev;
        return value === undefined ? rest : { ...rest, [created.id]: value };
      });
      setChatByProject((prev) => {
        const { [localId]: value, ...rest } = prev;
        return value === undefined ? rest : { ...rest, [created.id]: value };
      });
    } catch (err) {
      toast.error("Couldn't save the project to your account", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const handleUploadRows = async (
    rows: AssessmentPlpRow[],
    fileName: string
  ) => {
    if (!activeProject || !workspaceId) return;
    const projectId = activeProject.id;
    setUploadBusy(true);
    setUploadError(null);
    try {
      const result = await analyzeSheetApi(workspaceId, projectId, rows);
      setNichesByProject((prev) => ({
        ...prev,
        [projectId]: result.niches as unknown as NicheReading[],
      }));
      setStructuredNichesByProject((prev) => ({
        ...prev,
        [projectId]: result.structuredNiches as unknown as MockNiche[],
      }));
      setStage1DoneIds((prev) => {
        const next = new Set(prev);
        next.add(projectId);
        return next;
      });
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? { ...p, storeLabel: `${result.rowCount} PLPs from ${fileName}` }
            : p
        )
      );
      appendAgent(
        projectId,
        result.agentConclusion ||
          `Loaded ${result.rowCount} PLP${result.rowCount === 1 ? "" : "s"} from the sheet into ${result.niches.length} niche${result.niches.length === 1 ? "" : "s"}. Edit names on the right if a grouping looks off, then press Next for catalog scope.`
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to analyze the sheet";
      setUploadError(message);
      toast.error("Couldn't analyze the sheet", { description: message });
    } finally {
      setUploadBusy(false);
    }
  };

  const handleNextFromStage1 = () => {
    if (!canEdit || !activeProject || !stage1DoneForActive) return;
    const projectId = activeProject.id;
    setOpenedMaxByProject((prev) => ({
      ...prev,
      [projectId]: Math.max(prev[projectId] ?? 1, 2) as MarketResearchStage,
    }));
    setStage(2);
    setPreparingStage2(true);
    window.setTimeout(() => {
      setPreparingStage2(false);
      setStage2ReadyIds((prev) => {
        const next = new Set(prev);
        next.add(projectId);
        return next;
      });
      appendAgent(
        projectId,
        "Catalog scope is ready. Pick the PLPs to research, then Next opens seed terms."
      );
    }, 600);
  };

  const handleNextFromStage2 = async () => {
    if (!canEdit || !activeProject || preparingStage3) return;
    const collectionIds = activeProject.highlightedCollectionIds;
    if (collectionIds.length === 0) {
      toast.error("Select at least one collection");
      return;
    }
    const projectId = activeProject.id;
    const currentStructured = structuredNichesByProject[projectId] ?? [];
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
      const nicheFullySelected =
        niche.collections.length > 0 &&
        niche.collections.every((c) => selectedIdSet.has(c.id));
      for (const col of niche.collections) {
        if (!selectedIdSet.has(col.id)) continue;
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

    setOpenedMaxByProject((prev) => ({
      ...prev,
      [projectId]: Math.max(prev[projectId] ?? 1, 3) as MarketResearchStage,
    }));
    setStage(3);
    setPreparingStage3(true);
    appendAgent(
      projectId,
      "Analyzing selected PLPs to prepare broad niche seed variations…"
    );

    if (!workspaceId || selectedScopeCollections.length === 0) {
      const rows = getSeedRowsForCollections(collectionIds, currentStructured);
      setSeedRowsByProject((prev) => ({ ...prev, [projectId]: rows }));
      setStage3ScopeByProject((prev) => ({ ...prev, [projectId]: [...collectionIds] }));
      setSeedSelectionByProject((prev) => ({ ...prev, [projectId]: rows.map((r) => r.id) }));
      setPreparingStage3(false);
      setStage3ReadyIds((prev) => {
        const next = new Set(prev);
        next.add(projectId);
        return next;
      });
      return;
    }

    try {
      const res = await generateSeedsApi(
        workspaceId,
        projectId,
        activeProject.storeLabel,
        selectedScopeCollections
      );
      const rows = res.seedRows as unknown as MockSeedRow[];
      setSeedRowsByProject((prev) => ({ ...prev, [projectId]: rows }));
      setStage3ScopeByProject((prev) => ({ ...prev, [projectId]: [...collectionIds] }));
      setSeedSelectionByProject((prev) => ({ ...prev, [projectId]: rows.map((r) => r.id) }));
      setStage3ReadyIds((prev) => {
        const next = new Set(prev);
        next.add(projectId);
        return next;
      });
      appendAgent(
        projectId,
        `Prepared ${rows.length} broad seed variation${rows.length === 1 ? "" : "s"} from the selected PLPs. Run a demand check, then extract.`
      );
    } catch (err) {
      console.error("[handleNextFromStage2] Error:", err);
      toast.error("Couldn't generate seed terms", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setPreparingStage3(false);
    }
  };

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

    const CHUNK_SIZE = 20;
    const chunks: (typeof targets)[] = [];
    for (let i = 0; i < targets.length; i += CHUNK_SIZE) {
      chunks.push(targets.slice(i, i + CHUNK_SIZE));
    }

    const allResults: Record<string, SeedProbe> = {};
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
        setProbesByProject((prev) => ({
          ...prev,
          [projectId]: { ...(prev[projectId] ?? {}), ...chunkResults },
        }));
        setProbingIds((prev) => prev.filter((id) => !chunkIds.has(id)));
        invalidateFaWallet();
      } catch (error) {
        if (probeGen.current !== gen) return;
        failedChunks += 1;
        const msg =
          error instanceof Error ? error.message : "Could not retrieve seed metrics.";
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

    const picked = new Set(seedSelection);
    const estimate = estimateSelection(
      stage3Rows.filter((row) => picked.has(row.id) || allResults[row.id]),
      { ...activeProbes, ...allResults }
    );
    appendAgent(
      projectId,
      `Checked demand on ${targets.length} seed${targets.length === 1 ? "" : "s"}. ${estimate.rows} have real search volume — estimated extract cost is $${estimate.usd.toFixed(2)}.`
    );

    if (failedChunks > 0 && failedChunks === chunks.length) {
      toast.error("Demand check failed", {
        description:
          lastErrorMessage || "Could not retrieve seed metrics. Please try again.",
      });
    }
  };

  const settleExtractCharge = (
    projectId: string,
    rowsReturned: number,
    amount = actualExtractCostUsd(rowsReturned)
  ) => {
    setExtractChargeByProject((prev) => ({ ...prev, [projectId]: amount }));
    invalidateFaWallet();
  };

  const rememberExtractId = (projectId: string, extractId: string) => {
    extractIdRef.current = extractId;
    extractIdByProject.current = { ...extractIdByProject.current, [projectId]: extractId };
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
            window.setTimeout(() => {
              void tick();
            }, 2000);
            return;
          }
          let finalSample = poll.sample ?? sample;
          if (finalSample.length === 0) {
            const status = await extractStatusApi(
              input.workspaceId,
              input.projectId,
              input.extractId
            ).catch(() => null);
            if (status?.sample?.length) finalSample = status.sample;
          }
          if (finalSample.length > 0) {
            setKeywordsByProject((prev) => ({
              ...prev,
              [input.projectId]: finalSample,
            }));
          }
          setExtracting(false);
          settleExtractCharge(
            input.projectId,
            poll.rowsReturned,
            poll.settledUsd ?? actualExtractCostUsd(poll.rowsReturned)
          );
          return;
        }
      } catch {
        if (extractGen.current !== input.gen) return;
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

    const seeds = selectedSeedRows.filter(
      (row) => activeProbes[row.id] && !activeProbes[row.id].failed
    );
    if (seeds.length === 0) {
      toast.error("Check demand on selected seeds first");
      return;
    }

    const gen = ++extractGen.current;
    setCommittedProjectIds((prev) => {
      const next = new Set(prev);
      next.add(projectId);
      return next;
    });
    setWorkspaceTabByProject((prev) => ({ ...prev, [projectId]: "extract" }));
    setOpenedWorkspaceByProject((prev) => ({ ...prev, [projectId]: "extract" }));
    setOpenedMaxByProject((prev) => ({
      ...prev,
      [projectId]: Math.max(prev[projectId] ?? 1, 4) as MarketResearchStage,
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
      if (extractGen.current !== gen) {
        setExtracting(false);
        await cancelExtractApi(workspaceId, projectId, started.extractId).catch(
          () => undefined
        );
        return;
      }
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
      setExtracting(false);
      toast.error("Extract failed", {
        description: error instanceof Error ? error.message : "Could not start Apify.",
      });
    }
  };

  const handleCancelExtract = async () => {
    extractGen.current += 1;
    const projectId = activeProject?.id;
    setExtracting(false);
    if (!workspaceId || !projectId) return;
    let extractId = extractIdRef.current || extractIdByProject.current[projectId] || "";
    if (!extractId) {
      const status = await extractStatusApi(workspaceId, projectId).catch(() => null);
      extractId = status?.extract?.id ?? "";
    }
    if (!extractId) return;
    try {
      const cancelled = await cancelExtractApi(workspaceId, projectId, extractId);
      settleExtractCharge(projectId, cancelled.rowsReturned, cancelled.settledUsd);
    } catch (err) {
      console.error("[handleCancelExtract] Error:", err);
    }
  };

  // Resume a still-running Apify extract after a refresh or a return visit —
  // the poll loop otherwise only runs in-memory from handleExtract.
  useEffect(() => {
    if (!hydrated || !workspaceId || !canEdit || !activeProject) return;
    const projectId = activeProject.id;
    if (extracting) return;
    if (resumedExtract.current.has(projectId)) return;

    let cancelled = false;
    void (async () => {
      try {
        const status = await extractStatusApi(workspaceId, projectId);
        if (cancelled) return;
        if (!status.extract) {
          resumedExtract.current.add(projectId);
          return;
        }
        rememberExtractId(projectId, status.extract.id);
        const active =
          status.extract.status === "running" ||
          status.extract.billingStatus === "held";
        if (!active) {
          resumedExtract.current.add(projectId);
          if (
            status.sample?.length &&
            status.sample.length > (keywordsByProject[projectId]?.length ?? 0)
          ) {
            setKeywordsByProject((prev) => ({
              ...prev,
              [projectId]: status.sample as unknown as ExtractedKeyword[],
            }));
          }
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
        setExtracting(true);
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
            pulled: status.seeds.find((row) => row.seedId === seed.id)?.rowsReturned ?? 0,
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
    // Runs once per active project after hydration; re-firing on every
    // keyword/probe change would restart the resume check mid-poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, workspaceId, canEdit, activeProject?.id]);

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

    try {
      const result = await runClassifyArchiveLoop(
        workspaceId,
        projectId,
        (state) => {
          if (analyzeGen.current !== gen) return;
          setAnalyzeProgress({ done: state.nextOffset, total: state.total });
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

      try {
        const state = await loadFaStateApi(workspaceId);
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

  const timelineSteps = useMemo<StageStep[]>(() => {
    const s1: StageStepStatus = stage1DoneForActive ? "done" : "pending";
    const s2: StageStepStatus = preparingStage2
      ? "running"
      : stage2ReadyForActive
        ? "done"
        : openedMax >= 2
          ? "pending"
          : "locked";
    const s3: StageStepStatus = preparingStage3
      ? "running"
      : stage3ReadyForActive
        ? "done"
        : openedMax >= 3
          ? "pending"
          : "locked";
    const s4: StageStepStatus = extracting || analyzeLoading
      ? "running"
      : extractedKeywords.length > 0 || committedForActive
        ? "done"
        : openedMax >= 4
          ? "pending"
          : "locked";
    return [
      { stage: 1, status: s1, detail: STAGE_META[1].agentDetail },
      { stage: 2, status: s2, detail: STAGE_META[2].agentDetail },
      { stage: 3, status: s3, detail: STAGE_META[3].agentDetail },
      { stage: 4, status: s4, detail: STAGE_META[4].agentDetail },
    ];
  }, [
    stage1DoneForActive,
    preparingStage2,
    stage2ReadyForActive,
    openedMax,
    preparingStage3,
    stage3ReadyForActive,
    extracting,
    analyzeLoading,
    extractedKeywords.length,
    committedForActive,
  ]);

  const timelineReceipts = useMemo<StageReceipt[]>(() => {
    const list: StageReceipt[] = [];
    if (activeProject && stage1DoneForActive) {
      list.push({
        id: "r1",
        stage: 1,
        title: `Sheet loaded · ${activeNiches.length} niches`,
        detail: `${activeProject.storeLabel}`,
      });
    }
    if (extractedKeywords.length > 0) {
      list.push({
        id: "r4",
        stage: 4,
        title: `Keywords ready · ${extractedKeywords.length} terms`,
        detail: analyzed ? "Classified — proposal ready" : "Awaiting Analyze with AI",
      });
    }
    return list;
  }, [
    activeProject,
    stage1DoneForActive,
    activeNiches.length,
    extractedKeywords.length,
    analyzed,
  ]);

  const handleSendMessage = (text: string) => {
    if (!canEdit || !activeProject || preparingStage2 || preparingStage3) return;
    const projectId = activeProject.id;
    setChatByProject((prev) => ({
      ...prev,
      [projectId]: [...(prev[projectId] ?? []), { id: newId(), role: "user", text }],
    }));

    if (!workspaceId) {
      window.setTimeout(() => {
        appendAgent(
          projectId,
          "Workspace is still loading — try again in a moment."
        );
      }, 400);
      return;
    }

    setChatBusy(true);
    const history = (chatByProject[projectId] ?? []).map((m) => ({
      role: m.role === "agent" ? ("assistant" as const) : ("user" as const),
      content: m.text,
    }));
    const plpRows: AssessmentPlpRow[] = activeStructuredNiches.flatMap((niche) =>
      niche.collections.map((col) => ({
        name: col.name,
        pageType: (col.kind === "brand" ? "brand" : "collection") as
          | "collection"
          | "brand",
        skuCount: col.productCount,
        description: col.description ?? "",
      }))
    );

    void (async () => {
      try {
        const res = await chatAgentApi(workspaceId, projectId, history, text, activeNiches, {
          stage,
          market: activeMarket,
          selectedCollectionIds:
            stage === 2
              ? activeProject.highlightedCollectionIds
              : (stage3ScopeByProject[projectId] ?? activeProject.highlightedCollectionIds),
          seedRows: stage3Rows,
          probes: activeProbes,
          plpRows: plpRows.length > 0 ? plpRows : undefined,
        });
        setChatBusy(false);
        appendAgent(projectId, res.reply);
        if (res.updatedNiches && res.updatedNiches.length > 0) {
          setNichesByProject((prev) => ({ ...prev, [projectId]: res.updatedNiches! }));
        }
        if (res.updatedStructuredNiches && res.updatedStructuredNiches.length > 0) {
          setStructuredNichesByProject((prev) => ({
            ...prev,
            [projectId]: res.updatedStructuredNiches as unknown as MockNiche[],
          }));
        }
      } catch (err) {
        setChatBusy(false);
        appendAgent(
          projectId,
          err instanceof Error
            ? `Couldn't reach the agent: ${err.message}`
            : "Couldn't reach the agent. Please try again."
        );
      }
    })();
  };

  if (wsLoading || !hydrated) {
    return <PageLoader />;
  }

  const lockedViewStage: MarketResearchStage = reviewFlow
    ? (briefStageFromFlow(reviewFlow) ?? (Math.min(stage, 3) as MarketResearchStage))
    : (Math.min(stage, 3) as MarketResearchStage);
  const messages = activeProject
    ? (chatByProject[activeProject.id] ?? [])
    : [];

  return (
    <div className="autommerce-dashboard market-research-brand flex h-full min-h-0 gap-2 overflow-hidden bg-muted/25 p-2 [font-family:var(--brand-font)]">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/70 bg-background shadow-sm">
        <div className="relative flex flex-1 min-h-0 overflow-hidden">
          <NewProjectOverlay
            open={createOpen}
            onOpenChange={setCreateOpen}
            onCreate={handleCreateProject}
            required={namingRequired && canEdit}
            storeLabel={DEFAULT_STORE}
          />

          {activeProject ? (
            <div className={`mr-stage-frame${workspaceScene ? " is-workspace" : ""}`}>
              <div className="mr-agent-cell" aria-hidden={workspaceScene}>
                <div className="mr-agent-inner">
                  <AgentPanel
                    stage={lockedViewStage}
                    storeLabel={activeProject.storeLabel}
                    projectName={activeProject.name}
                    analyzingStage1={uploadBusy}
                    pendingStage1={!stage1DoneForActive}
                    stage1Done={stage1DoneForActive}
                    preparingStage2={preparingStage2}
                    preparingStage3={preparingStage3}
                    messages={messages}
                    onSendMessage={handleSendMessage}
                    chatBusy={chatBusy}
                    readOnly={reviewingBrief || !canEdit}
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
                      aria-label="Free assessment stages"
                      className="flex items-center gap-1"
                    >
                      {visibleStages.map((s) => {
                        const active = stage === s;
                        return (
                          <button
                            key={s}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            disabled={preparingStage2 || preparingStage3}
                            onClick={() => {
                              if (s > openedMax) return;
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
                      <StageStepper
                        current={Math.min(stage, 5) as MarketResearchStage}
                        steps={timelineSteps}
                        totalStages={5}
                      />
                    </div>
                    )}
                  </div>

                  <div className="flex-1 min-h-0 overflow-hidden p-4 sm:p-5 flex flex-col">
                    {lockedViewStage === 1 && (
                      stage1DoneForActive ? (
                        <StageScopePanel
                          projectId={activeProject.id}
                          storeLabel={activeProject.storeLabel}
                          phase="done"
                          showNext={!inWorkspace}
                          nextLabel={
                            openedMax >= 2 ? "Open Stage 2" : "Next · Catalog scope"
                          }
                          nextDisabled={preparingStage2 || preparingStage3}
                          onNext={handleNextFromStage1}
                          niches={activeNiches}
                          onRenameNiche={(id, name) => {
                            setNichesByProject((prev) => ({
                              ...prev,
                              [activeProject.id]: (prev[activeProject.id] ?? []).map(
                                (n) => (n.id === id ? { ...n, name, edited: true } : n)
                              ),
                            }));
                          }}
                          onDeleteNiche={(id) => {
                            setNichesByProject((prev) => ({
                              ...prev,
                              [activeProject.id]: (prev[activeProject.id] ?? []).filter(
                                (n) => n.id !== id
                              ),
                            }));
                          }}
                          onAddNiche={(name) => {
                            const id = newId();
                            setNichesByProject((prev) => ({
                              ...prev,
                              [activeProject.id]: [
                                ...(prev[activeProject.id] ?? []),
                                {
                                  id,
                                  name,
                                  summary: "Added on this assessment.",
                                  edited: true,
                                },
                              ],
                            }));
                          }}
                          onMergeNiche={() => undefined}
                          readOnly={reviewingBrief || !canEdit}
                        />
                      ) : (
                        <StagePlpUploadPanel
                          onRows={handleUploadRows}
                          busy={uploadBusy}
                          error={uploadError}
                          readOnly={reviewingBrief || !canEdit}
                        />
                      )
                    )}
                    {lockedViewStage === 2 && openedMax >= 2 && (
                      <StageSelectPanel
                        project={activeProject}
                        niches={activeStructuredNiches}
                        preparing={preparingStage2 || !stage2ReadyForActive}
                        showNext={
                          stage2ReadyForActive && !preparingStage2 && !reviewingBrief
                        }
                        nextLabel={
                          openedMax >= 3 ? "Open Stage 3" : "Next · Seed variations"
                        }
                        onNext={handleNextFromStage2}
                        onChangeSelection={(ids) => {
                          setProjects((prev) =>
                            prev.map((p) =>
                              p.id === activeProject.id
                                ? { ...p, highlightedCollectionIds: ids }
                                : p
                            )
                          );
                        }}
                        readOnly={reviewingBrief || !canEdit}
                      />
                    )}
                    {lockedViewStage === 3 && openedMax >= 3 && (
                      <StageSeedsPanel
                        rows={stage3Rows}
                        preparing={preparingStage3 || !stage3ReadyForActive}
                        selectedIds={seedSelection}
                        onChangeSelected={(ids) =>
                          setSeedSelectionByProject((prev) => ({
                            ...prev,
                            [activeProject.id]: ids,
                          }))
                        }
                        market={activeMarket}
                        onChangeMarket={(market) =>
                          setMarketByProject((prev) => ({
                            ...prev,
                            [activeProject.id]: market,
                          }))
                        }
                        probes={activeProbes}
                        probingIds={probingIds}
                        onProbe={runProbe}
                        onAddManualSeed={(term, collectionId) => {
                          const reference = stage3Rows.find(
                            (row) => row.collectionId === collectionId
                          );
                          if (!reference) return;
                          const row = createManualSeedRow(term, reference);
                          setManualSeedsByProject((prev) => ({
                            ...prev,
                            [activeProject.id]: [
                              ...(prev[activeProject.id] ?? []),
                              row,
                            ],
                          }));
                          setSeedSelectionByProject((prev) => ({
                            ...prev,
                            [activeProject.id]: [
                              ...(prev[activeProject.id] ?? []),
                              row.id,
                            ],
                          }));
                        }}
                        onConfirmSpend={handleExtract}
                        committed={committedForActive}
                        walletHref={`/w/${slug}/free-assessment/wallet`}
                        walletBalance={wallet?.balance ?? null}
                        readOnly={reviewingBrief || !canEdit}
                      />
                    )}
                  </div>
                </section>
                {inWorkspace ? (
                  <div className="mr-pane mr-pane-deep">
                    <DeepWorkspace
                      projectName={activeProject.name}
                      storeLabel={activeProject.storeLabel}
                      tab={
                        isWorkspaceTab(workspaceTab) ? workspaceTab : "extract"
                      }
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
                      analyzed={analyzed}
                      onCancelExtract={handleCancelExtract}
                      keywordsCsvHref={
                        workspaceId && committedForActive
                          ? `/api/free-assessment/extract/download?workspaceId=${workspaceId}&projectId=${activeProject.id}`
                          : undefined
                      }
                      growthEngineHref={`/w/${slug}/market-research`}
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
          onNewProject={() => {
            if (atProjectCap) {
              toast.error("Limit reached");
              return;
            }
            setCreateOpen(true);
          }}
          onRenameProject={(id, name) => {
            setProjects((prev) =>
              prev.map((p) => (p.id === id ? { ...p, name } : p))
            );
          }}
          onDeleteProject={(id) => {
            setProjects((prev) => prev.filter((p) => p.id !== id));
            if (activeProjectId === id) {
              const fallback = projects.find((p) => p.id !== id);
              setActiveProjectId(fallback?.id ?? "");
              setCreateOpen(!fallback);
            }
            if (workspaceId) {
              void deleteFaProjectApi(workspaceId, id).catch((err) => {
                toast.error("Couldn't delete the project", {
                  description: err instanceof Error ? err.message : undefined,
                });
              });
            }
          }}
          onToggleComplete={(id, completed) => {
            setProjects((prev) =>
              prev.map((p) =>
                p.id === id
                  ? { ...p, status: completed ? "completed" : "active" }
                  : p
              )
            );
          }}
          openedStageByProject={openedMaxByProject}
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
        walletHref={`/w/${slug}/free-assessment/wallet`}
      />
    </div>
  );
}
