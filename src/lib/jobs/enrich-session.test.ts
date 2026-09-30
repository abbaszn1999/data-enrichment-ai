import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectRow } from "@/lib/storage-helpers";
import type { EnrichRowOutcome } from "./enrich-row";
import type { CatalogProcessRow } from "./enrich-session";

const control = vi.hoisted(() => ({ stop: false, superseded: false }));
const repo = vi.hoisted(() => ({
  loadJobRun: vi.fn(),
  markJobRunning: vi.fn(),
  finishJobRun: vi.fn(async (_admin: unknown, id: string, patch: Record<string, unknown>) => ({ id, ...patch })),
  readJobControl: vi.fn(async () => ({ stop: control.stop, superseded: control.superseded })),
  touchJobHeartbeat: vi.fn(),
}));
const project = vi.hoisted(() => ({ current: null as null | { rows: ProjectRow[]; columns: string[] } }));
const chargeCatalogRow = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })));
const saveProjectJsonAdmin = vi.hoisted(() => vi.fn());

vi.mock("./repo", () => repo);
vi.mock("./guard", () => ({ runJobWithFailureGuard: (_id: string, fn: () => Promise<void>) => fn() }));
vi.mock("./notify", () => ({ notifyJobEvent: vi.fn() }));
vi.mock("./project-json", () => ({
  loadProjectJsonAdmin: vi.fn(async () => project.current),
  saveProjectJsonAdmin,
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
const { IMAGE_FINDER_ROW_TIMEOUT_SECONDS } = await import("./config");

const makeRow = (id: string, rowIndex: number): ProjectRow =>
  ({ id, rowIndex, originalData: { Code: `CODE${rowIndex}` }, enrichedData: {}, status: "pending" }) as unknown as ProjectRow;

beforeEach(() => {
  control.stop = false;
  control.superseded = false;
});

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
      expect.objectContaining({ status: "failed", lastError: PROVIDER_UNAVAILABLE_JOB_ERROR, completedCount: 1, failedCount: 0 }),
      expect.objectContaining({ onlyIfActive: true })
    );
  });
});

