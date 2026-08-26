import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DetectedProduct } from "@/lib/sync/core/types";
import type { Decision, SyncRuleRecord } from "./types";

/**
 * The engine is tested against a fake provider rather than a fake HTTP layer.
 * That is the point of the contract: if these pass for a provider that does not
 * exist, nothing in the pipeline is reaching into Shopify or WooCommerce.
 */

/** Loose by design: these stand in for modules the engine only calls. */
/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyFn = (...args: any[]) => any;
const fn = () => vi.fn<AnyFn>();

const detectNewProducts = fn();
const assign = fn();
const getProvider = fn();
const isProviderSupported = fn();

const loadIntegration = fn();
const loadWatermarks = fn();
const startRun = fn();
const finishRun = fn();
const releaseRule = fn();
const recordDecisions = fn();
const advanceWatermark = fn();

const holdSyncRun = fn();
const settleSyncRun = fn();

const classifyProducts = fn();
const loadProjectSliceAdmin = fn();

vi.mock("@/lib/sync/core/registry", () => ({
  getProvider: (id: string) => getProvider(id),
  isProviderSupported: (id: string) => isProviderSupported(id),
}));

vi.mock("./repo", () => ({
  loadIntegration: (...args: unknown[]) => loadIntegration(...args),
  loadWatermarks: (...args: unknown[]) => loadWatermarks(...args),
  startRun: (...args: unknown[]) => startRun(...args),
  finishRun: (...args: unknown[]) => finishRun(...args),
  releaseRule: (...args: unknown[]) => releaseRule(...args),
  recordDecisions: (...args: unknown[]) => recordDecisions(...args),
  advanceWatermark: (...args: unknown[]) => advanceWatermark(...args),
}));

vi.mock("./wallet-ops", () => ({
  holdSyncRun: (...args: unknown[]) => holdSyncRun(...args),
  settleSyncRun: (...args: unknown[]) => settleSyncRun(...args),
}));

vi.mock("./classify", () => ({
  classifyProducts: (args: unknown) => classifyProducts(args),
}));

vi.mock("@/lib/market-research/storage-admin", () => ({
  loadProjectSliceAdmin: (...args: unknown[]) => loadProjectSliceAdmin(...args),
}));

const { runRule } = await import("./engine");

const admin = {} as SupabaseClient;

/** Wrap decisions in the shape `classifyProducts` now returns: decisions plus
 *  the summed AI cost and how many products actually reached the agent. */
function classifyResult(
  decisions: Decision[],
  overrides: { totalCostUsd?: number; validatedCount?: number } = {}
) {
  return {
    decisions,
    totalCostUsd: overrides.totalCostUsd ?? 0,
    validatedCount: overrides.validatedCount ?? decisions.length,
  };
}

