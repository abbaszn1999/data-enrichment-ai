import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarketResearchPersisted } from "@/components/market-research/persistence";
import type {
  MockNiche,
  MockSeedRow,
  NicheReading,
  SeedProbe,
} from "@/components/market-research/mock-data";
import type {
  CollectionContent,
  ExtractedKeyword,
  GeneratedArticle,
  MarketResearchProduct,
  ProposedCollection,
  StrategyArticle,
} from "@/components/market-research/workspace-data";
import {
  projectStateSlice,
  rowsToPersisted,
  type MrProjectRow,
  type MrProjectStateJson,
} from "./project-state";
import {
  deleteProjectStorageFolder,
  loadMrJsonAdmin,
  loadProjectSliceAdmin,
  mrSlicePath,
  saveProjectSliceAdmin,
  type MrSliceName,
} from "./storage-admin";

type PersistAdmin = SupabaseClient;

/**
 * Cheap deterministic fingerprint used to detect whether a storage slice changed.
 * Combines length with two independent 32-bit rolling hashes.
 */
function fingerprintOf(payload: unknown): string {
  const json = JSON.stringify(payload) ?? "";
  let h1 = 0x811c9dc5;
  let h2 = 5381;
  for (let i = 0; i < json.length; i += 1) {
    const code = json.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = ((h2 << 5) + h2 + code) >>> 0;
  }
  return `${json.length.toString(36)}-${h1.toString(36)}-${h2.toString(36)}`;
}

type NichesSlicePayload = {
  niches: NicheReading[];
  structuredNiches: MockNiche[];
};

type SeedsSlicePayload = {
  seedRows: MockSeedRow[];
  manualSeeds: MockSeedRow[];
};