describe("runEnrichSession charges exactly what OpenAI billed, whatever the outcome", () => {
  const billed = { credits: 1.25, cost: 0.125, tokens: 900, billedAttempts: 2 };

  beforeEach(() => {
    vi.clearAllMocks();
    project.current = { rows: [makeRow("r1", 1)], columns: ["Code"] };
    repo.loadJobRun.mockResolvedValue({
      id: "run-1",
      kind: "catalog",
      status: "queued",
      workspace_id: "w",
      session_id: "s",
      target_ids: ["r1"],
      settings: {
        kind: "product",
        enabledColumns: ["imageUrls"],
        enrichmentColumns: [{ id: "imageUrls", label: "Image URLs", description: "", type: "imageUrls" }],
        enrichmentModel: "standard",
        sourceColumns: ["Code"],
        ownerUserId: "o",
        actorUserId: "a",
      },
    });
  });

  const run = (outcome: EnrichRowOutcome) =>
    runEnrichSession("run-1", { processRow: vi.fn<CatalogProcessRow>(async () => outcome) });

  it("charges a failed row for the attempts OpenAI billed and says so on the row", async () => {
    await run({ ok: false, rowId: "r1", error: "OpenAI enrich returned no parseable JSON output", billed });
    expect(chargeCatalogRow).toHaveBeenCalledTimes(1);
    expect(chargeCatalogRow).toHaveBeenCalledWith(
      expect.objectContaining({ rowId: "r1", credits: 1.25, cost: 0.125, tokens: 900, billedAttempts: 2, unfinished: true, recheck: false })
    );
    const row = project.current!.rows[0]!;
    expect(row.status).toBe("error");
    expect(row.errorMessage).toBe(
      "OpenAI enrich returned no parseable JSON output (1.25 credits charged for the AI work already done)"
    );
  });

  it("charges a stopped row for what was billed and leaves it pending", async () => {
    await run({ ok: false, rowId: "r1", error: "Cancelled by user", cancelled: true, billed });
    expect(chargeCatalogRow).toHaveBeenCalledWith(expect.objectContaining({ credits: 1.25, unfinished: true }));
    expect(project.current!.rows[0]!.status).toBe("pending");
  });

  it("charges rounds billed before the provider account ran out, and leaves the row pending", async () => {
    await run({ ok: false, rowId: "r1", error: PROVIDER_UNAVAILABLE_JOB_ERROR, providerUnavailable: true, billed });
    expect(chargeCatalogRow).toHaveBeenCalledWith(expect.objectContaining({ credits: 1.25, unfinished: true }));
    expect(project.current!.rows[0]!.status).toBe("pending");
  });

  it("charges nothing when OpenAI billed nothing", async () => {
    await run({ ok: false, rowId: "r1", error: "fetch failed" });
    expect(chargeCatalogRow).not.toHaveBeenCalled();
    expect(project.current!.rows[0]!.errorMessage).toBe("fetch failed");
  });

  it("pauses the job when the customer has no credits left to pay for a failed row's billed work", async () => {
    chargeCatalogRow.mockResolvedValueOnce({ ok: false, noCredits: true, error: "Insufficient credits" } as never);
    await run({ ok: false, rowId: "r1", error: "OpenAI enrich returned no parseable JSON output", billed });
    expect(repo.finishJobRun).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ status: "paused_no_credits" }),
      expect.objectContaining({ onlyIfActive: true })
    );
  });

  it("keeps and saves a finished row whose charge could only be paid in part, then pauses the job", async () => {
    project.current = { rows: [makeRow("r1", 1)], columns: ["Code"] };
    chargeCatalogRow.mockResolvedValueOnce({
      ok: true,
      remaining: 0,
      outOfCredits: { fullCredits: 1.25, chargedCredits: 0.4 },
    } as never);
    await run({
      ok: true,
      rowId: "r1",
      data: { imageUrls: [{ imageUrl: "https://cdn.test/a.jpg", pageUrl: "https://shop.test/p", title: "t" }] },
      originalPatches: {},
      ...billed,
    });

    const row = project.current!.rows[0]!;
    expect(row.status).toBe("done");
    expect(row.enrichedData.imageUrls).toHaveLength(1);
    expect(repo.finishJobRun).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ status: "paused_no_credits" }),
      expect.objectContaining({ onlyIfActive: true })
    );
  });
});

