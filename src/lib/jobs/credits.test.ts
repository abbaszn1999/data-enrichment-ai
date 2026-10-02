import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/workspace-context", () => ({ updateCachedCredits: vi.fn() }));
vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: vi.fn() }));

import { chargeCompletedCall, settleProviderUsage } from "./credits";

type Admin = NonNullable<Parameters<typeof chargeCompletedCall>[0]["admin"]>;

function adminWith(balance: number) {
  const calls: Array<{ amount: number; key: string }> = [];
  const admin = {
    rpc: vi.fn(async (_name: string, args: { p_amount: number; p_details: { idempotencyKey: string } }) => {
      calls.push({ amount: args.p_amount, key: args.p_details.idempotencyKey });
      if (args.p_amount > balance) {
        return { data: { success: false, error: "Insufficient credits", remaining: balance }, error: null };
      }
      balance -= args.p_amount;
      return { data: { success: true, remaining: balance }, error: null };
    }),
  };
  return { admin: admin as unknown as Admin, calls };
}

const base = {
  ownerUserId: "owner",
  workspaceId: "w1",
  actorUserId: "u1",
  operation: "ai_function",
  entityType: "ai_function",
  idempotencyKey: "ai_function:run-1",
};

describe("chargeCompletedCall", () => {
  it("charges the full amount when the balance covers it", async () => {
    const { admin, calls } = adminWith(10);
    const result = await chargeCompletedCall({ ...base, admin, amount: 4 });
    expect(result).toMatchObject({ success: true, charged: 4, remaining: 6 });
    expect(calls).toHaveLength(1);
  });

  it("charges the rest of the balance when it cannot cover the call", async () => {
    const { admin, calls } = adminWith(1.5);
    const result = await chargeCompletedCall({ ...base, admin, amount: 4 });
    expect(result).toMatchObject({ success: true, charged: 1.5, remaining: 0 });
    expect(calls.map((c) => c.key)).toEqual(["ai_function:run-1", "ai_function:run-1:balance"]);
  });

  it("charges nothing when the balance is already empty", async () => {
    const { admin, calls } = adminWith(0);
    const result = await chargeCompletedCall({ ...base, admin, amount: 4 });
    expect(result).toMatchObject({ success: false, charged: 0 });
    expect(calls).toHaveLength(1);
  });
});

describe("settleProviderUsage", () => {
  it("charges the full usage and keeps the run going", async () => {
    const { admin } = adminWith(10);
    const result = await settleProviderUsage({ ...base, admin, amount: 4 });
    expect(result).toMatchObject({ charged: 4, shortfall: 0, balanceExhausted: false, duplicate: false });
  });

  it("charges what is left and reports the shortfall when the balance is short", async () => {
    const { admin } = adminWith(1.5);
    const result = await settleProviderUsage({ ...base, admin, amount: 4 });
    expect(result).toMatchObject({ charged: 1.5, shortfall: 2.5, balanceExhausted: true });
  });

  it("stops the run when a full charge empties the balance", async () => {
    const { admin } = adminWith(4);
    const result = await settleProviderUsage({ ...base, admin, amount: 4 });
    expect(result).toMatchObject({ charged: 4, shortfall: 0, remaining: 0, balanceExhausted: true });
  });

  it("reports the whole usage as a shortfall when the balance is empty", async () => {
    const { admin } = adminWith(0);
    const result = await settleProviderUsage({ ...base, admin, amount: 4 });
    expect(result).toMatchObject({ charged: 0, shortfall: 4, balanceExhausted: true });
  });

  it("charges nothing for zero usage", async () => {
    const { admin, calls } = adminWith(10);
    const result = await settleProviderUsage({ ...base, admin, amount: 0 });
    expect(result).toMatchObject({ charged: 0, shortfall: 0, balanceExhausted: false });
    expect(calls).toHaveLength(0);
  });

  it("retries once after a transient database error", async () => {
    let attempts = 0;
    const admin = {
      rpc: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) return { data: null, error: { message: "fetch failed" } };
        return { data: { success: true, remaining: 6 }, error: null };
      }),
    } as unknown as Admin;
    const result = await settleProviderUsage({ ...base, admin, amount: 4 });
    expect(attempts).toBe(2);
    expect(result).toMatchObject({ charged: 4, shortfall: 0, balanceExhausted: false });
  });

  it("does not count an already-charged retry twice", async () => {
    const admin = {
      rpc: vi.fn(async () => ({ data: { success: true, duplicate: true }, error: null })),
    } as unknown as Admin;
    const result = await settleProviderUsage({ ...base, admin, amount: 4 });
    expect(result).toMatchObject({ charged: 0, shortfall: 0, duplicate: true, balanceExhausted: false });
  });
});
