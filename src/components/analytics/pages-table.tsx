"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  Download,
  ExternalLink,
  Search,
} from "lucide-react";
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
import type { Ga4PageRow, GscPageRow } from "@/lib/analytics/types";
import { analyticsPageHref } from "@/lib/analytics/page-url";

type Source = "gsc" | "ga4";
type SortField = "page" | "m1" | "m2" | "m3" | "m4";

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m ${s}s`;
}

export function AnalyticsPagesTable({
  gscPages,
  ga4Pages,
  gscLoading,
  ga4Loading,
  gscConnected,
  ga4Connected,
  siteProperty,
}: {
  gscPages: GscPageRow[];
  ga4Pages: Ga4PageRow[];
  gscLoading: boolean;
  ga4Loading: boolean;
  gscConnected: boolean;
  ga4Connected: boolean;
  siteProperty?: string | null;
}) {
  const [source, setSource] = useState<Source>(gscConnected ? "gsc" : "ga4");
  const [sortField, setSortField] = useState<SortField>("m1");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const switchSource = (next: Source) => {
    setSource(next);
    setPage(1);
    setSearch("");
    setSortField("m1");
    setSortDir("desc");
  };

  const loading = source === "gsc" ? gscLoading : ga4Loading;
  const connected = source === "gsc" ? gscConnected : ga4Connected;

  const rows = useMemo(() => {
    const mapped =
      source === "gsc"
        ? gscPages.map((row) => ({
            page: row.page,
            m1: row.clicks,
            m2: row.impressions,
            m3: row.ctr,
            m4: row.position,
          }))
        : ga4Pages.map((row) => ({
            page: row.page,
            m1: row.views,
            m2: row.users,
            m3: row.avgDuration,
            m4: undefined as number | undefined,
          }));
    const filtered = mapped.filter((row) => row.page.toLowerCase().includes(search.toLowerCase()));
    filtered.sort((a, b) => {
      const av = sortField === "page" ? a.page : (a[sortField] ?? 0);
      const bv = sortField === "page" ? b.page : (b[sortField] ?? 0);
      if (av === bv) return 0;
      const cmp = av > bv ? 1 : -1;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return filtered;
  }, [ga4Pages, gscPages, search, sortDir, sortField, source]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const headers =
    source === "gsc"
      ? { m1: "Clicks", m2: "Impressions", m3: "CTR", m4: "Position" }
      : { m1: "Views", m2: "Users", m3: "Avg time", m4: null };

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const sortIcon = (field: SortField) =>
    sortField !== field ? (
      <ChevronsUpDown className="ml-1 h-3 w-3 text-muted-foreground" />
    ) : sortDir === "asc" ? (
      <ChevronUp className="ml-1 h-3 w-3" />
    ) : (
      <ChevronDown className="ml-1 h-3 w-3" />
    );

  const exportXlsx = async () => {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(`${source.toUpperCase()} Pages`);
    if (source === "gsc") {
      sheet.addRow(["Page URL", "Clicks", "Impressions", "CTR", "Avg Position"]);
      for (const row of rows) {
        sheet.addRow([
          row.page,
          row.m1,
          row.m2,
          `${((row.m3 as number) * 100).toFixed(2)}%`,
          (row.m4 ?? 0).toFixed(1),
        ]);
      }
    } else {
      sheet.addRow(["Page Path", "Views", "Users", "Avg Duration"]);
      for (const row of rows) {
        sheet.addRow([row.page, row.m1, row.m2, formatDuration(row.m3 as number)]);
      }
    }
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `${source}-pages-export.xlsx`;
    a.click();
    URL.revokeObjectURL(href);
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
      <div className="space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-sm font-bold">
              Pages
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {rows.length.toLocaleString()} results
              </span>
            </h3>
            <div className="flex rounded-full bg-muted/70 p-0.5">
              <button
                type="button"
                disabled={!gscConnected}
                onClick={() => switchSource("gsc")}
                className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                  source === "gsc" ? "bg-background shadow-sm" : "text-muted-foreground"
                }`}
              >
                GSC
              </button>
              <button
                type="button"
                disabled={!ga4Connected}
                onClick={() => switchSource("ga4")}
                className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                  source === "ga4" ? "bg-background shadow-sm" : "text-muted-foreground"
                }`}
              >
                GA4
              </button>
            </div>
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => void exportXlsx()} disabled={loading || rows.length === 0}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Export
            </Button>
          </div>
          <select
            className="h-8 rounded-lg border border-border bg-background px-2 text-xs"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
          >
            {[10, 25, 50, 100, 250].map((n) => (
              <option key={n} value={n}>
                {n} rows
              </option>
            ))}
          </select>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search pages…"
            className="h-9 pl-9"
          />
        </div>
      </div>

      {!connected ? (
        <p className="px-5 pb-6 text-sm text-muted-foreground">
          {source === "gsc"
            ? "Connect Google Search Console to see search pages."
            : "Connect Google Analytics 4 to see on-site pages."}
        </p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="cursor-pointer pl-5" onClick={() => toggleSort("page")}>
                  <span className="inline-flex items-center">Page {sortIcon("page")}</span>
                </TableHead>
                {(["m1", "m2", "m3", "m4"] as const).map((key) =>
                  headers[key] ? (
                    <TableHead key={key} className="cursor-pointer text-right last:pr-5" onClick={() => toggleSort(key)}>
                      <span className="inline-flex w-full items-center justify-end">
                        {headers[key]} {sortIcon(key)}
                      </span>
                    </TableHead>
                  ) : null
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={headers.m4 ? 5 : 4} className="h-40 text-center text-sm text-muted-foreground">
                    Loading pages…
                  </TableCell>
                </TableRow>
              ) : pageRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={headers.m4 ? 5 : 4} className="h-40 text-center text-sm text-muted-foreground">
                    No pages for this range.
                  </TableCell>
                </TableRow>
              ) : (
                pageRows.map((row, i) => {
                  const href = analyticsPageHref(row.page, siteProperty);
                  return (
                    <TableRow key={`${row.page}-${i}`} className="group">
                      <TableCell className="max-w-[420px] pl-5">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium" title={row.page}>
                            {row.page}
                          </span>
                          {href ? (
                            <a
                              href={href}
                              target="_blank"
                              rel="noreferrer"
                              className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.m1.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.m2.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {source === "gsc" ? `${((row.m3 as number) * 100).toFixed(2)}%` : formatDuration(row.m3 as number)}
                      </TableCell>
                      {headers.m4 ? (
                        <TableCell className="pr-5 text-right tabular-nums">{(row.m4 ?? 0).toFixed(1)}</TableCell>
                      ) : null}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          {rows.length > pageSize && (
            <div className="flex items-center justify-between border-t border-border/60 px-5 py-3 text-xs text-muted-foreground">
              <span>
                {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, rows.length)} of {rows.length.toLocaleString()}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="h-8 px-2" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span>
                  {page} / {totalPages}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2"
                  disabled={page === totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
