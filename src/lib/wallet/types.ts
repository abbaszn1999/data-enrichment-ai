export type WalletTxKind = "topup" | "charge" | "refund";
export type WalletTxStatus = "completed" | "pending" | "failed";

export type WalletTx = {
  id: string;
  kind: WalletTxKind;
  /** Positive for money in, negative for money out. */
  amount: number;
  description: string;
  module: string;
  method?: string;
  status: WalletTxStatus;
  createdAt: number;
  /** Free-form per-charge metadata (e.g. Sync's `productCount`). */
  details?: Record<string, unknown>;
};

export type WalletAutoReload = {
  enabled: boolean;
  threshold: number;
  amount: number;
};

export type WalletSummaries = {
  spent7: number;
  spent30: number;
  byModule: { module: string; amount: number }[];
  lastTopup: WalletTx | null;
};

export type WalletState = {
  balance: number;
  currency: "USD";
  transactions: WalletTx[];
  autoReload: WalletAutoReload;
  allowDevTopup: boolean;
  summaries?: WalletSummaries;
};

export type WalletRpcResult = {
  ok: true;
  duplicate?: boolean;
  remaining: number;
  txId?: string;
} | {
  ok: false;
  reason: "insufficient_funds" | "forbidden" | "error";
  message?: string;
  remaining?: number;
};
