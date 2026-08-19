import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deleteProjectStorageFolder,
  listExtractChunkPathsAdmin,
  loadExtractRowsAdmin,
  saveExtractChunkAdmin,
  type MrExtractChunk,
} from "./storage-admin";
import type { KeywordRow } from "./providers/keyword-provider";

const workspaceId = "ws-1";
const projectId = "proj-1";
const projectPrefix = `${workspaceId}/market-research/${projectId}`;

type StoredFiles = Record<string, unknown>;

/**
 * Storage stub that mimics Supabase's flat keys with folder-style listing:
 * objects carry an id, synthetic folders come back with id null.
 */
function makeStorageStub(files: StoredFiles) {
  const store = new Map(Object.entries(files));
  const removed: string[] = [];
  const uploaded: Array<{ path: string; body: unknown }> = [];

  const storage = {
    from: () => ({
      list: (
        prefix: string,
        options?: { limit?: number; offset?: number }
      ) => {
        const base = prefix.endsWith("/") ? prefix : `${prefix}/`;
        const names = new Map<string, boolean>();
        for (const key of store.keys()) {
          if (!key.startsWith(base)) continue;
          const rest = key.slice(base.length);
          const slash = rest.indexOf("/");
          if (slash === -1) names.set(rest, true);
          else names.set(rest.slice(0, slash), false);
        }
        const all = [...names.entries()].map(([name, isFile]) => ({
          name,
          id: isFile ? `id-${name}` : null,
        }));
        const offset = options?.offset ?? 0;
        const limit = options?.limit ?? all.length;
        return Promise.resolve({
          data: all.slice(offset, offset + limit),
          error: null,
        });
      },
      remove: (paths: string[]) => {
        for (const path of paths) {
          store.delete(path);
          removed.push(path);
        }
        return Promise.resolve({ error: null });
      },
      upload: (path: string, blob: Blob) => {
        uploaded.push({ path, body: blob });
        return blob.text().then((text) => {
          store.set(path, JSON.parse(text));
          return { error: null };
        });
      },
      download: (path: string) => {
        if (!store.has(path)) {
          return Promise.resolve({
            data: null,
            error: { message: "Object not found" },
          });
        }
        const payload = JSON.stringify(store.get(path));
        return Promise.resolve({
          data: { text: () => Promise.resolve(payload) },
          error: null,
        });
      },
    }),
  };

  return {
    admin: { storage } as unknown as SupabaseClient,
    removed,
    uploaded,
    store,
  };
}

function keywordRow(phrase: string, volume: number, seed: string): KeywordRow {
  return {
    phrase,
    database: "us",
    volume,
    cpc: 0,
    competitionLevel: 0,
    difficulty: 0,
    results: 0,
    intents: [],
    serpFeatures: [],
    trends: [],
    seed,
  };
}

function chunk(rows: KeywordRow[], seedTerm: string): MrExtractChunk {
  return {
    extractId: "ext-1",
    runId: "run-1",
    seedId: "seed-1",
    seedTerm,
    offset: "0",
    rowCount: rows.length,
    savedAt: "2026-08-18T10:00:00.000Z",
    rows,
  };
}

describe("deleteProjectStorageFolder", () => {
  it("removes deeply nested extract chunks, not just top-level slices", async () => {
    const { admin, removed } = makeStorageStub({
      [`${projectPrefix}/catalog.json`]: {},
      [`${projectPrefix}/keywords.json`]: [],
      [`${projectPrefix}/extracts/ext-1/run-1/0.json`]: chunk([], "Tablets"),
      [`${projectPrefix}/extracts/ext-1/run-1/100.json`]: chunk([], "Tablets"),
      [`${projectPrefix}/extracts/ext-2/run-9/0.json`]: chunk([], "Laptops"),
    });

    const count = await deleteProjectStorageFolder(admin, workspaceId, projectId);

    expect(count).toBe(5);
    expect(removed).toContain(`${projectPrefix}/extracts/ext-1/run-1/100.json`);
    expect(removed).toContain(`${projectPrefix}/extracts/ext-2/run-9/0.json`);
    expect(removed).toContain(`${projectPrefix}/catalog.json`);
  });

  it("pages past the list limit so large archives are fully cleaned", async () => {
    const files: StoredFiles = {};
    for (let i = 0; i < 250; i += 1) {
      files[`${projectPrefix}/extracts/ext-1/run-1/${i * 100}.json`] = chunk(
        [],
        "Tablets"
      );
    }
    const { admin, removed } = makeStorageStub(files);

    const count = await deleteProjectStorageFolder(admin, workspaceId, projectId);

    expect(count).toBe(250);
    expect(removed).toHaveLength(250);
  });

  it("leaves other projects in the same workspace untouched", async () => {
    const { admin, store } = makeStorageStub({
      [`${projectPrefix}/catalog.json`]: {},
      [`${workspaceId}/market-research/proj-2/catalog.json`]: {},
    });

    await deleteProjectStorageFolder(admin, workspaceId, projectId);

    expect(store.has(`${workspaceId}/market-research/proj-2/catalog.json`)).toBe(
      true
    );
  });
});

