"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { WalletAutoReload, WalletState, WalletTx } from "@/lib/wallet/types";
import {
  PAYMENT_METHODS,
  formatMoney,
  round2,
} from "@/lib/wallet/format";

/**
 * Front-end only wallet leftover. Prefer `/api/wallet`.
 */

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
  ];
  const balance = transactions.reduce((sum, tx) => sum + tx.amount, 0);
  return {
    balance: round2(balance),
    currency: "USD",
    transactions,
    autoReload: { enabled: false, threshold: 25, amount: 100 },
    allowDevTopup: true,
  };
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

export function getWalletBalance(workspaceKey: string): number {
  if (typeof window === "undefined") return 0;
  return read(workspaceKey).balance;
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

export function useMockWallet(workspaceKey: string | null | undefined) {
  const getSnapshot = useCallback(
    () => (workspaceKey ? read(workspaceKey) : null),
    [workspaceKey]
  );
  const wallet = useSyncExternalStore(subscribe, getSnapshot, () => null);
  return wallet;
}
