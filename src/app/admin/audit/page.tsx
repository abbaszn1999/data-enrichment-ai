"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageLoader } from "@/components/brand/page-loader";
import { AdminTable } from "@/components/platform-admin/admin-table";
import { DataToolbar } from "@/components/platform-admin/data-toolbar";
import { AdminListLayout, LiveBadge, PageTitle, TableToolbar } from "@/components/platform-admin/list-chrome";
import { PageHeader } from "@/components/platform-admin/page-header";
import { pageCount } from "@/components/platform-admin/pagination-bar";
import { useDebouncedValue } from "@/components/platform-admin/use-debounced-value";
import { adminJson } from "@/lib/platform-admin/client-api";
import { formatDateTime } from "@/lib/platform-admin/format";
import { activityEntityLabel } from "@/lib/platform-admin/labels";
import { DATE_WINDOW_OPTIONS, LEDGER_PAGE_SIZE, toggleSort, type DateWindow, type SortState } from "@/lib/platform-admin/list-query";
import type { LiveAuditRow } from "@/lib/platform-admin/live-types";
import { adminRoutes } from "@/lib/platform-admin/paths";

export default function AdminAuditPage() {
  const [rows, setRows] = useState<LiveAuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [entityTypes, setEntityTypes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query);
  const [entity, setEntity] = useState("all");
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
    if (entity !== "all") params.set("entity", entity);
    if (dateWindow !== "all") params.set("window", dateWindow);

    setBusy(true);
    adminJson<{ events: LiveAuditRow[]; total: number; entityTypes: string[] }>(
      `/api/platform-admin/audit?${params}`,
      { signal: controller.signal }
    )
      .then((data) => {
        setRows(data.events);
        setTotal(data.total);
        setEntityTypes(data.entityTypes ?? []);
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
  }, [page, debouncedQuery, entity, dateWindow, sort]);

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
        title={<PageTitle label="Activity" badge={<LiveBadge>{total} live</LiveBadge>} />}
        description="Workspace actions from the product: Catalog Intelligence, Store Assistant, Gallery, Visualizer, and related events."
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
        emptyTitle={!hasFilters && total === 0 ? "No activity yet" : "No matching activity"}
        emptyDescription={
          !hasFilters && total === 0
            ? "Catalog Intelligence, Store Assistant, and other workspace events will appear here."
            : "Try a different search or clear the active filters."
        }
        onClearFilters={hasFilters ? clearFilters : undefined}
        toolbar={
          <TableToolbar label="Log">
          <DataToolbar
            search={query}
            onSearch={(value) => {
              setQuery(value);
              resetPage();
            }}
            searchPlaceholder="Action, user, or workspace"
            noun="events"
            resultCount={total}
            totalCount={total}
            filters={[
              {
                id: "entity",
                label: "Entity",
                value: entity,
                onChange: (value) => {
                  setEntity(value);
                  resetPage();
                },
                options: [
                  { value: "all", label: "All entities" },
                  ...entityTypes.map((type) => ({ value: type, label: activityEntityLabel(type) })),
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
              row.entityType
                ? `${activityEntityLabel(row.entityType)}${row.entityId ? ` · ${row.entityId.slice(0, 8)}` : ""}`
                : "—",
          },
        ]}
      />
      </AdminListLayout>
    </>
  );
}
