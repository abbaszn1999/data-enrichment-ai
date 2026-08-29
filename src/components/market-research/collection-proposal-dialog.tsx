"use client";

import { useMemo, useState } from "react";
import {
  FileText,
  Layers,
  LineChart,
  Percent,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatUsd } from "./mock-data";
import { USD_PER_COLLECTION, type ProposedCollection } from "./workspace-data";
import { cn } from "@/lib/utils";

/** Conservative share of monthly search volume modeled as organic sessions. */
export const TRAFFIC_HORIZONS = [
  { months: 3, capture: 0.1, label: "3 months", note: "Index & early ranks" },
  { months: 6, capture: 0.2, label: "6 months", note: "Compounding ranks" },
  { months: 12, capture: 0.35, label: "12 months", note: "Mature capture" },
] as const;

const DEFAULT_AOV = 80;
const DEFAULT_CRO = 2;

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Accepts 0.5, .5, 0. and comma decimals. */
function parseDecimal(raw: string) {
  const normalized = raw.trim().replace(",", ".");
  if (!normalized || normalized === "." || normalized === "-") return 0;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function isDecimalTyping(raw: string) {
  return /^\d*[.,]?\d*$/.test(raw.trim());
}

export function summarizeSelection(collections: ProposedCollection[]) {
  const count = collections.length;
  const totalVolume = collections.reduce((sum, row) => sum + (row.volume || 0), 0);
  const volumeWeight = collections.reduce(
    (sum, row) => sum + (row.volume || 0) * (row.difficulty || 0),
    0
  );
  const simpleKd =
    count === 0
      ? 0
      : collections.reduce((sum, row) => sum + (row.difficulty || 0), 0) / count;
  const avgKd = totalVolume > 0 ? volumeWeight / totalVolume : simpleKd;
  return { count, totalVolume, avgKd };
}

export function projectHorizon(params: {
  monthlyVolume: number;
  capture: number;
  croPct: number;
  aov: number;
}) {
  const sessions = Math.max(0, params.monthlyVolume) * params.capture;
  const orders = sessions * (clampNumber(params.croPct, 0, 100) / 100);
  const revenue = orders * Math.max(0, params.aov);
  return { sessions, orders, revenue };
}

function formatCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1_000).toLocaleString("en-US")}K`;
  return Math.round(value).toLocaleString("en-US");
}

function formatOrders(value: number) {
  if (value >= 10) return formatCount(value);
  if (value >= 1) return value.toFixed(1);
  if (value <= 0) return "0";
  return value.toFixed(2);
}

type CollectionProposalDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collections: ProposedCollection[];
};

export function CollectionProposalDialog({
  open,
  onOpenChange,
  collections,
}: CollectionProposalDialogProps) {
  const [aovInput, setAovInput] = useState(String(DEFAULT_AOV));
  const [croInput, setCroInput] = useState(String(DEFAULT_CRO));

  const aov = clampNumber(parseDecimal(aovInput), 0, 1_000_000);
  const croPct = clampNumber(parseDecimal(croInput), 0, 100);

  const stats = useMemo(() => summarizeSelection(collections), [collections]);
  const publishCost = stats.count * USD_PER_COLLECTION;

  const horizons = useMemo(
    () =>
      TRAFFIC_HORIZONS.map((horizon) => ({
        ...horizon,
        ...projectHorizon({
          monthlyVolume: stats.totalVolume,
          capture: horizon.capture,
          croPct,
          aov,
        }),
      })),
    [stats.totalVolume, croPct, aov]
  );

  const yearRunRate = horizons[2]?.revenue ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <div className="relative overflow-hidden border-b border-border/60 bg-gradient-to-br from-[#400095]/[0.09] via-background to-[#F76D01]/[0.08] px-6 py-5">
          <div className="pointer-events-none absolute -left-16 -top-20 h-48 w-48 rounded-full bg-[#400095]/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -right-10 h-48 w-48 rounded-full bg-[#F76D01]/10 blur-3xl" />
          <DialogHeader className="relative space-y-1.5 text-left">
            <div className="mb-1 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#400095] text-white shadow-[0_8px_25px_rgba(64,0,149,.22)] dark:bg-[#F76D01]">
                <FileText className="h-4 w-4" />
              </span>
              <span className="text-[9px] font-black uppercase tracking-[0.24em] text-[#400095] dark:text-[#F76D01]">
                Growth proposal
              </span>
            </div>
            <DialogTitle className="text-xl font-black tracking-[-0.03em] sm:text-2xl">
              Demand from this selection.
            </DialogTitle>
            <DialogDescription className="max-w-xl text-xs leading-relaxed">
              Live from the collections checked on this sheet. Close, change the
              selection, open again. AOV and conversion are yours — the forecast
              updates as you type.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="max-h-[min(72vh,720px)] space-y-5 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard
              icon={Layers}
              label="Collections selected"
              value={stats.count.toLocaleString("en-US")}
              hint={`${formatUsd(publishCost)} to publish`}
            />
            <StatCard
              icon={TrendingUp}
              label="Monthly search volume"
              value={stats.totalVolume.toLocaleString("en-US")}
              hint="Sum of selected queries"
            />
            <StatCard
              icon={LineChart}
              label="Average KD"
              value={stats.avgKd.toFixed(0)}
              hint="Volume-weighted difficulty"
            />
          </div>

          <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Percent className="h-3.5 w-3.5 text-primary" />
              <p className="text-xs font-semibold tracking-tight">
                Your store economics
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="proposal-aov" className="text-[11px] text-muted-foreground">
                  Average order value (AOV)
                </Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    $
                  </span>
                  <Input
                    id="proposal-aov"
                    type="number"
                    min={0}
                    step={1}
                    value={aovInput}
                    onChange={(e) => setAovInput(e.target.value)}
                    className="h-10 pl-7 text-sm font-semibold tabular-nums"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="proposal-cro" className="text-[11px] text-muted-foreground">
                  Conversion rate (CRO)
                </Label>
                <div className="relative">
                  <Input
                    id="proposal-cro"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0.5"
                    value={croInput}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (next === "" || isDecimalTyping(next)) setCroInput(next);
                    }}
                    className="h-10 pr-8 text-sm font-semibold tabular-nums"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    %
                  </span>
                </div>
              </div>
            </div>
            <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
              Set these to the AOV and conversion you actually see on this niche
              in your store. Traffic uses a conservative share of the selected
              monthly search volume — not 100% of every search.
            </p>
          </div>

          <div>
            <p className="mb-2.5 text-sm font-semibold tracking-tight">
              Projected monthly run-rate
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {horizons.map((horizon, index) => (
                <div
                  key={horizon.months}
                  className={cn(
                    "flex flex-col rounded-2xl border p-4",
                    index === 2
                      ? "border-[#400095]/35 bg-gradient-to-b from-[#400095]/[0.08] to-background dark:border-[#F76D01]/35 dark:from-[#F76D01]/[0.1]"
                      : "border-border/70 bg-card"
                  )}
                >
                  <p className="text-[11px] font-bold uppercase tracking-wider text-foreground">
                    After {horizon.label}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                    {horizon.note} · capturing {Math.round(horizon.capture * 100)}% of
                    search volume
                  </p>

                  <div className="mt-4 rounded-xl bg-background/80 px-3 py-3 ring-1 ring-border/60">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Sales / month
                    </p>
                    <p className="mt-1 text-[1.65rem] font-black leading-none tracking-tight tabular-nums text-primary">
                      {formatUsd(horizon.revenue)}
                    </p>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-muted/40 px-3 py-2.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Orders
                      </p>
                      <p className="mt-1 text-lg font-bold leading-none tabular-nums text-foreground">
                        {formatOrders(horizon.orders)}
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        / month
                      </p>
                    </div>
                    <div className="rounded-xl bg-muted/40 px-3 py-2.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Sessions
                      </p>
                      <p className="mt-1 text-lg font-bold leading-none tabular-nums text-foreground">
                        {formatCount(horizon.sessions)}
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        / month
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            At the 12-month capture rate, this selection is a{" "}
            <span className="font-semibold text-foreground">
              {formatUsd(yearRunRate)}
            </span>{" "}
            monthly sales run-rate on your AOV and conversion — not a guarantee.
            Rankings, inventory, and on-page work still have to earn the click.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/70 bg-muted/20 px-6 py-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Layers;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-2 text-2xl font-black tracking-tight tabular-nums">
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}
