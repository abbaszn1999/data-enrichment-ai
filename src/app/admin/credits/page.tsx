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
import { formatCredits, formatDateTime } from "@/lib/platform-admin/format";
import { CREDIT_OPERATION_LABELS, creditOperationLabel } from "@/lib/platform-admin/labels";
import type { LiveCreditTxRow } from "@/lib/platform-admin/live-types";
import { adminRoutes } from "@/lib/platform-admin/paths";

const OPERATIONS = Object.keys(CREDIT_OPERATION_LABELS);

export default function AdminCreditsPage() {
  const [transactions, setTransactions] = useState<LiveCreditTxRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [operation, setOperation] = useState("all");
  const [page, setPage] = useState(1);

  useEffect(() => {
    adminJson<{ transactions: LiveCreditTxRow[] }>("/api/platform-admin/credits")
      .then((data) => setTransactions(data.transactions))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return transactions.filter((tx) => {
      if (operation !== "all" && tx.operation !== operation) return false;
      if (!q) return true;
      return (
        tx.userName.toLowerCase().includes(q) ||
        tx.workspaceName.toLowerCase().includes(q) ||
        tx.userId.toLowerCase().includes(q)
      );
    });
  }, [transactions, query, operation]);

  const rows = paginate(filtered, page, 14);

  if (loading) return <PageLoader label="Loading credits" />;

  return (
    <>
      <PageHeader
        title="AI credits"
        description="Ledger of credit spend and top-ups. Separate from the USD wallet."
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="User or workspace" />
        <FilterSelect
          label="Operation"
          value={operation}
          onChange={(value) => { setOperation(value); setPage(1); }}
          options={[
            { value: "all", label: "All operations" },
            ...OPERATIONS.map((key) => ({
              value: key,
              label: creditOperationLabel(key),
            })),
          ]}
        />
      </div>
      <AdminTable
        rows={rows}
        rowKey={(row) => row.id}
        empty="No credit rows match."
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
          { header: "Operation", cell: (row) => creditOperationLabel(row.operation) },
          {
            header: "Credits",
            cell: (row) => (
              <span className={row.credits < 0 ? "text-emerald-600" : undefined}>
                {row.credits < 0 ? "+" : "−"}
                {formatCredits(Math.abs(row.credits))}
              </span>
            ),
          },
        ]}
      />
      <PaginationBar page={page} pageCount={pageCount(filtered.length, 14)} onPage={setPage} total={filtered.length} />
    </>
  );
}