export async function loadMrPersistedState(
  admin: PersistAdmin,
  workspaceId: string
): Promise<MarketResearchPersisted> {
  const [{ data: rows, error }, { data: prefs }] = await Promise.all([
    admin
      .from("mr_projects")
      .select(
        "id, name, status, store_label, highlighted_collection_ids, market, current_stage, opened_max_stage, state, keywords_path, extract_rows, extract_charged_usd"
      )
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true }),
    admin
      .from("mr_workspace_prefs")
      .select("active_project_id")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
  ]);
  if (error) throw error;

  const projectRows = (rows ?? []) as MrProjectRow[];
  const persisted = rowsToPersisted(
    projectRows,
    prefs?.active_project_id
  );

  await Promise.all(
    projectRows.map(async (row) => {
      const projectId = row.id;
      const state = (row.state && typeof row.state === "object" ? row.state : {}) as MrProjectStateJson;

      await Promise.all([
        // 1. Niches slice
        (async () => {
          try {
            const data = await loadProjectSliceAdmin<NichesSlicePayload>(
              admin,
              workspaceId,
              projectId,
              "niches"
            );
            if (data) {
              if (Array.isArray(data.niches) && data.niches.length > 0) {
                persisted.nichesByProject[projectId] = data.niches;
              }
              if (Array.isArray(data.structuredNiches) && data.structuredNiches.length > 0) {
                persisted.structuredNichesByProject[projectId] = data.structuredNiches;
              }
            } else {
              // Legacy fallback from DB state
              if (Array.isArray(state.niches)) persisted.nichesByProject[projectId] = state.niches;
              if (Array.isArray(state.structuredNiches)) persisted.structuredNichesByProject[projectId] = state.structuredNiches;
            }
          } catch {
            if (Array.isArray(state.niches)) persisted.nichesByProject[projectId] = state.niches;
            if (Array.isArray(state.structuredNiches)) persisted.structuredNichesByProject[projectId] = state.structuredNiches;
          }
        })(),

        // Products slice
        (async () => {
          try {
            const data = await loadProjectSliceAdmin<MarketResearchProduct[]>(
              admin,
              workspaceId,
              projectId,
              "products"
            );
            if (Array.isArray(data) && data.length > 0) {
              persisted.productsByProject[projectId] = data;
            }
          } catch {
            // No products file yet
          }
        })(),

        // 2. Seeds slice
        (async () => {
          try {
            const data = await loadProjectSliceAdmin<SeedsSlicePayload>(
              admin,
              workspaceId,
              projectId,
              "seeds"
            );
            if (data) {
              if (Array.isArray(data.seedRows) && data.seedRows.length > 0) {
                persisted.seedRowsByProject[projectId] = data.seedRows;
              }
              if (Array.isArray(data.manualSeeds) && data.manualSeeds.length > 0) {
                persisted.manualSeedsByProject[projectId] = data.manualSeeds;
              }
            } else {
              if (Array.isArray(state.seedRows)) persisted.seedRowsByProject[projectId] = state.seedRows;
              if (Array.isArray(state.manualSeeds)) persisted.manualSeedsByProject[projectId] = state.manualSeeds;
            }
          } catch {
            if (Array.isArray(state.seedRows)) persisted.seedRowsByProject[projectId] = state.seedRows;
            if (Array.isArray(state.manualSeeds)) persisted.manualSeedsByProject[projectId] = state.manualSeeds;
          }
        })(),

        // 3. Probes stay in Postgres because they arrive incrementally, chunk by
        // chunk. Only fall back to storage for rows written by an earlier build.
        (async () => {
          if (state.probes && Object.keys(state.probes).length > 0) {
            persisted.probesByProject[projectId] = state.probes;
            return;
          }
          try {
            const data = await loadProjectSliceAdmin<Record<string, SeedProbe>>(
              admin,
              workspaceId,
              projectId,
              "probes"
            );
            if (data && typeof data === "object") {
              persisted.probesByProject[projectId] = data;
            }
          } catch {
            // No legacy probes file; nothing to restore.
          }
        })(),

        // 4. Keywords slice
        (async () => {
          try {
            const data = await loadProjectSliceAdmin<ExtractedKeyword[]>(
              admin,
              workspaceId,
              projectId,
              "keywords"
            );
            const slicePath = mrSlicePath(workspaceId, projectId, "keywords");
            if (Array.isArray(data) && data.length > 0) {
              persisted.keywordsByProject[projectId] = data;
            } else if (row.keywords_path && row.keywords_path !== slicePath) {
              const legacySample = await loadMrJsonAdmin<ExtractedKeyword[]>(
                admin,
                row.keywords_path
              );
              if (Array.isArray(legacySample)) {
                persisted.keywordsByProject[projectId] = legacySample;
              }
            } else if (Array.isArray(state.keywords)) {
              persisted.keywordsByProject[projectId] = state.keywords;
            }
          } catch {
            if (Array.isArray(state.keywords)) {
              persisted.keywordsByProject[projectId] = state.keywords;
            }
          }
        })(),

        // 5. Proposed collections slice
        (async () => {
          try {
            const data = await loadProjectSliceAdmin<ProposedCollection[]>(
              admin,
              workspaceId,
              projectId,
              "collections"
            );
            if (Array.isArray(data) && data.length > 0) {
              persisted.proposedCollectionsByProject[projectId] = data;
            } else if (Array.isArray(state.proposedCollections)) {
              persisted.proposedCollectionsByProject[projectId] = state.proposedCollections;
            }
          } catch {
            if (Array.isArray(state.proposedCollections)) {
              persisted.proposedCollectionsByProject[projectId] = state.proposedCollections;
            }
          }
        })(),

        // 6. Content by id slice
        (async () => {
          try {
            const data = await loadProjectSliceAdmin<Record<string, CollectionContent>>(
              admin,
              workspaceId,
              projectId,
              "content"
            );
            if (data && typeof data === "object") {
              persisted.contentByIdByProject[projectId] = data;
            } else if (state.contentById && typeof state.contentById === "object") {
              persisted.contentByIdByProject[projectId] = state.contentById;
            }
          } catch {
            if (state.contentById && typeof state.contentById === "object") {
              persisted.contentByIdByProject[projectId] = state.contentById;
            }
          }
        })(),

        // 7. Stage 7 article plan slice
        (async () => {
          try {
            const data = await loadProjectSliceAdmin<StrategyArticle[]>(
              admin,
              workspaceId,
              projectId,
              "strategy"
            );
            if (Array.isArray(data) && data.length > 0) {
              persisted.strategyByProject[projectId] = data;
            } else if (Array.isArray(state.strategy)) {
              persisted.strategyByProject[projectId] = state.strategy;
            }
          } catch {
            if (Array.isArray(state.strategy)) {
              persisted.strategyByProject[projectId] = state.strategy;
            }
          }
        })(),

        // 8. Stage 7 generated article bodies slice
        (async () => {
          try {
            const data = await loadProjectSliceAdmin<
              Record<string, GeneratedArticle>
            >(admin, workspaceId, projectId, "articles");
            if (data && typeof data === "object") {
              persisted.articlesByProject[projectId] = data;
            } else if (state.articles && typeof state.articles === "object") {
              persisted.articlesByProject[projectId] = state.articles;
            }
          } catch {
            if (state.articles && typeof state.articles === "object") {
              persisted.articlesByProject[projectId] = state.articles;
            }
          }
        })(),
      ]);
    })
  );

  return persisted;
}

