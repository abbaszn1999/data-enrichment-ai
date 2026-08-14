import type {
  MarketResearchProject,
  MarketResearchStage,
  MockSeedRow,
  NicheReading,
  SeedProbe,
} from "./mock-data";
import type { Stage1ChatMessage } from "./agent-panel";
import type { WorkspaceTab } from "./workspace-data";

export type MarketResearchPersisted = {
  projects: MarketResearchProject[];
  activeProjectId: string;
  stage1DoneIds: string[];
  /** Highest stage the customer has opened via Next (per project). */
  openedMaxByProject: Record<string, MarketResearchStage>;
  /** Last viewed stage per project. */
  stageByProject: Record<string, MarketResearchStage>;
  chatByProject: Record<string, Stage1ChatMessage[]>;
  /** Collection ids Stage 3 was generated from (snapshot, per project). */
  stage3ScopeByProject: Record<string, string[]>;
  /** Seed rows the customer picked for the next stage (per project). */
  seedSelectionByProject: Record<string, string[]>;
  /** Stage 1 niches after customer edits. */
  nichesByProject: Record<string, NicheReading[]>;
  /** Target country + language the demand probe ran in. */
  marketByProject: Record<string, string>;
  /** Demand probe results keyed by seed row id. */
  probesByProject: Record<string, Record<string, SeedProbe>>;
  /** Broad seeds the customer added by hand. */
  manualSeedsByProject: Record<string, MockSeedRow[]>;
  /** Projects where Extract was paid and the workspace opened. */
  committedProjectIds: string[];
  workspaceTabByProject: Record<string, WorkspaceTab>;
  openedWorkspaceByProject: Record<string, WorkspaceTab>;
  clusterSelectionByProject: Record<string, string[]>;
  paidCollectionProjectIds: string[];
  contentReadyIds: string[];
  pushedIds: string[];
  customInstructionByProject: Record<string, string>;
};

function storageKey(workspaceSlug: string) {
  return `market-research:v2:${workspaceSlug}`;
}

function asStage(n: unknown): MarketResearchStage | null {
  if (n === 1 || n === 2 || n === 3) return n;
  if (n === "1" || n === "2" || n === "3") return Number(n) as MarketResearchStage;
  return null;
}

export function loadMarketResearchState(
  workspaceSlug: string
): MarketResearchPersisted | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(workspaceSlug));
    if (!raw) {
      // Migrate lightly from v1 if present
      const v1 = window.localStorage.getItem(
        `market-research:v1:${workspaceSlug}`
      );
      if (!v1) return null;
      const parsed = JSON.parse(v1) as {
        projects?: MarketResearchProject[];
        activeProjectId?: string;
        stage1DoneIds?: string[];
      };
      if (!Array.isArray(parsed.projects)) return null;
      return {
        projects: parsed.projects,
        activeProjectId: parsed.activeProjectId ?? "",
        stage1DoneIds: Array.isArray(parsed.stage1DoneIds)
          ? parsed.stage1DoneIds
          : [],
        openedMaxByProject: {},
        stageByProject: {},
        chatByProject: {},
        stage3ScopeByProject: {},
        seedSelectionByProject: {},
        nichesByProject: {},
        marketByProject: {},
        probesByProject: {},
        manualSeedsByProject: {},
        committedProjectIds: [],
        workspaceTabByProject: {},
        openedWorkspaceByProject: {},
        clusterSelectionByProject: {},
        paidCollectionProjectIds: [],
        contentReadyIds: [],
        pushedIds: [],
        customInstructionByProject: {},
      };
    }
    const parsed = JSON.parse(raw) as MarketResearchPersisted;
    if (!Array.isArray(parsed.projects)) return null;
    return {
      projects: parsed.projects,
      activeProjectId: parsed.activeProjectId ?? "",
      stage1DoneIds: Array.isArray(parsed.stage1DoneIds)
        ? parsed.stage1DoneIds
        : [],
      openedMaxByProject: parsed.openedMaxByProject ?? {},
      stageByProject: parsed.stageByProject ?? {},
      chatByProject: parsed.chatByProject ?? {},
      stage3ScopeByProject: parsed.stage3ScopeByProject ?? {},
      seedSelectionByProject: parsed.seedSelectionByProject ?? {},
      nichesByProject: parsed.nichesByProject ?? {},
      marketByProject: parsed.marketByProject ?? {},
      probesByProject: parsed.probesByProject ?? {},
      manualSeedsByProject: parsed.manualSeedsByProject ?? {},
      committedProjectIds: Array.isArray(parsed.committedProjectIds)
        ? parsed.committedProjectIds
        : [],
      workspaceTabByProject: parsed.workspaceTabByProject ?? {},
      openedWorkspaceByProject: parsed.openedWorkspaceByProject ?? {},
      clusterSelectionByProject: parsed.clusterSelectionByProject ?? {},
      paidCollectionProjectIds: Array.isArray(parsed.paidCollectionProjectIds)
        ? parsed.paidCollectionProjectIds
        : [],
      contentReadyIds: Array.isArray(parsed.contentReadyIds)
        ? parsed.contentReadyIds
        : [],
      pushedIds: Array.isArray(parsed.pushedIds) ? parsed.pushedIds : [],
      customInstructionByProject: parsed.customInstructionByProject ?? {},
    };
  } catch {
    return null;
  }
}

export function saveMarketResearchState(
  workspaceSlug: string,
  state: MarketResearchPersisted
) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(workspaceSlug), JSON.stringify(state));
  } catch {
    // ignore quota / private mode
  }
}

export function clampOpenedStage(
  value: unknown,
  fallback: MarketResearchStage = 1
): MarketResearchStage {
  return asStage(value) ?? fallback;
}
