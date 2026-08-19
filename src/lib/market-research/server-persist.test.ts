import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emptyMarketResearchState } from "@/components/market-research/persistence";
import { saveMrPersistedState } from "./server-persist";
import type { MrProjectStateJson } from "./project-state";

type StoredRow = {
  id: string;
  extract_rows: number;
  extract_charged_usd: number;
  keywords_path: string | null;
  state: MrProjectStateJson;
};

/** Minimal Supabase stub that records writes so we can assert autosave stays quiet. */
function makeAdminStub(rows: StoredRow[]) {
  const uploadedPaths: string[] = [];
  const rowUpdates: Record<string, unknown>[] = [];
  const rowInserts: Record<string, unknown>[] = [];

  function tableBuilder(table: string) {
    let op = "select";
    let payload: Record<string, unknown> = {};

    const builder = {
      select: () => builder,
      order: () => builder,
      eq: () => builder,
      in: () => builder,
      maybeSingle: () => builder,
      update: (fields: Record<string, unknown>) => {
        op = "update";
        payload = fields;
        return builder;
      },
      insert: (fields: Record<string, unknown>) => {
        op = "insert";
        payload = fields;
        return builder;
      },
      upsert: () => {
        op = "upsert";
        return builder;
      },
      delete: () => {
        op = "delete";
        return builder;
      },
      then: (resolve: (value: unknown) => unknown) => {
        if (table === "mr_projects") {
          if (op === "update") rowUpdates.push(payload);
          if (op === "insert") rowInserts.push(payload);
          if (op === "select") return resolve({ data: rows, error: null });
        }
        return resolve({ data: null, error: null });
      },
    };
    return builder;
  }

  const admin = {
    from: (table: string) => tableBuilder(table),
    storage: {
      from: () => ({
        upload: (path: string) => {
          uploadedPaths.push(path);
          return Promise.resolve({ error: null });
        },
        download: () =>
          Promise.resolve({ data: null, error: { message: "Object not found" } }),
        list: () => Promise.resolve({ data: [], error: null }),
        remove: () => Promise.resolve({ error: null }),
      }),
    },
  } as unknown as SupabaseClient;

  return { admin, uploadedPaths, rowUpdates, rowInserts };
}

const workspaceId = "22222222-2222-4222-8222-222222222222";
const projectId = "11111111-1111-4111-8111-111111111111";
const userId = "33333333-3333-4333-8333-333333333333";

function stateWithKeywords() {
  const persisted = emptyMarketResearchState();
  persisted.projects = [
    {
      id: projectId,
      name: "Eyewear",
      status: "active",
      storeLabel: "Store",
      highlightedCollectionIds: ["sunglasses"],
    },
  ];
  persisted.activeProjectId = projectId;
  persisted.keywordsByProject[projectId] = [
    {
      id: "k1",
      seedId: "s1",
      seed: "sunglasses",
      keyword: "buy sunglasses",
      volume: 100,
      difficulty: 12,
      wordCount: 2,
      isQuestion: false,
      sheet: "category",
      productMatches: 0,
      weight: 1,
    },
  ];
  persisted.probesByProject[projectId] = {
    s1: {
      seedId: "s1",
      market: "us-en",
      rawKeywords: 300,
      searchVolume: 1200,
      sampleKeywords: ["cheap sunglasses"],
      checkedAt: 1,
    },
  };
  return persisted;
}

describe("saveMrPersistedState storage routing", () => {
  it("uploads heavy slices and keeps probes plus chat in the row", async () => {
    const existingRow: StoredRow = {
      id: projectId,
      extract_rows: 0,
      extract_charged_usd: 0,
      keywords_path: null,
      state: {},
    };
    const { admin, uploadedPaths, rowUpdates } = makeAdminStub([existingRow]);

    await saveMrPersistedState(admin, workspaceId, userId, stateWithKeywords());

    expect(uploadedPaths).toContain(
      `${workspaceId}/market-research/${projectId}/keywords.json`
    );
    expect(rowUpdates).toHaveLength(1);

    const savedState = rowUpdates[0]!.state as MrProjectStateJson;
    // Probes are incremental, so they stay queryable in Postgres.
    expect(Object.keys(savedState.probes ?? {})).toEqual(["s1"]);
    expect(savedState.chat).toEqual([]);
    // Heavy arrays must never be duplicated into the row.
    expect(savedState.keywords).toBeUndefined();
    expect(savedState.niches).toBeUndefined();
    expect(savedState.proposedCollections).toBeUndefined();
    expect(savedState.contentById).toBeUndefined();
  });

  it("skips every write when an autosave repeats unchanged state", async () => {
    const existingRow: StoredRow = {
      id: projectId,
      extract_rows: 0,
      extract_charged_usd: 0,
      keywords_path: null,
      state: {},
    };
    const first = makeAdminStub([existingRow]);
    await saveMrPersistedState(first.admin, workspaceId, userId, stateWithKeywords());

    const persistedRow: StoredRow = {
      ...existingRow,
      state: first.rowUpdates[0]!.state as MrProjectStateJson,
      keywords_path: first.rowUpdates[0]!.keywords_path as string | null,
    };
    const second = makeAdminStub([persistedRow]);
    await saveMrPersistedState(second.admin, workspaceId, userId, stateWithKeywords());

    expect(second.uploadedPaths).toEqual([]);
    expect(second.rowUpdates).toEqual([]);
  });

  it("re-uploads only the slice that actually changed", async () => {
    const existingRow: StoredRow = {
      id: projectId,
      extract_rows: 0,
      extract_charged_usd: 0,
      keywords_path: null,
      state: {},
    };
    const first = makeAdminStub([existingRow]);
    await saveMrPersistedState(first.admin, workspaceId, userId, stateWithKeywords());

    const persistedRow: StoredRow = {
      ...existingRow,
      state: first.rowUpdates[0]!.state as MrProjectStateJson,
      keywords_path: first.rowUpdates[0]!.keywords_path as string | null,
    };

    const changed = stateWithKeywords();
    changed.proposedCollectionsByProject[projectId] = [
      {
        id: "col-1",
        name: "Stylus Tablets",
        headKeyword: "stylus tablets",
        parentNiche: "Electronics",
        volume: 100,
        difficulty: 10,
        productCount: 5,
        keywordCount: 1,
        status: "new",
      },
    ];

    const second = makeAdminStub([persistedRow]);
    await saveMrPersistedState(second.admin, workspaceId, userId, changed);

    expect(second.uploadedPaths).toEqual([
      `${workspaceId}/market-research/${projectId}/collections.json`,
    ]);
    expect(second.rowUpdates).toHaveLength(1);
  });
});