function makeRule(overrides: Partial<SyncRuleRecord> = {}): SyncRuleRecord {
  return {
    id: "rule-1",
    workspace_id: "ws-1",
    project_id: "proj-1",
    created_by: "user-1",
    name: "New arrivals",
    enabled: true,
    provider: "fakeshop",
    run_interval: "24h",
    watched_taxonomies: [{ ref: "tax-1", title: "New Arrivals" }],
    mode: "auto",
    next_run_at: null,
    lease_until: null,
    last_run_at: null,
    last_error: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function makeProduct(id: string, createdAt = "2026-08-10T10:00:00Z"): DetectedProduct {
  return { id, title: `Product ${id}`, createdAt };
}

/** Products with distinct, increasing creation times. */
function series(count: number, startDay = 1): DetectedProduct[] {
  return Array.from({ length: count }, (_, i) =>
    makeProduct(
      `p${i + 1}`,
      new Date(Date.UTC(2026, 7, startDay, 0, i, 0)).toISOString()
    )
  );
}

beforeEach(() => {
  vi.clearAllMocks();

  isProviderSupported.mockReturnValue(true);
  getProvider.mockReturnValue({
    id: "fakeshop",
    label: "FakeShop",
    growthSync: { detectNewProducts: (args: unknown) => detectNewProducts(args) },
    taxonomy: { assign: (args: unknown) => assign(args) },
  });

  loadIntegration.mockResolvedValue({ id: "int-1", provider: "fakeshop" });
  loadWatermarks.mockResolvedValue(new Map());
  startRun.mockResolvedValue("run-1");
  finishRun.mockResolvedValue(undefined);
  releaseRule.mockResolvedValue(undefined);
  recordDecisions.mockResolvedValue(undefined);
  advanceWatermark.mockResolvedValue(undefined);
  holdSyncRun.mockResolvedValue({ ok: true, heldUsd: 0.01 });
  settleSyncRun.mockResolvedValue({ actualUsd: 0, heldUsd: 0.01, refundUsd: 0.01 });
  loadProjectSliceAdmin.mockResolvedValue([
    { id: "c1", name: "Cables", storeCollectionId: "tax-live-1", headKeyword: "cables" },
    { id: "c2", name: "Not pushed yet" },
  ]);
  assign.mockResolvedValue({ assignedCount: 1 });
  detectNewProducts.mockResolvedValue({
    products: [],
    newestCreatedAt: null,
  });
});

describe("runRule", () => {
  it("records a skipped run and spends nothing when no product is new", async () => {
    const outcome = await runRule({ admin, rule: makeRule(), trigger: "cron" });

    expect(outcome.status).toBe("skipped");
    expect(holdSyncRun).not.toHaveBeenCalled();
    expect(classifyProducts).not.toHaveBeenCalled();
    // The rule is released without an error, so it stays on schedule.
    expect(releaseRule).toHaveBeenCalledWith(admin, "rule-1");
  });

  it("asks the store only for products newer than the stored watermark", async () => {
    loadWatermarks.mockResolvedValue(new Map([["tax-1", "2026-08-05T00:00:00Z"]]));

    await runRule({ admin, rule: makeRule(), trigger: "cron" });

    expect(detectNewProducts).toHaveBeenCalledWith(
      expect.objectContaining({ taxonomyId: "tax-1", since: "2026-08-05T00:00:00Z" })
    );
  });

  it("classifies a product found in two watched taxonomies only once", async () => {
    const shared = makeProduct("p1");
    detectNewProducts
      .mockResolvedValueOnce({ products: [shared], newestCreatedAt: shared.createdAt })
      .mockResolvedValueOnce({ products: [shared], newestCreatedAt: shared.createdAt });
    classifyProducts.mockResolvedValue(classifyResult([]));

    const rule = makeRule({
      watched_taxonomies: [
        { ref: "tax-1", title: "A" },
        { ref: "tax-2", title: "B" },
      ],
    });
    const outcome = await runRule({ admin, rule, trigger: "cron" });

    expect(outcome.detectedCount).toBe(1);
    expect(holdSyncRun).toHaveBeenCalledWith(admin, {
      workspaceId: "ws-1",
      userId: "user-1",
      runId: "run-1",
      productCount: 1,
    });
  });

  it("pauses the rule when the wallet cannot cover the run", async () => {
    detectNewProducts.mockResolvedValue({
      products: [makeProduct("p1")],
      newestCreatedAt: "2026-08-10T10:00:00Z",
    });
    holdSyncRun.mockResolvedValue({
      ok: false,
      message: "Wallet balance is too low to run Sync classification",
    });

    const outcome = await runRule({ admin, rule: makeRule(), trigger: "cron" });

    expect(outcome.status).toBe("failed");
    expect(outcome.error).toMatch(/wallet balance/i);
    expect(classifyProducts).not.toHaveBeenCalled();
    expect(releaseRule).toHaveBeenCalledWith(
      admin,
      "rule-1",
      expect.objectContaining({ disable: true })
    );
    // Nothing was held, so nothing may be settled.
    expect(settleSyncRun).not.toHaveBeenCalled();
  });

  it("offers the agent only the project categories that are live on the store", async () => {
    detectNewProducts.mockResolvedValue({
      products: [makeProduct("p1")],
      newestCreatedAt: "2026-08-10T10:00:00Z",
    });
    classifyProducts.mockResolvedValue(classifyResult([]));

    await runRule({ admin, rule: makeRule(), trigger: "cron" });

    const call = classifyProducts.mock.calls[0][0] as { targets: unknown[] };
    expect(call.targets).toEqual([
      expect.objectContaining({ taxonomyRef: "tax-live-1", name: "Cables" }),
    ]);
  });

  it("settles the hold against the agent's real cost and product count", async () => {
    const products = [makeProduct("p1"), makeProduct("p2"), makeProduct("p3")];
    detectNewProducts.mockResolvedValue({
      products,
      newestCreatedAt: "2026-08-10T10:00:00Z",
    });
    holdSyncRun.mockResolvedValue({ ok: true, heldUsd: 0.05 });
    classifyProducts.mockResolvedValue(
      classifyResult(
        [
          {
            product: products[0],
            sourceTaxonomyRef: "tax-1",
            decision: "assigned",
            target: { collectionId: "c1", taxonomyRef: "tax-live-1", name: "Cables" },
            score: 0.8,
            reason: "match",
          },
          {
            product: products[1],
            sourceTaxonomyRef: "tax-1",
            decision: "skipped",
            reason: "No category was close enough to consider",
          },
        ] satisfies Decision[],
        { totalCostUsd: 0.0021, validatedCount: 1 }
      )
    );

    const outcome = await runRule({ admin, rule: makeRule(), trigger: "cron" });

    expect(outcome.status).toBe("succeeded");
    expect(outcome.assignedCount).toBe(1);
    expect(settleSyncRun).toHaveBeenCalledWith(admin, {
      workspaceId: "ws-1",
      userId: "user-1",
      runId: "run-1",
      ruleId: "rule-1",
      ruleName: "New arrivals",
      heldUsd: 0.05,
      actualUsd: 0.0021,
      productCount: 1,
    });
  });

  it("groups accepted products into one write per destination", async () => {
    const products = [makeProduct("p1"), makeProduct("p2")];
    detectNewProducts.mockResolvedValue({
      products,
      newestCreatedAt: "2026-08-10T10:00:00Z",
    });
    const target = { collectionId: "c1", taxonomyRef: "tax-live-1", name: "Cables" };
    classifyProducts.mockResolvedValue(
      classifyResult(
        products.map((product) => ({
          product,
          sourceTaxonomyRef: "tax-1",
          decision: "assigned" as const,
          target,
          score: 0.7,
          reason: "match",
        }))
      )
    );

    await runRule({ admin, rule: makeRule(), trigger: "cron" });

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(
      expect.objectContaining({ taxonomyId: "tax-live-1", productIds: ["p1", "p2"] })
    );
  });

  it("keeps the rest of the run when one destination refuses the write", async () => {
    const products = [makeProduct("p1"), makeProduct("p2")];
    detectNewProducts.mockResolvedValue({
      products,
      newestCreatedAt: "2026-08-10T10:00:00Z",
    });
    classifyProducts.mockResolvedValue(
      classifyResult([
        {
          product: products[0],
          sourceTaxonomyRef: "tax-1",
          decision: "assigned" as const,
          target: { collectionId: "c1", taxonomyRef: "good", name: "Good" },
          reason: "match",
        },
        {
          product: products[1],
          sourceTaxonomyRef: "tax-1",
          decision: "assigned" as const,
          target: { collectionId: "c2", taxonomyRef: "bad", name: "Bad" },
          reason: "match",
        },
      ])
    );
    assign.mockImplementation(async (args: { taxonomyId: string }) => {
      if (args.taxonomyId === "bad") throw new Error("Collection is rule-based");
      return { assignedCount: 1 };
    });

    const outcome = await runRule({ admin, rule: makeRule(), trigger: "cron" });

    expect(outcome.status).toBe("succeeded");
    expect(outcome.assignedCount).toBe(1);
    // The failure is recorded against the product, not swallowed.
    const recorded = recordDecisions.mock.calls[0][1] as { decisions: Decision[] };
    const failed = recorded.decisions.find((d) => d.decision === "failed");
    expect(failed?.reason).toBe("Collection is rule-based");
  });

  it("advances the watermark only after the decisions are stored", async () => {
    detectNewProducts.mockResolvedValue({
      products: [makeProduct("p1")],
      newestCreatedAt: "2026-08-10T10:00:00Z",
    });
    classifyProducts.mockResolvedValue(classifyResult([]));
    const order: string[] = [];
    recordDecisions.mockImplementation(async () => void order.push("record"));
    advanceWatermark.mockImplementation(async () => void order.push("watermark"));

    await runRule({ admin, rule: makeRule(), trigger: "cron" });

    expect(order).toEqual(["record", "watermark"]);
    expect(advanceWatermark).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ taxonomyRef: "tax-1", createdAt: "2026-08-10T10:00:00Z" })
    );
  });

  it("caps one run and leaves the newest products for the next", async () => {
    const products = series(140);
    detectNewProducts.mockResolvedValue({
      products,
      newestCreatedAt: products[products.length - 1].createdAt,
    });
    classifyProducts.mockResolvedValue(classifyResult([]));

    const outcome = await runRule({ admin, rule: makeRule(), trigger: "cron" });

    // Work is taken oldest first, so the block processed is contiguous with the
    // watermark and the remainder is still detectable next run.
    const sent = (classifyProducts.mock.calls[0][0] as { products: DetectedProduct[] })
      .products;
    expect(sent).toHaveLength(100);
    expect(sent[0].id).toBe("p1");
    expect(sent[99].id).toBe("p100");
    expect(outcome.detectedCount).toBe(100);
    // The caller (a manual "Run now", or the dashboard toast) needs to know a
    // backlog remains — 140 detected, 100 taken, 40 left for the next run.
    expect(outcome.deferredCount).toBe(40);
    expect(holdSyncRun).toHaveBeenCalledWith(admin, {
      workspaceId: "ws-1",
      userId: "user-1",
      runId: "run-1",
      productCount: 100,
    });
    // The watermark stops at the last product handled, never past it.
    expect(advanceWatermark).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ createdAt: products[99].createdAt, productRef: "p100" })
    );
  });

  it("comes due again immediately while a backlog remains", async () => {
    detectNewProducts.mockResolvedValue({
      products: series(140),
      newestCreatedAt: null,
    });
    classifyProducts.mockResolvedValue(classifyResult([]));

    await runRule({ admin, rule: makeRule(), trigger: "cron" });

    // Waiting a full interval to continue a backlog would only make it deeper.
    expect(releaseRule).toHaveBeenCalledWith(admin, "rule-1", { dueNow: true });
  });

  it("waits for its interval when nothing is left over", async () => {
    detectNewProducts.mockResolvedValue({
      products: series(3),
      newestCreatedAt: null,
    });
    classifyProducts.mockResolvedValue(classifyResult([]));

    await runRule({ admin, rule: makeRule(), trigger: "cron" });

    expect(releaseRule).toHaveBeenCalledWith(admin, "rule-1", { dueNow: false });
  });

  it("holds a watermark back when an older product in that taxonomy was deferred", async () => {
    const products = series(140);
    detectNewProducts
      // The first taxonomy fills the whole allowance.
      .mockResolvedValueOnce({ products, newestCreatedAt: null })
      // The second one's product is newer than the cut, so it was not handled.
      .mockResolvedValueOnce({
        products: [makeProduct("late", "2026-08-20T00:00:00Z")],
        newestCreatedAt: "2026-08-20T00:00:00Z",
      });
    classifyProducts.mockResolvedValue(classifyResult([]));

    await runRule({
      admin,
      rule: makeRule({
        watched_taxonomies: [
          { ref: "tax-1", title: "A" },
          { ref: "tax-2", title: "B" },
        ],
      }),
      trigger: "cron",
    });

    const refs = advanceWatermark.mock.calls.map(
      (call) => (call[1] as { taxonomyRef: string }).taxonomyRef
    );
    expect(refs).toEqual(["tax-1"]);
  });

  it("moves both watermarks past a product shared by two taxonomies", async () => {
    const shared = makeProduct("shared", "2026-08-10T10:00:00Z");
    detectNewProducts.mockResolvedValue({
      products: [shared],
      newestCreatedAt: shared.createdAt,
    });
    classifyProducts.mockResolvedValue(classifyResult([]));

    await runRule({
      admin,
      rule: makeRule({
        watched_taxonomies: [
          { ref: "tax-1", title: "A" },
          { ref: "tax-2", title: "B" },
        ],
      }),
      trigger: "cron",
    });

    // It was classified once, under tax-1. If tax-2 stayed behind it would
    // detect the same product next run and pay for it a second time.
    const refs = advanceWatermark.mock.calls.map(
      (call) => (call[1] as { taxonomyRef: string }).taxonomyRef
    );
    expect(refs.sort()).toEqual(["tax-1", "tax-2"]);
  });

  it("refuses the run when the store walk never reached the watermark", async () => {
    detectNewProducts.mockResolvedValue({
      products: series(20),
      newestCreatedAt: null,
      truncated: true,
    });

    const outcome = await runRule({ admin, rule: makeRule(), trigger: "cron" });

    // The oldest new products were never seen, so no single watermark can
    // describe the result. Spending nothing and saying so beats losing them.
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toMatch(/Too many products/);
    expect(holdSyncRun).not.toHaveBeenCalled();
    expect(advanceWatermark).not.toHaveBeenCalled();
  });

  it("ignores a product with an unusable creation time", async () => {
    detectNewProducts.mockResolvedValue({
      products: [makeProduct("p1", ""), makeProduct("p2")],
      newestCreatedAt: null,
    });
    classifyProducts.mockResolvedValue(classifyResult([]));

    await runRule({ admin, rule: makeRule(), trigger: "cron" });

    const sent = (classifyProducts.mock.calls[0][0] as { products: DetectedProduct[] })
      .products;
    // It cannot be placed against the watermark, so it would otherwise be
    // reclassified on every single run.
    expect(sent.map((p) => p.id)).toEqual(["p2"]);
  });

  it("pauses a rule pointed at a store the workspace no longer uses", async () => {
    loadIntegration.mockResolvedValue({ id: "int-2", provider: "otherstore" });

    const outcome = await runRule({ admin, rule: makeRule(), trigger: "cron" });

    expect(outcome.status).toBe("failed");
    expect(releaseRule).toHaveBeenCalledWith(
      admin,
      "rule-1",
      expect.objectContaining({ disable: true })
    );
  });

  it("pauses a rule whose provider cannot detect new products", async () => {
    getProvider.mockReturnValue({
      id: "fakeshop",
      label: "FakeShop",
      taxonomy: { assign },
    });

    const outcome = await runRule({ admin, rule: makeRule(), trigger: "cron" });

    expect(outcome.status).toBe("failed");
    expect(outcome.error).toMatch(/not supported on FakeShop/);
    expect(releaseRule).toHaveBeenCalledWith(
      admin,
      "rule-1",
      expect.objectContaining({ disable: true })
    );
  });

  it("retries rather than pauses when the store call fails transiently", async () => {
    detectNewProducts.mockRejectedValue(new Error("503 upstream unavailable"));

    const outcome = await runRule({ admin, rule: makeRule(), trigger: "cron" });

    expect(outcome.status).toBe("failed");
    expect(releaseRule).toHaveBeenCalledWith(
      admin,
      "rule-1",
      expect.objectContaining({ disable: false })
    );
  });

  it("refunds the full hold when the pipeline fails after the hold but before settling", async () => {
    detectNewProducts.mockResolvedValue({
      products: [makeProduct("p1")],
      newestCreatedAt: "2026-08-10T10:00:00Z",
    });
    holdSyncRun.mockResolvedValue({ ok: true, heldUsd: 0.02 });
    classifyProducts.mockRejectedValue(new Error("agent exploded"));

    const outcome = await runRule({ admin, rule: makeRule(), trigger: "cron" });

    expect(outcome.status).toBe("failed");
    expect(settleSyncRun).toHaveBeenCalledWith(admin, {
      workspaceId: "ws-1",
      userId: "user-1",
      runId: "run-1",
      ruleId: "rule-1",
      ruleName: "New arrivals",
      heldUsd: 0.02,
      actualUsd: 0,
      productCount: 0,
    });
  });
});
