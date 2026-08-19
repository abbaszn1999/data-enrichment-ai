"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type {
  StrategyArticle,
  StrategyArticleType,
  StrategyPriority,
} from "./workspace-data";

const TYPE_LABEL: Record<StrategyArticleType, string> = {
  guide: "Guide",
  comparison: "Comparison",
  faq: "FAQ hub",
  roundup: "Roundup",
};

const PRIORITY_CLASS: Record<StrategyPriority, string> = {
  high: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/25",
  medium: "bg-sky-500/12 text-sky-700 dark:text-sky-300 border-sky-500/25",
  low: "bg-muted text-muted-foreground border-border/70",
};

export function StageStrategyPanel({
  articles,
  loading,
  ready,
  approved,
  onBuild,
  onApprove,
}: {
  articles: StrategyArticle[];
  loading: boolean;
  ready: boolean;
  approved: boolean;
  onBuild: () => void;
  onApprove: () => void;
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<StrategyArticleType | "all">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    setSelected(articles.map((row) => row.id));
  }, [articles]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return articles.filter((row) => {
      if (type !== "all" && row.type !== type) return false;
      if (!q) return true;
      return (
        row.title.toLowerCase().includes(q) ||
        row.keyword.toLowerCase().includes(q) ||
        row.collectionName.toLowerCase().includes(q)
      );
    });
  }, [articles, query, type]);

  const selectedSet = new Set(selected);
  const selectedVisible = visible.filter((row) => selectedSet.has(row.id));

  const toggle = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  if (!ready && !loading) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 text-center px-6">
        <div className="space-y-1 max-w-md">
          <h2 className="text-base font-semibold tracking-tight">
            Content strategy
          </h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Turn informational keywords into articles to write — titles, type,
            which collection they serve, and the internal links to place. This
            is a publishing plan, not the articles themselves.
          </p>
        </div>
        <Button
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={onBuild}
        >
          <Sparkles className="h-3.5 w-3.5" />
          Build strategy
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold tracking-tight">
            Building the plan
          </h2>
          <p className="text-xs text-muted-foreground">
            Clustering informational queries into guides, comparisons, and FAQ
            hubs per collection.
          </p>
        </div>
        <div className="rounded-xl border border-border/70 divide-y divide-border/60">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="grid grid-cols-5 gap-3 px-4 py-3">
              <div className="h-3 w-48 animate-pulse rounded bg-muted" />
              <div className="h-3 w-20 animate-pulse rounded bg-muted" />
              <div className="h-3 w-24 animate-pulse rounded bg-muted" />
              <div className="h-3 w-10 animate-pulse rounded bg-muted" />
              <div className="h-3 w-12 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2 shrink-0">
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            Content strategy
          </h2>
          <p className="text-[11px] text-muted-foreground">
            {articles.length} articles to write · titles and link map only —
            copy is written later.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ["all", "All types"],
              ["guide", "Guide"],
              ["comparison", "Comparison"],
              ["faq", "FAQ hub"],
              ["roundup", "Roundup"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setType(id)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                type === id
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border/70 text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter titles, keywords, collections…"
        className="h-8 w-full max-w-sm rounded-lg border border-border/70 bg-background px-3 text-xs outline-none focus:border-foreground/30"
        aria-label="Filter articles"
      />

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border/70">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-9" />
              <TableHead className="text-xs">Title to write</TableHead>
              <TableHead className="text-xs">Type</TableHead>
              <TableHead className="text-xs">Collection</TableHead>
              <TableHead className="text-xs text-right">Volume</TableHead>
              <TableHead className="text-xs text-right">KD</TableHead>
              <TableHead className="text-xs">Priority</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-10 text-center text-xs text-muted-foreground"
                >
                  No articles match this filter.
                </TableCell>
              </TableRow>
            ) : (
              visible.map((row) => {
                const on = selectedSet.has(row.id);
                const expanded = expandedId === row.id;
                return (
                  <Fragment key={row.id}>
                    <TableRow
                      className={cn("cursor-pointer", on && "bg-primary/5")}
                      onClick={() =>
                        setExpandedId(expanded ? null : row.id)
                      }
                    >
                      <TableCell
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(row.id);
                        }}
                      >
                        <span
                          className={cn(
                            "flex h-4 w-4 items-center justify-center rounded border",
                            on
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border"
                          )}
                        >
                          {on ? "✓" : ""}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">
                        <span className="inline-flex items-center gap-1.5">
                          <ChevronRight
                            className={cn(
                              "h-3 w-3 text-muted-foreground transition-transform",
                              expanded && "rotate-90"
                            )}
                          />
                          <span className="font-medium">{row.title}</span>
                        </span>
                        <span className="mt-0.5 block text-[10px] text-muted-foreground">
                          {row.keyword}
                        </span>
                      </TableCell>
                      <TableCell className="text-[11px] text-muted-foreground whitespace-nowrap">
                        {TYPE_LABEL[row.type]}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {row.collectionName}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums text-right">
                        {row.volume.toLocaleString("en-US")}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums text-right">
                        {row.difficulty}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] font-medium capitalize",
                            PRIORITY_CLASS[row.priority]
                          )}
                        >
                          {row.priority}
                        </Badge>
                      </TableCell>
                    </TableRow>
                    {expanded ? (
                      <TableRow>
                        <TableCell colSpan={7} className="bg-muted/20">
                          <div className="grid gap-3 py-1 sm:grid-cols-2 text-[11px]">
                            <div>
                              <p className="font-medium text-foreground">
                                Links in
                              </p>
                              <p className="mt-1 text-muted-foreground leading-relaxed">
                                Place links to this article from:{" "}
                                {row.linksIn.join(" · ")}
                              </p>
                            </div>
                            <div>
                              <p className="font-medium text-foreground">
                                Links out
                              </p>
                              <p className="mt-1 text-muted-foreground leading-relaxed">
                                This article should link to:{" "}
                                {row.linksOut.join(" · ")}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/70 bg-muted/30 px-4 py-3 shrink-0">
        <p className="text-[11px] text-muted-foreground">
          {selectedVisible.length} of {visible.length} shown ·{" "}
          {selected.length} in the plan. Approving locks the titles and link
          map — it does not push copy to the store.
        </p>
        {approved ? (
          <p className="flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-400">
            <Check className="h-3.5 w-3.5" />
            Plan approved
          </p>
        ) : (
          <Button
            size="sm"
            className="h-8 text-xs"
            disabled={selected.length === 0}
            onClick={onApprove}
          >
            Approve plan
          </Button>
        )}
      </div>
    </div>
  );
}
