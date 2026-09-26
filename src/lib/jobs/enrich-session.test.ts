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
