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
import { formatDateTime, formatUsd } from "@/lib/platform-admin/format";
import { WALLET_KIND_LABELS, WALLET_MODULE_LABELS, walletModuleLabel } from "@/lib/platform-admin/labels";
import { DATE_WINDOW_OPTIONS, LEDGER_PAGE_SIZE, toggleSort, type DateWindow, type SortState } from "@/lib/platform-admin/list-query";
import type { LiveWalletTxRow } from "@/lib/platform-admin/live-types";
import { adminRoutes } from "@/lib/platform-admin/paths";
import type { AdminWalletTxKind } from "@/lib/platform-admin/types";

export default function AdminWalletPage() {
  const [rows, setRows] = useState<LiveWalletTxRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query);
  const [kind, setKind] = useState("all");
  const [module, setModule] = useState("all");
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
    if (kind !== "all") params.set("kind", kind);
    if (module !== "all") params.set("module", module);
    if (dateWindow !== "all") params.set("window", dateWindow);

    setBusy(true);
    adminJson<{ transactions: LiveWalletTxRow[]; total: number }>(
      `/api/platform-admin/wallet?${params}`,
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
  }, [page, debouncedQuery, kind, module, dateWindow, sort]);

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
        title={<PageTitle label="USD wallet" badge={<LiveBadge>{total} live</LiveBadge>} />}
        description="Real-dollar balance for Market Research, Growth Sync, and Website Restructure. Not AI credits."
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
        emptyTitle={!hasFilters && total === 0 ? "No wallet activity yet" : "No matching wallet rows"}
        emptyDescription={
          !hasFilters && total === 0
            ? "Top-ups and charges will appear here as workspaces spend USD."
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
            searchPlaceholder="Workspace, user, or description"
            noun="rows"
            resultCount={total}
            totalCount={total}
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
                  ...Object.entries(WALLET_MODULE_LABELS).map(([value, label]) => ({ value, label })),
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
      </AdminListLayout>
    </>
  );
}
