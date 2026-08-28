"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, CreditCard, Plug, Wallet } from "lucide-react";
import { PageLoader } from "@/components/brand/page-loader";
import { AdminTable } from "@/components/platform-admin/admin-table";
import { DataToolbar } from "@/components/platform-admin/data-toolbar";
import { AdminListLayout, LiveBadge, PageTitle, TableToolbar, exclusiveFilter } from "@/components/platform-admin/list-chrome";
import { OverviewPulseStrip } from "@/components/platform-admin/overview-pulse-strip";
import { PageHeader } from "@/components/platform-admin/page-header";
import { pageCount, paginate } from "@/components/platform-admin/pagination-bar";
import { PersonCell } from "@/components/platform-admin/person-cell";
import { IntegrationStatusBadge, PlanBadge } from "@/components/platform-admin/status-badge";
import { adminJson } from "@/lib/platform-admin/client-api";
import { formatBytes, formatCredits, formatUsd, initials } from "@/lib/platform-admin/format";
import { PLAN_FILTER_OPTIONS, sortRows, toggleSort, type SortState } from "@/lib/platform-admin/list-query";
import type { LiveWorkspaceListRow } from "@/lib/platform-admin/live-types";
import { adminRoutes } from "@/lib/platform-admin/paths";
import { cn } from "@/lib/utils";

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
      if (store === "has" && !workspace.integrationProvider) return false;
      if (store !== "all" && store !== "none" && store !== "has" && workspace.integrationProvider !== store) {
        return false;
      }
      if (plan === "has" && !workspace.planId) return false;
      if (plan !== "all" && plan !== "has" && (workspace.planId || "none") !== plan) return false;
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
        storage: (row) => row.storageBytes,
        store: (row) => row.integrationProvider,
      }),
    [filtered, sort]
  );

  const stats = useMemo(() => {
    const withPlan = workspaces.filter((row) => Boolean(row.planId)).length;
    const connected = workspaces.filter((row) => Boolean(row.integrationProvider)).length;
    const funded = workspaces.filter((row) => row.walletUsd > 0).length;
    return { withPlan, connected, funded };
  }, [workspaces]);

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
        title={<PageTitle label="Workspaces" badge={<LiveBadge>{workspaces.length} live</LiveBadge>} />}
        description="Live workspaces. Open one to sign in as the owner or delete it with all stored files."
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <AdminListLayout>
        <OverviewPulseStrip
          items={[
            {
              label: "Workspaces",
              value: String(workspaces.length),
              hint: "All live tenants",
              icon: Building2,
              active: !hasFilters,
              onClick: () => clearFilters(),
            },
            {
              label: "On a plan",
              value: String(stats.withPlan),
              hint: `${workspaces.length - stats.withPlan} with no plan`,
              icon: CreditCard,
              active: plan === "has",
              onClick: () => exclusiveFilter(plan === "has", clearFilters, () => setPlan("has")),
            },
            {
              label: "Store connected",
              value: String(stats.connected),
              hint: `${workspaces.length - stats.connected} with no store`,
              icon: Plug,
              active: store === "has",
              onClick: () => exclusiveFilter(store === "has", clearFilters, () => setStore("has")),
            },
            {
              label: "Funded wallet",
              value: String(stats.funded),
              hint: `${workspaces.length - stats.funded} empty`,
              icon: Wallet,
              active: wallet === "funded",
              onClick: () => exclusiveFilter(wallet === "funded", clearFilters, () => setWallet("funded")),
            },
          ]}
        />
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
            <TableToolbar>
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
                      { value: "has", label: "Has a store" },
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
                    options: [...PLAN_FILTER_OPTIONS, { value: "has", label: "Has a plan" }, { value: "none", label: "No plan" }],
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
            </TableToolbar>
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
                <div className="flex items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#400095]/10 text-xs font-semibold text-[#400095] ring-1 ring-[#400095]/10 dark:bg-[#F76D01]/15 dark:text-[#F76D01] dark:ring-[#F76D01]/20">
                    {initials(row.name)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium leading-tight">{row.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">/{row.slug}</span>
                  </span>
                </div>
              ),
            },
            {
              header: "Owner",
              sortKey: "owner",
              cell: (row) => (
                <PersonCell name={row.ownerName} email={row.ownerEmail} href={adminRoutes.user(row.ownerId)} />
              ),
            },
            {
              header: "Plan",
              sortKey: "plan",
              cell: (row) =>
                row.planName ? <PlanBadge name={row.planName} /> : <span className="text-muted-foreground">No plan</span>,
            },
            { header: "Members", sortKey: "members", numeric: true, cell: (row) => row.memberCount },
            {
              header: "Credits left",
              sortKey: "credits",
              numeric: true,
              cell: (row) =>
                row.creditsRemaining == null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  formatCredits(row.creditsRemaining)
                ),
            },
            {
              header: "Wallet",
              sortKey: "wallet",
              numeric: true,
              cell: (row) => (
                <span className={cn(row.walletUsd <= 0 && "text-muted-foreground")}>{formatUsd(row.walletUsd)}</span>
              ),
            },
            {
              header: "Storage",
              sortKey: "storage",
              numeric: true,
              cell: (row) => (
                <span className={cn("tabular-nums", row.storageBytes <= 0 && "text-muted-foreground")}>
                  {formatBytes(row.storageBytes)}
                </span>
              ),
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
      </AdminListLayout>
    </>
  );
}
