import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchStoreCatalog } from "@/lib/market-research/agent/store-catalog";
import { runDuplicateCollectionExclusion } from "@/lib/market-research/agent/stage5-duplicate-exclusion";
import type { ProposedCollection } from "@/components/market-research/workspace-data";

export type DuplicateCheckResult = {
  collections: ProposedCollection[];
  duplicateCount: number;
  /**
   * True when "new" collections could not actually be checked against the
   * live catalog (catalog fetch failed, or the Gemini comparison failed).
   * A live store with zero collections is not a failure.
   */
  dedupeCheckFailed: boolean;
};

/**
 * Stage 5 Phase 3. Flags proposed collections whose shopper intent is
 * already served by a live store PLP. Never removes anything — flagged rows
 * get `status: "duplicate"`, and a failed check stamps "new" rows
 * `dedupeCheckStatus: "unknown"` so publishing stays blocked until a recheck.
 */
export async function checkCollectionDuplicates(
  admin: SupabaseClient,
  workspaceId: string,
  collections: ProposedCollection[]
): Promise<DuplicateCheckResult> {
  if (collections.length === 0) {
    return { collections: [], duplicateCount: 0, dedupeCheckFailed: false };
  }

  let existingCollections: Array<{ id: string; name: string }> = [];
  let catalogFetchFailed = false;
  try {
    const catalog = await fetchStoreCatalog(admin, workspaceId);
    existingCollections = [...catalog.collections, ...catalog.storeBrands].map((c) => ({
      id: c.id,
      name: c.name,
    }));
  } catch {
    catalogFetchFailed = true;
  }

  const newCollections = collections
    .filter((c) => c.status === "new")
    .map((c) => ({ id: c.id, name: c.name }));

  let duplicateIds = new Set<string>();
  let matchesById = new Map<string, Array<{ id: string; name: string }>>();
  let geminiCheckFailed = false;
  if (!catalogFetchFailed && existingCollections.length > 0 && newCollections.length > 0) {
    const result = await runDuplicateCollectionExclusion(newCollections, existingCollections);
    duplicateIds = result.duplicateIds;
    matchesById = result.matchesById;
    geminiCheckFailed = !result.checked;
  }
  const dedupeCheckFailed = catalogFetchFailed || geminiCheckFailed;

  const updated: ProposedCollection[] = collections.map((c) => {
    if (duplicateIds.has(c.id)) {
      const matches = matchesById.get(c.id) ?? [];
      return {
        ...c,
        status: "duplicate" as const,
        dedupeCheckStatus: "ok" as const,
        ...(matches.length > 0
          ? { duplicateMatches: matches, existingName: matches[0].name }
          : {}),
      };
    }
    if (c.status === "new") {
      return {
        ...c,
        dedupeCheckStatus: dedupeCheckFailed ? ("unknown" as const) : ("ok" as const),
      };
    }
    return c;
  });

  return { collections: updated, duplicateCount: duplicateIds.size, dedupeCheckFailed };
}
