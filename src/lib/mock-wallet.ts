"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Front-end only wallet. Balances and transactions live in localStorage so the
 * flow (top up → spend → history) behaves like the real product before the
 * billing backend exists. Nothing here talks to a payment provider.
 */

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
};

export type WalletAutoReload = {
  enabled: boolean;
  threshold: number;
  amount: number;
};

export type WalletState = {
  balance: number;
  currency: "USD";
  transactions: WalletTx[];
  autoReload: WalletAutoReload;
};

export const PAYMENT_METHODS = [
  { id: "visa-4242", label: "Visa •••• 4242", brand: "Visa" },
  { id: "mc-8813", label: "Mastercard •••• 8813", brand: "Mastercard" },
  { id: "paypal", label: "PayPal · billing@store.com", brand: "PayPal" },
] as const;

export const TOPUP_PRESETS = [25, 50, 100, 250, 500, 1000];

const STORAGE_PREFIX = "mock-wallet:v1:";
const listeners = new Set<() => void>();
const cache = new Map<string, WalletState>();

function storageKey(workspaceKey: string): string {
  return `${STORAGE_PREFIX}${workspaceKey}`;
}

function txId(): string {
  return `tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const DAY = 24 * 60 * 60 * 1000;

/** Seeded so a first-time visit still shows a believable history. */
function seedState(): WalletState {
  const now = Date.now();
  const transactions: WalletTx[] = [
    {
      id: txId(),
      kind: "topup",
      amount: 200,
      description: "Wallet top-up",
      module: "Billing",
      method: "Visa •••• 4242",
      status: "completed",
      createdAt: now - 26 * DAY,
    },
    {
      id: txId(),
      kind: "charge",
      amount: -48.6,
      description: "Deep market analysis · 4,860 keywords",
      module: "Market research",
      status: "completed",
      createdAt: now - 19 * DAY,
    },
    {
      id: txId(),
      kind: "charge",
      amount: -12.3,
      description: "Product image search · 1,230 lookups",
      module: "Sync",
      status: "completed",
      createdAt: now - 11 * DAY,
    },
    {
      id: txId(),
      kind: "refund",
      amount: 6.15,
      description: "Partial refund · failed image batch",
      module: "Sync",
      status: "completed",
      createdAt: now - 10 * DAY,
    },
    {
      id: txId(),
      kind: "charge",
      amount: -23.4,
      description: "Deep market analysis · 2,340 keywords",
      module: "Market research",
      status: "completed",
      createdAt: now - 3 * DAY,
    },
  ];
  const balance = transactions.reduce((sum, tx) => sum + tx.amount, 0);
  return {
    balance: round2(balance),
    currency: "USD",
    transactions,
    autoReload: { enabled: false, threshold: 25, amount: 100 },
  };
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function formatMoney(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function read(workspaceKey: string): WalletState {
  const cached = cache.get(workspaceKey);
  if (cached) return cached;
  let state: WalletState;
  try {
    const raw = window.localStorage.getItem(storageKey(workspaceKey));
    state = raw ? (JSON.parse(raw) as WalletState) : seedState();
  } catch {
    state = seedState();
  }
  cache.set(workspaceKey, state);
  return state;
}

function write(workspaceKey: string, next: WalletState) {
  cache.set(workspaceKey, next);
  try {
    window.localStorage.setItem(storageKey(workspaceKey), JSON.stringify(next));
  } catch {
    // Storage full or blocked — the in-memory cache still drives the session.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Auto-reload fires after a charge drops the balance under the threshold. */
function applyAutoReload(state: WalletState): WalletState {
  const { autoReload } = state;
  if (!autoReload.enabled || state.balance >= autoReload.threshold) return state;
  const tx: WalletTx = {
    id: txId(),
    kind: "topup",
    amount: autoReload.amount,
    description: `Auto-reload · balance fell under ${formatMoney(autoReload.threshold)}`,
    module: "Billing",
    method: PAYMENT_METHODS[0].label,
    status: "completed",
    createdAt: Date.now(),
  };
  return {
    ...state,
    balance: round2(state.balance + tx.amount),
    transactions: [tx, ...state.transactions],
  };
}

export function topUpWallet(
  workspaceKey: string,
  amount: number,
  method: string
): WalletTx {
  const state = read(workspaceKey);
  const tx: WalletTx = {
    id: txId(),
    kind: "topup",
    amount: round2(amount),
    description: "Wallet top-up",
    module: "Billing",
    method,
    status: "completed",
    createdAt: Date.now(),
  };
  write(workspaceKey, {
    ...state,
    balance: round2(state.balance + tx.amount),
    transactions: [tx, ...state.transactions],
  });
  return tx;
}

/** Returns false when the balance can't cover the charge. */
export function chargeWallet(
  workspaceKey: string,
  amount: number,
  description: string,
  module: string
): boolean {
  const state = read(workspaceKey);
  const value = round2(amount);
  if (value <= 0) return true;
  if (state.balance < value) return false;
  const tx: WalletTx = {
    id: txId(),
    kind: "charge",
    amount: -value,
    description,
    module,
    status: "completed",
    createdAt: Date.now(),
  };
  const charged: WalletState = {
    ...state,
    balance: round2(state.balance - value),
    transactions: [tx, ...state.transactions],
  };
  write(workspaceKey, applyAutoReload(charged));
  return true;
}

export function setAutoReload(
  workspaceKey: string,
  autoReload: WalletAutoReload
) {
  const state = read(workspaceKey);
  write(workspaceKey, { ...state, autoReload });
}

export function resetWallet(workspaceKey: string) {
  write(workspaceKey, seedState());
}

/** Money out over the last `days`, as a positive number. */
export function spentSince(state: WalletState, days: number): number {
  const from = Date.now() - days * DAY;
  return round2(
    state.transactions
      .filter((tx) => tx.amount < 0 && tx.createdAt >= from)
      .reduce((sum, tx) => sum + Math.abs(tx.amount), 0)
  );
}

export function spendByModule(
  state: WalletState
): { module: string; amount: number }[] {
  const totals = new Map<string, number>();
  for (const tx of state.transactions) {
    if (tx.amount >= 0) continue;
    totals.set(tx.module, (totals.get(tx.module) ?? 0) + Math.abs(tx.amount));
  }
  return [...totals.entries()]
    .map(([module, amount]) => ({ module, amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount);
}

export function transactionsToCsv(transactions: WalletTx[]): string {
  const head = "Date,Description,Module,Method,Type,Status,Amount (USD)";
  const rows = transactions.map((tx) =>
    [
      new Date(tx.createdAt).toISOString(),
      `"${tx.description.replace(/"/g, '""')}"`,
      tx.module,
      tx.method ?? "",
      tx.kind,
      tx.status,
      tx.amount.toFixed(2),
    ].join(",")
  );
  return [head, ...rows].join("\n");
}

/**
 * `null` until mounted on the client — callers render a skeleton meanwhile so
 * server and first client paint agree.
 */
export function useMockWallet(workspaceKey: string | null | undefined) {
  const getSnapshot = useCallback(
    () => (workspaceKey ? read(workspaceKey) : null),
    [workspaceKey]
  );
  const wallet = useSyncExternalStore(subscribe, getSnapshot, () => null);
  return wallet;
}
