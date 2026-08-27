"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageLoader } from "@/components/brand/page-loader";
import { AdminTable } from "@/components/platform-admin/admin-table";
import { DataToolbar } from "@/components/platform-admin/data-toolbar";
import { PageHeader } from "@/components/platform-admin/page-header";
import { pageCount, paginate } from "@/components/platform-admin/pagination-bar";
import { IntegrationStatusBadge, PlanBadge } from "@/components/platform-admin/status-badge";
import { adminJson } from "@/lib/platform-admin/client-api";
import { formatCredits, formatUsd } from "@/lib/platform-admin/format";
import { PLAN_FILTER_OPTIONS, sortRows, toggleSort, type SortState } from "@/lib/platform-admin/list-query";
import type { LiveWorkspaceListRow } from "@/lib/platform-admin/live-types";
import { adminRoutes } from "@/lib/platform-admin/paths";

export default function AdminWorkspacesPage() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<LiveWorkspaceListRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [store, setStore] = useState("all");
  const [plan, setPlan] = useState("all");
  const [wallet, setWallet] = useState("all");
  const [credits, setCredits] = useState("all");
  const [members, setMembers] = useState("all");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ key: "workspace", dir: "asc" });

  useEffect(() => {
    adminJson<{ workspaces: LiveWorkspaceListRow[] }>("/api/platform-admin/workspaces")
      .then((data) => setWorkspaces(data.workspaces))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const resetPage = () => setPage(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return workspaces.filter((workspace) => {
      if (store === "none" && workspace.integrationProvider) return false;
      if (store !== "all" && store !== "none" && workspace.integrationProvider !== store) return false;
      if (plan !== "all" && (workspace.planId || "none") !== plan) return false;
      if (wallet === "empty" && workspace.walletUsd > 0) return false;
      if (wallet === "funded" && workspace.walletUsd <= 0) return false;
      if (wallet === "low" && (workspace.walletUsd <= 0 || workspace.walletUsd >= 10)) return false;
      if (credits === "none" && workspace.creditsRemaining != null) return false;
      if (credits === "empty" && workspace.creditsRemaining !== 0) return false;
      if (credits === "low" && (workspace.creditsRemaining == null || workspace.creditsRemaining <= 0 || workspace.creditsRemaining >= 200)) {
        return false;
      }
      if (members === "solo" && workspace.memberCount > 1) return false;
      if (members === "team" && workspace.memberCount <= 1) return false;
      if (!q) return true;
      return (
        workspace.name.toLowerCase().includes(q) ||
        workspace.slug.toLowerCase().includes(q) ||
        workspace.ownerEmail.toLowerCase().includes(q) ||
        workspace.ownerName.toLowerCase().includes(q)
      );
    });
  }, [workspaces, query, store, plan, wallet, credits, members]);

  const sorted = useMemo(
    () =>
      sortRows(filtered, sort, {
        workspace: (row) => row.name,
        owner: (row) => row.ownerName,
        plan: (row) => row.planName,
        members: (row) => row.memberCount,
        credits: (row) => row.creditsRemaining,
        wallet: (row) => row.walletUsd,
        store: (row) => row.integrationProvider,
      }),
    [filtered, sort]
  );

  const rows = paginate(sorted, page);
  const hasFilters =
    query.trim() !== "" ||
    store !== "all" ||
    plan !== "all" ||
    wallet !== "all" ||
    credits !== "all" ||
    members !== "all";

  const clearFilters = () => {
    setQuery("");
    setStore("all");
    setPlan("all");
    setWallet("all");
    setCredits("all");
    setMembers("all");
    setPage(1);
  };

  if (loading) return <PageLoader label="Loading workspaces" />;

  return (
    <>
      <PageHeader
        title="Workspaces"
        description="Live workspaces. Open one to sign in as the owner or delete it with all stored files."
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <AdminTable
        rows={rows}
        rowKey={(row) => row.id}
        onRowClick={(row) => router.push(adminRoutes.workspace(row.id))}
        sort={sort}
        onSort={(key) => setSort((current) => toggleSort(current, key))}
        emptyTitle={workspaces.length === 0 ? "No workspaces yet" : "No matching workspaces"}
        emptyDescription={
          workspaces.length === 0
            ? "Workspaces will appear here as customers create them."
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
            searchPlaceholder="Workspace, slug, or owner"
            noun="workspaces"
            resultCount={filtered.length}
            totalCount={workspaces.length}
            filters={[
              {
                id: "store",
                label: "Store",
                value: store,
                onChange: (value) => {
                  setStore(value);
                  resetPage();
                },
                options: [
                  { value: "all", label: "All stores" },
                  { value: "shopify", label: "Shopify" },
                  { value: "woocommerce", label: "WooCommerce" },
                  { value: "wordpress", label: "WordPress" },
                  { value: "none", label: "No integration" },
                ],
              },
              {
                id: "plan",
                label: "Plan",
                value: plan,
                onChange: (value) => {
                  setPlan(value);
                  resetPage();
                },
                options: [...PLAN_FILTER_OPTIONS, { value: "none", label: "No plan" }],
              },
              {
                id: "wallet",
                label: "Wallet",
                value: wallet,
                onChange: (value) => {
                  setWallet(value);
                  resetPage();
                },
                options: [
                  { value: "all", label: "Any balance" },
                  { value: "funded", label: "Has funds" },
                  { value: "low", label: "Low (under $10)" },
                  { value: "empty", label: "Empty" },
                ],
              },
              {
                id: "credits",
                label: "Credits",
                value: credits,
                onChange: (value) => {
                  setCredits(value);
                  resetPage();
                },
                options: [
                  { value: "all", label: "Any remaining" },
                  { value: "low", label: "Low (under 200)" },
                  { value: "empty", label: "Zero remaining" },
                  { value: "none", label: "No allotment" },
                ],
              },
              {
                id: "members",
                label: "Members",
                value: members,
                onChange: (value) => {
                  setMembers(value);
                  resetPage();
                },
                options: [
                  { value: "all", label: "Any size" },
                  { value: "solo", label: "Solo" },
                  { value: "team", label: "Team (2+)" },
                ],
              },
            ]}
          />
        }
        pagination={{
          page,
          pageCount: pageCount(filtered.length),
          total: filtered.length,
          onPage: setPage,
        }}
        columns={[
          {
            header: "Workspace",
            sortKey: "workspace",
            cell: (row) => (
              <div>
                <div className="font-medium">{row.name}</div>
                <div className="text-xs text-muted-foreground">/{row.slug}</div>
              </div>
            ),
          },
          { header: "Owner", sortKey: "owner", cell: (row) => row.ownerName },
          {
            header: "Plan",
            sortKey: "plan",
            cell: (row) => (row.planName ? <PlanBadge name={row.planName} /> : <span className="text-muted-foreground">—</span>),
          },
          { header: "Members", sortKey: "members", numeric: true, cell: (row) => row.memberCount },
          {
            header: "Credits left",
            sortKey: "credits",
            numeric: true,
            cell: (row) => (row.creditsRemaining == null ? "—" : formatCredits(row.creditsRemaining)),
          },
          {
            header: "Wallet",
            sortKey: "wallet",
            numeric: true,
            cell: (row) => formatUsd(row.walletUsd),
          },
          {
            header: "Store",
            sortKey: "store",
            cell: (row) =>
              row.integrationStatus ? (
                <IntegrationStatusBadge status={row.integrationStatus} />
              ) : (
                <span className="text-muted-foreground">None</span>
              ),
          },
        ]}
      />
    </>
  );
}
