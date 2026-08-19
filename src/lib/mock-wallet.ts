"use client";

/**
 * Legacy localStorage wallet. Market Research and the Wallet page now use
 * `/api/wallet` (Postgres). These helpers remain for older tests and are
 * re-exported from the shared format module.
 */

export type {
  WalletAutoReload,
  WalletState,
  WalletTx,
  WalletTxKind,
  WalletTxStatus,
} from "@/lib/wallet/types";
export {
  PAYMENT_METHODS,
  TOPUP_PRESETS,
  formatMoney,
  round2,
  spendByModule,
  spentSince,
  transactionsToCsv,
} from "@/lib/wallet/format";

export {
  chargeWallet,
  getWalletBalance,
  resetWallet,
  setAutoReload,
  topUpWallet,
  useMockWallet,
} from "./mock-wallet-local";
