import type { SupabaseClient } from "@supabase/supabase-js";
import { chargeWorkspaceWallet, creditWorkspaceWallet } from "@/lib/wallet/server";
import type { WalletRpcResult } from "@/lib/wallet/types";

/**
 * Sync bills the workspace wallet directly, at the exact AI cost, no markup —
 * unlike Growth Sync's old classification-pack quota, this is a USD balance
 * that can never go negative (`workspace_wallets.balance_usd` has a DB-level
 * CHECK), so a run holds a conservative estimate up front and settles down to
 * the real cost once the agent has actually run. Gemini 3.7 Flash is cheap
 * enough (well under a cent for a 100-product batch) that the hold is tiny.
 */

export const GROWTH_SYNC_WALLET_MODULE = "growth-sync";

/** Round to the wallet's stored precision (matches `wallet_transactions.amount_usd`). */
export function roundUsd(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Conservative pre-flight estimate. Real per-product cost is a small fraction
 * of a cent, so this is deliberately generous — the settle step refunds the
 * unused remainder once the actual token usage is known.
 */
export function estimateSyncHoldUsd(productCount: number): number {
  return Math.max(0.01, roundUsd(productCount * 0.0005));
}

export async function chargeSyncWallet(
  admin: SupabaseClient,
  input: {
    workspaceId: string;
    userId: string;
    amountUsd: number;
    description: string;
    idempotencyKey: string;
    details?: Record<string, unknown>;
  }
): Promise<WalletRpcResult> {
  return chargeWorkspaceWallet(admin, {
    ...input,
    module: GROWTH_SYNC_WALLET_MODULE,
  });
}

export async function refundSyncWallet(
  admin: SupabaseClient,
  input: {
    workspaceId: string;
    userId: string;
    amountUsd: number;
    description: string;
    idempotencyKey: string;
    details?: Record<string, unknown>;
  }
): Promise<WalletRpcResult> {
  return creditWorkspaceWallet(admin, {
    ...input,
    kind: "refund",
    module: GROWTH_SYNC_WALLET_MODULE,
  });
}

/**
 * Hold an estimate before the agent runs. Failure here (insufficient funds)
 * is the wallet equivalent of the old "quota exhausted" case: the caller
 * should fail the run and pause the rule rather than spend AI budget it
 * cannot pay for.
 */
export async function holdSyncRun(
  admin: SupabaseClient,
  input: { workspaceId: string; userId: string; runId: string; productCount: number }
): Promise<{ ok: true; heldUsd: number } | { ok: false; message: string }> {
  const heldUsd = estimateSyncHoldUsd(input.productCount);
  const result = await chargeSyncWallet(admin, {
    workspaceId: input.workspaceId,
    userId: input.userId,
    amountUsd: heldUsd,
    description: `Sync classification hold · ${input.productCount.toLocaleString("en-US")} product${input.productCount === 1 ? "" : "s"}`,
    idempotencyKey: `gs_run:hold:${input.runId}`,
    details: { runId: input.runId, productCount: input.productCount },
  });
  if (!result.ok) {
    return {
      ok: false,
      message:
        result.reason === "insufficient_funds"
          ? "Wallet balance is too low to run Sync classification"
          : result.message || "Could not charge the wallet for this run",
    };
  }
  return { ok: true, heldUsd };
}

/**
 * Settle a run's hold against the real AI cost: refund the unused portion,
 * or (rarely, since holds are generous) charge the small remainder. Best
 * effort — a failed settlement never undoes work the run already completed.
 */
export async function settleSyncRun(
  admin: SupabaseClient,
  input: {
    workspaceId: string;
    userId: string;
    runId: string;
    ruleId: string;
    ruleName: string;
    heldUsd: number;
    actualUsd: number;
    productCount: number;
  }
): Promise<{ actualUsd: number; heldUsd: number; refundUsd: number }> {
  const held = roundUsd(input.heldUsd);
  const actual = roundUsd(input.actualUsd);
  const refund = roundUsd(Math.max(0, held - actual));
  const extra = roundUsd(Math.max(0, actual - held));
  const details = {
    runId: input.runId,
    ruleId: input.ruleId,
    ruleName: input.ruleName,
    productCount: input.productCount,
  };

  if (refund > 0) {
    const credited = await refundSyncWallet(admin, {
      workspaceId: input.workspaceId,
      userId: input.userId,
      amountUsd: refund,
      description: `Sync classification settlement · ${input.productCount.toLocaleString("en-US")} product${input.productCount === 1 ? "" : "s"}`,
      idempotencyKey: `gs_run:refund:${input.runId}`,
      details,
    });
    if (!credited.ok) {
      console.warn(
        `[growth-sync] wallet refund of ${refund} failed for run ${input.runId}: ${credited.message}`
      );
    }
  }
  if (extra > 0) {
    const charged = await chargeSyncWallet(admin, {
      workspaceId: input.workspaceId,
      userId: input.userId,
      amountUsd: extra,
      description: `Sync classification settlement extra · ${input.productCount.toLocaleString("en-US")} product${input.productCount === 1 ? "" : "s"}`,
      idempotencyKey: `gs_run:extra:${input.runId}`,
      details,
    });
    if (!charged.ok) {
      // The agent's work already happened; a failed top-up charge should
      // not retroactively fail an otherwise successful run.
      console.warn(
        `[growth-sync] wallet extra charge of ${extra} failed for run ${input.runId}: ${charged.message}`
      );
    }
  }

  return { actualUsd: actual, heldUsd: held, refundUsd: refund };
}
