import type { SupabaseClient } from "@supabase/supabase-js";
import {
  decodeVectorInt8,
  embedTexts,
  encodeVectorInt8,
  termEmbedText,
} from "./embeddings";
import { judgeSameIntentTerms } from "./stage9-same-intent";
import {
  collapseExactCopies,
  exactIntentKey,
  judgePackedClusters,
  nearestLeaderIndex,
  packClusters,
  SAME_INTENT_EMBEDDING_DIMENSIONS,
  SAME_INTENT_PARALLEL,
  type IntentTerm,
  type SameIntentDrop,
} from "./same-intent";
import { applySameIntentOverlay } from "@/lib/free-assessment/map-keywords";
import type { DisplayKeyword } from "@/lib/free-assessment/map-keywords";
import {
  clearSameIntentAdmin,
  loadClassifiedItemsAdmin,
  loadExtractRowsAdmin,
  loadProjectSliceAdmin,
  loadSameIntentAssignments,
  loadSameIntentClusters,
  loadSameIntentLeaders,
  loadSameIntentState,
  loadSameIntentSurvivors,
  saveProjectSliceAdmin,
  saveSameIntentAssignments,
  saveSameIntentClusters,
  saveSameIntentLeaders,
  saveSameIntentState,
  saveSameIntentSurvivors,
  type SameIntentClusterRecord,
  type SameIntentLeaderRecord,
  type SameIntentState,
  type SameIntentSurvivorRecord,
} from "@/lib/free-assessment/storage-admin";

const EMBED_PAGE = 200;
const CLUSTER_PAGE = 200;

export type SameIntentPage = {
  offset: number;
  nextOffset: number;
  done: boolean;
  phase: SameIntentState["phase"];
  processed: number;
  total: number;
  removedCount: number;
};

function freshState(total: number, drops: SameIntentDrop[]): SameIntentState {
  return {
    phase: total === 0 ? "done" : "embed",
    total,
    embedOffset: 0,
    clusterOffset: 0,
    judgeOffset: 0,
    drops,
    step: 0,
    updatedAt: new Date().toISOString(),
  };
}

function pageFrom(state: SameIntentState, processed: number): SameIntentPage {
  const cursor =
    state.phase === "embed"
      ? state.embedOffset
      : state.phase === "cluster"
        ? state.clusterOffset
        : state.phase === "judge"
          ? state.judgeOffset
          : state.total;
  return {
    offset: state.step,
    nextOffset: state.phase === "done" ? state.step : state.step + 1,
    done: state.phase === "done",
    phase: state.phase,
    processed,
    total: state.total,
    removedCount: state.drops.length,
  };
}

async function persistSample(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  drops: SameIntentDrop[]
): Promise<void> {
  const sample = await loadProjectSliceAdmin<DisplayKeyword[]>(
    admin,
    workspaceId,
    projectId,
    "keywords"
  ).catch(() => null);
  if (!Array.isArray(sample) || sample.length === 0) return;
  await saveProjectSliceAdmin(
    admin,
    workspaceId,
    projectId,
    "keywords",
    applySameIntentOverlay(sample, drops)
  );
}

async function startJob(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string
): Promise<SameIntentPage> {
  await clearSameIntentAdmin(admin, workspaceId, projectId);
  const [classified, archive] = await Promise.all([
    loadClassifiedItemsAdmin(admin, workspaceId, projectId),
    loadExtractRowsAdmin(admin, workspaceId, projectId).catch(() => []),
  ]);

  const volumeByKey = new Map<string, number>();
  for (const row of archive) {
    const key = exactIntentKey(row.phrase);
    if (!key) continue;
    const volume = row.volume ?? 0;
    if (volume > (volumeByKey.get(key) ?? -1)) volumeByKey.set(key, volume);
  }

  const seen = new Set<string>();
  const terms: IntentTerm[] = [];
  for (const item of classified) {
    if (item.sheet !== "category") continue;
    const keyword = (item.keyword || item.id || "").trim();
    if (!keyword || seen.has(item.id)) continue;
    seen.add(item.id);
    terms.push({
      id: item.id || keyword,
      keyword,
      volume: volumeByKey.get(exactIntentKey(keyword)) ?? 0,
    });
  }

  const collapsed = collapseExactCopies(terms);
  const survivors: SameIntentSurvivorRecord[] = collapsed.kept.map((term) => ({
    id: term.id,
    keyword: term.keyword,
    volume: term.volume,
    vector: "",
  }));
  const state = freshState(survivors.length, collapsed.drops);
  await saveSameIntentSurvivors(admin, workspaceId, projectId, survivors);
  await saveSameIntentLeaders(admin, workspaceId, projectId, []);
  await saveSameIntentAssignments(admin, workspaceId, projectId, {});
  await saveSameIntentClusters(admin, workspaceId, projectId, []);
  await saveSameIntentState(admin, workspaceId, projectId, state);
  if (state.phase === "done") {
    await persistSample(admin, workspaceId, projectId, state.drops);
  }
  return pageFrom(state, 0);
}