export async function saveMrPersistedState(
  admin: PersistAdmin,
  workspaceId: string,
  userId: string,
  persisted: MarketResearchPersisted
): Promise<void> {
  const { data: existingRows } = await admin
    .from("mr_projects")
    .select("id, extract_rows, extract_charged_usd, keywords_path, state")
    .eq("workspace_id", workspaceId);
  const existingById = new Map(
    (existingRows ?? []).map((row) => [row.id as string, row])
  );

  for (const project of persisted.projects) {
    const projectId = project.id;
    const slice = projectStateSlice(persisted, projectId);
    const existing = existingById.get(projectId);
    const existingState =
      existing?.state && typeof existing.state === "object"
        ? (existing.state as MrProjectStateJson)
        : {};
    const previousHashes = existingState.sliceHashes ?? {};
    const nextHashes: Record<string, string> = { ...previousHashes };

    // Heavy, write-once slices live in object storage. Autosave fires on every UI
    // change, so a slice is only uploaded when its fingerprint actually moved.
    const heavySlices: Array<{ name: MrSliceName; payload: unknown; empty: boolean }> = [
      {
        name: "niches",
        payload: {
          niches: persisted.nichesByProject[projectId] ?? [],
          structuredNiches: persisted.structuredNichesByProject[projectId] ?? [],
        } satisfies NichesSlicePayload,
        empty:
          (persisted.nichesByProject[projectId] ?? []).length === 0 &&
          (persisted.structuredNichesByProject[projectId] ?? []).length === 0,
      },
      {
        name: "products",
        payload: persisted.productsByProject?.[projectId] ?? [],
        empty: (persisted.productsByProject?.[projectId] ?? []).length === 0,
      },
      {
        name: "seeds",
        payload: {
          seedRows: persisted.seedRowsByProject[projectId] ?? [],
          manualSeeds: persisted.manualSeedsByProject[projectId] ?? [],
        } satisfies SeedsSlicePayload,
        empty:
          (persisted.seedRowsByProject[projectId] ?? []).length === 0 &&
          (persisted.manualSeedsByProject[projectId] ?? []).length === 0,
      },
      {
        name: "keywords",
        payload: persisted.keywordsByProject[projectId] ?? [],
        empty: (persisted.keywordsByProject[projectId] ?? []).length === 0,
      },
      {
        name: "collections",
        payload: persisted.proposedCollectionsByProject[projectId] ?? [],
        empty: (persisted.proposedCollectionsByProject[projectId] ?? []).length === 0,
      },
      {
        name: "content",
        payload: persisted.contentByIdByProject[projectId] ?? {},
        empty:
          Object.keys(persisted.contentByIdByProject[projectId] ?? {}).length === 0,
      },
      {
        name: "strategy",
        payload: persisted.strategyByProject?.[projectId] ?? [],
        empty: (persisted.strategyByProject?.[projectId] ?? []).length === 0,
      },
      {
        name: "articles",
        payload: persisted.articlesByProject?.[projectId] ?? {},
        empty:
          Object.keys(persisted.articlesByProject?.[projectId] ?? {}).length === 0,
      },
    ];

    const uploads: Promise<unknown>[] = [];
    for (const { name, payload, empty } of heavySlices) {
      if (empty) continue;
      const fingerprint = fingerprintOf(payload);
      if (previousHashes[name] === fingerprint) continue;
      nextHashes[name] = fingerprint;
      uploads.push(
        saveProjectSliceAdmin(admin, workspaceId, projectId, name, payload).catch(
          (err) => {
            // Drop the fingerprint so the next autosave retries this slice.
            delete nextHashes[name];
            console.error(`[saveMrPersistedState] Failed to save ${name} slice:`, err);
          }
        )
      );
    }
    await Promise.all(uploads);

    // Lightweight control-plane data stays in Postgres: chat, selections, probes
    // (incremental), billing counters and stage flags. Large arrays are omitted.
    const stateForDb: MrProjectStateJson = {
      stage1Done: slice.stage1Done,
      openedMax: slice.openedMax,
      stage: slice.stage,
      chat: slice.chat ?? [],
      stage3Scope: slice.stage3Scope,
      seedSelection: slice.seedSelection,
      probes: slice.probes ?? {},
      clusterSelection: slice.clusterSelection,
      committed: slice.committed,
      workspaceTab: slice.workspaceTab,
      openedWorkspace: slice.openedWorkspace,
      paidCollections: slice.paidCollections,
      contentReady: slice.contentReady,
      pushed: slice.pushed,
      analyzed: slice.analyzed,
      strategyReady: slice.strategyReady,
      strategyApproved: slice.strategyApproved,
      customInstruction: slice.customInstruction,
      extractCharge: slice.extractCharge,
      extractRows: slice.extractRows,
      sliceHashes: nextHashes,
    };

    const keywordsPath = nextHashes.keywords
      ? mrSlicePath(workspaceId, projectId, "keywords")
      : ((existing?.keywords_path as string | null) ?? null);

    const extractRows = Math.max(
      persisted.extractRowsByProject[projectId] ?? 0,
      Number(existing?.extract_rows) || 0
    );
    const extractCharged = Math.max(
      persisted.extractChargeByProject[projectId] ?? 0,
      Number(existing?.extract_charged_usd) || 0
    );

    const payload = {
      id: projectId,
      workspace_id: workspaceId,
      name: project.name.slice(0, 120),
      status: project.status,
      store_label: project.storeLabel,
      highlighted_collection_ids: project.highlightedCollectionIds,
      market: persisted.marketByProject[projectId] || "us-en",
      current_stage: persisted.stageByProject[projectId] ?? 1,
      opened_max_stage: persisted.openedMaxByProject[projectId] ?? 1,
      state: stateForDb,
      keywords_path: keywordsPath,
      extract_rows: extractRows,
      extract_charged_usd: extractCharged,
    };

    const { id, ...updateFields } = payload;

    // Skip the row write when nothing in the control plane moved either, so an
    // idle autosave costs zero writes instead of rewriting every project.
    const rowFingerprint = fingerprintOf({
      ...updateFields,
      state: { ...stateForDb, sliceHashes: undefined },
    });
    if (
      existingById.has(projectId) &&
      uploads.length === 0 &&
      previousHashes.__row === rowFingerprint
    ) {
      continue;
    }
    nextHashes.__row = rowFingerprint;

    const { error } = existingById.has(projectId)
      ? await admin.from("mr_projects").update(updateFields).eq("id", id)
      : await admin.from("mr_projects").insert({
          ...payload,
          created_by: userId,
        });
    if (error) throw error;
  }

  const incomingIds = new Set(persisted.projects.map((project) => project.id));
  const orphanIds = [...existingById.keys()].filter((id) => !incomingIds.has(id));

  const active =
    persisted.projects.some((project) => project.id === persisted.activeProjectId)
      ? persisted.activeProjectId
      : persisted.projects[0]?.id ?? null;

  const { error: prefsError } = await admin.from("mr_workspace_prefs").upsert({
    workspace_id: workspaceId,
    active_project_id: active || null,
    updated_at: new Date().toISOString(),
  });
  if (prefsError) throw prefsError;

  if (orphanIds.length > 0) {
    // Delete orphan projects from database and clean their storage folders
    await Promise.all(
      orphanIds.map((orphanId) =>
        deleteProjectStorageFolder(admin, workspaceId, orphanId).catch((err) =>
          console.error("[saveMrPersistedState] Cleanup orphan storage failed:", err)
        )
      )
    );

    const { error: deleteError } = await admin
      .from("mr_projects")
      .delete()
      .eq("workspace_id", workspaceId)
      .in("id", orphanIds);
    if (deleteError) throw deleteError;
  }
}

