import { beforeEach, describe, expect, it, vi } from "vitest";

const wallet = {
  balance: 10,
  charges: [] as Array<{ amountUsd: number; idempotencyKey: string }>,
};

function chargeFake(_admin: unknown, input: { amountUsd: number; idempotencyKey: string }) {
  if (input.amountUsd > wallet.balance + 1e-9) {
    return Promise.resolve({
      ok: false as const,
      reason: "insufficient_funds" as const,
      message: "Insufficient funds",
      remaining: wallet.balance,
    });
  }
  wallet.balance -= input.amountUsd;
  wallet.charges.push({ amountUsd: input.amountUsd, idempotencyKey: input.idempotencyKey });
  return Promise.resolve({ ok: true as const, duplicate: false, remaining: wallet.balance });
}

vi.mock("@/lib/market-research/wallet-ops", () => ({ chargeMrWallet: chargeFake }));
vi.mock("@/lib/free-assessment/wallet-ops", () => ({ chargeAssessmentWallet: chargeFake }));
vi.mock("@/lib/wallet/server", () => ({
  readWorkspaceWallet: async () => ({ balance: wallet.balance }),
}));
vi.mock("@/lib/free-assessment/wallet-server", () => ({
  readFaWallet: async () => ({ balance: wallet.balance }),
}));

import {
  AI_SETTLE_THRESHOLD_USD,
  assertAiBudget,
  bindAiBilling,
  ensureAiBudget,
  recordAiSpend,
  runWithAiBilling,
  WalletExhaustedError,
  withAiWalletBilling,
} from "./ai-wallet-billing";

const binding = { admin: {} as never, workspaceId: "w1", userId: "u1" };

beforeEach(() => {
  wallet.balance = 10;
  wallet.charges = [];
});

describe("AI wallet billing scope", () => {
  it("charges the total spend once when the scope ends", async () => {
    await runWithAiBilling({ wallet: "market-research", operation: "mr_seeds", binding }, async () => {
      await ensureAiBudget();
      recordAiSpend(0.012);
      await ensureAiBudget();
      recordAiSpend(0.03);
    });
    expect(wallet.charges).toHaveLength(1);
    expect(wallet.charges[0]!.amountUsd).toBeCloseTo(0.042, 6);
    expect(wallet.charges[0]!.idempotencyKey).toMatch(/^ai:mr_seeds:.+:1$/);
  });

  it("settles as it goes and stops once the wallet cannot pay", async () => {
    wallet.balance = 0.3;
    await expect(
      runWithAiBilling({ wallet: "free-assessment", operation: "fa_classify", binding }, async () => {
        for (let i = 0; i < 10; i += 1) {
          await ensureAiBudget();
          recordAiSpend(AI_SETTLE_THRESHOLD_USD);
        }
      })
    ).rejects.toBeInstanceOf(WalletExhaustedError);
    expect(wallet.balance).toBeCloseTo(0, 6);
    expect(wallet.charges.map((c) => c.amountUsd)).toEqual([0.25, 0.05]);
    expect(wallet.charges[1]!.idempotencyKey).toMatch(/:balance$/);
  });

  it("refuses up front when the wallet is already empty", async () => {
    wallet.balance = 0;
    await runWithAiBilling({ wallet: "market-research", operation: "mr_chat" }, async () => {
      expect(await bindAiBilling(binding)).toMatch(/wallet balance is empty/i);
      expect(() => assertAiBudget()).toThrow(WalletExhaustedError);
    });
    expect(wallet.charges).toEqual([]);
  });

  it("does nothing outside a billing scope", async () => {
    recordAiSpend(5);
    await ensureAiBudget();
    expect(await bindAiBilling(binding)).toBeNull();
    expect(wallet.charges).toEqual([]);
  });
});

describe("withAiWalletBilling", () => {
  async function drainThenRespond(respond: () => Response) {
    await bindAiBilling(binding);
    try {
      for (let i = 0; i < 10; i += 1) {
        await ensureAiBudget();
        recordAiSpend(AI_SETTLE_THRESHOLD_USD);
      }
    } catch {
      return respond();
    }
    return Response.json({ ok: true });
  }

  it("answers 402 when the wallet runs dry and the error escapes", async () => {
    wallet.balance = 0.3;
    const handler = withAiWalletBilling("market-research", "mr_seeds", async () => {
      await bindAiBilling(binding);
      for (let i = 0; i < 10; i += 1) {
        await ensureAiBudget();
        recordAiSpend(AI_SETTLE_THRESHOLD_USD);
      }
      return Response.json({ ok: true });
    });
    const res = await handler();
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ code: "WALLET_EMPTY" });
  });

  it("turns a generic 500 into 402 once the wallet ran dry", async () => {
    wallet.balance = 0.3;
    const handler = withAiWalletBilling("free-assessment", "fa_seeds", () =>
      drainThenRespond(() => Response.json({ error: "boom" }, { status: 500 }))
    );
    const res = await handler();
    expect(res.status).toBe(402);
  });

  it("keeps a real 500 when the wallet can still pay", async () => {
    const handler = withAiWalletBilling("market-research", "mr_chat", async () =>
      Response.json({ error: "boom" }, { status: 500 })
    );
    const res = await handler();
    expect(res.status).toBe(500);
  });
});
