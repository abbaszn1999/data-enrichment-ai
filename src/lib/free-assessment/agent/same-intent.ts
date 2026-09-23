import { cosineSimilarity } from "./embeddings";

/** Candidate net only. Cosine never deletes a term; Gemini does. */
export const SAME_INTENT_COSINE = 0.84;
/** Full width of text-embedding-3-small for this shortlist. Other embeddings stay at 512. */
export const SAME_INTENT_EMBEDDING_DIMENSIONS = 1536;
/**
 * Terms per Gemini request. Whole groups are packed until the next one would
 * go over; a single group larger than this is sent alone and never split.
 * Measured on a real project: 100 terms found 27 of the 29 duplicates that
 * one-group-per-request found, 300 terms found only 24.
 */
export const SAME_INTENT_REQUEST_LIMIT = 100;
export const SAME_INTENT_PARALLEL = 5;

export type IntentTerm = {
  id: string;
  keyword: string;
  volume: number;
};

export type SameIntentDrop = {
  droppedKeyword: string;
  keptKeyword: string;
};

/**
 * Script-neutral identity. Unicode normalize, trim, collapse spaces, and
 * casefold. Arabic has no case, so casefold does not change it. This is not
 * a token sort and it does not drop particles — different words stay different.
 */
export function exactIntentKey(keyword: string): string {
  return keyword.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Collapse keywords that are the same wording. Keeps the highest volume.
 * A volume tie keeps the earlier row.
 */
export function collapseExactCopies(terms: IntentTerm[]): {
  kept: IntentTerm[];
  drops: SameIntentDrop[];
} {
  const groups = new Map<string, IntentTerm[]>();
  for (const term of terms) {
    const key = exactIntentKey(term.keyword) || term.id;
    const list = groups.get(key) ?? [];
    list.push(term);
    groups.set(key, list);
  }

  const kept: IntentTerm[] = [];
  const drops: SameIntentDrop[] = [];
  for (const group of groups.values()) {
    let winner = group[0]!;
    for (const term of group.slice(1)) {
      if (term.volume > winner.volume) winner = term;
    }
    kept.push(winner);
    for (const term of group) {
      if (term.id === winner.id) continue;
      drops.push({
        droppedKeyword: term.keyword,
        keptKeyword: winner.keyword,
      });
    }
  }

  kept.sort((a, b) => b.volume - a.volume || a.id.localeCompare(b.id));
  return { kept, drops };
}

export type VectorTerm = IntentTerm & { vector: number[] | null };

/**
 * Volume-desc leader clustering. Each term joins the nearest earlier leader
 * at or above `threshold`. Missing vectors stay singletons so a failed embed
 * cannot delete them. Returned clusters include singletons; callers send only
 * size >= 2 to the model.
 */
/** Index of the nearest leader at or above `threshold`, or -1 to become a new leader. */
export function nearestLeaderIndex(
  vector: number[] | null,
  leaders: number[][],
  threshold = SAME_INTENT_COSINE
): number {
  if (!vector || vector.length === 0) return -1;
  let best = -1;
  let bestSim = -1;
  for (let i = 0; i < leaders.length; i += 1) {
    const sim = cosineSimilarity(vector, leaders[i]!);
    if (sim >= threshold && sim > bestSim) {
      best = i;
      bestSim = sim;
    }
  }
  return best;
}

export function clusterByLeaders(
  terms: VectorTerm[],
  threshold = SAME_INTENT_COSINE
): IntentTerm[][] {
  const clusters: IntentTerm[][] = [];
  const leaderVectors: number[][] = [];
  const leaderClusterIndex: number[] = [];

  for (const term of terms) {
    const best = nearestLeaderIndex(term.vector, leaderVectors, threshold);
    if (best === -1) {
      if (term.vector && term.vector.length > 0) {
        leaderVectors.push(term.vector);
        leaderClusterIndex.push(clusters.length);
      }
      clusters.push([term]);
    } else {
      clusters[leaderClusterIndex[best]!]!.push(term);
    }
  }

  return clusters;
}

/**
 * Pack whole clusters into requests of up to `limit` terms. A cluster is
 * never split across requests; one larger than `limit` travels alone.
 * Clusters of one term are skipped — there is nothing to compare.
 */
export function packClusters<T>(
  clusters: T[][],
  limit = SAME_INTENT_REQUEST_LIMIT
): T[][][] {
  const bins: T[][][] = [];
  let current: T[][] = [];
  let count = 0;
  for (const cluster of clusters) {
    if (cluster.length < 2) continue;
    if (current.length > 0 && count + cluster.length > limit) {
      bins.push(current);
      current = [];
      count = 0;
    }
    current.push(cluster);
    count += cluster.length;
  }
  if (current.length > 0) bins.push(current);
  return bins;
}

/**
 * Keep only model groups whose ids all belong to one candidate cluster.
 * A group mixing two clusters is ignored whole, so terms that were never
 * shortlisted together can never be merged. Unknown ids are dropped.
 */
export function groupsWithinClusters(
  clusters: IntentTerm[][],
  groups: string[][]
): string[][] {
  const clusterById = new Map<string, number>();
  clusters.forEach((cluster, index) => {
    for (const term of cluster) clusterById.set(term.id, index);
  });
  const accepted: string[][] = [];
  for (const group of groups) {
    const known = group.filter((id) => clusterById.has(id));
    const owners = new Set(known.map((id) => clusterById.get(id)));
    if (known.length < 2 || owners.size !== 1) continue;
    accepted.push(known);
  }
  return accepted;
}

/**
 * Code picks the winner. The model only names ids that share one search.
 * An id omitted from every group stays. An unknown id is ignored. The first
 * group to claim an id owns it. A volume tie keeps the earlier member.
 */
export function dropsFromGroups(
  members: IntentTerm[],
  groups: string[][]
): SameIntentDrop[] {
  const byId = new Map(members.map((member) => [member.id, member]));
  const claimed = new Set<string>();
  const drops: SameIntentDrop[] = [];

  for (const group of groups) {
    const present: IntentTerm[] = [];
    for (const id of group) {
      if (claimed.has(id)) continue;
      const term = byId.get(id);
      if (!term) continue;
      claimed.add(id);
      present.push(term);
    }
    if (present.length < 2) continue;

    let winner = present[0]!;
    for (const term of present.slice(1)) {
      if (term.volume > winner.volume) winner = term;
    }
    for (const term of present) {
      if (term.id === winner.id) continue;
      drops.push({
        droppedKeyword: term.keyword,
        keptKeyword: winner.keyword,
      });
    }
  }

  return drops;
}

/**
 * Judge up to `parallel` packed requests at once. Each request keeps its
 * clusters labelled, and any answer that mixes two clusters is ignored. A
 * failed or null judgement keeps every term in that request.
 */
export async function judgePackedClusters(
  bins: IntentTerm[][][],
  judge: (clusters: IntentTerm[][]) => Promise<string[][] | null>,
  parallel = SAME_INTENT_PARALLEL
): Promise<{ drops: SameIntentDrop[]; judgedBins: number }> {
  const wave = bins.slice(0, parallel);
  const settled = await Promise.all(
    wave.map(async (bin) => {
      try {
        const groups = await judge(bin);
        if (!groups) return [] as SameIntentDrop[];
        return dropsFromGroups(bin.flat(), groupsWithinClusters(bin, groups));
      } catch {
        return [] as SameIntentDrop[];
      }
    })
  );
  return { drops: settled.flat(), judgedBins: wave.length };
}
