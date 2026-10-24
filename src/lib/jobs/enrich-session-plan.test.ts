import { beforeEach, describe, expect, it, vi } from "vitest";
import { calculateOpenAiWebSearchCost, costToCredits } from "@/lib/ai-pricing";
import type { SourceUrlsPlan } from "@/lib/enrich/source-urls/plan";
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
const planSourceUrls = vi.hoisted(() => vi.fn());
const settleProviderUsage = vi.hoisted(() => vi.fn());

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
vi.mock("./credits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./credits")>()),
  settleProviderUsage,
}));
vi.mock("@/lib/enrich/source-urls/planner", () => ({ planSourceUrls }));
vi.mock("@/lib/catalog/flag", () => ({ catalogRowStoreEnabled: () => false }));
vi.mock("@/lib/supabase-admin", () => {
  const chain = { update: () => chain, eq: () => chain, then: (resolve: (v: unknown) => void) => resolve({}) };
  return { createAdminClient: () => ({ from: () => chain }) };
});

const { runEnrichSession } = await import("./enrich-session");

const makeRow = (id: string, rowIndex: number): ProjectRow =>
  ({ id, rowIndex, originalData: { Barcode: `BC${rowIndex}` }, enrichedData: {}, status: "pending" }) as unknown as ProjectRow;

const call = calculateOpenAiWebSearchCost("gpt-6.1-sol", { input_tokens: 4_000, output_tokens: 1_000 }, 0);

const billing = { credits: 0.2, cost: 0.02, tokens: 5_000, billedAttempts: 1, details: {} };
const plannedPlan = (extra: Partial<SourceUrlsPlan> = {}): SourceUrlsPlan => ({
  version: 1,
  source: "planner",
  columns: ["Barcode"],
  steps: [{ name: "Barcode", text: "Find the page that sells the product with barcode {{Barcode}}." }],
  model: "gpt-6.1-sol",
  billing,
  ...extra,
});

let settings: Record<string, unknown>;
const baseSettings = () => ({
  kind: "product",
  enabledColumns: ["sourceUrls"],
  enrichmentColumns: [
    { id: "sourceUrls", label: "Source URLs", description: "", type: "sourceUrls", customInstruction: "Barcode first." },
  ],
  sourceColumns: ["Barcode"],
  ownerUserId: "owner",
  actorUserId: "actor",
});

const okOutcome = (rowId: string): EnrichRowOutcome => ({
  ok: true,
  rowId,
  data: { sourceUrls: [] },
  originalPatches: {},
  credits: 0.04,
  cost: 0.004,
  tokens: 0,
  billedAttempts: 1,
});

const processRow = () => vi.fn<CatalogProcessRow>(async (rowId) => okOutcome(rowId));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  control.stop = false;
  control.superseded = false;
  settings = baseSettings();
  project.current = { rows: [makeRow("r1", 1), makeRow("r2", 2), makeRow("r3", 3)], columns: ["Barcode"] };
  repo.loadJobRun.mockImplementation(async () => ({
    id: "run-1",
    kind: "catalog",
    status: "queued",
    workspace_id: "w",
    session_id: "s",
    target_ids: ["r1", "r2", "r3"],
    settings,
  }));
  saved.length = 0;
  repo.touchJobHeartbeat.mockImplementation(async (...args: unknown[]) => {
    const plan = (args[2] as { settings?: { sourceUrlsPlan?: SourceUrlsPlan } } | undefined)?.settings?.sourceUrlsPlan;
    if (plan) saved.push(JSON.parse(JSON.stringify(plan)) as SourceUrlsPlan);
    return {};
  });
  planSourceUrls.mockResolvedValue({ plan: plannedPlan({ billing: undefined }), costs: [call] });
  settleProviderUsage.mockResolvedValue({ charged: 0.2, shortfall: 0, duplicate: false, remaining: 50, balanceExhausted: false });
});

