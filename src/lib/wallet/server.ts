import type { SupabaseClient } from "@supabase/supabase-js";
import { walletDevTopupEnabled } from "./dev-topup";
import { round2, round4 } from "./format";
import type {
  WalletAutoReload,
  WalletRpcResult,
  WalletState,
  WalletTx,
  WalletTxKind,
  WalletTxStatus,
} from "./types";

type RpcPayload = {
  success?: boolean;
  duplicate?: boolean;
  remaining?: number | string | null;
  tx_id?: string;
  error?: string;
};

function parseRpc(data: unknown): RpcPayload {
  if (!data || typeof data !== "object") return {};
  return data as RpcPayload;
}

function remainingOf(payload: RpcPayload, fallback = 0): number {
  const value = Number(payload.remaining);
  return Number.isFinite(value) ? round4(value) : fallback;
}

function toResult(data: unknown): WalletRpcResult {
  const payload = parseRpc(data);
  if (payload.success) {
    return {
      ok: true,
      duplicate: payload.duplicate === true,
      remaining: remainingOf(payload),
      txId: payload.tx_id,
    };
  }
  const error = payload.error || "Wallet charge failed";
  if (/insufficient/i.test(error)) {
    return {
      ok: false,
      reason: "insufficient_funds",
      message: error,
      remaining: remainingOf(payload),
    };
  }
  if (/not allowed/i.test(error)) {
    return { ok: false, reason: "forbidden", message: error };
  }
  return { ok: false, reason: "error", message: error };
}

export async function chargeWorkspaceWallet(
  admin: SupabaseClient,
  input: {
    workspaceId: string;
    userId: string;
    amountUsd: number;
    description: string;
    module: string;
    idempotencyKey: string;
    details?: Record<string, unknown>;
  }
): Promise<WalletRpcResult> {
  const { data, error } = await admin.rpc("charge_workspace_wallet", {
    p_workspace_id: input.workspaceId,
    p_user_id: input.userId,
    p_amount: round4(input.amountUsd),
    p_description: input.description,
    p_module: input.module,
    p_idempotency_key: input.idempotencyKey,
    p_details: input.details ?? {},
  });
  if (error) {
    return { ok: false, reason: "error", message: error.message };
  }
  return toResult(data);
}

export async function creditWorkspaceWallet(
  admin: SupabaseClient,
  input: {
    workspaceId: string;
    userId: string;
    amountUsd: number;
    kind: "topup" | "refund";
    description: string;
    module: string;
    method?: string;
    idempotencyKey?: string;
    details?: Record<string, unknown>;
  }
): Promise<WalletRpcResult> {
  const { data, error } = await admin.rpc("credit_workspace_wallet", {
    p_workspace_id: input.workspaceId,
    p_user_id: input.userId,
    p_amount: round4(input.amountUsd),
    p_kind: input.kind,
    p_description: input.description,
    p_module: input.module,
    p_method: input.method ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
    p_details: input.details ?? {},
  });
  if (error) {
    return { ok: false, reason: "error", message: error.message };
  }
  return toResult(data);
}

function mapTx(row: {
  id: string;
  kind: string;
  amount_usd: number | string;
  description: string | null;
  module: string | null;
  method: string | null;
  status: string;
  created_at: string;
  details?: Record<string, unknown> | null;
}): WalletTx {
  return {
    id: row.id,
    kind: row.kind as WalletTxKind,
    amount: Number(row.amount_usd) || 0,
    description: row.description ?? "",
    module: row.module ?? "",
    method: row.method ?? undefined,
    status: row.status as WalletTxStatus,
    createdAt: new Date(row.created_at).getTime(),
    details: row.details ?? undefined,
  };
}

export async function readWorkspaceWallet(
  admin: SupabaseClient,
  workspaceId: string
): Promise<WalletState> {
  const [{ data: wallet }, { data: txs }] = await Promise.all([
    admin
      .from("workspace_wallets")
      .select(
        "balance_usd, currency, auto_reload_enabled, auto_reload_threshold, auto_reload_amount"
      )
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    admin
      .from("wallet_transactions")
      .select(
        "id, kind, amount_usd, description, module, method, status, created_at, details"
      )
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const autoReload: WalletAutoReload = {
    enabled: Boolean(wallet?.auto_reload_enabled),
    threshold: Number(wallet?.auto_reload_threshold ?? 25),
    amount: Number(wallet?.auto_reload_amount ?? 100),
  };

  return {
    balance: round4(Number(wallet?.balance_usd ?? 0)),
    currency: "USD",
    transactions: (txs ?? []).map(mapTx),
    autoReload,
    allowDevTopup: walletDevTopupEnabled(),
  };
}

export async function updateWalletAutoReload(
  admin: SupabaseClient,
  workspaceId: string,
  autoReload: WalletAutoReload
): Promise<void> {
  const { error } = await admin.from("workspace_wallets").upsert({
    workspace_id: workspaceId,
    auto_reload_enabled: autoReload.enabled,
    auto_reload_threshold: round2(autoReload.threshold),
    auto_reload_amount: round2(autoReload.amount),
  });
  if (error) throw error;
}
