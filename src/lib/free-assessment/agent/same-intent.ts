import { cosineSimilarity } from "./embeddings";

/** Candidate net only. Cosine never deletes a term; Gemini does. */
export const SAME_INTENT_COSINE = 0.84;
/** Full width of text-embedding-3-small for this shortlist. Other embeddings stay at 512. */
export const SAME_INTENT_EMBEDDING_DIMENSIONS = 1536;
/** One cluster can still be this large. It is sent alone and never split. */
export const SAME_INTENT_REQUEST_LIMIT = 1000;
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
 * One Gemini request per cluster. Clusters are never merged and never split.
 * `limit` stays in the signature so a caller can still name the cap; a cluster
 * larger than that cap is sent whole.
 */
export function packClusters<T>(
  clusters: T[][],
  _limit = SAME_INTENT_REQUEST_LIMIT
): T[][][] {
  const bins: T[][][] = [];
  for (const cluster of clusters) {
    if (cluster.length < 2) continue;
    bins.push([cluster]);
  }
  return bins;
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
 * Judge up to `parallel` packed requests. A null judgement keeps that
 * request's terms. Clusters inside a request are flattened for the model;
 * packing already kept each cluster whole.
 */
export async function judgePackedClusters(
  bins: IntentTerm[][][],
  judge: (terms: IntentTerm[]) => Promise<string[][] | null>,
  parallel = SAME_INTENT_PARALLEL
): Promise<{ drops: SameIntentDrop[]; judgedBins: number }> {
  const wave = bins.slice(0, parallel);
  const settled = await Promise.all(
    wave.map(async (bin) => {
      const terms = bin.flat();
      try {
        const groups = await judge(terms);
        if (!groups) return [] as SameIntentDrop[];
        return dropsFromGroups(terms, groups);
      } catch {
        return [] as SameIntentDrop[];
      }
    })
  );
  return { drops: settled.flat(), judgedBins: wave.length };
}
