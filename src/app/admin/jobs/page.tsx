"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageLoader } from "@/components/brand/page-loader";
import { AdminTable } from "@/components/platform-admin/admin-table";
import { DataToolbar } from "@/components/platform-admin/data-toolbar";
import { AdminListLayout, LiveBadge, PageTitle, TableToolbar } from "@/components/platform-admin/list-chrome";
import { PageHeader } from "@/components/platform-admin/page-header";
import { pageCount } from "@/components/platform-admin/pagination-bar";
import { JobStatusBadge } from "@/components/platform-admin/status-badge";
import { useDebouncedValue } from "@/components/platform-admin/use-debounced-value";
import { adminJson } from "@/lib/platform-admin/client-api";
import { formatDateTime, formatDuration } from "@/lib/platform-admin/format";
import { JOB_KIND_LABELS } from "@/lib/platform-admin/labels";
import { DATE_WINDOW_OPTIONS, LEDGER_PAGE_SIZE, toggleSort, type DateWindow, type SortState } from "@/lib/platform-admin/list-query";
import type { LiveJobRow } from "@/lib/platform-admin/live-types";
import { adminRoutes } from "@/lib/platform-admin/paths";
import type { AdminJobKind } from "@/lib/platform-admin/types";

export default function AdminJobsPage() {
  const [rows, setRows] = useState<LiveJobRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query);
  const [status, setStatus] = useState("all");
  const [kind, setKind] = useState("all");
  const [errorFilter, setErrorFilter] = useState("all");
  const [dateWindow, setDateWindow] = useState<DateWindow>("all");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ key: "when", dir: "desc" });

  const resetPage = () => setPage(1);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(LEDGER_PAGE_SIZE),
      sort: sort.key,
      dir: sort.dir,
    });
    if (debouncedQuery.trim()) params.set("q", debouncedQuery.trim());
    if (status !== "all") params.set("status", status);
    if (kind !== "all") params.set("kind", kind);
    if (errorFilter !== "all") params.set("error", errorFilter);
    if (dateWindow !== "all") params.set("window", dateWindow);

    setBusy(true);
    adminJson<{ jobs: LiveJobRow[]; total: number }>(
      `/api/platform-admin/jobs?${params}`,
      { signal: controller.signal }
    )
      .then((data) => {
        setRows(data.jobs);
        setTotal(data.total);
        setError("");
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setError(err.message);
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setLoading(false);
        setBusy(false);
      });

    return () => controller.abort();
  }, [page, debouncedQuery, status, kind, errorFilter, dateWindow, sort]);

  const hasFilters =
    query.trim() !== "" || status !== "all" || kind !== "all" || errorFilter !== "all" || dateWindow !== "all";

  const clearFilters = () => {
    setQuery("");
    setStatus("all");
    setKind("all");
    setErrorFilter("all");
    setDateWindow("all");
    setPage(1);
  };

  if (loading) return <PageLoader label="Loading jobs" />;

  return (
    <>
      <PageHeader
        title={<PageTitle label="Jobs" badge={<LiveBadge>{total} live</LiveBadge>} />}
        description="Queued and completed Catalog Intelligence, Gallery, Visualizer, and Market Research job runs."
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <AdminListLayout>
      <AdminTable
        rows={rows}
        rowKey={(row) => row.id}
        busy={busy}
        sort={sort}
        onSort={(key) => {
          setSort((current) => toggleSort(current, key));
          resetPage();
        }}
        emptyTitle={!hasFilters && total === 0 ? "No jobs yet" : "No matching jobs"}
        emptyDescription={
          !hasFilters && total === 0
            ? "Catalog Intelligence, Gallery, Visualizer, and Market Research runs will appear here."
            : "Try a different search or clear the active filters."
        }
        onClearFilters={hasFilters ? clearFilters : undefined}
        toolbar={
          <TableToolbar label="Runs">
          <DataToolbar
            search={query}
            onSearch={(value) => {
              setQuery(value);
              resetPage();
            }}
            searchPlaceholder="Workspace, actor, or error"
            noun="jobs"
            resultCount={total}
            totalCount={total}
            filters={[
              {
                id: "status",
                label: "Status",
                value: status,
                onChange: (value) => {
                  setStatus(value);
                  resetPage();
                },
                options: [
                  { value: "all", label: "All statuses" },
                  { value: "running", label: "Running" },
                  { value: "queued", label: "Queued" },
                  { value: "completed", label: "Completed" },
                  { value: "failed", label: "Failed" },
                  { value: "paused_no_credits", label: "Paused · no credits" },
                  { value: "cancelled", label: "Cancelled" },
                ],
              },
              {
                id: "kind",
                label: "Kind",
                value: kind,
                onChange: (value) => {
                  setKind(value);
                  resetPage();
                },
                options: [
                  { value: "all", label: "All kinds" },
                  ...Object.entries(JOB_KIND_LABELS).map(([value, label]) => ({ value, label })),
                ],
              },
              {
                id: "error",
                label: "Error",
                value: errorFilter,
                onChange: (value) => {
                  setErrorFilter(value);
                  resetPage();
                },
                options: [
                  { value: "all", label: "Any error state" },
                  { value: "yes", label: "Has error" },
                  { value: "no", label: "No error" },
                ],
              },
              {
                id: "window",
                label: "Date",
                value: dateWindow,
                onChange: (value) => {
                  setDateWindow(value as DateWindow);
                  resetPage();
                },
                options: [...DATE_WINDOW_OPTIONS],
              },
            ]}
          />
          </TableToolbar>
        }
        pagination={{
          page,
          pageCount: pageCount(total, LEDGER_PAGE_SIZE),
          total,
          pageSize: LEDGER_PAGE_SIZE,
          onPage: setPage,
        }}
        columns={[
          {
            header: "When",
            sortKey: "when",
            className: "text-muted-foreground",
            cell: (row) => formatDateTime(row.createdAt),
          },
          {
            header: "Workspace",
            sortKey: "workspace",
            cell: (row) => (
              <Link href={adminRoutes.workspace(row.workspaceId)} className="hover:underline">
                {row.workspaceName}
              </Link>
            ),
          },
          {
            header: "Kind",
            sortKey: "kind",
            cell: (row) => JOB_KIND_LABELS[row.kind as AdminJobKind] ?? row.kind,
          },
          { header: "Status", sortKey: "status", cell: (row) => <JobStatusBadge status={row.status} /> },
          {
            header: "Progress",
            sortKey: "progress",
            numeric: true,
            cell: (row) => `${row.completedCount + row.failedCount}/${row.total}`,
          },
          {
            header: "Duration",
            sortKey: "duration",
            numeric: true,
            cell: (row) => formatDuration(row.durationMs),
          },
          { header: "Actor", sortKey: "actor", cell: (row) => row.actorName },
          {
            header: "Error",
            sortKey: "error",
            className: "max-w-[240px] truncate text-muted-foreground",
            cell: (row) => row.lastError ?? "—",
          },
        ]}
      />
      </AdminListLayout>
    </>
  );
}
