import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { KeywordDataProvider } from "./providers/keyword-provider";
import {
  EXTRACT_MAX_AGE_MS,
  advanceMrExtract,
  isExtractTimedOut,
  nextStoredCursor,
  pollStatusForStore,
  seedIsFinished,
  settleStatusFromSeeds,
} from "./extract-advance";

vi.mock("./wallet-ops", () => ({
  settleExtractBilling: vi.fn(async () => ({ actualUsd: 0.42 })),
}));

vi.mock("./storage-admin", () => ({
  saveExtractChunkAdmin: vi.fn(async () => undefined),
  loadExtractRowsAdmin: vi.fn(async () => []),
  saveProjectSliceAdmin: vi.fn(async () => undefined),
}));

const header = {
  id: "11111111-1111-4111-8111-111111111111",
  workspace_id: "22222222-2222-4222-8222-222222222222",
  project_id: "33333333-3333-4333-8333-333333333333",
  created_by: "user-1",
  held_usd: 1,
  actual_usd: 0,
  rows_returned: 0,
  billing_status: "held",
  status: "running",
  created_at: new Date().toISOString(),
  job_run_id: "job-1",
};

const runningSeed = {
  id: "run-1",
  seed_id: "seed-1",
  seed_term: "sunglasses",
  apify_run_id: "apify-1",
  dataset_id: "ds-1",
  pages: 2,
  status: "running" as const,
  rows_returned: 250,
  next_cursor: "250",
};

function mockAdmin(options: {
  leaseAcquired: boolean;
  run?: typeof runningSeed;
}) {
  const providerCalls: Array<string | undefined> = [];
  const run = options.run ?? runningSeed;

  const admin = {
    from(table: string) {
      let didUpdate = false;
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.or = () => builder;
      builder.update = () => {
        didUpdate = true;
        return builder;
      };
      builder.maybeSingle = async () => {
        if (table !== "mr_extracts") return { data: null, error: null };
        if (didUpdate) {
          return {
            data: options.leaseAcquired ? { id: header.id } : null,
            error: null,
          };
        }
        return { data: header, error: null };
      };
      builder.then = (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown
      ) => {
        try {
          if (table === "mr_runs") {
            return Promise.resolve(
              didUpdate ? { error: null } : { data: [run], error: null }
            ).then(resolve, reject);
          }
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        } catch (error) {
          if (reject) return Promise.reject(error).then(resolve, reject);
          throw error;
        }
      };
      return builder;
    },
  } as unknown as SupabaseClient;

  const provider: KeywordDataProvider = {
    fetchSeedMetrics: async () => [],
    startKeywordIdeas: async () => ({
      runId: "apify-1",
      seed: "sunglasses",
      database: "us",
      pages: 2,
    }),
    pollKeywordIdeas: async (_handle, cursor) => {
      providerCalls.push(cursor);
      return {
        status: "succeeded",
        rows: [],
        nextCursor: undefined,
      };
    },
    abortKeywordIdeas: async () => undefined,
  };

  return { admin, provider, providerCalls };
}

describe("extract advance helpers", () => {
  it("treats succeeded seeds without a cursor as finished", () => {
    expect(seedIsFinished("succeeded")).toBe(true);
    expect(seedIsFinished("succeeded", "250")).toBe(false);
    expect(seedIsFinished("failed")).toBe(true);
    expect(seedIsFinished("aborted")).toBe(true);
    expect(seedIsFinished("running", "250")).toBe(false);
  });

  it("stores the next Apify offset until the dataset is exhausted", () => {
    expect(nextStoredCursor({ status: "running", nextCursor: "250" })).toBe("250");
    expect(nextStoredCursor({ status: "succeeded", nextCursor: "500" })).toBe("500");
    expect(nextStoredCursor({ status: "succeeded" })).toBeNull();
    expect(nextStoredCursor({ status: "failed", nextCursor: "250" })).toBeNull();
  });

  it("keeps a succeeded poll in running while a cursor remains", () => {
    expect(
      pollStatusForStore({ status: "succeeded", nextCursor: "250" })
    ).toBe("running");
    expect(pollStatusForStore({ status: "succeeded" })).toBe("succeeded");
    expect(pollStatusForStore({ status: "running" })).toBe("running");
  });

  it("settles as aborted when any seed was cancelled", () => {
    expect(
      settleStatusFromSeeds([{ status: "succeeded" }, { status: "aborted" }])
    ).toBe("aborted");
    expect(settleStatusFromSeeds([{ status: "aborted" }])).toBe("aborted");
    expect(
      settleStatusFromSeeds([{ status: "failed" }, { status: "failed" }])
    ).toBe("failed");
    expect(
      settleStatusFromSeeds([{ status: "succeeded" }, { status: "failed" }])
    ).toBe("succeeded");
  });

  it("times extracts out after 24 hours", () => {
    const now = Date.parse("2026-09-03T12:00:00.000Z");
    expect(isExtractTimedOut(new Date(now - EXTRACT_MAX_AGE_MS - 1).toISOString(), now)).toBe(
      true
    );
    expect(isExtractTimedOut(new Date(now - 60_000).toISOString(), now)).toBe(false);
    expect(isExtractTimedOut("not-a-date", now)).toBe(false);
  });
});

describe("advanceMrExtract", () => {
  it("skips Apify when another pump holds the lease", async () => {
    const { admin, provider, providerCalls } = mockAdmin({ leaseAcquired: false });
    const result = await advanceMrExtract(admin, {
      workspaceId: header.workspace_id,
      projectId: header.project_id,
      extractId: header.id,
      userId: header.created_by,
      provider,
    });
    expect(result.leased).toBe(false);
    expect(result.seeds[0]?.rows).toEqual([]);
    expect(result.seeds[0]?.rowsReturned).toBe(250);
    expect(providerCalls).toEqual([]);
  });

  it("advances from the stored cursor, not a stale client cursor", async () => {
    const { admin, provider, providerCalls } = mockAdmin({ leaseAcquired: true });
    await advanceMrExtract(admin, {
      workspaceId: header.workspace_id,
      projectId: header.project_id,
      extractId: header.id,
      userId: header.created_by,
      provider,
      clientCursors: [{ seedId: "seed-1", cursor: "0" }],
    });
    expect(providerCalls).toEqual(["250"]);
  });
});
