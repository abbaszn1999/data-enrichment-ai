"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageLoader } from "@/components/brand/page-loader";
import { AdminTable } from "@/components/platform-admin/admin-table";
import { DataToolbar } from "@/components/platform-admin/data-toolbar";
import { PageHeader } from "@/components/platform-admin/page-header";
import { LEDGER_PAGE_SIZE, pageCount, paginate } from "@/components/platform-admin/pagination-bar";
import { adminJson } from "@/lib/platform-admin/client-api";
import { formatCredits, formatDateTime } from "@/lib/platform-admin/format";
import { CREDIT_OPERATION_LABELS, creditOperationLabel } from "@/lib/platform-admin/labels";
import { DATE_WINDOW_OPTIONS, inDateWindow, sortRows, toggleSort, type DateWindow, type SortState } from "@/lib/platform-admin/list-query";
import type { LiveCreditTxRow } from "@/lib/platform-admin/live-types";
import { adminRoutes } from "@/lib/platform-admin/paths";

const OPERATIONS = Object.keys(CREDIT_OPERATION_LABELS);

export default function AdminCreditsPage() {
  const [transactions, setTransactions] = useState<LiveCreditTxRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [operation, setOperation] = useState("all");
  const [direction, setDirection] = useState("all");
  const [dateWindow, setDateWindow] = useState<DateWindow>("all");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ key: "when", dir: "desc" });

  useEffect(() => {
    adminJson<{ transactions: LiveCreditTxRow[] }>("/api/platform-admin/credits")
      .then((data) => setTransactions(data.transactions))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const resetPage = () => setPage(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return transactions.filter((tx) => {
      if (operation !== "all" && tx.operation !== operation) return false;
      if (direction === "spend" && tx.credits <= 0) return false;
      if (direction === "credit" && tx.credits >= 0) return false;
      if (!inDateWindow(tx.createdAt, dateWindow)) return false;
      if (!q) return true;
      return (
        tx.userName.toLowerCase().includes(q) ||
        tx.workspaceName.toLowerCase().includes(q) ||
        tx.userId.toLowerCase().includes(q) ||
        creditOperationLabel(tx.operation).toLowerCase().includes(q)
      );
    });
  }, [transactions, query, operation, direction, dateWindow]);

  const sorted = useMemo(
    () =>
      sortRows(filtered, sort, {
        when: (row) => new Date(row.createdAt).getTime(),
        user: (row) => row.userName,
        workspace: (row) => row.workspaceName,
        operation: (row) => creditOperationLabel(row.operation),
        credits: (row) => row.credits,
      }),
    [filtered, sort]
  );

  const rows = paginate(sorted, page, LEDGER_PAGE_SIZE);
  const hasFilters = query.trim() !== "" || operation !== "all" || direction !== "all" || dateWindow !== "all";

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
        title="AI credits"
        description="Ledger of credit spend and top-ups. Separate from the USD wallet."
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <AdminTable
        rows={rows}
        rowKey={(row) => row.id}
        sort={sort}
        onSort={(key) => setSort((current) => toggleSort(current, key))}
        emptyTitle={transactions.length === 0 ? "No credit activity yet" : "No matching credit rows"}
        emptyDescription={
          transactions.length === 0
            ? "Spend and top-ups will appear here as workspaces use AI credits."
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
            searchPlaceholder="User, workspace, or operation"
            noun="rows"
            resultCount={filtered.length}
            totalCount={transactions.length}
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
    </>
  );
}
