import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectRow } from "@/lib/storage-helpers";
import type { EnrichRowOutcome } from "./enrich-row";
import type { CatalogProcessRow } from "./enrich-session";

const repo = vi.hoisted(() => ({
  loadJobRun: vi.fn(),
  markJobRunning: vi.fn(),
  finishJobRun: vi.fn(async (_admin: unknown, id: string, patch: Record<string, unknown>) => ({ id, ...patch })),
  isJobCancelRequested: vi.fn(async () => false),
  touchJobHeartbeat: vi.fn(),
}));
const project = vi.hoisted(() => ({ current: null as null | { rows: ProjectRow[]; columns: string[] } }));
const chargeCatalogRow = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })));

vi.mock("./repo", () => repo);
vi.mock("./guard", () => ({ runJobWithFailureGuard: (_id: string, fn: () => Promise<void>) => fn() }));
vi.mock("./notify", () => ({ notifyJobEvent: vi.fn() }));
vi.mock("./project-json", () => ({
  loadProjectJsonAdmin: vi.fn(async () => project.current),
  saveProjectJsonAdmin: vi.fn(),
}));
vi.mock("./enrich-row", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./enrich-row")>()),
  chargeCatalogRow,
}));
vi.mock("@/lib/catalog/flag", () => ({ catalogRowStoreEnabled: () => false }));
vi.mock("@/lib/supabase-admin", () => {
  const chain = { update: () => chain, eq: () => chain, then: (resolve: (v: unknown) => void) => resolve({}) };
  return { createAdminClient: () => ({ from: () => chain }) };
});

const { runEnrichSession } = await import("./enrich-session");
const { PROVIDER_UNAVAILABLE_JOB_ERROR } = await import("./enrich-row");

const makeRow = (id: string, rowIndex: number): ProjectRow =>
  ({ id, rowIndex, originalData: { Code: `CODE${rowIndex}` }, enrichedData: {}, status: "pending" }) as unknown as ProjectRow;

describe("runEnrichSession when the AI provider account is unavailable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    project.current = { rows: [makeRow("r1", 1), makeRow("r2", 2), makeRow("r3", 3)], columns: ["Code"] };
    repo.loadJobRun.mockResolvedValue({
      id: "run-1",
      kind: "catalog",
      status: "queued",
      workspace_id: "w",
      session_id: "s",
      target_ids: ["r1", "r2", "r3"],
      settings: {
        kind: "product",
        enabledColumns: ["imageUrls"],
        enrichmentColumns: [{ id: "imageUrls", label: "Image URLs", description: "", type: "imageUrls" }],
        enrichmentModel: "premium",
        sourceColumns: ["Code"],
        ownerUserId: "o",
        actorUserId: "a",
      },
    });
  });

  it("stops, leaves unserved rows pending and uncharged, skips the re-check, and fails with a clear message", async () => {
    const processRow = vi.fn<CatalogProcessRow>(async (rowId): Promise<EnrichRowOutcome> =>
      rowId === "r1"
        ? { ok: true, rowId, data: { imageUrls: [] }, originalPatches: {}, credits: 3, cost: 0.3, tokens: 10, billedAttempts: 1 }
        : { ok: false, rowId, error: PROVIDER_UNAVAILABLE_JOB_ERROR, providerUnavailable: true }
    );

    await runEnrichSession("run-1", { processRow });

    const rows = project.current!.rows;
    expect(rows.find((row) => row.id === "r1")?.status).toBe("done");
    expect(rows.find((row) => row.id === "r2")?.status).toBe("pending");
    expect(rows.find((row) => row.id === "r3")?.status).toBe("pending");
    expect(chargeCatalogRow).toHaveBeenCalledTimes(1);
    expect(processRow.mock.calls.every(([, context]) => !context.recheck)).toBe(true);
    expect(repo.finishJobRun).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ status: "failed", lastError: PROVIDER_UNAVAILABLE_JOB_ERROR, completedCount: 1, failedCount: 0 })
    );
  });
});

describe("Image Finder recheck pass respects the tier", () => {
  const notFoundKey = "imageUrls__notFoundReason";
  const found = (rowId: string, host: string) => ({
    ok: true as const,
    rowId,
    data: { imageUrls: [{ imageUrl: `https://cdn.test/${rowId}.jpg`, pageUrl: `https://${host}/p/${rowId}`, title: "x" }] },
    originalPatches: {},
    credits: 1,
    cost: 0.1,
    tokens: 10,
    billedAttempts: 1,
  });
  const notFound = (rowId: string): EnrichRowOutcome => ({
    ok: true,
    rowId,
    data: { imageUrls: [], [notFoundKey]: "not found on any site" },
    originalPatches: {},
    credits: 1,
    cost: 0.1,
    tokens: 10,
    billedAttempts: 1,
  });

  function runWithTier(enrichmentModel: "standard" | "premium") {
    vi.clearAllMocks();
    project.current = { rows: [makeRow("r1", 1), makeRow("r2", 2), makeRow("r3", 3)], columns: ["Code"] };
    repo.loadJobRun.mockResolvedValue({
      id: "run-1",
      kind: "catalog",
      status: "queued",
      workspace_id: "w",
      session_id: "s",
      target_ids: ["r1", "r2", "r3"],
      settings: {
        kind: "product",
        enabledColumns: ["imageUrls"],
        enrichmentColumns: [{ id: "imageUrls", label: "Image URLs", description: "", type: "imageUrls" }],
        enrichmentModel,
        sourceColumns: ["Code"],
        ownerUserId: "o",
        actorUserId: "a",
      },
    });
    // r1 and r2 both verify on store.test — enough for the learner to treat it
    // as a strong lead; r3 comes back Not found, the recheck candidate.
    const processRow = vi.fn<CatalogProcessRow>(async (rowId) =>
      rowId === "r3" ? notFound(rowId) : found(rowId, "store.test")
    );
    return runEnrichSession("run-1", { processRow }).then(() => processRow);
  }

  it("runs the second billed attempt on Premium", async () => {
    const processRow = await runWithTier("premium");
    const recheckCalls = processRow.mock.calls.filter(([, context]) => context.recheck === true);
    expect(recheckCalls).toHaveLength(1);
    expect(recheckCalls[0]![0]).toBe("r3");
    expect(recheckCalls[0]![1].learnedDomains).toEqual(["store.test"]);
  });

  it("never spends the second billed attempt on Standard", async () => {
    const processRow = await runWithTier("standard");
    // Still processed once as the first pass, just never rechecked.
    expect(processRow.mock.calls.filter(([id]) => id === "r3")).toHaveLength(1);
    expect(processRow.mock.calls.some(([, context]) => context.recheck === true)).toBe(false);
  });
});
