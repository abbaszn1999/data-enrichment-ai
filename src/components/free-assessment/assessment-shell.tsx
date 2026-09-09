"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { PageLoader } from "@/components/brand/page-loader";
import { useAuth } from "@/hooks/use-auth";
import { useWallet } from "@/hooks/use-wallet";
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
import {
  RunTimeline,
  StageStepper,
  type StageReceipt,
  type StageStep,
  type StageStepStatus,
} from "./run-timeline";
import type { AssessmentCatalog } from "./assessment-csv";
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
  buildProposedCollections,
  isWorkspaceTab,
  keywordsFromSeeds,
  type ExtractedKeyword,
  type ProposedCollection,
  type SeedExtractProgress,
  type WorkspaceTab,
} from "./workspace-data";

const STAGES: MarketResearchStage[] = [1, 2, 3];
const DEFAULT_STORE = "Uploaded catalog";

function newId(): string {
  return crypto.randomUUID();
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) % 100000;
  }
  return hash;
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
  const { wallet } = useWallet(workspaceId || null);

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
  const [clustering, setClustering] = useState(false);
  const [preparingStage2, setPreparingStage2] = useState(false);
  const [preparingStage3, setPreparingStage3] = useState(false);

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
  const workspaceTab: WorkspaceTab = activeProject
    ? (workspaceTabByProject[activeProject.id] ?? "extract")
    : "extract";
  const openedWorkspace: WorkspaceTab = activeProject
    ? (openedWorkspaceByProject[activeProject.id] ?? "extract")
    : "extract";
  const analyzed = Boolean(
    activeProject && analyzedProjectIds.has(activeProject.id)
  );

  useEffect(() => {
    if (!slug) return;
    const saved = loadMarketResearchState(slug) ?? emptyMarketResearchState();
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
    setHydrated(true);
  }, [slug]);

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
  }, [hydrated, slug, persistedSnapshot]);

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
  const proposedCollections = activeProject
    ? (proposedCollectionsByProject[activeProject.id] ?? [])
    : [];
  const clusterSelection = activeProject
    ? (clusterSelectionByProject[activeProject.id] ?? [])
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

  const handleSelectProject = (id: string) => {
    setActiveProjectId(id);
    const opened = clampOpenedStage(openedMaxByProject[id], 1);
    setStage(Math.min(opened, 5) as MarketResearchStage);
  };

  const handleCreateProject = async (name: string) => {
    if (!canEdit || atProjectCap) {
      toast.error("Limit reached", {
        description: `Up to ${MAX_MARKET_RESEARCH_PROJECTS} free assessment projects.`,
      });
      return;
    }
    const project: MarketResearchProject = {
      id: newId(),
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
  };

  const handleCatalogUpload = (catalog: AssessmentCatalog) => {
    if (!activeProject) return;
    const projectId = activeProject.id;
    setNichesByProject((prev) => ({ ...prev, [projectId]: catalog.niches }));
    setStructuredNichesByProject((prev) => ({
      ...prev,
      [projectId]: catalog.structuredNiches,
    }));
    setStage1DoneIds((prev) => {
      const next = new Set(prev);
      next.add(projectId);
      return next;
    });
    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId
          ? { ...p, storeLabel: `${catalog.rowCount} PLPs from sheet` }
          : p
      )
    );
    appendAgent(
      projectId,
      `Loaded ${catalog.rowCount} PLP${catalog.rowCount === 1 ? "" : "s"} from the sheet into ${catalog.niches.length} niche${catalog.niches.length === 1 ? "" : "s"}. Edit names on the right if a grouping looks off, then press Next for catalog scope.`
    );
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

  const handleNextFromStage2 = () => {
    if (!canEdit || !activeProject || preparingStage3) return;
    const collectionIds = activeProject.highlightedCollectionIds;
    if (collectionIds.length === 0) {
      toast.error("Select at least one collection");
      return;
    }
    const projectId = activeProject.id;
    setOpenedMaxByProject((prev) => ({
      ...prev,
      [projectId]: Math.max(prev[projectId] ?? 1, 3) as MarketResearchStage,
    }));
    setStage(3);
    setPreparingStage3(true);
    window.setTimeout(() => {
      const rows = getSeedRowsForCollections(
        collectionIds,
        structuredNichesByProject[projectId] ?? []
      );
      setSeedRowsByProject((prev) => ({ ...prev, [projectId]: rows }));
      setStage3ScopeByProject((prev) => ({
        ...prev,
        [projectId]: [...collectionIds],
      }));
      setSeedSelectionByProject((prev) => ({
        ...prev,
        [projectId]: rows.map((r) => r.id),
      }));
      setPreparingStage3(false);
      setStage3ReadyIds((prev) => {
        const next = new Set(prev);
        next.add(projectId);
        return next;
      });
      appendAgent(
        projectId,
        `Prepared ${rows.length} broad seed variation${rows.length === 1 ? "" : "s"} from the selected PLPs. Run a demand check, then extract.`
      );
    }, 700);
  };

  const runProbe = (rowIds: string[]) => {
    if (!activeProject || rowIds.length === 0) return;
    const projectId = activeProject.id;
    const market = activeMarket;
    const targets = stage3Rows.filter((row) => rowIds.includes(row.id));
    setProbingIds(rowIds);
    window.setTimeout(() => {
      setProbesByProject((prev) => {
        const current = { ...(prev[projectId] ?? {}) };
        for (const row of targets) {
          const h = hashString(row.broadSeedVariation + market);
          current[row.id] = {
            seedId: row.id,
            market,
            rawKeywords: 80 + (h % 420),
            searchVolume: 200 + (h % 4800),
            sampleKeywords: [
              row.broadSeedVariation,
              `buy ${row.broadSeedVariation.toLowerCase()}`,
              `best ${row.broadSeedVariation.toLowerCase()}`,
            ],
            checkedAt: Date.now(),
          };
        }
        return { ...prev, [projectId]: current };
      });
      setProbingIds([]);
      toast.message("Frontend preview", {
        description:
          "Live Apify demand check will run once the free-assessment backend is connected.",
      });
    }, 900);
  };

  const handleExtract = () => {
    if (!activeProject) return;
    const projectId = activeProject.id;
    const seeds = selectedSeedRows.filter(
      (row) => activeProbes[row.id] && !activeProbes[row.id].failed
    );
    if (seeds.length === 0) {
      toast.error("Check demand on selected seeds first");
      return;
    }
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
    setExtracting(true);
    setExtractProgress(0);
    const caps = seeds.map((seed) => ({
      seedId: seed.id,
      seed: seed.broadSeedVariation,
      cap: 1,
      pulled: 0,
    }));
    setSeedProgress(caps);
    let tick = 0;
    const timer = window.setInterval(() => {
      tick += 1;
      setExtractProgress(Math.min(1, tick / 6));
      setSeedProgress((prev) =>
        prev.map((row, i) =>
          i < tick ? { ...row, pulled: row.cap } : row
        )
      );
      if (tick >= 6) {
        window.clearInterval(timer);
        const rows = keywordsFromSeeds(seeds, activeProbes);
        setKeywordsByProject((prev) => ({ ...prev, [projectId]: rows }));
        setExtracting(false);
        setExtractChargeByProject((prev) => ({ ...prev, [projectId]: 0 }));
        toast.message("Frontend preview", {
          description:
            "Keyword extract listed the selected seed terms. Apify will replace this once the assessment backend is connected.",
        });
      }
    }, 220);
  };

  const handleAnalyze = () => {
    if (!activeProject) return;
    const projectId = activeProject.id;
    const current = keywordsByProject[projectId] ?? [];
    if (current.length === 0) {
      toast.error("No keywords to analyze");
      return;
    }
    setAnalyzeLoading(true);
    setAnalyzeProgress({ done: 0, total: current.length });
    window.setTimeout(() => {
      const classified = current.map((row) => {
        if (row.isQuestion) {
          return {
            ...row,
            sheet: "informational" as const,
            exclusionReason: "Question / guide",
          };
        }
        return {
          ...row,
          sheet: "category" as const,
          plpConcept: "Category PLP",
        };
      });
      setKeywordsByProject((prev) => ({ ...prev, [projectId]: classified }));
      setAnalyzedProjectIds((prev) => {
        const next = new Set(prev);
        next.add(projectId);
        return next;
      });
      setAnalyzeLoading(false);
      setAnalyzeProgress(null);
    }, 700);
  };

  const handleNextCollections = (filtered?: ExtractedKeyword[]) => {
    if (!activeProject) return;
    const projectId = activeProject.id;
    const source =
      filtered && filtered.length > 0
        ? filtered
        : (keywordsByProject[projectId] ?? []).filter(
            (row) => row.sheet === "category"
          );
    setClustering(true);
    window.setTimeout(() => {
      const collections = buildProposedCollections(selectedSeedRows, source);
      setProposedCollectionsByProject((prev) => ({
        ...prev,
        [projectId]: collections,
      }));
      setClusterSelectionByProject((prev) => ({
        ...prev,
        [projectId]: collections.map((c) => c.id),
      }));
      setWorkspaceTabByProject((prev) => ({
        ...prev,
        [projectId]: "collections",
      }));
      setOpenedWorkspaceByProject((prev) => ({
        ...prev,
        [projectId]: "collections",
      }));
      setOpenedMaxByProject((prev) => ({
        ...prev,
        [projectId]: Math.max(prev[projectId] ?? 1, 5) as MarketResearchStage,
      }));
      setClustering(false);
    }, 800);
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
    const s5: StageStepStatus = clustering
      ? "running"
      : proposedCollections.length > 0
        ? "done"
        : openedMax >= 5
          ? "pending"
          : "locked";
    return [
      { stage: 1, status: s1, detail: STAGE_META[1].agentDetail },
      { stage: 2, status: s2, detail: STAGE_META[2].agentDetail },
      { stage: 3, status: s3, detail: STAGE_META[3].agentDetail },
      { stage: 4, status: s4, detail: STAGE_META[4].agentDetail },
      { stage: 5, status: s5, detail: STAGE_META[5].agentDetail },
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
    clustering,
    proposedCollections.length,
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
        detail: analyzed ? "Classified" : "Awaiting Analyze with AI",
      });
    }
    if (proposedCollections.length > 0) {
      list.push({
        id: "r5",
        stage: 5,
        title: `Collections · ${proposedCollections.length}`,
        detail: "Assessment stops here — no push or on-page.",
      });
    }
    return list;
  }, [
    activeProject,
    stage1DoneForActive,
    activeNiches.length,
    extractedKeywords.length,
    analyzed,
    proposedCollections.length,
  ]);

  if (wsLoading || !hydrated) {
    return <PageLoader />;
  }

  const lockedViewStage = (Math.min(stage, 3) as MarketResearchStage);
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
            <div className={`mr-stage-frame${inWorkspace ? " is-workspace" : ""}`}>
              <div className="mr-agent-cell" aria-hidden={inWorkspace}>
                <div className="mr-agent-inner">
                  <AgentPanel
                    stage={lockedViewStage}
                    storeLabel={activeProject.storeLabel}
                    projectName={activeProject.name}
                    analyzingStage1={false}
                    pendingStage1={!stage1DoneForActive}
                    stage1Done={stage1DoneForActive}
                    preparingStage2={preparingStage2}
                    preparingStage3={preparingStage3}
                    messages={messages}
                    onSendMessage={(text) => {
                      if (!canEdit) return;
                      setChatByProject((prev) => ({
                        ...prev,
                        [activeProject.id]: [
                          ...(prev[activeProject.id] ?? []),
                          { id: newId(), role: "user", text },
                        ],
                      }));
                      window.setTimeout(() => {
                        appendAgent(
                          activeProject.id,
                          "Noted. This assessment frontend is a preview — chat against the cloned agents lands with the backend next."
                        );
                      }, 400);
                    }}
                    readOnly={!canEdit}
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
                    <div className="ml-auto flex items-center gap-3 px-1">
                      <StageStepper
                        current={Math.min(stage, 5) as MarketResearchStage}
                        steps={timelineSteps}
                        totalStages={5}
                      />
                    </div>
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
                          readOnly={!canEdit}
                        />
                      ) : (
                        <StagePlpUploadPanel
                          onCatalog={handleCatalogUpload}
                          readOnly={!canEdit}
                        />
                      )
                    )}
                    {lockedViewStage === 2 && openedMax >= 2 && (
                      <StageSelectPanel
                        project={activeProject}
                        niches={activeStructuredNiches}
                        preparing={preparingStage2 || !stage2ReadyForActive}
                        showNext={stage2ReadyForActive && !preparingStage2}
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
                        readOnly={!canEdit}
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
                        walletHref={`/w/${slug}/wallet`}
                        walletBalance={wallet?.balance ?? null}
                        readOnly={!canEdit}
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
                      onTab={(next) => {
                        if (isWorkspaceTab(next)) {
                          setWorkspaceTabByProject((prev) => ({
                            ...prev,
                            [activeProject.id]: next,
                          }));
                        }
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
                      analyzeProgress={analyzeProgress}
                      analyzed={analyzed}
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
    </div>
  );
}
