import type { WalletState, WalletTx } from "./types";

const DAY = 24 * 60 * 60 * 1000;

export const PAYMENT_METHODS = [
  { id: "visa-4242", label: "Visa •••• 4242", brand: "Visa" },
  { id: "mc-8813", label: "Mastercard •••• 8813", brand: "Mastercard" },
  { id: "paypal", label: "PayPal · billing@store.com", brand: "PayPal" },
] as const;

export const TOPUP_PRESETS = [25, 50, 100, 250, 500, 1000];

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function formatMoney(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: abs > 0 && abs < 0.01 ? 4 : 2,
  })}`;
}

/** Money out over the last `days`, as a positive number. */
export function spentSince(state: WalletState, days: number): number {
  if (state.summaries) {
    return days <= 7 ? state.summaries.spent7 : state.summaries.spent30;
  }
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
  if (state.summaries) return state.summaries.byModule;
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
