import type {
  MarketResearchProject,
  MarketResearchStage,
  MockNiche,
  MockSeedRow,
  NicheReading,
  SeedProbe,
} from "@/components/market-research/mock-data";
import type { Stage1ChatMessage } from "@/components/market-research/agent-panel";
import {
  emptyMarketResearchState,
  type MarketResearchPersisted,
} from "@/components/market-research/persistence";
import {
  normalizeOnPageInstructions,
  type CollectionContent,
  type ExtractedKeyword,
  type OnPageInstructions,
  type ProposedCollection,
  type WorkspaceTab,
} from "@/components/market-research/workspace-data";

export type MrProjectStateJson = {
  stage1Done?: boolean;
  openedMax?: MarketResearchStage;
  stage?: MarketResearchStage;
  chat?: Stage1ChatMessage[];
  stage3Scope?: string[];
  seedSelection?: string[];
  niches?: NicheReading[];
  structuredNiches?: MockNiche[];
  seedRows?: MockSeedRow[];
  probes?: Record<string, SeedProbe>;
  manualSeeds?: MockSeedRow[];
  committed?: boolean;
  workspaceTab?: WorkspaceTab;
  openedWorkspace?: WorkspaceTab;
  clusterSelection?: string[];
  proposedCollections?: ProposedCollection[];
  contentById?: Record<string, CollectionContent>;
  paidCollections?: boolean;
  contentReady?: boolean;
  pushed?: boolean;
  analyzed?: boolean;
  strategyReady?: boolean;
  strategyApproved?: boolean;
  customInstruction?: OnPageInstructions;
  extractCharge?: number;
  extractRows?: number;
  keywords?: ExtractedKeyword[];
  /** Fingerprints of the heavy slices stored in object storage, so autosave can skip unchanged uploads. */
  sliceHashes?: Record<string, string>;
};

