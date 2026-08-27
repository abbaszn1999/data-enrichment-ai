"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageLoader } from "@/components/brand/page-loader";
import { AdminTable } from "@/components/platform-admin/admin-table";
import { FilterSelect } from "@/components/platform-admin/filter-select";
import { PageHeader } from "@/components/platform-admin/page-header";
import { PaginationBar, pageCount, paginate } from "@/components/platform-admin/pagination-bar";
import { JobStatusBadge } from "@/components/platform-admin/status-badge";
import { adminJson } from "@/lib/platform-admin/client-api";
import { formatDateTime, formatDuration } from "@/lib/platform-admin/format";
import { JOB_KIND_LABELS } from "@/lib/platform-admin/labels";
import type { LiveJobRow } from "@/lib/platform-admin/live-types";
import { adminRoutes } from "@/lib/platform-admin/paths";
import type { AdminJobKind } from "@/lib/platform-admin/types";

export default function AdminJobsPage() {
  const [jobs, setJobs] = useState<LiveJobRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("all");
  const [kind, setKind] = useState("all");
  const [page, setPage] = useState(1);

  useEffect(() => {
    adminJson<{ jobs: LiveJobRow[] }>("/api/platform-admin/jobs")
      .then((data) => setJobs(data.jobs))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    return jobs.filter((job) => {
      if (status !== "all" && job.status !== status) return false;
      if (kind !== "all" && job.kind !== kind) return false;
      return true;
    });
  }, [jobs, status, kind]);

  const rows = paginate(filtered, page);

  if (loading) return <PageLoader label="Loading jobs" />;

  return (
    <>
      <PageHeader
        title="Jobs"
        description="Queued and completed catalog, gallery, and visualizer job runs."
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          label="Status"
          value={status}
          onChange={(value) => { setStatus(value); setPage(1); }}
          options={[
            { value: "all", label: "All statuses" },
            { value: "running", label: "Running" },
            { value: "queued", label: "Queued" },
            { value: "completed", label: "Completed" },
            { value: "failed", label: "Failed" },
            { value: "paused_no_credits", label: "Paused · no credits" },
            { value: "cancelled", label: "Cancelled" },
          ]}
        />
        <FilterSelect
          label="Kind"
          value={kind}
          onChange={(value) => { setKind(value); setPage(1); }}
          options={[
            { value: "all", label: "All kinds" },
            { value: "catalog", label: "Catalog" },
            { value: "gallery", label: "Gallery" },
            { value: "visualizer", label: "Visualizer" },
          ]}
        />
      </div>
      <AdminTable
        rows={rows}
        rowKey={(row) => row.id}
        empty="No jobs match."
        columns={[
          { header: "When", className: "text-muted-foreground", cell: (row) => formatDateTime(row.createdAt) },
          {
            header: "Workspace",
            cell: (row) => (
              <Link href={adminRoutes.workspace(row.workspaceId)} className="hover:underline">
                {row.workspaceName}
              </Link>
            ),
          },
          { header: "Kind", cell: (row) => JOB_KIND_LABELS[row.kind as AdminJobKind] ?? row.kind },
          { header: "Status", cell: (row) => <JobStatusBadge status={row.status} /> },
          { header: "Progress", cell: (row) => `${row.completedCount + row.failedCount}/${row.total}` },
          { header: "Duration", cell: (row) => formatDuration(row.durationMs) },
          { header: "Actor", cell: (row) => row.actorName },
          {
            header: "Error",
            className: "max-w-[240px] truncate text-muted-foreground",
            cell: (row) => row.lastError ?? "—",
          },
        ]}
      />
      <PaginationBar page={page} pageCount={pageCount(filtered.length)} onPage={setPage} total={filtered.length} />
    </>
  );
}
