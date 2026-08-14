"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Copy,
  Info,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Rows3,
  Search,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  MARKETS,
  STAGE3_EXCLUDED_EXAMPLES,
  estimateSelection,
  formatProductCount,
  formatUsd,
  groupSeedRowsByCanonical,
  isProbeStale,
  marketLabel,
  seedIdsWithinBudget,
  seedRowsToCsv,
  usdForRawKeywords,
  type MockSeedRow,
  type ScopeMatch,
  type SeedProbe,
} from "./mock-data";
import { cn } from "@/lib/utils";

const SCOPE_FILTERS: ScopeMatch[] = ["Exact", "Close", "Broader", "Ambiguous"];

function scopeMatchClass(match: ScopeMatch): string {
  switch (match) {
    case "Exact":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30";
    case "Close":
      return "bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/30";
    case "Broader":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
    case "Ambiguous":
      return "bg-muted text-muted-foreground border-border";
    default:
      return "";
  }
}

type StageSeedsPanelProps = {
  rows: MockSeedRow[];
  preparing?: boolean;
  stale?: boolean;
  onRegenerate?: () => void;
  selectedIds: string[];
  onChangeSelected: (ids: string[]) => void;
  /** Stage 3b demand probe. */
  market: string;
  onChangeMarket: (market: string) => void;
  probes: Record<string, SeedProbe>;
  probingIds: string[];
  onProbe: (rowIds: string[]) => void;
  onAddManualSeed: (term: string, canonicalKey: string) => void;
  onConfirmSpend: () => void;
  committed?: boolean;
  walletHref?: string;
  readOnly?: boolean;
};

