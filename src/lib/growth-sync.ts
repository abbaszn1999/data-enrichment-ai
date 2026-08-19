import { MOCK_NICHES } from "@/components/market-research/mock-data";
import { loadMarketResearchState } from "@/components/market-research/persistence";
import { loadMrStateApi } from "@/lib/market-research/client";

export type SyncInterval = "manual" | "1h" | "6h" | "12h" | "24h";

export type SyncRule = {
  id: string;
  name: string;
  enabled: boolean;
  collectionIds: string[];
  projectIds: string[];
  lastSyncAt: number | null;
  itemsSynced: number;
};

export type SyncActivity = {
  id: string;
  at: number;
  ruleName: string;
  productTitle: string;
  collectionName: string;
  projectName: string;
  status: "classified" | "skipped";
};

export type SyncPlanId = "starter" | "growth" | "scale";

export type SyncState = {
  interval: SyncInterval;
  rules: SyncRule[];
  planId: SyncPlanId | null;
  creditsIncluded: number;
  creditsUsed: number;
  activity: SyncActivity[];
};

export type StoreCollectionOption = {
  id: string;
  name: string;
  productCount: number;
};

export type LiveProjectOption = {
  id: string;
  name: string;
  liveCount: number;
};

export const SYNC_INTERVALS: { id: SyncInterval; label: string }[] = [
  { id: "manual", label: "Manual only (Resync)" },
  { id: "1h", label: "Every hour" },
  { id: "6h", label: "Every 6 hours" },
  { id: "12h", label: "Every 12 hours" },
  { id: "24h", label: "Every 24 hours" },
];

export const SYNC_PLANS: {
  id: SyncPlanId;
  name: string;
  classifications: number;
  price: number;
  blurb: string;
}[] = [
  {
    id: "starter",
    name: "Starter",
    classifications: 500,
    price: 19,
    blurb: "A few collections, light catalog change.",
  },
  {
    id: "growth",
    name: "Growth",
    classifications: 2_000,
    price: 49,
    blurb: "Several projects running on an hourly schedule.",
  },
  {
    id: "scale",
    name: "Scale",
    classifications: 10_000,
    price: 149,
    blurb: "Large catalogs adding products every day.",
  },
];

export const STORE_COLLECTIONS: StoreCollectionOption[] = MOCK_NICHES.flatMap(
  (niche) =>
    niche.collections.map((collection) => ({
      id: collection.id,
      name: collection.name,
      productCount: collection.productCount,
    }))
);

const EXAMPLE_PROJECTS: LiveProjectOption[] = [
  { id: "ex-eyewear", name: "Eyewear catalog", liveCount: 2 },
  { id: "ex-toys", name: "Toys catalog", liveCount: 1 },
];

function storageKey(slug: string) {
  return `growth-sync:v1:${slug}`;
}

function seedState(): SyncState {
  return {
    interval: "1h",
    planId: null,
    creditsIncluded: 0,
    creditsUsed: 0,
    rules: [
      {
        id: "rule-example",
        name: "Sunglasses auto-sync",
        enabled: false,
        collectionIds: ["sunglasses"],
        projectIds: ["ex-eyewear"],
        lastSyncAt: null,
        itemsSynced: 0,
      },
    ],
    activity: [],
  };
}

export function loadGrowthSync(slug: string): SyncState {
  if (typeof window === "undefined") return seedState();
  try {
    const raw = window.localStorage.getItem(storageKey(slug));
    if (!raw) return seedState();
    const parsed = JSON.parse(raw) as Partial<SyncState>;
    const seeded = seedState();
    return {
      interval: parsed.interval ?? seeded.interval,
      planId: parsed.planId ?? null,
      creditsIncluded: parsed.creditsIncluded ?? 0,
      creditsUsed: parsed.creditsUsed ?? 0,
      rules: Array.isArray(parsed.rules) ? parsed.rules : seeded.rules,
      activity: Array.isArray(parsed.activity) ? parsed.activity : [],
    };
  } catch {
    return seedState();
  }
}

export function saveGrowthSync(slug: string, state: SyncState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(slug), JSON.stringify(state));
  } catch {
    // ignore quota / private mode
  }
}

export function intervalLabel(id: SyncInterval): string {
  return SYNC_INTERVALS.find((row) => row.id === id)?.label ?? id;
}

export function collectionById(id: string): StoreCollectionOption | undefined {
  return STORE_COLLECTIONS.find((row) => row.id === id);
}

export function liveProjectsFromPersisted(
  saved: {
    projects: { id: string; name: string; highlightedCollectionIds: string[] }[];
    pushedIds: string[];
    clusterSelectionByProject: Record<string, string[]>;
  } | null
): LiveProjectOption[] {
  if (!saved) return EXAMPLE_PROJECTS;
  const pushed = new Set(saved.pushedIds);
  const live = saved.projects
    .filter((project) => pushed.has(project.id))
    .map((project) => ({
      id: project.id,
      name: project.name,
      liveCount:
        saved.clusterSelectionByProject[project.id]?.length ||
        project.highlightedCollectionIds.length ||
        1,
    }));
  return live.length > 0 ? live : EXAMPLE_PROJECTS;
}

export function loadLiveProjects(slug: string): LiveProjectOption[] {
  return liveProjectsFromPersisted(loadMarketResearchState(slug));
}

export async function fetchLiveProjects(
  workspaceId: string,
  slug: string
): Promise<LiveProjectOption[]> {
  try {
    const state = await loadMrStateApi(workspaceId);
    const live = liveProjectsFromPersisted(state);
    if (live.length > 0 && live !== EXAMPLE_PROJECTS) return live;
    if (state.projects.some((project) => state.pushedIds.includes(project.id))) {
      return live;
    }
  } catch {
    // Fall through to the local snapshot, then the demo list.
  }
  return loadLiveProjects(slug);
}

export function projectLabel(
  id: string,
  projects: LiveProjectOption[]
): string {
  return projects.find((row) => row.id === id)?.name ?? id;
}
