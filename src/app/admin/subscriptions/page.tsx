"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageLoader } from "@/components/brand/page-loader";
import { AdminTable } from "@/components/platform-admin/admin-table";
import { FilterSelect } from "@/components/platform-admin/filter-select";
import { PageHeader } from "@/components/platform-admin/page-header";
import { PaginationBar, pageCount, paginate } from "@/components/platform-admin/pagination-bar";
import { PersonCell } from "@/components/platform-admin/person-cell";
import { PlanBadge, SubscriptionStatusBadge } from "@/components/platform-admin/status-badge";
import { adminJson } from "@/lib/platform-admin/client-api";
import { formatCredits, formatDate } from "@/lib/platform-admin/format";
import type { LiveSubscriptionRow } from "@/lib/platform-admin/live-types";
import { adminRoutes } from "@/lib/platform-admin/paths";

export default function AdminSubscriptionsPage() {
  const router = useRouter();
  const [subscriptions, setSubscriptions] = useState<LiveSubscriptionRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("all");
  const [plan, setPlan] = useState("all");
  const [page, setPage] = useState(1);

  useEffect(() => {
    adminJson<{ subscriptions: LiveSubscriptionRow[] }>("/api/platform-admin/subscriptions")
      .then((data) => setSubscriptions(data.subscriptions))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    return subscriptions.filter((sub) => {
      if (status !== "all" && sub.status !== status) return false;
      if (plan !== "all" && sub.planId !== plan) return false;
      return true;
    });
  }, [subscriptions, status, plan]);

  const rows = paginate(filtered, page);

  if (loading) return <PageLoader label="Loading subscriptions" />;

  return (
    <>
      <PageHeader
        title="Subscriptions"
        description="Owner-level plans. Workspace members share the owner's credits."
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          label="Status"
          value={status}
          onChange={(value) => { setStatus(value); setPage(1); }}
          options={[
            { value: "all", label: "All statuses" },
            { value: "active", label: "Active" },
            { value: "trialing", label: "Trialing" },
            { value: "past_due", label: "Past due" },
            { value: "cancelled", label: "Cancelled" },
            { value: "expired", label: "Expired" },
            { value: "incomplete", label: "Incomplete" },
          ]}
        />
        <FilterSelect
          label="Plan"
          value={plan}
          onChange={(value) => { setPlan(value); setPage(1); }}
          options={[
            { value: "all", label: "All plans" },
            { value: "free", label: "Free" },
            { value: "starter", label: "Starter" },
            { value: "growth", label: "Growth" },
            { value: "pro", label: "Pro" },
          ]}
        />
      </div>
      <AdminTable
        rows={rows}
        rowKey={(row) => row.id}
        onRowClick={(row) => router.push(adminRoutes.user(row.userId))}
        empty="No subscriptions match."
        columns={[
          {
            header: "Owner",
            cell: (row) => (
              <PersonCell name={row.fullName} email={row.email} href={adminRoutes.user(row.userId)} />
            ),
          },
          { header: "Plan", cell: (row) => <PlanBadge name={row.planName} /> },
          { header: "Status", cell: (row) => <SubscriptionStatusBadge status={row.status} /> },
          { header: "Cycle", cell: (row) => row.billingCycle },
          { header: "MRR", cell: (row) => `$${row.mrr.toFixed(0)}` },
          {
            header: "Credits",
            cell: (row) =>
              `${formatCredits(row.creditsUsed)} / ${formatCredits(row.periodCredits)}`,
          },
          { header: "Remaining", cell: (row) => formatCredits(row.remaining) },
          {
            header: "Period end",
            className: "text-muted-foreground",
            cell: (row) => (row.currentPeriodEnd ? formatDate(row.currentPeriodEnd) : "—"),
          },
          {
            header: "Cancel",
            cell: (row) => (row.cancelAtPeriodEnd ? "At period end" : "—"),
          },
        ]}
      />
      <PaginationBar page={page} pageCount={pageCount(filtered.length)} onPage={setPage} total={filtered.length} />
    </>
  );
}
