"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageLoader } from "@/components/brand/page-loader";
import { AdminTable } from "@/components/platform-admin/admin-table";
import { DataToolbar } from "@/components/platform-admin/data-toolbar";
import { PageHeader } from "@/components/platform-admin/page-header";
import { LEDGER_PAGE_SIZE, pageCount, paginate } from "@/components/platform-admin/pagination-bar";
import { JobStatusBadge } from "@/components/platform-admin/status-badge";
import { adminJson } from "@/lib/platform-admin/client-api";
import { formatDateTime, formatDuration } from "@/lib/platform-admin/format";
import { JOB_KIND_LABELS } from "@/lib/platform-admin/labels";
import { DATE_WINDOW_OPTIONS, inDateWindow, sortRows, toggleSort, type DateWindow, type SortState } from "@/lib/platform-admin/list-query";
import type { LiveJobRow } from "@/lib/platform-admin/live-types";
import { adminRoutes } from "@/lib/platform-admin/paths";
import type { AdminJobKind } from "@/lib/platform-admin/types";

export default function AdminJobsPage() {
  const [jobs, setJobs] = useState<LiveJobRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [kind, setKind] = useState("all");
  const [errorFilter, setErrorFilter] = useState("all");
  const [dateWindow, setDateWindow] = useState<DateWindow>("all");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ key: "when", dir: "desc" });

  useEffect(() => {
    adminJson<{ jobs: LiveJobRow[] }>("/api/platform-admin/jobs")
      .then((data) => setJobs(data.jobs))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const resetPage = () => setPage(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return jobs.filter((job) => {
      if (status !== "all" && job.status !== status) return false;
      if (kind !== "all" && job.kind !== kind) return false;
      if (errorFilter === "yes" && !job.lastError) return false;
      if (errorFilter === "no" && job.lastError) return false;
      if (!inDateWindow(job.createdAt, dateWindow)) return false;
      if (!q) return true;
      return (
        job.workspaceName.toLowerCase().includes(q) ||
        job.actorName.toLowerCase().includes(q) ||
        (job.lastError ?? "").toLowerCase().includes(q)
      );
    });
  }, [jobs, query, status, kind, errorFilter, dateWindow]);

  const sorted = useMemo(
    () =>
      sortRows(filtered, sort, {
        when: (row) => new Date(row.createdAt).getTime(),
        workspace: (row) => row.workspaceName,
        kind: (row) => row.kind,
        status: (row) => row.status,
        progress: (row) => row.completedCount + row.failedCount,
        duration: (row) => row.durationMs,
        actor: (row) => row.actorName,
        error: (row) => row.lastError,
      }),
    [filtered, sort]
  );

  const rows = paginate(sorted, page, LEDGER_PAGE_SIZE);
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
        title="Jobs"
        description="Queued and completed catalog, gallery, and visualizer job runs."
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <AdminTable
        rows={rows}
        rowKey={(row) => row.id}
        sort={sort}
        onSort={(key) => setSort((current) => toggleSort(current, key))}
        emptyTitle={jobs.length === 0 ? "No jobs yet" : "No matching jobs"}
        emptyDescription={
          jobs.length === 0
            ? "Catalog, gallery, and visualizer runs will appear here."
            : "Try a different search or clear the active filters."
        }
        onClearFilters={hasFilters ? clearFilters : undefined}
        toolbar={
          <DataToolbar
            search={query}
            onSearch={(value) => {
              setQuery(value);
              resetPage();
            }}
            searchPlaceholder="Workspace, actor, or error"
            noun="jobs"
            resultCount={filtered.length}
            totalCount={jobs.length}
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
                  { value: "catalog", label: "Catalog" },
                  { value: "gallery", label: "Gallery" },
                  { value: "visualizer", label: "Visualizer" },
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
        }
        pagination={{
          page,
          pageCount: pageCount(filtered.length, LEDGER_PAGE_SIZE),
          total: filtered.length,
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
    </>
  );
}