/** Stage 3 — broad seed variations plus the demand/cost decision surface. */
export function StageSeedsPanel({
  rows,
  preparing = false,
  stale = false,
  onRegenerate,
  selectedIds,
  onChangeSelected,
  market,
  onChangeMarket,
  probes,
  probingIds,
  onProbe,
  onAddManualSeed,
  onConfirmSpend,
  committed = false,
  walletHref,
  readOnly = false,
}: StageSeedsPanelProps) {
  const [view, setView] = useState<"rows" | "grouped">("rows");
  const [query, setQuery] = useState("");
  const [scopes, setScopes] = useState<ScopeMatch[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [manualTerm, setManualTerm] = useState("");
  const [manualFamily, setManualFamily] = useState("");
  const [budget, setBudget] = useState<number | null>(null);

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const probing = useMemo(() => new Set(probingIds), [probingIds]);

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (scopes.length > 0 && !scopes.includes(row.scopeMatch)) return false;
      if (!q) return true;
      return (
        row.broadSeedVariation.toLowerCase().includes(q) ||
        row.canonicalNicheSeed.toLowerCase().includes(q) ||
        row.selectedCollection.toLowerCase().includes(q)
      );
    });
  }, [rows, query, scopes]);

  const groups = useMemo(
    () => groupSeedRowsByCanonical(visibleRows),
    [visibleRows]
  );
  const allGroups = useMemo(() => groupSeedRowsByCanonical(rows), [rows]);

  const selectedRows = useMemo(
    () => rows.filter((row) => selected.has(row.id)),
    [rows, selected]
  );
  const estimate = useMemo(
    () => estimateSelection(selectedRows, probes),
    [selectedRows, probes]
  );
  const maxBudget = Math.max(0.01, estimate.usd);
  const effectiveBudget = budget ?? maxBudget;

  const allVisibleSelected =
    visibleRows.length > 0 && visibleRows.every((r) => selected.has(r.id));
  const unprobedSelected = selectedRows.filter(
    (row) => !probes[row.id] && !probing.has(row.id)
  );
  const staleSelected = selectedRows.filter(
    (row) => probes[row.id] && isProbeStale(probes[row.id], market)
  );

  if (preparing) {
    return (
      <div className="flex h-full min-h-[320px] flex-col items-center justify-center px-4 py-10">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <div className="space-y-1">
            <h2 className="text-base font-semibold tracking-tight">
              Generating broad seed variations
            </h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              The agent is building one seed family per selected collection —
              canonical terms plus broad wording only. Follow the chat on the
              left.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const toggleRow = (id: string) => {
    if (readOnly) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChangeSelected(Array.from(next));
  };

  const toggleAllVisible = () => {
    if (readOnly) return;
    const next = new Set(selected);
    if (allVisibleSelected) visibleRows.forEach((r) => next.delete(r.id));
    else visibleRows.forEach((r) => next.add(r.id));
    onChangeSelected(Array.from(next));
  };

  const toggleGroup = (groupRows: MockSeedRow[]) => {
    if (readOnly) return;
    const next = new Set(selected);
    const allOn = groupRows.every((r) => next.has(r.id));
    if (allOn) groupRows.forEach((r) => next.delete(r.id));
    else groupRows.forEach((r) => next.add(r.id));
    onChangeSelected(Array.from(next));
  };

  const copySelected = async () => {
    const target = selectedRows.length > 0 ? selectedRows : rows;
    try {
      await navigator.clipboard.writeText(seedRowsToCsv(target));
      toast.success("Copied as CSV", {
        description: `${target.length} rows on your clipboard.`,
      });
    } catch {
      toast.error("Couldn’t copy", {
        description: "Clipboard access was blocked by the browser.",
      });
    }
  };

  const toggleScope = (scope: ScopeMatch) => {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  };

  const submitManualSeed = () => {
    const term = manualTerm.trim();
    const family = manualFamily || allGroups[0]?.canonicalNicheSeed;
    if (!term || !family) return;
    onAddManualSeed(term, family);
    setManualTerm("");
  };

  const applyBudget = () => {
    const kept = seedIdsWithinBudget(selectedRows, probes, effectiveBudget);
    const unprobedKept = selectedRows
      .filter((row) => !probes[row.id])
      .map((row) => row.id);
    onChangeSelected([...kept, ...unprobedKept]);
    toast.success("Selection trimmed to budget", {
      description: `${kept.length} probed seeds kept within ${formatUsd(effectiveBudget)}.`,
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col space-y-3">
      <div className="space-y-2 shrink-0">
        {stale && onRegenerate && !readOnly ? (
          <div className="flex flex-col gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
              Catalog scope changed in Stage 2. These rows are from the previous
              scope until you regenerate.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5 shrink-0"
              onClick={onRegenerate}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Regenerate
            </Button>
          </div>
        ) : null}

        {/* Demand probe gate — market first, because volume is per market. */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-card px-3 py-2.5">
          <label className="text-[11px] font-medium text-muted-foreground">
            Market
          </label>
          {readOnly ? (
            <span className="text-xs">
              {MARKETS.find((option) => option.code === market)?.label ?? market}
            </span>
          ) : (
          <select
            value={market}
            onChange={(e) => onChangeMarket(e.target.value)}
            className="h-8 rounded-lg border border-border/70 bg-background px-2 text-xs outline-none focus:border-foreground/30"
            aria-label="Target country and language"
          >
            {MARKETS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
          )}
          {readOnly ? (
            <p className="ml-auto text-[11px] text-muted-foreground">
              View only — demand checks are closed.
            </p>
          ) : staleSelected.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5 text-xs"
              onClick={() => onProbe(staleSelected.map((r) => r.id))}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Re-check {staleSelected.length} stale
            </Button>
          ) : null}
          {readOnly ? null : (
          <Button
            type="button"
            size="sm"
            className="ml-auto h-8 gap-1.5 text-xs"
            disabled={unprobedSelected.length === 0 || probing.size > 0}
            onClick={() => onProbe(unprobedSelected.map((r) => r.id))}
          >
            {probing.size > 0 ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            Check demand
            {unprobedSelected.length > 0 ? ` (${unprobedSelected.length})` : ""}
          </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border/70 p-0.5">
            {(
              [
                { id: "rows", label: "Rows", icon: Rows3 },
                { id: "grouped", label: "By canonical seed", icon: Layers },
              ] as const
            ).map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setView(option.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                    view === option.id
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {option.label}
                </button>
              );
            })}
          </div>

          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter seeds…"
            className="h-8 w-[160px] text-xs"
            aria-label="Filter seed variations"
            disabled={readOnly}
          />

          <div className="flex flex-wrap items-center gap-1">
            {SCOPE_FILTERS.map((scope) => {
              const on = scopes.includes(scope);
              return (
                <button
                  key={scope}
                  type="button"
                  onClick={() => toggleScope(scope)}
                  disabled={readOnly}
                  aria-pressed={on}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors disabled:cursor-default",
                    on
                      ? scopeMatchClass(scope)
                      : "border-border/70 text-muted-foreground hover:text-foreground"
                  )}
                >
                  {scope}
                </button>
              );
            })}
          </div>

          <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
            {rows.length} rows · {allGroups.length} canonical
          </span>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="What the agent leaves out of this stage"
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[260px]">
                <p className="font-medium">Left out on purpose</p>
                <ul className="mt-1 space-y-0.5">
                  {STAGE3_EXCLUDED_EXAMPLES.map((item) => (
                    <li key={item}>• {item}</li>
                  ))}
                </ul>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {readOnly ? null : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={copySelected}
            disabled={rows.length === 0}
          >
            <Copy className="h-3.5 w-3.5" />
            Copy CSV
          </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border/70 bg-card">
        {view === "rows" ? (
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-9">
                  <SelectBox
                    state={
                      allVisibleSelected
                        ? "all"
                        : visibleRows.some((r) => selected.has(r.id))
                          ? "some"
                          : "none"
                    }
                    onClick={readOnly ? undefined : toggleAllVisible}
                    label="Select all visible seeds"
                  />
                </TableHead>
                <TableHead className="text-xs whitespace-nowrap">
                  Broad seed
                </TableHead>
                <TableHead className="text-xs whitespace-nowrap">
                  Canonical
                </TableHead>
                <TableHead className="text-xs whitespace-nowrap">
                  Collection
                </TableHead>
                <TableHead className="text-xs whitespace-nowrap">
                  Scope
                </TableHead>
                <TableHead className="text-xs whitespace-nowrap text-right">
                  Raw keywords
                </TableHead>
                <TableHead className="text-xs whitespace-nowrap text-right">
                  Volume
                </TableHead>
                <TableHead className="text-xs whitespace-nowrap text-right">
                  Price
                </TableHead>
                <TableHead className="text-xs whitespace-nowrap text-right">
                  Cost share
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="text-center text-xs text-muted-foreground py-8"
                  >
                    {rows.length === 0
                      ? "No seed rows for the current selection."
                      : "No seeds match these filters."}
                  </TableCell>
                </TableRow>
              ) : (
                visibleRows.map((row) => {
                  const on = selected.has(row.id);
                  const probe = probes[row.id];
                  const isProbing = probing.has(row.id);
                  const price = probe
                    ? usdForRawKeywords(probe.rawKeywords)
                    : 0;
                  const share =
                    probe && estimate.rawKeywords > 0 && on
                      ? (probe.rawKeywords / estimate.rawKeywords) * 100
                      : null;
                  const expanded = expandedId === row.id;
                  return (
                    <Fragment key={row.id}>
                      <TableRow
                        onClick={() =>
                          setExpandedId(expanded ? null : row.id)
                        }
                        className={cn(
                          "cursor-pointer hover:bg-muted/40",
                          on && "bg-primary/5"
                        )}
                      >
                        <TableCell className="w-9">
                          <SelectBox
                            state={on ? "all" : "none"}
                            onClick={
                              readOnly ? undefined : () => toggleRow(row.id)
                            }
                            label={`Select ${row.broadSeedVariation}`}
                          />
                        </TableCell>
                        <TableCell className="text-sm font-medium whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            <ChevronRight
                              className={cn(
                                "h-3 w-3 text-muted-foreground transition-transform",
                                expanded && "rotate-90"
                              )}
                            />
                            {row.broadSeedVariation}
                            {row.manual ? (
                              <span className="rounded-full border border-border/70 px-1.5 text-[9px] text-muted-foreground">
                                Manual
                              </span>
                            ) : null}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {row.canonicalNicheSeed}
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {row.selectedCollection}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Badge
                            variant="outline"
                            className={`text-[10px] font-medium ${scopeMatchClass(row.scopeMatch)}`}
                          >
                            {row.scopeMatch}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs tabular-nums text-right whitespace-nowrap">
                          <ProbeCell
                            probe={probe}
                            probing={isProbing}
                            market={market}
                            value={probe?.rawKeywords}
                          />
                        </TableCell>
                        <TableCell className="text-xs tabular-nums text-right whitespace-nowrap">
                          <ProbeCell
                            probe={probe}
                            probing={isProbing}
                            market={market}
                            value={probe?.searchVolume}
                          />
                        </TableCell>
                        <TableCell className="text-xs tabular-nums text-right whitespace-nowrap">
                          {probe && !probe.failed ? formatUsd(price) : "—"}
                        </TableCell>
                        <TableCell className="text-xs tabular-nums text-right whitespace-nowrap">
                          {share === null ? (
                            "—"
                          ) : (
                            <span
                              className={cn(
                                share >= 50 &&
                                  "font-semibold text-amber-700 dark:text-amber-400"
                              )}
                            >
                              {share.toFixed(0)}%
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                      {expanded ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={9} className="bg-muted/20">
                            <SeedDetail
                              row={row}
                              probe={probe}
                              probing={isProbing}
                              onProbe={() => onProbe([row.id])}
                              readOnly={readOnly}
                            />
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>
        ) : (
          <div className="divide-y divide-border/60">
            {groups.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                {rows.length === 0
                  ? "No seed rows for the current selection."
                  : "No seeds match these filters."}
              </p>
            ) : (
              groups.map((group) => {
                const groupOn = group.rows.every((r) => selected.has(r.id));
                const groupSome = group.rows.some((r) => selected.has(r.id));
                const groupProbes = group.rows
                  .map((r) => probes[r.id])
                  .filter((p): p is SeedProbe => Boolean(p) && !p?.failed);
                const groupRaw = groupProbes.reduce(
                  (sum, p) => sum + p.rawKeywords,
                  0
                );
                const groupVolume = groupProbes.reduce(
                  (sum, p) => sum + p.searchVolume,
                  0
                );
                return (
                  <section
                    key={`${group.selectedCollection}-${group.canonicalNicheSeed}`}
                  >
                    <div className="flex items-center gap-3 bg-muted/30 px-4 py-2.5">
                      <SelectBox
                        state={groupOn ? "all" : groupSome ? "some" : "none"}
                        onClick={
                          readOnly
                            ? undefined
                            : () => toggleGroup(group.rows)
                        }
                        label={`Select ${group.canonicalNicheSeed} family`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold tracking-tight truncate">
                          {group.canonicalNicheSeed}
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {group.selectedCollection} · {group.broadParentNiche} ·{" "}
                          {formatProductCount(group.productCount)} products ·{" "}
                          {group.rows.length} variation
                          {group.rows.length === 1 ? "" : "s"}
                        </p>
                      </div>
                      {groupProbes.length > 0 ? (
                        <div className="shrink-0 text-right text-[10px] text-muted-foreground tabular-nums">
                          <div>
                            {groupRaw.toLocaleString("en-US")} raw ·{" "}
                            {groupVolume.toLocaleString("en-US")} vol
                          </div>
                          <div>
                            {formatUsd(usdForRawKeywords(groupRaw))} before
                            overlap
                          </div>
                        </div>
                      ) : readOnly ? null : (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 shrink-0 gap-1.5 text-[11px]"
                          disabled={probing.size > 0}
                          onClick={() => onProbe(group.rows.map((r) => r.id))}
                        >
                          <Search className="h-3 w-3" />
                          Check family
                        </Button>
                      )}
                    </div>
                    <ul className="divide-y divide-border/40">
                      {group.rows.map((row) => {
                        const on = selected.has(row.id);
                        const probe = probes[row.id];
                        return (
                          <li
                            key={row.id}
                            className={cn(
                              "flex items-center gap-3 px-4 py-2",
                              on && "bg-primary/5"
                            )}
                          >
                            <SelectBox
                              state={on ? "all" : "none"}
                              onClick={
                                readOnly ? undefined : () => toggleRow(row.id)
                              }
                              label={`Select ${row.broadSeedVariation}`}
                            />
                            <span className="min-w-0 flex-1 text-sm truncate">
                              {row.broadSeedVariation}
                            </span>
                            {probe && !probe.failed ? (
                              <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                                {probe.rawKeywords.toLocaleString("en-US")} kw ·{" "}
                                {formatUsd(
                                  usdForRawKeywords(probe.rawKeywords)
                                )}
                              </span>
                            ) : null}
                            <Badge
                              variant="outline"
                              className={`shrink-0 text-[10px] font-medium ${scopeMatchClass(row.scopeMatch)}`}
                            >
                              {row.scopeMatch}
                            </Badge>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Manual seed — the client knows regional wording we may miss. */}
      {readOnly ? null : (
      <div className="shrink-0 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border/70 px-3 py-2">
        <Plus className="h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={manualTerm}
          onChange={(e) => setManualTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitManualSeed();
            }
          }}
          placeholder="Add a broad seed we missed…"
          className="h-8 w-[220px] text-xs"
          aria-label="Add a broad seed variation"
        />
        <select
          value={manualFamily || allGroups[0]?.canonicalNicheSeed || ""}
          onChange={(e) => setManualFamily(e.target.value)}
          className="h-8 rounded-lg border border-border/70 bg-background px-2 text-xs outline-none"
          aria-label="Canonical seed family"
        >
          {allGroups.map((group) => (
            <option
              key={group.canonicalNicheSeed}
              value={group.canonicalNicheSeed}
            >
              {group.canonicalNicheSeed}
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          disabled={!manualTerm.trim() || allGroups.length === 0}
          onClick={submitManualSeed}
        >
          Add seed
        </Button>
      </div>
      )}

      <div className="shrink-0 space-y-2 rounded-2xl border border-border/70 bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium tracking-tight">
            {selected.size === 0
              ? "No seeds selected yet"
              : `${selected.size} seed${selected.size === 1 ? "" : "s"} selected · ${estimate.rows} checked in ${marketLabel(market)}`}
          </p>
          {walletHref ? (
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-[11px]"
            >
              <Link href={walletHref}>
                <Wallet className="h-3.5 w-3.5" />
                Wallet
              </Link>
            </Button>
          ) : null}
        </div>

        {estimate.rows === 0 ? (
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Stages 1–3 are included in your plan. Select seeds and run a demand
            check to see raw keyword counts, search volume, and what the deep
            analysis would cost — before anything is charged.
          </p>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-4">
              <Metric
                label="Raw keywords"
                value={estimate.rawKeywords.toLocaleString("en-US")}
              />
              <Metric
                label="Unique after overlap"
                value={estimate.uniqueKeywords.toLocaleString("en-US")}
                highlight
              />
              <Metric
                label="Search volume"
                value={estimate.searchVolume.toLocaleString("en-US")}
              />
              <Metric
                label="Price"
                value={formatUsd(estimate.usd)}
                highlight
              />
            </div>

            {estimate.usdIfNotDeduped > estimate.usd ? (
              <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Variations of the same canonical seed return overlapping
                keywords. Billing on the raw sum would be{" "}
                {formatUsd(estimate.usdIfNotDeduped)} — you’re quoted{" "}
                {formatUsd(estimate.usd)} on unique keywords only.
              </p>
            ) : null}

            {readOnly ? (
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Locked after extract — this is the seed selection that was
                charged.
              </p>
            ) : (
            <>
            <div className="flex flex-wrap items-center gap-2">
              <label
                htmlFor="seed-budget"
                className="text-[11px] text-muted-foreground"
              >
                Budget cap
              </label>
              <input
                id="seed-budget"
                type="range"
                min={0}
                max={maxBudget}
                step={Math.max(0.5, Math.round((maxBudget / 50) * 100) / 100)}
                value={effectiveBudget}
                onChange={(e) => setBudget(Number(e.target.value))}
                className="h-1 w-40 accent-primary"
              />
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {formatUsd(effectiveBudget)}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-[11px]"
                onClick={applyBudget}
                disabled={effectiveBudget >= estimate.usd}
              >
                Fit selection to budget
              </Button>
              <Button
                type="button"
                size="sm"
                className="ml-auto h-8 text-xs"
                onClick={onConfirmSpend}
                disabled={estimate.rows === 0 || committed}
              >
                {committed
                  ? "Extracted"
                  : `Extract · ${formatUsd(estimate.usd)}`}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Extract pulls up to 10,000 keywords per selected seed, then
              filters, classifies intent, and matches them to your catalog —
              {formatUsd(estimate.usd)} from your wallet. Nothing is charged
              before you extract.
            </p>
            </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2",
        highlight
          ? "border-primary/30 bg-primary/5"
          : "border-border/70 bg-background"
      )}
    >
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-sm font-semibold tabular-nums tracking-tight">
        {value}
      </p>
    </div>
  );
}

function ProbeCell({
  probe,
  probing,
  market,
  value,
}: {
  probe?: SeedProbe;
  probing: boolean;
  market: string;
  value?: number;
}) {
  if (probing) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
      </span>
    );
  }
  if (!probe) return <span className="text-muted-foreground/60">—</span>;
  if (probe.failed) {
    return (
      <span className="text-[10px] font-medium text-destructive">Failed</span>
    );
  }
  return (
    <span
      className={cn(
        isProbeStale(probe, market) && "text-amber-700 dark:text-amber-400"
      )}
    >
      {(value ?? 0).toLocaleString("en-US")}
    </span>
  );
}

function SeedDetail({
  row,
  probe,
  probing,
  onProbe,
  readOnly = false,
}: {
  row: MockSeedRow;
  probe?: SeedProbe;
  probing: boolean;
  onProbe: () => void;
  readOnly?: boolean;
}) {
  return (
    <div className="space-y-2 py-1">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          Parent niche:{" "}
          <span className="text-foreground/80">{row.broadParentNiche}</span>
        </span>
        <span>
          Variation:{" "}
          <span className="text-foreground/80">{row.variationType}</span>
        </span>
        <span>
          Products:{" "}
          <span className="text-foreground/80 tabular-nums">
            {formatProductCount(row.productCount)}
          </span>
        </span>
      </div>

      {probing ? (
        <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          Checking what this seed returns…
        </p>
      ) : probe && !probe.failed ? (
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Sample of what this seed returns
          </p>
          <div className="flex flex-wrap gap-1.5">
            {probe.sampleKeywords.map((keyword) => (
              <span
                key={keyword}
                className="rounded-full border border-border/70 bg-background px-2 py-0.5 text-[10px]"
              >
                {keyword}
              </span>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Checked {new Date(probe.checkedAt).toLocaleDateString()} ·{" "}
            {marketLabel(probe.market)}
          </p>
        </div>
      ) : probe?.failed ? (
        <p className="text-[11px] text-destructive">
          The demand check failed for this seed. Nothing was charged — try again
          or drop the term.
        </p>
      ) : readOnly ? (
        <p className="text-[11px] text-muted-foreground">No demand check on this seed.</p>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-[11px]"
          onClick={onProbe}
        >
          <Search className="h-3 w-3" />
          Check this seed
        </Button>
      )}
    </div>
  );
}

function SelectBox({
  state,
  onClick,
  label,
}: {
  state: "all" | "some" | "none";
  onClick?: () => void;
  label: string;
}) {
  const box = (
    <span
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
        state === "all"
          ? "border-primary bg-primary text-primary-foreground"
          : state === "some"
            ? "border-primary bg-primary/15 text-primary"
            : "border-muted-foreground/40 bg-background"
      )}
    >
      {state === "all" ? (
        <Check className="h-3 w-3" />
      ) : state === "some" ? (
        <span className="h-0.5 w-2 rounded bg-current" />
      ) : null}
    </span>
  );

  if (!onClick) {
    return (
      <span role="img" aria-label={label}>
        {box}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      aria-pressed={state === "all"}
    >
      {box}
    </button>
  );
}