export type MrProjectRow = {
  id: string;
  name: string;
  status: MarketResearchProject["status"] | "archived";
  store_label: string;
  highlighted_collection_ids: unknown;
  market: string;
  current_stage: number;
  opened_max_stage: number;
  state: MrProjectStateJson | null;
  keywords_path: string | null;
  extract_rows: number;
  extract_charged_usd: number;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function asStage(value: unknown, fallback: MarketResearchStage = 1): MarketResearchStage {
  const n = typeof value === "number" ? value : Number(value);
  if (n >= 1 && n <= 7) return n as MarketResearchStage;
  return fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function projectFromRow(row: MrProjectRow): MarketResearchProject {
  const status = row.status === "completed" ? "completed" : "active";
  return {
    id: row.id,
    name: row.name,
    status,
    storeLabel: row.store_label || "Store",
    highlightedCollectionIds: asStringArray(row.highlighted_collection_ids),
  };
}

function stateFromRow(row: MrProjectRow): MrProjectStateJson {
  return row.state && typeof row.state === "object" ? row.state : {};
}

export function rowsToPersisted(
  rows: MrProjectRow[],
  activeProjectId: string | null | undefined
): MarketResearchPersisted {
  const next = emptyMarketResearchState();
  next.projects = rows.map(projectFromRow);
  const preferred =
    next.projects.find((project) => project.id === activeProjectId)?.id ??
    next.projects[0]?.id ??
    "";
  next.activeProjectId = preferred;

  for (const row of rows) {
    const id = row.id;
    const state = stateFromRow(row);
    if (state.stage1Done) next.stage1DoneIds.push(id);
    next.openedMaxByProject[id] = asStage(
      state.openedMax ?? row.opened_max_stage,
      1
    );
    next.stageByProject[id] = asStage(state.stage ?? row.current_stage, 1);
    if (Array.isArray(state.chat)) next.chatByProject[id] = state.chat;
    if (Array.isArray(state.stage3Scope)) {
      next.stage3ScopeByProject[id] = state.stage3Scope;
    }
    if (Array.isArray(state.seedSelection)) {
      next.seedSelectionByProject[id] = state.seedSelection;
    }
    if (Array.isArray(state.niches)) next.nichesByProject[id] = state.niches;
    if (Array.isArray(state.structuredNiches)) {
      next.structuredNichesByProject[id] = state.structuredNiches;
    }
    if (Array.isArray(state.seedRows)) {
      next.seedRowsByProject[id] = state.seedRows;
    }
    next.marketByProject[id] = row.market || "us-en";
    if (state.probes) next.probesByProject[id] = state.probes;
    if (Array.isArray(state.manualSeeds)) {
      next.manualSeedsByProject[id] = state.manualSeeds;
    }
    if (state.committed) next.committedProjectIds.push(id);
    if (state.workspaceTab) next.workspaceTabByProject[id] = state.workspaceTab;
    if (state.openedWorkspace) {
      next.openedWorkspaceByProject[id] = state.openedWorkspace;
    }
    if (Array.isArray(state.clusterSelection)) {
      next.clusterSelectionByProject[id] = state.clusterSelection;
    }
    if (Array.isArray(state.proposedCollections)) {
      next.proposedCollectionsByProject[id] = state.proposedCollections;
    }
    if (state.contentById && typeof state.contentById === "object") {
      next.contentByIdByProject[id] = state.contentById;
    }
    if (state.paidCollections) next.paidCollectionProjectIds.push(id);
    if (state.contentReady) next.contentReadyIds.push(id);
    if (state.pushed) next.pushedIds.push(id);
    if (state.analyzed) next.analyzedProjectIds.push(id);
    if (state.strategyReady) next.strategyReadyIds.push(id);
    if (state.strategyApproved) next.strategyApprovedIds.push(id);
    if (state.customInstruction) {
      next.customInstructionByProject[id] = normalizeOnPageInstructions(
        state.customInstruction
      );
    }
    const extractCharge =
      typeof state.extractCharge === "number"
        ? state.extractCharge
        : Number(row.extract_charged_usd);
    if (Number.isFinite(extractCharge) && extractCharge > 0) {
      next.extractChargeByProject[id] = extractCharge;
    }
    const extractRows =
      typeof state.extractRows === "number"
        ? state.extractRows
        : Number(row.extract_rows);
    if (Number.isFinite(extractRows) && extractRows > 0) {
      next.extractRowsByProject[id] = extractRows;
    }
    if (Array.isArray(state.keywords)) {
      next.keywordsByProject[id] = state.keywords;
    }
  }

  return next;
}

export function projectStateSlice(
  persisted: MarketResearchPersisted,
  projectId: string
): MrProjectStateJson {
  const keywords = persisted.keywordsByProject[projectId];
  return {
    stage1Done: persisted.stage1DoneIds.includes(projectId),
    openedMax: persisted.openedMaxByProject[projectId] ?? 1,
    stage: persisted.stageByProject[projectId] ?? 1,
    chat: persisted.chatByProject[projectId] ?? [],
    stage3Scope: persisted.stage3ScopeByProject[projectId] ?? [],
    seedSelection: persisted.seedSelectionByProject[projectId] ?? [],
    niches: persisted.nichesByProject[projectId] ?? [],
    structuredNiches: persisted.structuredNichesByProject[projectId] ?? [],
    seedRows: persisted.seedRowsByProject[projectId] ?? [],
    probes: persisted.probesByProject[projectId] ?? {},
    manualSeeds: persisted.manualSeedsByProject[projectId] ?? [],
    committed: persisted.committedProjectIds.includes(projectId),
    workspaceTab: persisted.workspaceTabByProject[projectId],
    openedWorkspace: persisted.openedWorkspaceByProject[projectId],
    clusterSelection: persisted.clusterSelectionByProject[projectId] ?? [],
    proposedCollections: persisted.proposedCollectionsByProject[projectId] ?? [],
    contentById: persisted.contentByIdByProject[projectId] ?? {},
    paidCollections: persisted.paidCollectionProjectIds.includes(projectId),
    contentReady: persisted.contentReadyIds.includes(projectId),
    pushed: persisted.pushedIds.includes(projectId),
    analyzed: persisted.analyzedProjectIds.includes(projectId),
    strategyReady: persisted.strategyReadyIds.includes(projectId),
    strategyApproved: persisted.strategyApprovedIds.includes(projectId),
    customInstruction: persisted.customInstructionByProject[projectId],
    extractCharge: persisted.extractChargeByProject[projectId] ?? 0,
    extractRows: persisted.extractRowsByProject[projectId] ?? 0,
    keywords: Array.isArray(keywords) ? keywords : [],
  };
}

export function remapPersistedIds(
  persisted: MarketResearchPersisted,
  idMap: Record<string, string>
): MarketResearchPersisted {
  const remap = (id: string) => idMap[id] ?? id;
  const remapIds = (ids: string[]) => ids.map(remap);
  const remapRecord = <T>(record: Record<string, T>): Record<string, T> => {
    const out: Record<string, T> = {};
    for (const [key, value] of Object.entries(record)) {
      out[remap(key)] = value;
    }
    return out;
  };

  return {
    ...persisted,
    projects: persisted.projects.map((project) => ({
      ...project,
      id: remap(project.id),
    })),
    activeProjectId: remap(persisted.activeProjectId),
    stage1DoneIds: remapIds(persisted.stage1DoneIds),
    openedMaxByProject: remapRecord(persisted.openedMaxByProject),
    stageByProject: remapRecord(persisted.stageByProject),
    chatByProject: remapRecord(persisted.chatByProject),
    stage3ScopeByProject: remapRecord(persisted.stage3ScopeByProject),
    seedSelectionByProject: remapRecord(persisted.seedSelectionByProject),
    nichesByProject: remapRecord(persisted.nichesByProject),
    marketByProject: remapRecord(persisted.marketByProject),
    probesByProject: remapRecord(persisted.probesByProject),
    manualSeedsByProject: remapRecord(persisted.manualSeedsByProject),
    committedProjectIds: remapIds(persisted.committedProjectIds),
    workspaceTabByProject: remapRecord(persisted.workspaceTabByProject),
    openedWorkspaceByProject: remapRecord(persisted.openedWorkspaceByProject),
    clusterSelectionByProject: remapRecord(persisted.clusterSelectionByProject),
    paidCollectionProjectIds: remapIds(persisted.paidCollectionProjectIds),
    contentReadyIds: remapIds(persisted.contentReadyIds),
    pushedIds: remapIds(persisted.pushedIds),
    customInstructionByProject: remapRecord(
      persisted.customInstructionByProject
    ),
    analyzedProjectIds: remapIds(persisted.analyzedProjectIds),
    strategyReadyIds: remapIds(persisted.strategyReadyIds),
    strategyApprovedIds: remapIds(persisted.strategyApprovedIds),
    extractChargeByProject: remapRecord(persisted.extractChargeByProject),
    extractRowsByProject: remapRecord(persisted.extractRowsByProject),
    keywordsByProject: remapRecord(persisted.keywordsByProject),
  };
}

export function assignUuidProjectIds(
  persisted: MarketResearchPersisted
): MarketResearchPersisted {
  const idMap: Record<string, string> = {};
  for (const project of persisted.projects) {
    idMap[project.id] = isUuid(project.id) ? project.id : crypto.randomUUID();
  }
  return remapPersistedIds(persisted, idMap);
}
