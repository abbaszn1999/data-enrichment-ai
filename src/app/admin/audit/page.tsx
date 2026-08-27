"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageLoader } from "@/components/brand/page-loader";
import { AdminTable } from "@/components/platform-admin/admin-table";
import { PageHeader } from "@/components/platform-admin/page-header";
import { PaginationBar, pageCount, paginate } from "@/components/platform-admin/pagination-bar";
import { SearchInput } from "@/components/platform-admin/search-input";
import { adminJson } from "@/lib/platform-admin/client-api";
import { formatDateTime } from "@/lib/platform-admin/format";
import type { LiveAuditRow } from "@/lib/platform-admin/live-types";
import { adminRoutes } from "@/lib/platform-admin/paths";

export default function AdminAuditPage() {
  const [events, setEvents] = useState<LiveAuditRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    adminJson<{ events: LiveAuditRow[] }>("/api/platform-admin/audit")
      .then((data) => setEvents(data.events))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return events;
    return events.filter((event) => {
      return (
        event.action.toLowerCase().includes(q) ||
        event.userName.toLowerCase().includes(q) ||
        event.workspaceName.toLowerCase().includes(q) ||
        (event.entityType ?? "").toLowerCase().includes(q) ||
        (event.entityId ?? "").toLowerCase().includes(q)
      );
    });
  }, [events, query]);

  const rows = paginate(filtered, page, 14);

  if (loading) return <PageLoader label="Loading activity" />;

  return (
    <>
      <PageHeader
        title="Activity"
        description="Workspace actions from the product: imports, catalog changes, and related events."
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <SearchInput
        value={query}
        onChange={(value) => { setQuery(value); setPage(1); }}
        placeholder="Action, user, or workspace"
      />
      <AdminTable
        rows={rows}
        rowKey={(row) => row.id}
        empty="No activity yet."
        columns={[
          { header: "When", className: "text-muted-foreground", cell: (row) => formatDateTime(row.createdAt) },
          {
            header: "User",
            cell: (row) => (
              <Link href={adminRoutes.user(row.userId)} className="hover:underline">
                {row.userName}
              </Link>
            ),
          },
          {
            header: "Workspace",
            cell: (row) => (
              <Link href={adminRoutes.workspace(row.workspaceId)} className="hover:underline">
                {row.workspaceName}
              </Link>
            ),
          },
          { header: "Action", cell: (row) => row.action },
          {
            header: "Entity",
            className: "text-muted-foreground",
            cell: (row) =>
              row.entityType ? `${row.entityType}${row.entityId ? ` · ${row.entityId.slice(0, 8)}` : ""}` : "—",
          },
        ]}
      />
      <PaginationBar page={page} pageCount={pageCount(filtered.length, 14)} onPage={setPage} total={filtered.length} />
    </>
  );
}
