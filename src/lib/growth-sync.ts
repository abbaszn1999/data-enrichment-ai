import { loadMarketResearchState } from "@/components/market-research/persistence";
import { loadMrStateApi } from "@/lib/market-research/client";

/**
 * Which Market Research projects can receive synced products.
 *
 * Everything else that used to live here — rule storage, plan state, a mock
 * collection list built from MOCK_NICHES — has moved to the database and to
 * `@/lib/growth-sync/client`. Only project discovery stays client-side, since
 * it reads the same persisted MR state the rest of the dashboard already has.
 */

export type LiveProjectOption = {
  id: string;
  name: string;
  liveCount: number;
  /**
   * Store collection ids/handles this project has already pushed live.
   * Watching one of these for new products makes no sense once it's picked
   * as the sync destination — it's where Sync assigns products *to*, not a
   * source of organic ones — so the rule-creation UI hides them from the
   * "watch" picker for whichever project is selected.
   */
  liveCollectionRefs: string[];
  /**
   * Bare collection names (pre-prefix) proposed for this project. Older pushes
   * — made before the push route started writing `storeHandle`/`storeCollectionId`
   * back onto the slice, or ones where that write step failed — leave a
   * collection live on the store with no ref recorded here at all. Matching on
   * the name (the store title is always `${prefix} - ${name}`) catches those
   * too, as a fallback for whenever `liveCollectionRefs` comes up empty.
   */
  liveCollectionNames: string[];
};

export function liveProjectsFromPersisted(
  saved: {
    projects: { id: string; name: string; highlightedCollectionIds: string[] }[];
    pushedIds: string[];
    clusterSelectionByProject: Record<string, string[]>;
    proposedCollectionsByProject?: Record<
      string,
      { name?: string; storeHandle?: string; storeCollectionId?: string }[]
    >;
  } | null
): LiveProjectOption[] {
  if (!saved) return [];
  // A project with nothing pushed has no live categories, so there is nowhere
  // for a synced product to land.
  const pushed = new Set(saved.pushedIds);
  return saved.projects
    .filter((project) => pushed.has(project.id))
    .map((project) => {
      const collections = saved.proposedCollectionsByProject?.[project.id] ?? [];
      const liveCollectionRefs = collections.flatMap((c) =>
        [c.storeHandle, c.storeCollectionId].filter(
          (v): v is string => typeof v === "string" && v.length > 0
        )
      );
      const liveCollectionNames = collections
        .map((c) => c.name)
        .filter((v): v is string => typeof v === "string" && v.trim().length > 0);
      return {
        id: project.id,
        name: project.name,
        liveCount:
          saved.clusterSelectionByProject[project.id]?.length ||
          project.highlightedCollectionIds.length ||
          1,
        liveCollectionRefs,
        liveCollectionNames,
      };
    });
}

export async function fetchLiveProjects(
  workspaceId: string,
  slug: string
): Promise<LiveProjectOption[]> {
  try {
    return liveProjectsFromPersisted(await loadMrStateApi(workspaceId));
  } catch {
    // The local snapshot is stale but still real; better than an empty picker.
    return liveProjectsFromPersisted(loadMarketResearchState(slug));
  }
}

export function projectLabel(id: string, projects: LiveProjectOption[]): string {
  return projects.find((row) => row.id === id)?.name ?? id;
}
