"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import {
  DEFAULT_FILTERS,
  EXTRACT_CAP_PER_SEED,
  filterKeywords,
  pulledCountForSeed,
  weightedCount,
  type ExtractedKeyword,
  type KeywordFilters,
  type SeedExtractProgress,
} from "./workspace-data";
import type { MockSeedRow, SeedProbe } from "./mock-data";
import { formatUsd } from "./mock-data";
import { cn } from "@/lib/utils";

export function StageExtractPanel({
  seeds,
  probes,
  keywords,
  extracting,
  progress,
  seedProgress,
  chargedUsd,
  onAnalyze,
}: {
  seeds: MockSeedRow[];
  probes: Record<string, SeedProbe>;
  keywords: ExtractedKeyword[];
  extracting: boolean;
  progress: number;
  seedProgress: SeedExtractProgress[];
  chargedUsd: number;
  onAnalyze: () => void;
}) {
  const [filters, setFilters] = useState<KeywordFilters>(DEFAULT_FILTERS);
  const visible = useMemo(
    () => filterKeywords(keywords, filters),
    [keywords, filters]
  );
  const totalPulled = seeds.reduce(
    (sum, seed) => sum + pulledCountForSeed(seed, probes),
    0
  );
  const shownWeight = weightedCount(visible);

  if (extracting) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold tracking-tight">
            Extracting keywords
          </h2>
          <p className="text-xs text-muted-foreground">
            Up to {EXTRACT_CAP_PER_SEED.toLocaleString("en-US")} keywords per
            seed · intent and catalog matching run after this pull.
          </p>
        </div>
        <Progress value={Math.round(progress * 100)} className="h-1.5" />
        <ul className="space-y-2 overflow-y-auto">
          {seedProgress.map((row) => (
            <li
              key={row.seedId}
              className="rounded-xl border border-border/70 px-3 py-2.5"
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium truncate">{row.seed}</span>
                <span className="tabular-nums text-muted-foreground">
                  {row.pulled.toLocaleString("en-US")} /{" "}
                  {row.cap.toLocaleString("en-US")}
                </span>
              </div>
              <Progress
                value={row.cap ? (row.pulled / row.cap) * 100 : 0}
                className="mt-2 h-1"
              />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2 shrink-0">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Extract</h2>
          <p className="text-[11px] text-muted-foreground">
            {totalPulled.toLocaleString("en-US")} keywords pulled ·{" "}
            {formatUsd(chargedUsd)} charged from wallet. Filters below are free
            and do not change that bill.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-card px-3 py-2 shrink-0">
        <Input
          value={filters.query}
          onChange={(e) =>
            setFilters((prev) => ({ ...prev, query: e.target.value }))
          }
          placeholder="Include / exclude…"
          className="h-8 w-[180px] text-xs"
          aria-label="Filter keywords"
        />
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          Min volume
          <Input
            type="number"
            min={0}
            value={filters.minVolume}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                minVolume: Number(e.target.value) || 0,
              }))
            }
            className="h-8 w-[88px] text-xs"
          />
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          Max KD
          <Input
            type="number"
            min={0}
            max={100}
            value={filters.maxKd}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                maxKd: Number(e.target.value) || 0,
              }))
            }
            className="h-8 w-[72px] text-xs"
          />
        </label>
        <button
          type="button"
          aria-pressed={filters.questionsOnly}
          onClick={() =>
            setFilters((prev) => ({
              ...prev,
              questionsOnly: !prev.questionsOnly,
            }))
          }
          className={cn(
            "rounded-full border px-2.5 py-1 text-[11px] font-medium",
            filters.questionsOnly
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border/70 text-muted-foreground hover:text-foreground"
          )}
        >
          Questions
        </button>
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
          Showing {visible.length.toLocaleString("en-US")} sample rows · ~
          {shownWeight.toLocaleString("en-US")} after filters
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border/70">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Keyword</TableHead>
              <TableHead className="text-xs">Seed</TableHead>
              <TableHead className="text-xs text-right">Volume</TableHead>
              <TableHead className="text-xs text-right">KD</TableHead>
              <TableHead className="text-xs">Intent</TableHead>
              <TableHead className="text-xs text-right">Products</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-10 text-center text-xs text-muted-foreground"
                >
                  No keywords match these filters.
                </TableCell>
              </TableRow>
            ) : (
              visible.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-sm">{row.keyword}</TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {row.seed}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums text-right">
                    {row.volume.toLocaleString("en-US")}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums text-right">
                    {row.difficulty}
                  </TableCell>
                  <TableCell className="text-[11px] capitalize text-muted-foreground">
                    {row.sheet === "category" ? "Category" : "Informational"}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums text-right">
                    {row.productMatches.toLocaleString("en-US")}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between gap-2 shrink-0">
        <p className="text-[11px] text-muted-foreground">
          Analyze splits this set into informational queries vs keywords
          suitable for category pages.
        </p>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={onAnalyze}>
          <Search className="h-3.5 w-3.5" />
          Analyze
        </Button>
      </div>
    </div>
  );
}
