"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageLoader } from "@/components/brand/page-loader";
import { AdminTable } from "@/components/platform-admin/admin-table";
import { FilterSelect } from "@/components/platform-admin/filter-select";
import { PageHeader } from "@/components/platform-admin/page-header";
import { PaginationBar, pageCount, paginate } from "@/components/platform-admin/pagination-bar";
import { SearchInput } from "@/components/platform-admin/search-input";
import { adminJson } from "@/lib/platform-admin/client-api";
import { formatDateTime, formatUsd } from "@/lib/platform-admin/format";
import { WALLET_KIND_LABELS, walletModuleLabel } from "@/lib/platform-admin/labels";
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
  const [page, setPage] = useState(1);

  useEffect(() => {
    adminJson<{ transactions: LiveWalletTxRow[] }>("/api/platform-admin/wallet")
      .then((data) => setTransactions(data.transactions))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return transactions.filter((tx) => {
      if (kind !== "all" && tx.kind !== kind) return false;
      if (module !== "all" && tx.module !== module) return false;
      if (!q) return true;
      return (
        tx.workspaceName.toLowerCase().includes(q) ||
        tx.userName.toLowerCase().includes(q)
      );
    });
  }, [transactions, query, kind, module]);

  const rows = paginate(filtered, page, 14);

  if (loading) return <PageLoader label="Loading wallet" />;

  return (
    <>
      <PageHeader
        title="USD wallet"
        description="Real-dollar balance for Market Research, Growth Sync, and Website Restructure. Not AI credits."
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="Workspace or user" />
        <FilterSelect
          label="Kind"
          value={kind}
          onChange={(value) => { setKind(value); setPage(1); }}
          options={[
            { value: "all", label: "All kinds" },
            { value: "topup", label: "Top-up" },
            { value: "charge", label: "Charge" },
            { value: "refund", label: "Refund" },
          ]}
        />
        <FilterSelect
          label="Module"
          value={module}
          onChange={(value) => { setModule(value); setPage(1); }}
          options={[
            { value: "all", label: "All modules" },
            { value: "topup", label: "Top-up" },
            { value: "Billing", label: "Billing" },
            { value: "Market Research", label: "Market Research" },
            { value: "Sync", label: "Sync" },
          ]}
        />
      </div>
      <AdminTable
        rows={rows}
        rowKey={(row) => row.id}
        empty="No wallet rows match."
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
          {
            header: "Kind",
            cell: (row) => WALLET_KIND_LABELS[row.kind as AdminWalletTxKind] ?? row.kind,
          },
          { header: "Module", cell: (row) => walletModuleLabel(row.module) },
          { header: "Description", cell: (row) => row.description || "—" },
          {
            header: "Amount",
            cell: (row) => (
              <span className={row.amountUsd < 0 ? "text-destructive" : "text-emerald-600"}>
                {formatUsd(row.amountUsd)}
              </span>
            ),
          },
        ]}
      />
      <PaginationBar page={page} pageCount={pageCount(filtered.length, 14)} onPage={setPage} total={filtered.length} />
    </>
  );
}
