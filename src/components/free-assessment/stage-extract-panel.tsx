"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Search,
  CheckCircle2,
  HelpCircle,
  XCircle,
  Download,
  FileText,
} from "lucide-react";
import { WorksheetPaginationBar } from "@/components/worksheet-pagination-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  type ExtractedKeyword,
  type KeywordFilters,
  type KeywordSheet,
  type SeedExtractProgress,
} from "./workspace-data";
import type { MockSeedRow, SeedProbe } from "./mock-data";
import { formatUsd } from "./mock-data";
import { cn } from "@/lib/utils";
import { AssessmentProposalDialog } from "./assessment-proposal-dialog";

type ExtractSheet = "all" | KeywordSheet;
const EXTRACT_PAGE_SIZE = 50;

export function StageExtractPanel({
  seeds,
  probes,
  keywords,
  extracting,
  progress,
  seedProgress,
  chargedUsd,
  onAnalyze,
  analyzeLoading,
  analyzeProgress,
  productEmbedProgress,
  analyzed,
  growthEngineHref,
  onCancelExtract,
  csvHref,
}: {
  seeds: MockSeedRow[];
  probes: Record<string, SeedProbe>;
  keywords: ExtractedKeyword[];
  extracting: boolean;
  progress: number;
  seedProgress: SeedExtractProgress[];
  chargedUsd: number;
  onAnalyze: () => void;
  analyzeLoading: boolean;
  /** Live progress across the chunked classification requests (Layer 1). */
  analyzeProgress?: { done: number; total: number } | null;
  /**
   * Product embedding pass (Phase B), driven in parallel with the Apify
   * extract poll below — surfaced as a second line so the wait doesn't look
   * idle while it happens in the background.
   */
  productEmbedProgress?: { embedded: number; total: number; done: boolean } | null;
  analyzed: boolean;
  growthEngineHref?: string;
  onCancelExtract?: () => void;
  /** Export of every pulled keyword. */
  csvHref?: string;
}) {
  const [filters, setFilters] = useState<KeywordFilters>(DEFAULT_FILTERS);
  const [sheet, setSheet] = useState<ExtractSheet>("all");
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(EXTRACT_PAGE_SIZE);
  const [proposalOpen, setProposalOpen] = useState(false);
  const classified = analyzed || analyzeLoading;
  const activeSheet: ExtractSheet =
    classified && sheet === "all" && analyzeLoading ? "category" : sheet;

  const visible = useMemo(() => {
    const filtered = filterKeywords(keywords, filters);
    if (!classified || activeSheet === "all") return filtered;
    return filtered.filter((row) => row.sheet === activeSheet);
  }, [keywords, filters, activeSheet, classified]);

  useEffect(() => {
    setPageIndex(0);
  }, [filters, activeSheet, pageSize]);

  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize) || 1);
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  const paged = visible.slice(
    safePageIndex * pageSize,
    (safePageIndex + 1) * pageSize
  );
  const tableColCount = !classified
    ? 4
    : activeSheet === "excluded"
      ? 5
      : 6;

  const categoryKeywords = useMemo(
    () => keywords.filter((row) => row.sheet === "category"),
    [keywords]
  );

  const totalPulled = keywords.length > 0
    ? keywords.length
    : seeds.reduce(
        (sum, seed) => sum + pulledCountForSeed(seed, probes),
        0
      );

  const categoryCount = categoryKeywords.length;
  const informationalCount = useMemo(
    () => keywords.filter((k) => k.sheet === "informational").length,
    [keywords]
  );
  const excludedCount = useMemo(
    () => keywords.filter((k) => k.sheet === "excluded").length,
    [keywords]
  );

  if (extracting) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold tracking-tight">
            Extracting keywords
          </h2>
          <p className="text-xs text-muted-foreground">
            Up to {EXTRACT_CAP_PER_SEED.toLocaleString("en-US")} keywords per
            seed · you can leave this page; the pull continues on the server
            and the unused wallet hold is settled when it finishes.
          </p>
        </div>
        <Progress value={Math.round(progress * 100)} className="h-1.5" />
        {productEmbedProgress && !productEmbedProgress.done ? (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Preparing product index
            {productEmbedProgress.total > 0
              ? ` — ${productEmbedProgress.embedded.toLocaleString("en-US")} / ${productEmbedProgress.total.toLocaleString("en-US")}`
              : "…"}
          </p>
        ) : null}
        {onCancelExtract ? (
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={onCancelExtract}
            >
              Cancel extract
            </Button>
          </div>
        ) : null}
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
            {formatUsd(chargedUsd)} charged from wallet. Filters below are
            optional and do not change that bill.
          </p>
          {csvHref && keywords.length > 0 ? (
            <a
              href={csvHref}
              className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
            >
              <Download className="h-3 w-3" />
              Download all keywords (CSV)
            </a>
          ) : null}
        </div>
        {classified ? (
          <div className="flex flex-wrap rounded-lg border border-border/70 p-0.5 bg-muted/40">
            {(
              [
                ["all", `All (${keywords.length})`],
                ["category", `Suitable for categories (${categoryCount})`],
                ["informational", `Informational (${informationalCount})`],
                ["excluded", `Excluded / Removed (${excludedCount})`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSheet(id)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                  activeSheet === id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
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
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/70">
        <div className="min-h-0 flex-1 overflow-auto">
        {analyzeLoading && activeSheet !== "all" ? (
          <div className="divide-y divide-border/60">
            <div className="grid grid-cols-5 gap-3 px-4 py-2.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              <span>Keyword</span>
              <span>Seed</span>
              <span>Volume</span>
              <span>KD</span>
              <span>Classification</span>
            </div>
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="grid grid-cols-5 gap-3 px-4 py-3">
                <div className="h-3 w-40 animate-pulse rounded bg-muted" />
                <div className="h-3 w-24 animate-pulse rounded bg-muted" />
                <div className="h-3 w-12 animate-pulse rounded bg-muted" />
                <div className="h-3 w-8 animate-pulse rounded bg-muted" />
                <div className="h-3 w-28 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Keyword</TableHead>
                <TableHead className="text-xs">Seed</TableHead>
                <TableHead className="text-xs text-right">Volume</TableHead>
                <TableHead className="text-xs text-right">KD</TableHead>
                {!classified ? null : activeSheet === "category" ? (
                  <>
                    <TableHead className="text-xs">Concept / Tag</TableHead>
                    <TableHead className="text-xs text-right">Products</TableHead>
                  </>
                ) : activeSheet === "informational" ? (
                  <>
                    <TableHead className="text-xs">Question</TableHead>
                    <TableHead className="text-xs">Classification Notes</TableHead>
                  </>
                ) : activeSheet === "excluded" ? (
                  <TableHead className="text-xs">Reason for Exclusion</TableHead>
                ) : (
                  <>
                    <TableHead className="text-xs">Classification</TableHead>
                    <TableHead className="text-xs">Reason / Angle</TableHead>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={tableColCount}
                    className="py-10 text-center text-xs text-muted-foreground"
                  >
                    No keywords match these filters.
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((row, index) => (
                  <TableRow key={`${row.id}-${safePageIndex}-${index}`}>
                    <TableCell className="text-sm font-medium">{row.keyword}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {row.seed}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums text-right font-medium">
                      {row.volume.toLocaleString("en-US")}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums text-right">
                      {row.difficulty}
                    </TableCell>
                    {!classified ? null : activeSheet === "category" ? (
                      <>
                        <TableCell className="text-[11px] text-muted-foreground">
                          {row.plpConcept || "Category PLP"}
                        </TableCell>
                        <TableCell className="text-xs tabular-nums text-right">
                          {row.productMatches.toLocaleString("en-US")}
                        </TableCell>
                      </>
                    ) : activeSheet === "informational" ? (
                      <>
                        <TableCell className="text-[11px] text-muted-foreground">
                          {row.isQuestion ? (
                            <span className="text-blue-500 font-medium">Yes</span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-[11px] text-muted-foreground">
                          {row.exclusionReason || "Informational search / guide"}
                        </TableCell>
                      </>
                    ) : activeSheet === "excluded" ? (
                      <TableCell className="text-[11px] text-rose-500/90 dark:text-rose-400 font-medium">
                        {row.exclusionReason || "Excluded (Single SKU / PDP or out of niche)"}
                      </TableCell>
                    ) : (
                      <>
                        <TableCell className="text-[11px]">
                          {row.sheet === "category" ? (
                            <Badge variant="outline" className="text-[10px] font-normal border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Suitable (PLP)
                            </Badge>
                          ) : row.sheet === "informational" ? (
                            <Badge variant="outline" className="text-[10px] font-normal border-blue-500/30 text-blue-600 dark:text-blue-400 bg-blue-500/5">
                              <HelpCircle className="h-3 w-3 mr-1" />
                              Informational
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] font-normal border-rose-500/30 text-rose-600 dark:text-rose-400 bg-rose-500/5">
                              <XCircle className="h-3 w-3 mr-1" />
                              Excluded
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-[11px] text-muted-foreground truncate max-w-[220px]" title={row.exclusionReason || row.plpConcept || ""}>
                          {row.exclusionReason || row.plpConcept || "—"}
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
        </div>
        <WorksheetPaginationBar
          pageIndex={safePageIndex}
          pageSize={pageSize}
          totalRows={visible.length}
          readyCount={0}
          colCount={tableColCount}
          itemLabel="keywords"
          onPageChange={setPageIndex}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPageIndex(0);
          }}
        />
      </div>

      <div className="flex items-center justify-between gap-2 shrink-0">
        {analyzed ? (
          <>
            <p className="text-[11px] text-muted-foreground">
              {categoryKeywords.length.toLocaleString("en-US")} suitable category
              terms. Open the proposal for 20 / 40 / 60% capture scenarios — catalog
              matching needs a live store in Growth Engine.
            </p>
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs font-medium"
              onClick={() => setProposalOpen(true)}
              disabled={categoryKeywords.length === 0}
            >
              <FileText className="h-3.5 w-3.5" />
              Proposal ({categoryKeywords.length.toLocaleString("en-US")})
            </Button>
          </>
        ) : (
          <>
            <p className="text-[11px] text-muted-foreground">
              Analyze uses Gemini 3.7 Flash to evaluate search intent, PLP vs PDP viability, and classify keywords into Category, Informational, and Excluded.
            </p>
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs font-medium"
              onClick={() => {
                setSheet("category");
                onAnalyze();
              }}
              disabled={analyzeLoading || keywords.length === 0}
            >
              {analyzeLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Search className="h-3.5 w-3.5" />
              )}
              {analyzeLoading
                ? analyzeProgress && analyzeProgress.total > 0
                  ? `Classifying ${analyzeProgress.done.toLocaleString()} / ${analyzeProgress.total.toLocaleString()}…`
                  : "Classifying with Gemini…"
                : "Analyze with AI"}
            </Button>
          </>
        )}
      </div>

      <AssessmentProposalDialog
        open={proposalOpen}
        onOpenChange={setProposalOpen}
        keywords={categoryKeywords}
        growthEngineHref={growthEngineHref}
      />
    </div>
  );
}
