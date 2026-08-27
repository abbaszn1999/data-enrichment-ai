"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageLoader } from "@/components/brand/page-loader";
import { AdminTable } from "@/components/platform-admin/admin-table";
import { DataToolbar } from "@/components/platform-admin/data-toolbar";
import { PageHeader } from "@/components/platform-admin/page-header";
import { LEDGER_PAGE_SIZE, pageCount, paginate } from "@/components/platform-admin/pagination-bar";
import { adminJson } from "@/lib/platform-admin/client-api";
import { formatDateTime } from "@/lib/platform-admin/format";
import { DATE_WINDOW_OPTIONS, inDateWindow, sortRows, toggleSort, type DateWindow, type SortState } from "@/lib/platform-admin/list-query";
import type { LiveAuditRow } from "@/lib/platform-admin/live-types";
import { adminRoutes } from "@/lib/platform-admin/paths";

export default function AdminAuditPage() {
  const [events, setEvents] = useState<LiveAuditRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [entity, setEntity] = useState("all");
  const [dateWindow, setDateWindow] = useState<DateWindow>("all");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ key: "when", dir: "desc" });

  useEffect(() => {
    adminJson<{ events: LiveAuditRow[] }>("/api/platform-admin/audit")
      .then((data) => setEvents(data.events))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const entityOptions = useMemo(() => {
    const types = [...new Set(events.map((event) => event.entityType).filter(Boolean))] as string[];
    types.sort();
    return [
      { value: "all", label: "All entities" },
      ...types.map((type) => ({ value: type, label: type })),
    ];
  }, [events]);

  const resetPage = () => setPage(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter((event) => {
      if (entity !== "all" && event.entityType !== entity) return false;
      if (!inDateWindow(event.createdAt, dateWindow)) return false;
      if (!q) return true;
      return (
        event.action.toLowerCase().includes(q) ||
        event.userName.toLowerCase().includes(q) ||
        event.workspaceName.toLowerCase().includes(q) ||
        (event.entityType ?? "").toLowerCase().includes(q) ||
        (event.entityId ?? "").toLowerCase().includes(q)
      );
    });
  }, [events, query, entity, dateWindow]);

  const sorted = useMemo(
    () =>
      sortRows(filtered, sort, {
        when: (row) => new Date(row.createdAt).getTime(),
        user: (row) => row.userName,
        workspace: (row) => row.workspaceName,
        action: (row) => row.action,
        entity: (row) => row.entityType,
      }),
    [filtered, sort]
  );

  const rows = paginate(sorted, page, LEDGER_PAGE_SIZE);
  const hasFilters = query.trim() !== "" || entity !== "all" || dateWindow !== "all";

  const clearFilters = () => {
    setQuery("");
    setEntity("all");
    setDateWindow("all");
    setPage(1);
  };

  if (loading) return <PageLoader label="Loading activity" />;

  return (
    <>
      <PageHeader
        title="Activity"
        description="Workspace actions from the product: imports, catalog changes, and related events."
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <AdminTable
        rows={rows}
        rowKey={(row) => row.id}
        sort={sort}
        onSort={(key) => setSort((current) => toggleSort(current, key))}
        emptyTitle={events.length === 0 ? "No activity yet" : "No matching activity"}
        emptyDescription={
          events.length === 0
            ? "Imports, catalog changes, and other workspace events will appear here."
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
            searchPlaceholder="Action, user, or workspace"
            noun="events"
            resultCount={filtered.length}
            totalCount={events.length}
            filters={[
              {
                id: "entity",
                label: "Entity",
                value: entity,
                onChange: (value) => {
                  setEntity(value);
                  resetPage();
                },
                options: entityOptions,
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
            header: "User",
            sortKey: "user",
            cell: (row) => (
              <Link href={adminRoutes.user(row.userId)} className="hover:underline">
                {row.userName}
              </Link>
            ),
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
          { header: "Action", sortKey: "action", cell: (row) => row.action },
          {
            header: "Entity",
            sortKey: "entity",
            className: "text-muted-foreground",
            cell: (row) =>
              row.entityType ? `${row.entityType}${row.entityId ? ` · ${row.entityId.slice(0, 8)}` : ""}` : "—",
          },
        ]}
      />
    </>
  );
}