export async function createMrProjectRow(
  admin: PersistAdmin,
  input: {
    workspaceId: string;
    userId: string;
    name: string;
    storeLabel: string;
    highlightedCollectionIds: string[];
  }
): Promise<{ id: string; name: string }> {
  const id = crypto.randomUUID();
  const { error } = await admin.from("mr_projects").insert({
    id,
    workspace_id: input.workspaceId,
    created_by: input.userId,
    name: input.name.slice(0, 120),
    status: "active",
    store_label: input.storeLabel,
    highlighted_collection_ids: input.highlightedCollectionIds,
    market: "us-en",
    current_stage: 1,
    opened_max_stage: 1,
    state: { stage1Done: false, openedMax: 1, stage: 1, chat: [] },
  });
  if (error) throw error;
  await admin.from("mr_workspace_prefs").upsert({
    workspace_id: input.workspaceId,
    active_project_id: id,
    updated_at: new Date().toISOString(),
  });
  return { id, name: input.name.slice(0, 120) };
}

export async function getMrProject(
  admin: PersistAdmin,
  workspaceId: string,
  projectId: string
) {
  const { data, error } = await admin
    .from("mr_projects")
    .select("id, workspace_id, name")
    .eq("workspace_id", workspaceId)
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function deleteMrProjectRow(
  admin: PersistAdmin,
  workspaceId: string,
  projectId: string
): Promise<boolean> {
  // 1. Clean up storage folder
  await deleteProjectStorageFolder(admin, workspaceId, projectId);

  // 2. Delete row from database
  const { data, error } = await admin
    .from("mr_projects")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", projectId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}
