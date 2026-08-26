"use client";

import { Fragment, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarClock,
  Eye,
  Loader2,
  Sparkles,
} from "lucide-react";
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
import { ArticleDrawer } from "./article-drawer";
import {
  ARTICLE_GENERATION_CONCURRENCY,
  type GeneratedArticle,
  type StoreBlog,
  type StrategyArticle,
  type StrategyArticleType,
  type StrategyPriority,
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

/**
 * Link targets are stored as store-relative paths, which is what belongs in a
 * published article. In the dashboard they must be resolved against the
 * storefront, otherwise the browser sends the merchant to our own app.
 */
export function storefrontHref(storeUrl: string, path: string): string {
  const url = (path || "").trim();
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  const origin = (storeUrl || "").trim().replace(/\/+$/, "");
  if (!origin) return "";
  return `${origin}${url.startsWith("/") ? url : `/${url}`}`;
}

export function StageStrategyPanel({
  articles,
  generatedById,
  blogs,
  storeUrl,
  scopeWarning,
  loading,
  ready,
  syncing,
  syncProgress,
  onBuild,
  onGenerate,
  onSync,
  onArticleChange,
  onTitleChange,
}: {
  articles: StrategyArticle[];
  generatedById: Record<string, GeneratedArticle>;
  blogs: StoreBlog[];
  storeUrl: string;
  scopeWarning?: string | null;
  loading: boolean;
  ready: boolean;
  syncing: boolean;
  /** Batch progress while a large plan is uploaded in chunks. */
  syncProgress?: { done: number; total: number } | null;
  onBuild: () => void;
  onGenerate: (ids: string[]) => void;
  onSync: (ids: string[]) => void;
  onArticleChange: (articleId: string, patch: Partial<GeneratedArticle>) => void;
  onTitleChange: (articleId: string, title: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<StrategyArticleType | "all">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return articles.filter((row) => {
      if (type !== "all" && row.type !== type) return false;
      if (!q) return true;
      return (
        row.title.toLowerCase().includes(q) ||
        row.keyword.toLowerCase().includes(q)
      );
    });
  }, [articles, query, type]);

  // Derived rather than pruned in an effect: a row that reached the store's
  // calendar simply stops counting as selected.
  const selectedSet = useMemo(() => {
    const actionable = new Set(
      articles.filter((row) => row.status !== "scheduled").map((row) => row.id)
    );
    return new Set(selected.filter((id) => actionable.has(id)));
  }, [articles, selected]);

  const readyCount = articles.filter((row) => row.status === "ready").length;
  const generatingCount = articles.filter(
    (row) => row.status === "generating"
  ).length;

  const selectedRows = articles.filter((row) => selectedSet.has(row.id));
  const selectedReady = selectedRows.filter((row) => row.status === "ready");
  const selectedPending = selectedRows.filter(
    (row) => row.status === "pending" || row.status === "failed"
  );
  // Once the selection is written, the same button becomes the upload action.
  const mode: "generate" | "sync" =
    selectedPending.length === 0 && selectedReady.length > 0
      ? "sync"
      : "generate";

  const toggle = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    const selectable = visible.filter((row) => row.status !== "scheduled");
    const allOn = selectable.every((row) => selectedSet.has(row.id));
    setSelected(allOn ? [] : selectable.map((row) => row.id));
  };

  if (!ready && !loading) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="max-w-md space-y-1">
          <h2 className="text-base font-semibold tracking-tight">
            Content plan
          </h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Every informational keyword becomes one article: the title to
            publish, the format, and the collection pages it links out to. The
            copy is written in the next step.
          </p>
        </div>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={onBuild}>
          <Sparkles className="h-3.5 w-3.5" />
          Build plan
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
            Writing titles for each informational keyword and matching them to
            the collections they should send readers to.
          </p>
        </div>
        <div className="divide-y divide-border/60 rounded-xl border border-border/70">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="grid grid-cols-6 gap-3 px-4 py-3">
              <div className="h-3 w-48 animate-pulse rounded bg-muted" />
              <div className="h-3 w-20 animate-pulse rounded bg-muted" />
              <div className="h-3 w-16 animate-pulse rounded bg-muted" />
              <div className="h-3 w-10 animate-pulse rounded bg-muted" />
              <div className="h-3 w-10 animate-pulse rounded bg-muted" />
              <div className="h-3 w-12 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const openRow = openId
    ? articles.find((row) => row.id === openId) ?? null
    : null;
  const openArticle = openId ? generatedById[openId] ?? null : null;

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            Content plan
          </h2>
          <p className="text-[11px] text-muted-foreground">
            {articles.length} articles · {readyCount} written
            {generatingCount > 0 ? ` · ${generatingCount} in progress` : ""}
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

      {scopeWarning ? (
        <div className="flex shrink-0 items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-200">
            {scopeWarning} You can still write and review articles now — only
            uploading them needs this permission.
          </p>
        </div>
      ) : null}

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter titles or keywords…"
        className="h-8 w-full max-w-sm rounded-lg border border-border/70 bg-background px-3 text-xs outline-none focus:border-foreground/30"
        aria-label="Filter articles"
      />

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border/70">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-9">
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                  aria-label="Select all articles"
                >
                  All
                </button>
              </TableHead>
              <TableHead className="text-xs">Title</TableHead>
              <TableHead className="text-xs">Informational</TableHead>
              <TableHead className="text-xs">Type</TableHead>
              <TableHead className="text-xs">Category</TableHead>
              <TableHead className="text-xs text-right">Volume</TableHead>
              <TableHead className="text-xs text-right">KD</TableHead>
              <TableHead className="text-xs">Priority</TableHead>
              <TableHead className="w-16 text-xs text-center">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="py-10 text-center text-xs text-muted-foreground"
                >
                  No articles match this filter.
                </TableCell>
              </TableRow>
            ) : (
              visible.map((row) => {
                const on = selectedSet.has(row.id);
                const expanded = expandedId === row.id;
                const locked = row.status === "scheduled";
                return (
                  <Fragment key={row.id}>
                    <TableRow
                      className={cn("cursor-pointer", on && "bg-primary/5")}
                      onClick={() => setExpandedId(expanded ? null : row.id)}
                    >
                      <TableCell
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!locked) toggle(row.id);
                        }}
                      >
                        <span
                          className={cn(
                            "flex h-4 w-4 items-center justify-center rounded border text-[10px]",
                            locked
                              ? "border-border/50 bg-muted text-muted-foreground"
                              : on
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border"
                          )}
                        >
                          {on && !locked ? "✓" : ""}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm font-medium">
                        {row.title}
                      </TableCell>
                      <TableCell className="max-w-[16rem] text-xs text-muted-foreground">
                        <span className="block truncate">{row.keyword}</span>
                        {row.mergedCount ? (
                          <span
                            className="text-[10px] text-muted-foreground/70"
                            title="Near-duplicate keywords covered by this same article"
                          >
                            +{row.mergedCount} similar
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-[11px] text-muted-foreground">
                        {TYPE_LABEL[row.type]}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-[11px] text-muted-foreground">
                        {row.category || "-"}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {row.volume.toLocaleString("en-US")}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
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
                      <TableCell
                        className="text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <StatusCell
                          row={row}
                          onOpen={() => setOpenId(row.id)}
                        />
                      </TableCell>
                    </TableRow>
                    {expanded ? (
                      <TableRow>
                        <TableCell colSpan={9} className="bg-muted/20">
                          <div className="py-1 text-[11px]">
                            <p className="font-medium text-foreground">
                              Links out
                            </p>
                            {row.linksOut.length === 0 ? (
                              <p className="mt-1 text-muted-foreground">
                                No collection page matched this topic closely
                                enough to link to.
                              </p>
                            ) : (
                              <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                                {row.linksOut.map((link) => {
                                  const href = storefrontHref(
                                    storeUrl,
                                    link.url
                                  );
                                  return (
                                    <li key={link.url}>
                                      {href ? (
                                        <a
                                          href={href}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
                                          title={`${link.collectionName} · ${href}`}
                                        >
                                          {link.anchor}
                                        </a>
                                      ) : (
                                        <span
                                          className="text-foreground"
                                          title={link.collectionName}
                                        >
                                          {link.anchor}
                                        </span>
                                      )}
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                            {row.error ? (
                              <p className="mt-2 text-destructive">
                                {row.error}
                              </p>
                            ) : null}
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

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/70 bg-muted/30 px-4 py-3">
        <p className="text-[11px] text-muted-foreground">
          {selectedSet.size} selected ·{" "}
          {mode === "sync"
            ? "articles publish one per day, at a different time each day."
            : `written ${ARTICLE_GENERATION_CONCURRENCY} at a time.`}
        </p>
        <Button
          size="sm"
          className="h-8 text-xs"
          disabled={
            selectedSet.size === 0 ||
            syncing ||
            generatingCount > 0 ||
            (mode === "generate" && selectedPending.length === 0)
          }
          onClick={() =>
            mode === "sync"
              ? onSync(selectedReady.map((row) => row.id))
              : onGenerate(selectedPending.map((row) => row.id))
          }
        >
          {syncing ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              {syncProgress && syncProgress.total > 1
                ? `Syncing ${syncProgress.done + 1} of ${syncProgress.total}`
                : "Syncing"}
            </>
          ) : mode === "sync" ? (
            `Sync to store (${selectedReady.length})`
          ) : (
            `Generate (${selectedPending.length})`
          )}
        </Button>
      </div>

      <ArticleDrawer
        row={openRow}
        article={openArticle}
        blogs={blogs}
        storeUrl={storeUrl}
        syncing={syncing}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
        onChange={onArticleChange}
        onTitleChange={onTitleChange}
        onSync={(articleId) => onSync([articleId])}
      />
    </div>
  );
}

function StatusCell({
  row,
  onOpen,
}: {
  row: StrategyArticle;
  onOpen: () => void;
}) {
  if (row.status === "generating") {
    return (
      <Loader2
        className="mx-auto h-3.5 w-3.5 animate-spin text-muted-foreground"
        aria-label="Writing"
      />
    );
  }
  if (row.status === "failed") {
    return (
      <AlertCircle
        className="mx-auto h-3.5 w-3.5 text-destructive"
        aria-label={row.error || "Failed"}
      />
    );
  }
  if (row.status === "scheduled") {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="mx-auto flex text-emerald-600 dark:text-emerald-400"
        aria-label="Open scheduled article"
      >
        <CalendarClock className="h-3.5 w-3.5" />
      </button>
    );
  }
  if (row.status === "ready" || row.status === "syncing") {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="mx-auto flex text-muted-foreground hover:text-foreground"
        aria-label="Open article"
      >
        <Eye className="h-3.5 w-3.5" />
      </button>
    );
  }
  return <span className="text-[10px] text-muted-foreground">—</span>;
}
