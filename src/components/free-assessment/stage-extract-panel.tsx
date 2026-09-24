"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  analyzeProgress?: { done: number; total: number; phase?: "classify" | "same-intent" } | null;
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
  const [sameIntentOpen, setSameIntentOpen] = useState(false);
  const classified = analyzed || analyzeLoading;
  const activeSheet: ExtractSheet =
    classified && sheet === "all" && analyzeLoading ? "category" : sheet;
  const analyzeWasLoading = useRef(false);
  useEffect(() => {
    if (analyzeLoading) {
      analyzeWasLoading.current = true;
      return;
    }
    if (analyzeWasLoading.current) {
      analyzeWasLoading.current = false;
      setSheet("all");
    }
  }, [analyzeLoading]);

  const visible = useMemo(() => {
    if (!analyzed) return keywords;
    if (!classified || activeSheet === "all") return filterKeywords(keywords, filters);
    return filterKeywords(keywords, filters, activeSheet);
  }, [keywords, filters, activeSheet, classified, analyzed]);

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
    : activeSheet === "all" || activeSheet === "informational"
      ? 6
      : 5;

  const categoryKeywords = useMemo(
    () => filterKeywords(keywords, filters, "category"),
    [keywords, filters]
  );

  const totalPulled = keywords.length > 0
    ? keywords.length
    : seeds.reduce(
        (sum, seed) => sum + pulledCountForSeed(seed, probes),
        0
      );

  const categoryCount = categoryKeywords.length;
  const sameIntentRows = useMemo(
    () => keywords.filter((row) => row.sameIntentOf),
    [keywords]
  );
  const removedSameIntent = sameIntentRows.length;
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
            {formatUsd(chargedUsd)} charged from wallet.
            {analyzed
              ? " Filters below narrow the classified terms and do not change that bill."
              : ""}
            {analyzed && removedSameIntent > 0
              ? ` ${removedSameIntent.toLocaleString("en-US")} same-intent terms removed. The highest-volume wording was kept.`
              : ""}
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

      {analyzed ? (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-card px-3 py-2 shrink-0">
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          Word count
          <Input
            type="number"
            min={DEFAULT_FILTERS.minWordCount}
            max={DEFAULT_FILTERS.maxWordCount}
            value={filters.minWordCount}
            onChange={(e) => {
              const nextMin = Math.min(
                DEFAULT_FILTERS.maxWordCount,
                Math.max(
                  DEFAULT_FILTERS.minWordCount,
                  Math.floor(Number(e.target.value) || DEFAULT_FILTERS.minWordCount)
                )
              );
              setFilters((prev) => ({
                ...prev,
                minWordCount: nextMin,
                maxWordCount: Math.min(
                  DEFAULT_FILTERS.maxWordCount,
                  Math.max(nextMin, prev.maxWordCount)
                ),
              }));
            }}
            className="h-8 w-[56px] text-xs"
            aria-label="Minimum word count"
          />
          <span>to</span>
          <Input
            type="number"
            min={filters.minWordCount}
            max={DEFAULT_FILTERS.maxWordCount}
            value={filters.maxWordCount}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                maxWordCount: Math.min(
                  DEFAULT_FILTERS.maxWordCount,
                  Math.max(
                    prev.minWordCount,
                    Math.floor(Number(e.target.value) || prev.minWordCount)
                  )
                ),
              }))
            }
            className="h-8 w-[56px] text-xs"
            aria-label="Maximum word count"
          />
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          Min volume
          <Input
            type="number"
            min={1}
            value={filters.minVolume}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                minVolume: Math.max(1, Math.floor(Number(e.target.value) || 1)),
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
            max={50}
            value={filters.maxKd}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                maxKd: Math.min(
                  50,
                  Math.max(0, Math.floor(Number(e.target.value) || 0))
                ),
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
      ) : null}

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
                  <TableHead className="text-xs">Concept / Tag</TableHead>
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
                    <TableCell className="text-sm font-medium">
                      <div className="flex items-center gap-1.5">
                        <span>{row.keyword}</span>
                        {row.sameIntentOf ? (
                          <Badge
                            variant="outline"
                            title={`Same search as “${row.sameIntentOf}”, which has the higher volume.`}
                            className="shrink-0 text-[9px] font-normal px-1.5 py-0"
                          >
                            Same intent
                          </Badge>
                        ) : null}
                        {row.isAiGenerated === false ? (
                          <Badge
                            variant="outline"
                            title="This keyword could not be verified after retries — a rule-based guess was used instead of a real AI verdict."
                            className="shrink-0 text-[9px] font-normal border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/5 px-1.5 py-0"
                          >
                            Estimated
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
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
                      <TableCell className="text-[11px] text-muted-foreground">
                        {row.plpConcept || "Category PLP"}
                      </TableCell>
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
            <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs font-medium"
              onClick={() => setSameIntentOpen(true)}
            >
              Cleaned terms ({removedSameIntent.toLocaleString("en-US")})
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs font-medium"
              onClick={() => setProposalOpen(true)}
              disabled={categoryKeywords.length === 0}
            >
              <FileText className="h-3.5 w-3.5" />
              Proposal ({categoryKeywords.length.toLocaleString("en-US")})
            </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-[11px] text-muted-foreground">
              Analyze evaluates search intent, PLP vs PDP viability, and classifies keywords into Category, Informational, and Excluded.
            </p>
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs font-medium"
              onClick={onAnalyze}
              disabled={analyzeLoading || keywords.length === 0}
            >
              {analyzeLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Search className="h-3.5 w-3.5" />
              )}
              {analyzeLoading
                ? analyzeProgress?.phase === "same-intent"
                  ? analyzeProgress.total > 0
                    ? `Cleaning same-intent terms ${analyzeProgress.done.toLocaleString()} / ${analyzeProgress.total.toLocaleString()}…`
                    : "Cleaning same-intent terms…"
                  : analyzeProgress && analyzeProgress.total > 0
                    ? `Classifying ${analyzeProgress.done.toLocaleString()} / ${analyzeProgress.total.toLocaleString()}…`
                    : "Classifying…"
                : "Analyze with AI"}
            </Button>
          </>
        )}
      </div>

      <Dialog open={sameIntentOpen} onOpenChange={setSameIntentOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Same-intent terms removed</DialogTitle>
            <DialogDescription>
              {removedSameIntent > 0
                ? "These category terms were the exact same search as a higher-volume wording. The kept term stays on Suitable for categories."
                : "The cleanup ran after classification. No two suitable terms were the exact same search, so nothing was removed."}
            </DialogDescription>
          </DialogHeader>
          {removedSameIntent > 0 ? (
            <div className="max-h-80 overflow-auto rounded-xl border border-border/70">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-muted/80 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-medium">Removed</th>
                    <th className="px-3 py-1.5 text-left font-medium">Kept</th>
                  </tr>
                </thead>
                <tbody>
                  {sameIntentRows.map((row) => (
                    <tr key={row.id} className="border-t border-border/50">
                      <td className="px-3 py-1.5">{row.keyword}</td>
                      <td className="px-3 py-1.5">{row.sameIntentOf}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <AssessmentProposalDialog
        open={proposalOpen}
        onOpenChange={setProposalOpen}
        keywords={categoryKeywords}
        growthEngineHref={growthEngineHref}
      />
    </div>
  );
}
