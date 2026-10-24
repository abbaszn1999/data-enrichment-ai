import { beforeEach, describe, expect, it, vi } from "vitest";
import { calculateOpenAiWebSearchCost, costToCredits, sumCosts } from "@/lib/ai-pricing";
import type { SourceUrlsPlan } from "@/lib/enrich/source-urls/plan";
import type { ProjectRow } from "@/lib/storage-helpers";
import type { CatalogJobSettings } from "./types";

const planSourceUrls = vi.hoisted(() => vi.fn());
const settleProviderUsage = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("./project-json", () => ({ loadProjectJsonAdmin: vi.fn() }));
vi.mock("./repo", () => ({ loadJobRun: vi.fn() }));
vi.mock("./credits", () => ({
  deductCreditsIdempotent: vi.fn(),
  isInsufficientCredits: vi.fn(() => false),
  settleProviderUsage,
}));
vi.mock("@/lib/enrich/source-urls/planner", () => ({ planSourceUrls }));

const {
  chargeSourceUrlsPlan,
  collectPlannerColumns,
  needsSourceUrlsPlan,
  prepareSourceUrlsPlan,
  sourceUrlsInstructionOf,
  sourceUrlsPlanIdempotencyKey,
} = await import("./source-urls-plan");

const sourceUrlsColumn = { id: "sourceUrls", label: "Source URLs", description: "", type: "sourceUrls", customInstruction: "Barcode first, then SKU." };

const settings: CatalogJobSettings = {
  kind: "product",
  enabledColumns: ["sourceUrls"],
  enrichmentColumns: [sourceUrlsColumn],
  sourceColumns: ["Barcode", "Vendor SKU", "Image Src"],
  ownerUserId: "owner",
  actorUserId: "actor",
};

const makeRow = (id: string, originalData: Record<string, string>) =>
  ({ id, rowIndex: 0, originalData, enrichedData: {}, status: "pending" }) as unknown as ProjectRow;

const planned = (billing?: SourceUrlsPlan["billing"]): SourceUrlsPlan => ({
  version: 1,
  source: "planner",
  columns: ["Barcode"],
  steps: [{ name: "Barcode", text: "Find the page that sells barcode {{Barcode}}." }],
  model: "gpt-6.1-sol",
  ...(billing ? { billing } : {}),
});

const call = calculateOpenAiWebSearchCost("gpt-6.1-sol", { input_tokens: 4_000, output_tokens: 1_000 }, 0);

describe("needsSourceUrlsPlan", () => {
  it("needs a plan whenever Source URLs runs, with or without an instruction", () => {
    expect(needsSourceUrlsPlan(settings)).toBe(true);
    expect(needsSourceUrlsPlan({ ...settings, enrichmentColumns: [{ ...sourceUrlsColumn, customInstruction: "  " }] })).toBe(true);
    expect(needsSourceUrlsPlan({ ...settings, enrichmentColumns: [{ ...sourceUrlsColumn, customInstruction: undefined }] })).toBe(true);
  });

  it("does not plan for other columns, PLP sheets or a Lens run", () => {
    expect(needsSourceUrlsPlan({ ...settings, enabledColumns: ["titleTag"] })).toBe(false);
    expect(needsSourceUrlsPlan({ ...settings, kind: "plp" })).toBe(false);
    expect(needsSourceUrlsPlan({ ...settings, enabledColumns: ["lensFounds"] })).toBe(false);
  });

  it("plans when Source URLs runs next to other columns", () => {
    expect(needsSourceUrlsPlan({ ...settings, enabledColumns: ["titleTag", "sourceUrls"] })).toBe(true);
    expect(sourceUrlsInstructionOf(settings)).toBe("Barcode first, then SKU.");
  });
});

describe("collectPlannerColumns", () => {
  it("takes up to three distinct sample values per ticked column and leaves image columns out", () => {
    const rows = [
      makeRow("1", { Barcode: "111", "Vendor SKU": "A1", "Image Src": "https://cdn.example.com/a.jpg" }),
      makeRow("2", { Barcode: "222", "Vendor SKU": "A1" }),
      makeRow("3", { Barcode: "333", "Vendor SKU": "A3" }),
      makeRow("4", { Barcode: "444", "Vendor SKU": "A4" }),
    ];
    const { columns, hasPhoto } = collectPlannerColumns(rows, settings);
    expect(columns).toEqual([
      { name: "Barcode", samples: ["111", "222", "333"] },
      { name: "Vendor SKU", samples: ["A1", "A3", "A4"] },
    ]);
    expect(hasPhoto).toBe(true);
  });

  it("finds a column that is empty on the first rows, and reports no photo when there is none", () => {
    const rows = [makeRow("1", { Barcode: "" }), makeRow("2", { Barcode: "", "Vendor SKU": "Z9" })];
    const { columns, hasPhoto } = collectPlannerColumns(rows, settings);
    expect(columns).toEqual([{ name: "Vendor SKU", samples: ["Z9"] }]);
    expect(hasPhoto).toBe(false);
  });
});

