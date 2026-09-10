"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
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
import type { ExtractedKeyword } from "./workspace-data";
import { cn } from "@/lib/utils";

/** Share of suitable category demand modeled if the catalog can cover it. */
export const CAPTURE_SCENARIOS = [
  { capture: 0.2, label: "20% capture", note: "Early catalog coverage" },
  { capture: 0.4, label: "40% capture", note: "Solid assortment match" },
  { capture: 0.6, label: "60% capture", note: "Strong product coverage" },
] as const;

const DEFAULT_AOV = 80;
const DEFAULT_CRO = 2;

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function parseDecimal(raw: string) {
  const normalized = raw.trim().replace(",", ".");
  if (!normalized || normalized === "." || normalized === "-") return 0;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function isDecimalTyping(raw: string) {
  return /^\d*[.,]?\d*$/.test(raw.trim());
}

export function summarizeCategoryTerms(keywords: ExtractedKeyword[]) {
  const count = keywords.length;
  const totalVolume = keywords.reduce((sum, row) => sum + (row.volume || 0), 0);
  const volumeWeight = keywords.reduce(
    (sum, row) => sum + (row.volume || 0) * (row.difficulty || 0),
    0
  );
  const simpleKd =
    count === 0
      ? 0
      : keywords.reduce((sum, row) => sum + (row.difficulty || 0), 0) / count;
  const avgKd = totalVolume > 0 ? volumeWeight / totalVolume : simpleKd;
  return { count, totalVolume, avgKd };
}

export function projectCapture(params: {
  monthlyVolume: number;
  capture: number;
  croPct: number;
  aov: number;
}) {
  const targetingVolume = Math.max(0, params.monthlyVolume) * params.capture;
  const sessions = targetingVolume;
  const orders = sessions * (clampNumber(params.croPct, 0, 100) / 100);
  const revenue = orders * Math.max(0, params.aov);
  return { targetingVolume, sessions, orders, revenue };
}

function formatCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1_000).toLocaleString("en-US")}K`;
  return Math.round(value).toLocaleString("en-US");
}

type AssessmentProposalDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keywords: ExtractedKeyword[];
  growthEngineHref?: string;
};

export function AssessmentProposalDialog({
  open,
  onOpenChange,
  keywords,
  growthEngineHref,
}: AssessmentProposalDialogProps) {
  const [aovInput, setAovInput] = useState(String(DEFAULT_AOV));
  const [croInput, setCroInput] = useState(String(DEFAULT_CRO));

  const aov = clampNumber(parseDecimal(aovInput), 0, 1_000_000);
  const croPct = clampNumber(parseDecimal(croInput), 0, 100);

  const stats = useMemo(() => summarizeCategoryTerms(keywords), [keywords]);

  const scenarios = useMemo(
    () =>
      CAPTURE_SCENARIOS.map((scenario) => ({
        ...scenario,
        ...projectCapture({
          monthlyVolume: stats.totalVolume,
          capture: scenario.capture,
          croPct,
          aov,
        }),
        avgKd: stats.avgKd,
      })),
    [stats.totalVolume, stats.avgKd, croPct, aov]
  );

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
              Demand from suitable category terms.
            </DialogTitle>
            <DialogDescription className="max-w-xl text-xs leading-relaxed">
              Live from every term classified as a suitable category (PLP) query.
              Scenarios ask what happens if your catalog can cover 20%, 40%, or
              60% of that demand. AOV and conversion are yours — the forecast
              updates as you type.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="max-h-[min(72vh,720px)] space-y-5 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard
              icon={Layers}
              label="Suitable category terms"
              value={stats.count.toLocaleString("en-US")}
              hint="Classified as PLP-suitable"
            />
            <StatCard
              icon={TrendingUp}
              label="Monthly search volume"
              value={stats.totalVolume.toLocaleString("en-US")}
              hint="Sum of suitable queries"
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
                <Label htmlFor="fa-proposal-aov" className="text-[11px] text-muted-foreground">
                  Average order value (AOV)
                </Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    $
                  </span>
                  <Input
                    id="fa-proposal-aov"
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
                <Label htmlFor="fa-proposal-cro" className="text-[11px] text-muted-foreground">
                  Conversion rate (CRO)
                </Label>
                <div className="relative">
                  <Input
                    id="fa-proposal-cro"
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
              Set these to the AOV and conversion you actually see. Each scenario
              assumes you have suitable products covering that share of category
              search volume — not a live match against your catalog.
            </p>
          </div>

          <div>
            <p className="mb-2.5 text-sm font-semibold tracking-tight">
              If you have products to capture this demand
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {scenarios.map((scenario, index) => (
                <div
                  key={scenario.label}
                  className={cn(
                    "flex flex-col rounded-2xl border p-4",
                    index === 2
                      ? "border-[#400095]/35 bg-gradient-to-b from-[#400095]/[0.08] to-background dark:border-[#F76D01]/35 dark:from-[#F76D01]/[0.1]"
                      : "border-border/70 bg-card"
                  )}
                >
                  <p className="text-[11px] font-bold uppercase tracking-wider text-foreground">
                    {scenario.label}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                    {scenario.note}
                  </p>

                  <div className="mt-4 rounded-xl bg-background/80 px-3 py-3 ring-1 ring-border/60">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Estimated sales / month
                    </p>
                    <p className="mt-1 text-[1.65rem] font-black leading-none tracking-tight tabular-nums text-primary">
                      {formatUsd(scenario.revenue)}
                    </p>
                  </div>

                  <dl className="mt-3 space-y-2">
                    <ScenarioStat
                      label="Search volume targeting"
                      value={formatCount(scenario.targetingVolume)}
                      hint="/ month"
                    />
                    <ScenarioStat
                      label="Average KD"
                      value={scenario.avgKd.toFixed(0)}
                      hint="same keyword mix"
                    />
                    <ScenarioStat
                      label="Est. monthly traffic"
                      value={formatCount(scenario.sessions)}
                      hint="sessions / month"
                    />
                  </dl>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-[#400095]/20 bg-[#400095]/[0.04] p-4 dark:border-[#F76D01]/25 dark:bg-[#F76D01]/[0.06]">
            <p className="text-xs font-semibold tracking-tight text-foreground">
              For an accurate estimation, sync your store with Autommerce OS.
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              Free Assessment has no live catalog, so these scenarios cannot match
              terms to products you actually sell. Open the main{" "}
              <span className="font-semibold text-foreground">Growth Engine</span>{" "}
              after connecting Shopify or WooCommerce — there we read your
              collections and SKUs, cluster these terms into collection
              opportunities, and forecast against real inventory.
            </p>
            {growthEngineHref ? (
              <Button
                asChild
                size="sm"
                className="mt-3 h-8 gap-1.5 text-xs font-semibold"
              >
                <Link href={growthEngineHref}>
                  Open Growth Engine
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            ) : null}
          </div>
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

function ScenarioStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl bg-muted/40 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-bold tabular-nums text-foreground">
        {value}
        <span className="ml-1 text-[10px] font-medium text-muted-foreground">
          {hint}
        </span>
      </p>
    </div>
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
