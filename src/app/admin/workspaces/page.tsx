"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageLoader } from "@/components/brand/page-loader";
import { AdminTable } from "@/components/platform-admin/admin-table";
import { FilterSelect } from "@/components/platform-admin/filter-select";
import { PageHeader } from "@/components/platform-admin/page-header";
import { PaginationBar, pageCount, paginate } from "@/components/platform-admin/pagination-bar";
import { SearchInput } from "@/components/platform-admin/search-input";
import { IntegrationStatusBadge, PlanBadge } from "@/components/platform-admin/status-badge";
import { formatCredits, formatUsd } from "@/lib/platform-admin/format";
import { adminJson } from "@/lib/platform-admin/client-api";
import type { LiveWorkspaceListRow } from "@/lib/platform-admin/live-types";
import { adminRoutes } from "@/lib/platform-admin/paths";

export default function AdminWorkspacesPage() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<LiveWorkspaceListRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [store, setStore] = useState("all");
  const [page, setPage] = useState(1);

  useEffect(() => {
    adminJson<{ workspaces: LiveWorkspaceListRow[] }>("/api/platform-admin/workspaces")
      .then((data) => setWorkspaces(data.workspaces))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return workspaces.filter((workspace) => {
      if (store === "none" && workspace.integrationProvider) return false;
      if (store !== "all" && store !== "none" && workspace.integrationProvider !== store) return false;
      if (!q) return true;
      return (
        workspace.name.toLowerCase().includes(q) ||
        workspace.slug.toLowerCase().includes(q) ||
        workspace.ownerEmail.toLowerCase().includes(q)
      );
    });
  }, [workspaces, query, store]);

  const rows = paginate(filtered, page);

  if (loading) return <PageLoader label="Loading workspaces" />;

  return (
    <>
      <PageHeader
        title="Workspaces"
        description="Live workspaces. Open one to sign in as the owner or delete it with all stored files."
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={query}
          onChange={(value) => { setQuery(value); setPage(1); }}
          placeholder="Workspace, slug, or owner email"
        />
        <FilterSelect
          label="Store"
          value={store}
          onChange={(value) => { setStore(value); setPage(1); }}
          options={[
            { value: "all", label: "All stores" },
            { value: "shopify", label: "Shopify" },
            { value: "woocommerce", label: "WooCommerce" },
            { value: "wordpress", label: "WordPress" },
            { value: "none", label: "No integration" },
          ]}
        />
      </div>
      <AdminTable
        rows={rows}
        rowKey={(row) => row.id}
        onRowClick={(row) => router.push(adminRoutes.workspace(row.id))}
        empty="No workspaces match these filters."
        columns={[
          {
            header: "Workspace",
            cell: (row) => (
              <div>
                <div className="font-medium">{row.name}</div>
                <div className="text-xs text-muted-foreground">/{row.slug}</div>
              </div>
            ),
          },
          { header: "Owner", cell: (row) => row.ownerName },
          {
            header: "Plan",
            cell: (row) => (row.planName ? <PlanBadge name={row.planName} /> : "—"),
          },
          { header: "Members", cell: (row) => row.memberCount },
          {
            header: "Credits left",
            cell: (row) => (row.creditsRemaining == null ? "—" : formatCredits(row.creditsRemaining)),
          },
          { header: "Wallet", cell: (row) => formatUsd(row.walletUsd) },
          {
            header: "Store",
            cell: (row) =>
              row.integrationStatus ? (
                <IntegrationStatusBadge status={row.integrationStatus} />
              ) : (
                <span className="text-muted-foreground">None</span>
              ),
          },
        ]}
      />
      <PaginationBar page={page} pageCount={pageCount(filtered.length)} onPage={setPage} total={filtered.length} />
    </>
  );
}
