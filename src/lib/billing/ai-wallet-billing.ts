import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { round4 } from "@/lib/wallet/format";
import { chargeMrWallet } from "@/lib/market-research/wallet-ops";
import { readWorkspaceWallet } from "@/lib/wallet/server";
import { chargeAssessmentWallet } from "@/lib/free-assessment/wallet-ops";
import { readFaWallet } from "@/lib/free-assessment/wallet-server";

/**
 * Market Research and Free Assessment pass their AI cost (Gemini, OpenAI,
 * embeddings) through to the tool's USD wallet at cost. A scope wraps one
 * route request or one job run; the AI runners record spend into it, and it
 * is charged in small settlements so a long job stops when the wallet runs
 * dry instead of running far past zero.
 */

export type AiWallet = "market-research" | "free-assessment";

export type AiBillingBinding = {
  admin: SupabaseClient;
  workspaceId: string;
  userId: string;
};

type Scope = {
  wallet: AiWallet;
  operation: string;
  runKey: string;
  binding: AiBillingBinding | null;
  pendingUsd: number;
  chargedUsd: number;
  calls: number;
  seq: number;
  exhausted: boolean;
  balanceCheck: Promise<void> | null;
  settling: Promise<void> | null;
};

/** Spend is charged whenever this much has built up since the last charge. */
export const AI_SETTLE_THRESHOLD_USD = 0.25;

const storage = new AsyncLocalStorage<Scope>();

export class WalletExhaustedError extends Error {
  constructor(wallet: AiWallet) {
    super(
      wallet === "free-assessment"
        ? "The Free Assessment wallet is empty. Top up the wallet to continue."
        : "The wallet balance is empty. Top up the wallet to continue."
    );
    this.name = "WalletExhaustedError";
  }
}

export function isWalletExhaustedError(error: unknown): error is WalletExhaustedError {
  return error instanceof WalletExhaustedError;
}

/** Records the USD cost of one AI call made inside a billing scope. */
export function recordAiSpend(usd: number): void {
  const scope = storage.getStore();
  if (!scope || !Number.isFinite(usd) || usd <= 0) return;
  scope.pendingUsd += usd;
  scope.calls += 1;
}

export function aiBillingActive(): boolean {
  return Boolean(storage.getStore());
}

async function readBalance(scope: Scope, binding: AiBillingBinding): Promise<number> {
  const wallet =
    scope.wallet === "free-assessment"
      ? await readFaWallet(binding.admin, binding.workspaceId)
      : await readWorkspaceWallet(binding.admin, binding.workspaceId);
  return wallet.balance;
}

/**
 * Attaches the payer to the current scope. Returns an error message when the
 * wallet is already empty, so the caller can refuse the AI work up front.
 */
export async function bindAiBilling(binding: AiBillingBinding): Promise<string | null> {
  const scope = storage.getStore();
  if (!scope) return null;
  scope.binding = binding;
  scope.balanceCheck ??= readBalance(scope, binding).then((balance) => {
    if (!(balance > 0)) scope.exhausted = true;
  });
  await scope.balanceCheck;
  return scope.exhausted ? new WalletExhaustedError(scope.wallet).message : null;
}

async function charge(scope: Scope, binding: AiBillingBinding, amountUsd: number, key: string) {
  const input = {
    workspaceId: binding.workspaceId,
    userId: binding.userId,
    amountUsd,
    description: `AI usage · ${scope.operation}`,
    idempotencyKey: key,
    details: { operation: scope.operation, calls: scope.calls },
  };
  return scope.wallet === "free-assessment"
    ? chargeAssessmentWallet(binding.admin, input)
    : chargeMrWallet(binding.admin, input);
}

function settle(scope: Scope): Promise<void> {
  if (scope.settling) return scope.settling;
  const binding = scope.binding;
  const amount = round4(scope.pendingUsd);
  if (!binding || !(amount > 0)) return Promise.resolve();
  scope.pendingUsd = Math.max(0, scope.pendingUsd - amount);
  scope.seq += 1;
  const key = `ai:${scope.operation}:${scope.runKey}:${scope.seq}`;

  scope.settling = (async () => {
    const result = await charge(scope, binding, amount, key);
    if (result.ok) {
      scope.chargedUsd += amount;
      return;
    }
    if (result.reason === "insufficient_funds") {
      const rest = round4(Number(result.remaining ?? 0));
      if (rest > 0) {
        const partial = await charge(scope, binding, rest, `${key}:balance`);
        if (partial.ok) scope.chargedUsd += rest;
      }
      scope.exhausted = true;
      return;
    }
    scope.pendingUsd += amount;
    console.error(`[ai-billing] ${scope.operation} charge failed:`, result.message);
  })().finally(() => {
    scope.settling = null;
  });
  return scope.settling;
}