describe("extract chunk archive", () => {
  it("writes a self-describing chunk that names the seed term and run", async () => {
    const { admin, store } = makeStorageStub({});

    const path = await saveExtractChunkAdmin(admin, {
      workspaceId,
      projectId,
      extractId: "ext-1",
      runId: "X325mHEl4RzsOrxQ7",
      seedId: "seed-42",
      seedTerm: "Digital tablets with pen",
      offset: "0",
      rows: [keywordRow("digital art tablets with pen", 20, "Digital tablets with pen")],
    });

    expect(path).toBe(
      `${projectPrefix}/extracts/ext-1/X325mHEl4RzsOrxQ7/0.json`
    );
    const saved = store.get(path!) as MrExtractChunk;
    expect(saved.runId).toBe("X325mHEl4RzsOrxQ7");
    expect(saved.seedTerm).toBe("Digital tablets with pen");
    expect(saved.seedId).toBe("seed-42");
    expect(saved.rowCount).toBe(1);
    // The old shape stored the runId under `seed`, which read as a seed term.
    expect("seed" in saved).toBe(false);
  });

  it("skips empty chunks", async () => {
    const { admin, uploaded } = makeStorageStub({});
    const path = await saveExtractChunkAdmin(admin, {
      workspaceId,
      projectId,
      extractId: "ext-1",
      runId: "run-1",
      seedId: "seed-1",
      seedTerm: "Tablets",
      offset: "0",
      rows: [],
    });
    expect(path).toBeNull();
    expect(uploaded).toHaveLength(0);
  });

  it("merges every chunk, dedupes by phrase keeping the richer metric, and sorts by volume", async () => {
    const { admin } = makeStorageStub({
      [`${projectPrefix}/extracts/ext-1/run-1/0.json`]: chunk(
        [
          keywordRow("cheap tablets", 500, "Tablets"),
          keywordRow("stylus tablet", 90, "Tablets"),
        ],
        "Tablets"
      ),
      [`${projectPrefix}/extracts/ext-1/run-2/0.json`]: chunk(
        [
          // Same phrase from another seed with a better volume.
          keywordRow("Stylus Tablet", 140, "Stylus tablets"),
          keywordRow("drawing tablet", 3000, "Stylus tablets"),
        ],
        "Stylus tablets"
      ),
    });

    const rows = await loadExtractRowsAdmin(admin, workspaceId, projectId);

    expect(rows.map((row) => row.phrase)).toEqual([
      "drawing tablet",
      "cheap tablets",
      "Stylus Tablet",
    ]);
    expect(rows.find((row) => row.phrase === "Stylus Tablet")?.volume).toBe(140);
  });

  it("scopes the export to one extract when an id is given", async () => {
    const { admin } = makeStorageStub({
      [`${projectPrefix}/extracts/ext-1/run-1/0.json`]: chunk(
        [keywordRow("tablets", 100, "Tablets")],
        "Tablets"
      ),
      [`${projectPrefix}/extracts/ext-2/run-2/0.json`]: chunk(
        [keywordRow("laptops", 200, "Laptops")],
        "Laptops"
      ),
    });

    const paths = await listExtractChunkPathsAdmin(
      admin,
      workspaceId,
      projectId,
      "ext-2"
    );
    const rows = await loadExtractRowsAdmin(
      admin,
      workspaceId,
      projectId,
      "ext-2"
    );

    expect(paths).toEqual([`${projectPrefix}/extracts/ext-2/run-2/0.json`]);
    expect(rows.map((row) => row.phrase)).toEqual(["laptops"]);
  });

  it("returns an empty export when nothing was archived", async () => {
    const { admin } = makeStorageStub({});
    await expect(
      loadExtractRowsAdmin(admin, workspaceId, projectId)
    ).resolves.toEqual([]);
  });
});
