"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageLoader } from "@/components/brand/page-loader";
import { AdminTable } from "@/components/platform-admin/admin-table";
import { DataToolbar } from "@/components/platform-admin/data-toolbar";
import { PageHeader } from "@/components/platform-admin/page-header";
import { LEDGER_PAGE_SIZE, pageCount, paginate } from "@/components/platform-admin/pagination-bar";
import { adminJson } from "@/lib/platform-admin/client-api";
import { formatDateTime, formatUsd } from "@/lib/platform-admin/format";
import { WALLET_KIND_LABELS, walletModuleLabel } from "@/lib/platform-admin/labels";
import { DATE_WINDOW_OPTIONS, inDateWindow, sortRows, toggleSort, type DateWindow, type SortState } from "@/lib/platform-admin/list-query";
import type { LiveWalletTxRow } from "@/lib/platform-admin/live-types";
import { adminRoutes } from "@/lib/platform-admin/paths";
import type { AdminWalletTxKind } from "@/lib/platform-admin/types";

export default function AdminWalletPage() {
  const [transactions, setTransactions] = useState<LiveWalletTxRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [module, setModule] = useState("all");
  const [dateWindow, setDateWindow] = useState<DateWindow>("all");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ key: "when", dir: "desc" });

  useEffect(() => {
    adminJson<{ transactions: LiveWalletTxRow[] }>("/api/platform-admin/wallet")
      .then((data) => setTransactions(data.transactions))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const resetPage = () => setPage(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return transactions.filter((tx) => {
      if (kind !== "all" && tx.kind !== kind) return false;
      if (module !== "all" && tx.module !== module) return false;
      if (!inDateWindow(tx.createdAt, dateWindow)) return false;
      if (!q) return true;
      return (
        tx.workspaceName.toLowerCase().includes(q) ||
        tx.userName.toLowerCase().includes(q) ||
        tx.description.toLowerCase().includes(q)
      );
    });
  }, [transactions, query, kind, module, dateWindow]);

  const sorted = useMemo(
    () =>
      sortRows(filtered, sort, {
        when: (row) => new Date(row.createdAt).getTime(),
        workspace: (row) => row.workspaceName,
        kind: (row) => row.kind,
        module: (row) => row.module,
        description: (row) => row.description,
        amount: (row) => row.amountUsd,
      }),
    [filtered, sort]
  );

  const rows = paginate(sorted, page, LEDGER_PAGE_SIZE);
  const hasFilters = query.trim() !== "" || kind !== "all" || module !== "all" || dateWindow !== "all";

  const clearFilters = () => {
    setQuery("");
    setKind("all");
    setModule("all");
    setDateWindow("all");
    setPage(1);
  };

  if (loading) return <PageLoader label="Loading wallet" />;

  return (
    <>
      <PageHeader
        title="USD wallet"
        description="Real-dollar balance for Market Research, Growth Sync, and Website Restructure. Not AI credits."
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <AdminTable
        rows={rows}
        rowKey={(row) => row.id}
        sort={sort}
        onSort={(key) => setSort((current) => toggleSort(current, key))}
        emptyTitle={transactions.length === 0 ? "No wallet activity yet" : "No matching wallet rows"}
        emptyDescription={
          transactions.length === 0
            ? "Top-ups and charges will appear here as workspaces spend USD."
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
            searchPlaceholder="Workspace, user, or description"
            noun="rows"
            resultCount={filtered.length}
            totalCount={transactions.length}
            filters={[
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
                  { value: "topup", label: "Top-up" },
                  { value: "charge", label: "Charge" },
                  { value: "refund", label: "Refund" },
                ],
              },
              {
                id: "module",
                label: "Module",
                value: module,
                onChange: (value) => {
                  setModule(value);
                  resetPage();
                },
                options: [
                  { value: "all", label: "All modules" },
                  { value: "topup", label: "Top-up" },
                  { value: "Billing", label: "Billing" },
                  { value: "Market Research", label: "Market Research" },
                  { value: "Sync", label: "Sync" },
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
            cell: (row) => WALLET_KIND_LABELS[row.kind as AdminWalletTxKind] ?? row.kind,
          },
          {
            header: "Module",
            sortKey: "module",
            cell: (row) => walletModuleLabel(row.module),
          },
          {
            header: "Description",
            sortKey: "description",
            className: "max-w-[280px] truncate text-muted-foreground",
            cell: (row) => row.description || "—",
          },
          {
            header: "Amount",
            sortKey: "amount",
            numeric: true,
            cell: (row) => (
              <span className={row.amountUsd < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}>
                {formatUsd(row.amountUsd)}
              </span>
            ),
          },
        ]}
      />
    </>
  );
}
