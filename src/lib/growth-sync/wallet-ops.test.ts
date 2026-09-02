import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const chargeWorkspaceWallet = vi.fn();
const creditWorkspaceWallet = vi.fn();

vi.mock("@/lib/wallet/server", () => ({
  chargeWorkspaceWallet: (...args: unknown[]) => chargeWorkspaceWallet(...args),
  creditWorkspaceWallet: (...args: unknown[]) => creditWorkspaceWallet(...args),
}));

const { estimateSyncHoldUsd, holdSyncRun, settleSyncRun, roundUsd } = await import(
  "./wallet-ops"
);

const admin = {} as SupabaseClient;

beforeEach(() => {
  vi.clearAllMocks();
  chargeWorkspaceWallet.mockResolvedValue({ ok: true, remaining: 10 });
  creditWorkspaceWallet.mockResolvedValue({ ok: true, remaining: 10 });
});

describe("estimateSyncHoldUsd", () => {
  it("floors at a one-cent minimum", () => {
    expect(estimateSyncHoldUsd(1)).toBe(0.01);
    expect(estimateSyncHoldUsd(5)).toBe(0.01);
  });

  it("scales with product count above the floor", () => {
    expect(estimateSyncHoldUsd(100)).toBe(0.05);
  });
});

describe("holdSyncRun", () => {
  it("charges the Growth Sync wallet module with a run-scoped idempotency key", async () => {
    const result = await holdSyncRun(admin, {
      workspaceId: "ws-1",
      userId: "user-1",
      runId: "run-1",
      productCount: 100,
    });

    expect(result).toEqual({ ok: true, heldUsd: 0.05 });
    expect(chargeWorkspaceWallet).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        workspaceId: "ws-1",
        userId: "user-1",
        amountUsd: 0.05,
        module: "growth-sync",
        idempotencyKey: "gs_run:hold:run-1",
        details: { runId: "run-1", productCount: 100 },
      })
    );
  });

  it("surfaces an insufficient-funds hold as a wallet-balance failure message", async () => {
    chargeWorkspaceWallet.mockResolvedValue({
      ok: false,
      reason: "insufficient_funds",
      message: "Insufficient funds",
    });

    const result = await holdSyncRun(admin, {
      workspaceId: "ws-1",
      userId: "user-1",
      runId: "run-1",
      productCount: 10,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/wallet balance is too low/i);
    }
  });

  it("passes through other failure reasons unchanged", async () => {
    chargeWorkspaceWallet.mockResolvedValue({
      ok: false,
      reason: "error",
      message: "Database is unreachable",
    });

    const result = await holdSyncRun(admin, {
      workspaceId: "ws-1",
      userId: "user-1",
      runId: "run-1",
      productCount: 10,
    });

    expect(result).toEqual({ ok: false, message: "Database is unreachable" });
  });
});

describe("settleSyncRun", () => {
  const base = {
    workspaceId: "ws-1",
    userId: "user-1",
    runId: "run-1",
    ruleId: "rule-1",
    ruleName: "New arrivals",
  };

  it("refunds the unused portion of the hold", async () => {
    const result = await settleSyncRun(admin, {
      ...base,
      heldUsd: 0.05,
      actualUsd: 0.002,
      productCount: 100,
    });

    expect(result).toEqual({ actualUsd: 0.002, heldUsd: 0.05, refundUsd: 0.048 });
    expect(creditWorkspaceWallet).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        workspaceId: "ws-1",
        userId: "user-1",
        amountUsd: 0.048,
        kind: "refund",
        module: "growth-sync",
        idempotencyKey: "gs_run:refund:run-1",
        details: { runId: "run-1", ruleId: "rule-1", ruleName: "New arrivals", productCount: 100 },
      })
    );
    expect(chargeWorkspaceWallet).not.toHaveBeenCalled();
  });

  it("charges the small remainder when the actual cost exceeds the hold", async () => {
    const result = await settleSyncRun(admin, {
      ...base,
      heldUsd: 0.01,
      actualUsd: 0.013,
      productCount: 50,
    });

    expect(result).toEqual({ actualUsd: 0.013, heldUsd: 0.01, refundUsd: 0 });
    expect(chargeWorkspaceWallet).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        amountUsd: 0.003,
        module: "growth-sync",
        idempotencyKey: "gs_run:extra:run-1",
      })
    );
    expect(creditWorkspaceWallet).not.toHaveBeenCalled();
  });

  it("moves neither way when the actual cost matches the hold exactly", async () => {
    await settleSyncRun(admin, {
      ...base,
      heldUsd: 0.01,
      actualUsd: 0.01,
      productCount: 10,
    });

    expect(creditWorkspaceWallet).not.toHaveBeenCalled();
    expect(chargeWorkspaceWallet).not.toHaveBeenCalled();
  });

  it("never throws when the refund itself fails", async () => {
    creditWorkspaceWallet.mockResolvedValue({
      ok: false,
      reason: "error",
      message: "boom",
    });

    await expect(
      settleSyncRun(admin, { ...base, heldUsd: 0.05, actualUsd: 0, productCount: 0 })
    ).resolves.toEqual({ actualUsd: 0, heldUsd: 0.05, refundUsd: 0.05 });
  });
});

describe("roundUsd", () => {
  it("rounds to four decimal places and floors non-positive values to zero", () => {
    expect(roundUsd(0.00006)).toBe(0.0001);
    expect(roundUsd(-1)).toBe(0);
    expect(roundUsd(Number.NaN)).toBe(0);
  });
});
