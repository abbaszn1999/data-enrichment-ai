"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Building2, Plug, PlugZap } from "lucide-react";
import { PageLoader } from "@/components/brand/page-loader";
import { AdminTable } from "@/components/platform-admin/admin-table";
import { DataToolbar } from "@/components/platform-admin/data-toolbar";
import { AdminListLayout, LiveBadge, PageTitle, TableToolbar, exclusiveFilter } from "@/components/platform-admin/list-chrome";
import { OverviewPulseStrip } from "@/components/platform-admin/overview-pulse-strip";
import { PageHeader } from "@/components/platform-admin/page-header";
import { pageCount, paginate } from "@/components/platform-admin/pagination-bar";
import { IntegrationStatusBadge } from "@/components/platform-admin/status-badge";
import { adminJson } from "@/lib/platform-admin/client-api";
import { formatRelative } from "@/lib/platform-admin/format";
import { PROVIDER_LABELS } from "@/lib/platform-admin/labels";
import { sortRows, toggleSort, type SortState } from "@/lib/platform-admin/list-query";
import type { LiveIntegrationsPayload } from "@/lib/platform-admin/live-types";
import { adminRoutes } from "@/lib/platform-admin/paths";
import type { AdminIntegrationProvider } from "@/lib/platform-admin/types";

type IntegrationTableRow = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  provider: AdminIntegrationProvider | null;
  storeName: string;
  baseUrl: string;
  status: "connected" | "error" | "disconnected" | "none";
  lastSyncAt: string | null;
};

export default function AdminIntegrationsPage() {
  const [data, setData] = useState<LiveIntegrationsPayload>({ integrations: [], unconnected: [] });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ key: "store", dir: "asc" });

  useEffect(() => {
    adminJson<LiveIntegrationsPayload>("/api/platform-admin/integrations")
      .then(setData)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const allRows = useMemo<IntegrationTableRow[]>(() => {
    const connected: IntegrationTableRow[] = data.integrations.map((item) => ({
      id: item.id,
      workspaceId: item.workspaceId,
      workspaceName: item.workspaceName,
      provider: item.provider,
      storeName: item.storeName,
      baseUrl: item.baseUrl,
      status: item.status,
      lastSyncAt: item.lastSyncAt,
    }));
    const unconnected: IntegrationTableRow[] = data.unconnected.map((workspace) => ({
      id: `unconnected-${workspace.id}`,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      provider: null,
      storeName: "—",
      baseUrl: "",
      status: "none",
      lastSyncAt: null,
    }));
    return [...connected, ...unconnected];
  }, [data]);

  const resetPage = () => setPage(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allRows.filter((item) => {
      if (provider !== "all" && item.provider !== provider) return false;
      if (status !== "all" && item.status !== status) return false;
      if (!q) return true;
      return (
        item.storeName.toLowerCase().includes(q) ||
        item.workspaceName.toLowerCase().includes(q) ||
        item.baseUrl.toLowerCase().includes(q)
      );
    });
  }, [allRows, query, provider, status]);

  const sorted = useMemo(
    () =>
      sortRows(filtered, sort, {
        store: (row) => row.storeName,
        workspace: (row) => row.workspaceName,
        provider: (row) => row.provider,
        status: (row) => row.status,
        updated: (row) => (row.lastSyncAt ? new Date(row.lastSyncAt).getTime() : null),
      }),
    [filtered, sort]
  );

  const stats = useMemo(() => {
    const connected = allRows.filter((row) => row.status === "connected").length;
    const errors = allRows.filter((row) => row.status === "error").length;
    const none = allRows.filter((row) => row.status === "none").length;
    return { connected, errors, none };
  }, [allRows]);

  const rows = paginate(sorted, page);
  const hasFilters = query.trim() !== "" || provider !== "all" || status !== "all";

  const clearFilters = () => {
    setQuery("");
    setProvider("all");
    setStatus("all");
    setPage(1);
  };

  if (loading) return <PageLoader label="Loading integrations" />;

  return (
    <>
      <PageHeader
        title={<PageTitle label="Integrations" badge={<LiveBadge>{allRows.length} live</LiveBadge>} />}
        description="Connected Shopify, WooCommerce, and WordPress stores. No store credentials are shown."
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <AdminListLayout>
        <OverviewPulseStrip
          items={[
            {
              label: "Workspaces",
              value: String(allRows.length),
              hint: "With or without a store",
              icon: Building2,
              active: !hasFilters,
              onClick: () => clearFilters(),
            },
            {
              label: "Connected",
              value: String(stats.connected),
              hint: "Healthy store links",
              tone: "ok",
              icon: PlugZap,
              active: status === "connected",
              onClick: () => exclusiveFilter(status === "connected", clearFilters, () => setStatus("connected")),
            },
            {
              label: "Errors",
              value: String(stats.errors),
              hint: stats.errors ? "Needs a reconnect" : "No store errors",
              tone: stats.errors ? "danger" : "ok",
              icon: AlertTriangle,
              active: status === "error",
              onClick: () => exclusiveFilter(status === "error", clearFilters, () => setStatus("error")),
            },
            {
              label: "Not connected",
              value: String(stats.none),
              hint: "No integration yet",
              icon: Plug,
              active: status === "none",
              onClick: () => exclusiveFilter(status === "none", clearFilters, () => setStatus("none")),
            },
          ]}
        />
      <AdminTable
        rows={rows}
        rowKey={(row) => row.id}
        sort={sort}
        onSort={(key) => setSort((current) => toggleSort(current, key))}
        emptyTitle={allRows.length === 0 ? "No workspaces yet" : "No matching integrations"}
        emptyDescription={
          allRows.length === 0
            ? "Store connections will appear here as workspaces connect Shopify, WooCommerce, or WordPress."
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
            searchPlaceholder="Store, workspace, or URL"
            noun="rows"
            resultCount={filtered.length}
            totalCount={allRows.length}
            filters={[
              {
                id: "provider",
                label: "Provider",
                value: provider,
                onChange: (value) => {
                  setProvider(value);
                  resetPage();
                },
                options: [
                  { value: "all", label: "All providers" },
                  { value: "shopify", label: "Shopify" },
                  { value: "woocommerce", label: "WooCommerce" },
                  { value: "wordpress", label: "WordPress" },
                ],
              },
              {
                id: "status",
                label: "Status",
                value: status,
                onChange: (value) => {
                  setStatus(value);
                  resetPage();
                },
                options: [
                  { value: "all", label: "All statuses" },
                  { value: "connected", label: "Connected" },
                  { value: "error", label: "Error" },
                  { value: "disconnected", label: "Disconnected" },
                  { value: "none", label: "Not connected" },
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
            header: "Store",
            sortKey: "store",
            cell: (row) => (
              <div>
                <div className="font-medium">{row.storeName}</div>
                {row.baseUrl ? <div className="text-xs text-muted-foreground">{row.baseUrl}</div> : null}
              </div>
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
            header: "Provider",
            sortKey: "provider",
            cell: (row) =>
              row.provider ? PROVIDER_LABELS[row.provider] : <span className="text-muted-foreground">—</span>,
          },
          {
            header: "Status",
            sortKey: "status",
            cell: (row) => <IntegrationStatusBadge status={row.status} />,
          },
          {
            header: "Updated",
            sortKey: "updated",
            className: "text-muted-foreground",
            cell: (row) => (row.lastSyncAt ? formatRelative(row.lastSyncAt) : "—"),
          },
        ]}
      />
      </AdminListLayout>
    </>
  );
}