describe("prepareSourceUrlsPlan", () => {
  beforeEach(() => {
    planSourceUrls.mockReset();
  });

  it("records exactly what the planner's calls billed on the plan", async () => {
    planSourceUrls.mockResolvedValueOnce({ plan: planned(), costs: [call, call] });
    const plan = await prepareSourceUrlsPlan({ settings, rows: [makeRow("1", { Barcode: "111" })] });
    const totals = sumCosts([call, call]);
    expect(plan.billing).toMatchObject({
      credits: totals.totalCredits,
      cost: totals.totalCost,
      tokens: totals.totalTokens,
      billedAttempts: 2,
    });
    expect(plan.billing!.credits).toBe(costToCredits(2 * call.totalCost));
    expect(plan.billing!.credits).toBeGreaterThan(0);
    expect(plan.billing!.details).toMatchObject({ openAiTokens: 10_000, webSearchCalls: 0, searchApiCalls: 0 });
    expect(plan.billing!.settled).toBeUndefined();
  });

  it("records no billing when nothing was billed", async () => {
    planSourceUrls.mockResolvedValueOnce({ plan: planned(), costs: [] });
    expect((await prepareSourceUrlsPlan({ settings, rows: [] })).billing).toBeUndefined();
  });

  it("passes the instruction, the sampled columns and the photo flag to the planner", async () => {
    planSourceUrls.mockResolvedValueOnce({ plan: planned(), costs: [] });
    await prepareSourceUrlsPlan({ settings, rows: [makeRow("1", { Barcode: "111" })] });
    expect(planSourceUrls).toHaveBeenCalledWith(
      expect.objectContaining({
        instruction: "Barcode first, then SKU.",
        columns: [{ name: "Barcode", samples: ["111"] }],
        hasPhoto: false,
      })
    );
  });

  it("returns the default plan, never an error, if the planner throws", async () => {
    planSourceUrls.mockRejectedValueOnce(new Error("boom"));
    const plan = await prepareSourceUrlsPlan({ settings, rows: [] });
    expect(plan).toMatchObject({ source: "default", reason: "boom" });
    expect(plan.billing).toBeUndefined();
  });
});

describe("chargeSourceUrlsPlan", () => {
  const billing = { credits: 0.123, cost: 0.0123, tokens: 5_000, billedAttempts: 1, details: { openAiCost: 0.0123 } };

  beforeEach(() => {
    settleProviderUsage.mockReset();
    settleProviderUsage.mockResolvedValue({ charged: 0.123, shortfall: 0, duplicate: false, balanceExhausted: false });
  });

  it("charges the billed amount once, under the run's plan key, as Catalog Intelligence", async () => {
    await chargeSourceUrlsPlan({ runId: "run-1", sessionId: "sess-1", workspaceId: "w", settings, plan: planned(billing) });
    expect(settleProviderUsage).toHaveBeenCalledTimes(1);
    expect(settleProviderUsage.mock.calls[0]![0]).toMatchObject({
      ownerUserId: "owner",
      actorUserId: "actor",
      workspaceId: "w",
      amount: 0.123,
      operation: "catalog_intelligence",
      entityType: "catalog_plan",
      entityId: "sess-1",
      idempotencyKey: "catalog_intelligence:run-1:plan",
      details: expect.objectContaining({
        runId: "run-1",
        planner: "source-urls",
        model: "gpt-6.1-sol",
        billedAttempts: 1,
        totalCost: 0.0123,
        totalTokens: 5_000,
        openAiCost: 0.0123,
        fullCredits: 0.123,
      }),
    });
  });

  it("charges nothing when no planner call was billed", async () => {
    expect(await chargeSourceUrlsPlan({ runId: "run-1", sessionId: "s", workspaceId: "w", settings, plan: planned() })).toBeNull();
    expect(await chargeSourceUrlsPlan({ runId: "run-1", sessionId: "s", workspaceId: "w", settings, plan: planned({ ...billing, credits: 0 }) })).toBeNull();
    expect(settleProviderUsage).not.toHaveBeenCalled();
  });

  it("uses a key that cannot collide with a row's key", () => {
    expect(sourceUrlsPlanIdempotencyKey("run-1")).toBe("catalog_intelligence:run-1:plan");
  });
});