// The run mutates one settings object, so each save is copied as it happens.
const saved: SourceUrlsPlan[] = [];
const savedPlans = () => saved;

describe("runEnrichSession plans Source URLs once per run and charges the planner", () => {
  it("plans once for all rows, saves the plan BEFORE charging it, charges once, then runs the rows", async () => {
    const rows = processRow();
    await runEnrichSession("run-1", { processRow: rows });

    expect(planSourceUrls).toHaveBeenCalledTimes(1);
    expect(planSourceUrls).toHaveBeenCalledWith(
      expect.objectContaining({
        instruction: "Barcode first.",
        columns: [{ name: "Barcode", samples: ["BC1", "BC2", "BC3"] }],
      })
    );

    // Charged exactly what the planner's call cost, under the run's plan key.
    expect(settleProviderUsage).toHaveBeenCalledTimes(1);
    const charge = settleProviderUsage.mock.calls[0]![0];
    expect(charge).toMatchObject({
      operation: "catalog_intelligence",
      entityType: "catalog_plan",
      idempotencyKey: "catalog_intelligence:run-1:plan",
      workspaceId: "w",
    });
    // The planner's own billed call, in credits (10 credits = $1, rounded up to 0.001).
    expect(charge.amount).toBe(costToCredits(call.totalCost));
    expect(charge.amount).toBe(0.18);

    // The saved plan reaches the saved settings first, so a row task started on another process can read it.
    const firstSave = repo.touchJobHeartbeat.mock.invocationCallOrder[0]!;
    expect(firstSave).toBeLessThan(settleProviderUsage.mock.invocationCallOrder[0]!);
    const plans = savedPlans();
    expect(plans[0]).toMatchObject({ source: "planner", steps: [{ name: "Barcode" }] });
    expect(plans[0]!.billing!.settled).toBeUndefined();
    // After the charge it is saved again as settled.
    expect(plans.at(-1)!.billing!.settled).toBe(true);

    expect(rows).toHaveBeenCalledTimes(3);
    expect(repo.finishJobRun).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ status: "completed", completedCount: 3 }),
      expect.anything()
    );
  });

  it("does not plan or charge a second time when the run is resumed with a settled plan", async () => {
    settings.sourceUrlsPlan = plannedPlan({ billing: { ...billing, settled: true } });
    const rows = processRow();
    await runEnrichSession("run-1", { processRow: rows });
    expect(planSourceUrls).not.toHaveBeenCalled();
    expect(settleProviderUsage).not.toHaveBeenCalled();
    expect(rows).toHaveBeenCalledTimes(3);
  });

  it("charges a saved plan whose charge never went through, without planning again", async () => {
    settings.sourceUrlsPlan = plannedPlan();
    await runEnrichSession("run-1", { processRow: processRow() });
    expect(planSourceUrls).not.toHaveBeenCalled();
    expect(settleProviderUsage).toHaveBeenCalledTimes(1);
    expect(settleProviderUsage.mock.calls[0]![0].amount).toBe(0.2);
    expect(savedPlans().at(-1)!.billing!.settled).toBe(true);
  });

  it("makes no planner call and no charge without an instruction", async () => {
    settings = {
      ...baseSettings(),
      enrichmentColumns: [{ id: "sourceUrls", label: "Source URLs", description: "", type: "sourceUrls" }],
    };
    const rows = processRow();
    await runEnrichSession("run-1", { processRow: rows });
    expect(planSourceUrls).not.toHaveBeenCalled();
    expect(settleProviderUsage).not.toHaveBeenCalled();
    expect(rows).toHaveBeenCalledTimes(3);
  });

  it("makes no planner call for runs that do not search Source URLs", async () => {
    settings = { ...baseSettings(), enabledColumns: ["titleTag"] };
    await runEnrichSession("run-1", { processRow: processRow() });
    expect(planSourceUrls).not.toHaveBeenCalled();
    expect(settleProviderUsage).not.toHaveBeenCalled();
  });

  it("charges nothing when the planner billed nothing, and runs the rows with the default query", async () => {
    planSourceUrls.mockResolvedValueOnce({ plan: { version: 1, source: "default", steps: [], columns: [], reason: "network down" }, costs: [] });
    const rows = processRow();
    await runEnrichSession("run-1", { processRow: rows });
    expect(settleProviderUsage).not.toHaveBeenCalled();
    expect(rows).toHaveBeenCalledTimes(3);
  });

  it("still charges a planner that billed its calls but produced no usable plan", async () => {
    planSourceUrls.mockResolvedValueOnce({
      plan: { version: 1, source: "default", steps: [], columns: [], reason: "no usable search requests" },
      costs: [call, call],
    });
    await runEnrichSession("run-1", { processRow: processRow() });
    expect(settleProviderUsage).toHaveBeenCalledTimes(1);
    expect(settleProviderUsage.mock.calls[0]![0].details).toMatchObject({ billedAttempts: 2 });
  });

  it("pauses the run before any row when the planner's charge takes the last of the balance", async () => {
    settleProviderUsage.mockResolvedValueOnce({ charged: 0.05, shortfall: 0.15, duplicate: false, remaining: 0, balanceExhausted: true });
    const rows = processRow();
    await runEnrichSession("run-1", { processRow: rows });
    expect(rows).not.toHaveBeenCalled();
    expect(chargeCatalogRow).not.toHaveBeenCalled();
    expect(repo.finishJobRun).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ status: "paused_no_credits", lastError: "Out of credits" }),
      expect.anything()
    );
    // What was taken is recorded as settled, so it is never taken again.
    expect(savedPlans().at(-1)!.billing!.settled).toBe(true);
  });

  it("does not stop the run for a billing database error: rows run and the plan stays unsettled", async () => {
    settleProviderUsage.mockResolvedValueOnce({ charged: 0, shortfall: 0.2, duplicate: false, balanceExhausted: true, billingError: "database unavailable" });
    const rows = processRow();
    await runEnrichSession("run-1", { processRow: rows });
    expect(rows).toHaveBeenCalledTimes(3);
    expect(savedPlans().every((plan) => plan.billing!.settled !== true)).toBe(true);
  });

  it("fails the run clearly, charging nothing, when the plan cannot be saved", async () => {
    vi.useFakeTimers();
    try {
      // The three attempts to save the plan fail; the run's own final save then goes through.
      let saves = 0;
      repo.touchJobHeartbeat.mockImplementation(async () => {
        saves += 1;
        if (saves <= 3) throw new Error("db down");
        return {};
      });
      const rows = processRow();
      const done = runEnrichSession("run-1", { processRow: rows });
      await vi.advanceTimersByTimeAsync(10_000);
      await done;
      expect(settleProviderUsage).not.toHaveBeenCalled();
      expect(rows).not.toHaveBeenCalled();
      expect(repo.finishJobRun).toHaveBeenCalledWith(
        expect.anything(),
        "run-1",
        expect.objectContaining({ status: "failed", lastError: expect.stringMatching(/Could not save the search plan/) }),
        expect.anything()
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("a worker that lost the run still charges its planner call, once, and touches nothing else", async () => {
    repo.touchJobHeartbeat.mockResolvedValue(null);
    const rows = processRow();
    await runEnrichSession("run-1", { processRow: rows });
    expect(settleProviderUsage).toHaveBeenCalledTimes(1);
    expect(rows).not.toHaveBeenCalled();
    expect(repo.finishJobRun).not.toHaveBeenCalled();
  });

  it("goes on with the default query if planning itself throws unexpectedly", async () => {
    planSourceUrls.mockRejectedValueOnce(new Error("boom"));
    const rows = processRow();
    await runEnrichSession("run-1", { processRow: rows });
    expect(rows).toHaveBeenCalledTimes(3);
    expect(settleProviderUsage).not.toHaveBeenCalled();
  });
});
