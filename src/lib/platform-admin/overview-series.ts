import { CREDIT_TOPUP_USD_PER_CREDIT } from "@/lib/stripe";
import type { OverviewDayPoint } from "./live-types";
import type { AdminOverviewRange } from "./types";

const RANGE_DAYS: Record<AdminOverviewRange, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

function utcDay(iso: string): string {
  return iso.slice(0, 10);
}

function utcDateList(range: AdminOverviewRange, now = new Date()): string[] {
  const days = RANGE_DAYS[range];
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    dates.push(new Date(end - i * 86_400_000).toISOString().slice(0, 10));
  }
  return dates;
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

export function buildOverviewSeries(
  range: AdminOverviewRange,
  credits: { createdAt: string; credits: number }[],
  wallet: { createdAt: string; amountUsd: number; status: string }[],
  now = new Date()
): OverviewDayPoint[] {
  const dates = utcDateList(range, now);
  const byDay = new Map(dates.map((date) => [date, { date, creditUsd: 0, walletUsd: 0, credits: 0 }]));

  for (const tx of credits) {
    if (tx.credits <= 0) continue;
    const row = byDay.get(utcDay(tx.createdAt));
    if (!row) continue;
    row.credits += tx.credits;
    row.creditUsd += tx.credits * CREDIT_TOPUP_USD_PER_CREDIT;
  }

  for (const tx of wallet) {
    if (tx.status && tx.status !== "completed") continue;
    if (tx.amountUsd >= 0) continue;
    const row = byDay.get(utcDay(tx.createdAt));
    if (!row) continue;
    row.walletUsd += Math.abs(tx.amountUsd);
  }

  return dates.map((date) => {
    const row = byDay.get(date)!;
    return {
      date,
      credits: row.credits,
      creditUsd: roundUsd(row.creditUsd),
      walletUsd: roundUsd(row.walletUsd),
    };
  });
}

export { halfPeriodDeltaPercent } from "./overview-delta";