async function embedPage(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  state: SameIntentState
): Promise<SameIntentPage> {
  const survivors = await loadSameIntentSurvivors(admin, workspaceId, projectId);
  const slice = survivors.slice(state.embedOffset, state.embedOffset + EMBED_PAGE);
  if (slice.length > 0) {
    const vectors = await embedTexts(
      slice.map((row) => termEmbedText(row.keyword)),
      SAME_INTENT_EMBEDDING_DIMENSIONS
    );
    slice.forEach((row, index) => {
      const vector = vectors[index];
      row.vector = vector && vector.length > 0 ? encodeVectorInt8(vector) : "";
    });
    await saveSameIntentSurvivors(admin, workspaceId, projectId, survivors);
  }
  state.embedOffset += slice.length;
  state.step += 1;
  if (state.embedOffset >= survivors.length) {
    state.phase = "cluster";
    state.clusterOffset = 0;
  }
  state.updatedAt = new Date().toISOString();
  await saveSameIntentState(admin, workspaceId, projectId, state);
  return pageFrom(state, state.embedOffset);
}

async function clusterPage(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  state: SameIntentState
): Promise<SameIntentPage> {
  const [survivors, leaders, assignments] = await Promise.all([
    loadSameIntentSurvivors(admin, workspaceId, projectId),
    loadSameIntentLeaders(admin, workspaceId, projectId),
    loadSameIntentAssignments(admin, workspaceId, projectId),
  ]);
  const decoded = leaders.map((leader) =>
    leader.vector ? decodeVectorInt8(leader.vector, SAME_INTENT_EMBEDDING_DIMENSIONS) : []
  );
  const slice = survivors.slice(state.clusterOffset, state.clusterOffset + CLUSTER_PAGE);
  const nextLeaders: SameIntentLeaderRecord[] = [...leaders];

  for (const term of slice) {
    const vector = term.vector
      ? decodeVectorInt8(term.vector, SAME_INTENT_EMBEDDING_DIMENSIONS)
      : null;
    const best = nearestLeaderIndex(vector, decoded);
    if (best === -1) {
      if (vector && vector.length > 0) {
        decoded.push(vector);
        nextLeaders.push({ id: term.id, vector: term.vector });
      }
    } else {
      const leader = nextLeaders[best];
      if (leader) assignments[term.id] = leader.id;
    }
  }

  state.clusterOffset += slice.length;
  state.step += 1;
  await saveSameIntentLeaders(admin, workspaceId, projectId, nextLeaders);
  await saveSameIntentAssignments(admin, workspaceId, projectId, assignments);

  if (state.clusterOffset >= survivors.length) {
    const byId = new Map(survivors.map((row) => [row.id, row]));
    const grouped = new Map<string, IntentTerm[]>();
    for (const [memberId, leaderId] of Object.entries(assignments)) {
      const leader = byId.get(leaderId);
      const member = byId.get(memberId);
      if (!leader || !member) continue;
      const list = grouped.get(leaderId) ?? [
        { id: leader.id, keyword: leader.keyword, volume: leader.volume },
      ];
      list.push({ id: member.id, keyword: member.keyword, volume: member.volume });
      grouped.set(leaderId, list);
    }
    const clusters: SameIntentClusterRecord[] = [...grouped.values()]
      .filter((members) => members.length >= 2)
      .map((members) => ({ members }));
    await saveSameIntentClusters(admin, workspaceId, projectId, clusters);
    state.phase = clusters.length === 0 ? "done" : "judge";
    state.judgeOffset = 0;
  }

  state.updatedAt = new Date().toISOString();
  await saveSameIntentState(admin, workspaceId, projectId, state);
  if (state.phase === "done") {
    await persistSample(admin, workspaceId, projectId, state.drops);
  }
  return pageFrom(state, state.clusterOffset);
}

async function judgePage(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  state: SameIntentState
): Promise<SameIntentPage> {
  const clusters = await loadSameIntentClusters(admin, workspaceId, projectId);
  const bins = packClusters(clusters.map((cluster) => cluster.members));
  const wave = bins.slice(state.judgeOffset, state.judgeOffset + SAME_INTENT_PARALLEL);
  if (wave.length > 0) {
    const judged = await judgePackedClusters(wave, judgeSameIntentTerms);
    state.drops = [...state.drops, ...judged.drops];
    state.judgeOffset += judged.judgedBins;
  } else {
    state.judgeOffset = bins.length;
  }
  state.step += 1;
  if (state.judgeOffset >= bins.length) state.phase = "done";
  state.updatedAt = new Date().toISOString();
  await saveSameIntentState(admin, workspaceId, projectId, state);
  if (state.phase === "done") {
    await persistSample(admin, workspaceId, projectId, state.drops);
  }
  return pageFrom(state, state.judgeOffset);
}

/** One cursor step. `offset === 0` starts a fresh pass and clears the previous manifest. */
export async function advanceSameIntent(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  offset: number
): Promise<SameIntentPage> {
  if (offset === 0) return startJob(admin, workspaceId, projectId);
  const state = await loadSameIntentState(admin, workspaceId, projectId);
  if (!state || state.phase === "done") {
    const done = state ?? freshState(0, []);
    done.phase = "done";
    return pageFrom(done, done.total);
  }
  if (state.phase === "embed") return embedPage(admin, workspaceId, projectId, state);
  if (state.phase === "cluster") return clusterPage(admin, workspaceId, projectId, state);
  return judgePage(admin, workspaceId, projectId, state);
}
