"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageLoader } from "@/components/brand/page-loader";
import { AdminTable } from "@/components/platform-admin/admin-table";
import { FilterSelect } from "@/components/platform-admin/filter-select";
import { PageHeader } from "@/components/platform-admin/page-header";
import { IntegrationStatusBadge } from "@/components/platform-admin/status-badge";
import { adminJson } from "@/lib/platform-admin/client-api";
import { formatRelative } from "@/lib/platform-admin/format";
import { PROVIDER_LABELS } from "@/lib/platform-admin/labels";
import type { LiveIntegrationsPayload } from "@/lib/platform-admin/live-types";
import { adminRoutes } from "@/lib/platform-admin/paths";
import type { AdminIntegrationProvider } from "@/lib/platform-admin/types";

export default function AdminIntegrationsPage() {
  const [data, setData] = useState<LiveIntegrationsPayload>({ integrations: [], unconnected: [] });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState("all");
  const [status, setStatus] = useState("all");

  useEffect(() => {
    adminJson<LiveIntegrationsPayload>("/api/platform-admin/integrations")
      .then(setData)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const connected = useMemo(() => {
    return data.integrations.filter((item) => {
      if (provider !== "all" && item.provider !== provider) return false;
      if (status !== "all" && item.status !== status) return false;
      return true;
    });
  }, [data.integrations, provider, status]);

  if (loading) return <PageLoader label="Loading integrations" />;

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Connected Shopify, WooCommerce, and WordPress stores. No store credentials are shown."
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          label="Provider"
          value={provider}
          onChange={setProvider}
          options={[
            { value: "all", label: "All providers" },
            { value: "shopify", label: "Shopify" },
            { value: "woocommerce", label: "WooCommerce" },
            { value: "wordpress", label: "WordPress" },
          ]}
        />
        <FilterSelect
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "all", label: "All statuses" },
            { value: "connected", label: "Connected" },
            { value: "error", label: "Error" },
            { value: "disconnected", label: "Disconnected" },
          ]}
        />
      </div>
      <AdminTable
        rows={connected}
        rowKey={(row) => row.id}
        empty="No integrations match."
        columns={[
          {
            header: "Store",
            cell: (row) => (
              <div>
                <div className="font-medium">{row.storeName}</div>
                <div className="text-xs text-muted-foreground">{row.baseUrl}</div>
              </div>
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
          {
            header: "Provider",
            cell: (row) => PROVIDER_LABELS[row.provider as AdminIntegrationProvider] ?? row.provider,
          },
          { header: "Status", cell: (row) => <IntegrationStatusBadge status={row.status} /> },
          {
            header: "Updated",
            className: "text-muted-foreground",
            cell: (row) => (row.lastSyncAt ? formatRelative(row.lastSyncAt) : "—"),
          },
        ]}
      />
      {data.unconnected.length > 0 && provider === "all" && status === "all" ? (
        <p className="text-xs text-muted-foreground">
          {data.unconnected.length} workspaces have no store connected:{" "}
          {data.unconnected
            .slice(0, 6)
            .map((workspace) => workspace.name)
            .join(", ")}
          {data.unconnected.length > 6 ? "…" : ""}
        </p>
      ) : null}
    </>
  );
}