/**
 * Call before each AI request. Settles built-up spend and throws
 * WalletExhaustedError once the wallet can no longer pay.
 */
export async function ensureAiBudget(): Promise<void> {
  const scope = storage.getStore();
  if (!scope?.binding) return;
  if (scope.balanceCheck) await scope.balanceCheck;
  if (scope.pendingUsd >= AI_SETTLE_THRESHOLD_USD) await settle(scope);
  if (scope.exhausted) throw new WalletExhaustedError(scope.wallet);
}

/** Throws when an earlier settlement found the wallet empty. */
export function assertAiBudget(): void {
  const scope = storage.getStore();
  if (scope?.exhausted) throw new WalletExhaustedError(scope.wallet);
}

/** Binds the payer and throws WalletExhaustedError when the wallet is empty. */
export async function bindAiBillingOrThrow(binding: AiBillingBinding): Promise<void> {
  const scope = storage.getStore();
  const blocked = await bindAiBilling(binding);
  if (blocked && scope) throw new WalletExhaustedError(scope.wallet);
}

/** Runs `fn` in a billing scope and charges all recorded spend when it ends. */
export async function runWithAiBilling<T>(
  opts: { wallet: AiWallet; operation: string; binding?: AiBillingBinding },
  fn: () => Promise<T>
): Promise<T> {
  const scope: Scope = {
    wallet: opts.wallet,
    operation: opts.operation,
    runKey: randomUUID(),
    binding: opts.binding ?? null,
    pendingUsd: 0,
    chargedUsd: 0,
    calls: 0,
    seq: 0,
    exhausted: false,
    balanceCheck: null,
    settling: null,
  };
  try {
    return await storage.run(scope, fn);
  } finally {
    try {
      if (scope.settling) await scope.settling;
      if (!scope.exhausted) await settle(scope);
    } catch (error) {
      console.error(`[ai-billing] ${scope.operation} final charge failed:`, error);
    }
  }
}

function walletEmptyResponse(wallet: AiWallet): Response {
  return Response.json(
    { error: new WalletExhaustedError(wallet).message, code: "WALLET_EMPTY" },
    { status: 402 }
  );
}

/**
 * Wraps a route handler so its AI spend is charged to the tool's wallet.
 * A wallet that runs dry mid-request answers 402 WALLET_EMPTY, whether the
 * handler let the error escape or turned it into a generic 5xx.
 */
export function withAiWalletBilling<A extends unknown[], R>(
  wallet: AiWallet,
  operation: string,
  handler: (...args: A) => Promise<R>
): (...args: A) => Promise<R> {
  return (...args: A) =>
    runWithAiBilling({ wallet, operation }, async () => {
      try {
        const result = await handler(...args);
        if (result instanceof Response && result.status >= 500 && storage.getStore()?.exhausted) {
          return walletEmptyResponse(wallet) as R;
        }
        return result;
      } catch (error) {
        if (isWalletExhaustedError(error)) return walletEmptyResponse(wallet) as R;
        throw error;
      }
    });
}

/** Charges a one-off AI cost outside a scope, idempotent on `key`. */
export async function chargeAiCostOnce(
  wallet: AiWallet,
  binding: AiBillingBinding,
  input: { operation: string; amountUsd: number; key: string }
): Promise<void> {
  const amount = round4(input.amountUsd);
  if (!(amount > 0)) return;
  const scope: Scope = {
    wallet,
    operation: input.operation,
    runKey: input.key,
    binding,
    pendingUsd: 0,
    chargedUsd: 0,
    calls: 1,
    seq: 0,
    exhausted: false,
    balanceCheck: null,
    settling: null,
  };
  const result = await charge(scope, binding, amount, `ai:${input.operation}:${input.key}`);
  if (result.ok) return;
  if (result.reason === "insufficient_funds") {
    const rest = round4(Number(result.remaining ?? 0));
    if (rest > 0) await charge(scope, binding, rest, `ai:${input.operation}:${input.key}:balance`);
    return;
  }
  console.error(`[ai-billing] ${input.operation} charge failed:`, result.message);
}
