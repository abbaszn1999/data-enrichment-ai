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
import { formatCredits, formatDateTime } from "@/lib/platform-admin/format";
import { CREDIT_OPERATION_LABELS, creditOperationLabel } from "@/lib/platform-admin/labels";
import { DATE_WINDOW_OPTIONS, LEDGER_PAGE_SIZE, toggleSort, type DateWindow, type SortState } from "@/lib/platform-admin/list-query";
import type { LiveCreditTxRow } from "@/lib/platform-admin/live-types";
import { adminRoutes } from "@/lib/platform-admin/paths";

const OPERATIONS = Object.keys(CREDIT_OPERATION_LABELS);

export default function AdminCreditsPage() {
  const [rows, setRows] = useState<LiveCreditTxRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query);
  const [operation, setOperation] = useState("all");
  const [direction, setDirection] = useState("all");
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
    if (operation !== "all") params.set("operation", operation);
    if (direction !== "all") params.set("direction", direction);
    if (dateWindow !== "all") params.set("window", dateWindow);

    setBusy(true);
    adminJson<{ transactions: LiveCreditTxRow[]; total: number }>(
      `/api/platform-admin/credits?${params}`,
      { signal: controller.signal }
    )
      .then((data) => {
        setRows(data.transactions);
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
  }, [page, debouncedQuery, operation, direction, dateWindow, sort]);

  const hasFilters =
    query.trim() !== "" || operation !== "all" || direction !== "all" || dateWindow !== "all";

  const clearFilters = () => {
    setQuery("");
    setOperation("all");
    setDirection("all");
    setDateWindow("all");
    setPage(1);
  };

  if (loading) return <PageLoader label="Loading credits" />;

  return (
    <>
      <PageHeader
        title={<PageTitle label="AI credits" badge={<LiveBadge>{total} live</LiveBadge>} />}
        description="Ledger of credit spend and top-ups. Separate from the USD wallet."
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
        emptyTitle={!hasFilters && total === 0 ? "No credit activity yet" : "No matching credit rows"}
        emptyDescription={
          !hasFilters && total === 0
            ? "Spend and top-ups will appear here as workspaces use AI credits."
            : "Try a different search or clear the active filters."
        }
        onClearFilters={hasFilters ? clearFilters : undefined}
        toolbar={
          <TableToolbar label="Ledger">
          <DataToolbar
            search={query}
            onSearch={(value) => {
              setQuery(value);
              resetPage();
            }}
            searchPlaceholder="User, workspace, or operation"
            noun="rows"
            resultCount={total}
            totalCount={total}
            filters={[
              {
                id: "operation",
                label: "Operation",
                value: operation,
                onChange: (value) => {
                  setOperation(value);
                  resetPage();
                },
                options: [
                  { value: "all", label: "All operations" },
                  ...OPERATIONS.map((key) => ({
                    value: key,
                    label: creditOperationLabel(key),
                  })),
                ],
              },
              {
                id: "direction",
                label: "Type",
                value: direction,
                onChange: (value) => {
                  setDirection(value);
                  resetPage();
                },
                options: [
                  { value: "all", label: "Spend and credits" },
                  { value: "spend", label: "Spend" },
                  { value: "credit", label: "Top-up / credit" },
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
          {
            header: "Operation",
            sortKey: "operation",
            cell: (row) => creditOperationLabel(row.operation),
          },
          {
            header: "Credits",
            sortKey: "credits",
            numeric: true,
            cell: (row) => (
              <span className={row.credits < 0 ? "text-emerald-600 dark:text-emerald-400" : undefined}>
                {row.credits < 0 ? "+" : "−"}
                {formatCredits(Math.abs(row.credits))}
              </span>
            ),
          },
        ]}
      />
      </AdminListLayout>
    </>
  );
}