describe("runEnrichSession lifecycle guarantees", () => {
  const settings = {
    kind: "product",
    enabledColumns: ["imageUrls"],
    enrichmentColumns: [{ id: "imageUrls", label: "Image URLs", description: "", type: "imageUrls" }],
    enrichmentModel: "standard",
    sourceColumns: ["Code"],
    ownerUserId: "o",
    actorUserId: "a",
  };
  const ok = (rowId: string): EnrichRowOutcome => ({
    ok: true,
    rowId,
    data: { imageUrls: [] },
    originalPatches: {},
    credits: 1,
    cost: 0.1,
    tokens: 10,
    billedAttempts: 1,
  });
  const setup = (count: number, extraSettings: Record<string, unknown> = {}) => {
    vi.clearAllMocks();
    const rows = Array.from({ length: count }, (_, i) => makeRow(`r${i + 1}`, i + 1));
    project.current = { rows, columns: ["Code"] };
    repo.loadJobRun.mockResolvedValue({
      id: "run-1",
      kind: "catalog",
      status: "running",
      workspace_id: "w",
      session_id: "s",
      target_ids: rows.map((row) => row.id),
      settings: { ...settings, ...extraSettings },
    });
    return rows;
  };

  it("Stop starts no new row, lets in-flight rows finish, saves and charges them, then ends the run cancelled", async () => {
    const rows = setup(10);
    // Stop lands while the first rows are already with the AI.
    const processRow = vi.fn<CatalogProcessRow>(async (rowId) => {
      control.stop = true;
      return ok(rowId);
    });
    await runEnrichSession("run-1", { processRow });

    const started = processRow.mock.calls.map(([id]) => id);
    expect(started.length).toBeGreaterThan(0);
    expect(started.length).toBeLessThan(rows.length);
    for (const id of started) {
      expect(rows.find((row) => row.id === id)?.status).toBe("done");
    }
    expect(rows.filter((row) => row.status === "pending")).toHaveLength(rows.length - started.length);
    expect(chargeCatalogRow).toHaveBeenCalledTimes(started.length);
    expect(repo.finishJobRun).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ status: "cancelled", completedCount: started.length }),
      expect.objectContaining({ onlyIfActive: true })
    );
  });

  it("a worker that lost the run to a resumed one writes nothing and never finishes it", async () => {
    setup(3);
    control.superseded = true;
    const processRow = vi.fn<CatalogProcessRow>(async (rowId) => ok(rowId));
    await runEnrichSession("run-1", { processRow });
    expect(processRow).not.toHaveBeenCalled();
    expect(repo.finishJobRun).not.toHaveBeenCalled();
    expect(saveProjectJsonAdmin).not.toHaveBeenCalled();
  });

  it("one row that throws becomes a failed row instead of killing the run", async () => {
    const rows = setup(3);
    const processRow = vi.fn<CatalogProcessRow>(async (rowId) => {
      if (rowId === "r2") throw new Error("row task exhausted its retries");
      return ok(rowId);
    });
    await runEnrichSession("run-1", { processRow });
    expect(rows.map((row) => row.status)).toEqual(["done", "error", "done"]);
    expect(rows[1]!.errorMessage).toBe("row task exhausted its retries");
    expect(repo.finishJobRun).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ status: "completed", completedCount: 2, failedCount: 1 }),
      expect.anything()
    );
  });

  it("a row that hangs is failed at the row limit instead of freezing the whole job", async () => {
    vi.useFakeTimers();
    try {
      const rows = setup(2);
      repo.touchJobHeartbeat.mockResolvedValue(null);
      // Rows now share the session's process, so nothing else would ever end
      // a row that never comes back — and the heartbeat keeps the run "alive".
      const processRow = vi.fn<CatalogProcessRow>((rowId) =>
        rowId === "r1" ? new Promise<EnrichRowOutcome>(() => undefined) : Promise.resolve(ok(rowId))
      );
      const finished = runEnrichSession("run-1", { processRow });
      await vi.advanceTimersByTimeAsync(IMAGE_FINDER_ROW_TIMEOUT_SECONDS * 1000);
      await finished;

      expect(rows.map((row) => row.status)).toEqual(["error", "done"]);
      expect(rows[0]!.errorMessage).toContain("took too long");
      expect(repo.finishJobRun).toHaveBeenCalledWith(
        expect.anything(),
        "run-1",
        expect.objectContaining({ status: "completed", completedCount: 1, failedCount: 1 }),
        expect.anything()
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("a resumed run skips rows it already finished, so OpenAI never bills them twice", async () => {
    const rows = setup(3, { processedRowIds: ["r1"] });
    rows[0]!.status = "done";
    const processRow = vi.fn<CatalogProcessRow>(async (rowId) => ok(rowId));
    await runEnrichSession("run-1", { processRow });
    expect(processRow.mock.calls.map(([id]) => id).sort()).toEqual(["r2", "r3"]);
    expect(repo.finishJobRun).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ status: "completed", completedCount: 3 }),
      expect.anything()
    );
  });

  it("claims the run under a worker token and fences every progress write with it", async () => {
    setup(1);
    await runEnrichSession("run-1", { processRow: vi.fn<CatalogProcessRow>(async (rowId) => ok(rowId)) });
    const token = repo.markJobRunning.mock.calls[0]![3];
    expect(typeof token).toBe("string");
    for (const call of repo.touchJobHeartbeat.mock.calls) {
      expect(call[3]).toBe(token);
    }
    expect(repo.finishJobRun).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.anything(),
      { workerToken: token, onlyIfActive: true }
    );
  });
});

describe("Image Finder final re-check pass", () => {
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

  it("runs it for every Image Finder run, whatever tier setting was saved (there is no tier to pick)", async () => {
    const processRow = await runWithTier("standard");
    const recheckCalls = processRow.mock.calls.filter(([, context]) => context.recheck === true);
    expect(recheckCalls.map(([id]) => id)).toEqual(["r3"]);
  });
});
