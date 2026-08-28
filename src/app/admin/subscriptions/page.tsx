"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CreditCard, RefreshCcw, UserCheck } from "lucide-react";
import { PageLoader } from "@/components/brand/page-loader";
import { AdminTable } from "@/components/platform-admin/admin-table";
import { DataToolbar } from "@/components/platform-admin/data-toolbar";
import { AdminListLayout, LiveBadge, PageTitle, TableToolbar, exclusiveFilter } from "@/components/platform-admin/list-chrome";
import { OverviewPulseStrip } from "@/components/platform-admin/overview-pulse-strip";
import { PageHeader } from "@/components/platform-admin/page-header";
import { pageCount, paginate } from "@/components/platform-admin/pagination-bar";
import { PersonCell } from "@/components/platform-admin/person-cell";
import { PlanBadge, SubscriptionStatusBadge } from "@/components/platform-admin/status-badge";
import { adminJson } from "@/lib/platform-admin/client-api";
import { formatCredits, formatDate, formatUsd } from "@/lib/platform-admin/format";
import { PLAN_FILTER_OPTIONS, sortRows, toggleSort, type SortState } from "@/lib/platform-admin/list-query";
import type { LiveSubscriptionRow } from "@/lib/platform-admin/live-types";
import { adminRoutes } from "@/lib/platform-admin/paths";

export default function AdminSubscriptionsPage() {
  const router = useRouter();
  const [subscriptions, setSubscriptions] = useState<LiveSubscriptionRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [plan, setPlan] = useState("all");
  const [cycle, setCycle] = useState("all");
  const [cancel, setCancel] = useState("all");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ key: "mrr", dir: "desc" });

  useEffect(() => {
    adminJson<{ subscriptions: LiveSubscriptionRow[] }>("/api/platform-admin/subscriptions")
      .then((data) => setSubscriptions(data.subscriptions))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const resetPage = () => setPage(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return subscriptions.filter((sub) => {
      if (status === "healthy" && sub.status !== "active" && sub.status !== "trialing") return false;
      if (status !== "all" && status !== "healthy" && sub.status !== status) return false;
      if (plan !== "all" && sub.planId !== plan) return false;
      if (cycle !== "all" && sub.billingCycle !== cycle) return false;
      if (cancel === "yes" && !sub.cancelAtPeriodEnd) return false;
      if (cancel === "no" && sub.cancelAtPeriodEnd) return false;
      if (!q) return true;
      return sub.fullName.toLowerCase().includes(q) || sub.email.toLowerCase().includes(q);
    });
  }, [subscriptions, query, status, plan, cycle, cancel]);

  const sorted = useMemo(
    () =>
      sortRows(filtered, sort, {
        owner: (row) => row.fullName,
        plan: (row) => row.planName,
        status: (row) => row.status,
        cycle: (row) => row.billingCycle,
        mrr: (row) => row.mrr,
        credits: (row) => row.creditsUsed,
        remaining: (row) => row.remaining,
        period: (row) => (row.currentPeriodEnd ? new Date(row.currentPeriodEnd).getTime() : null),
        cancel: (row) => row.cancelAtPeriodEnd,
      }),
    [filtered, sort]
  );

  const stats = useMemo(() => {
    const healthy = subscriptions.filter((row) => row.status === "active" || row.status === "trialing").length;
    const pastDue = subscriptions.filter((row) => row.status === "past_due").length;
    const canceling = subscriptions.filter((row) => row.cancelAtPeriodEnd).length;
    const mrr = subscriptions
      .filter((row) => row.status === "active" || row.status === "trialing")
      .reduce((sum, row) => sum + row.mrr, 0);
    return { healthy, pastDue, canceling, mrr };
  }, [subscriptions]);

  const rows = paginate(sorted, page);
  const hasFilters =
    query.trim() !== "" || status !== "all" || plan !== "all" || cycle !== "all" || cancel !== "all";

  const clearFilters = () => {
    setQuery("");
    setStatus("all");
    setPlan("all");
    setCycle("all");
    setCancel("all");
    setPage(1);
  };

  if (loading) return <PageLoader label="Loading subscriptions" />;

  return (
    <>
      <PageHeader
        title={<PageTitle label="Subscriptions" badge={<LiveBadge>{subscriptions.length} live</LiveBadge>} />}
        description="Owner-level plans. Workspace members share the owner's credits."
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <AdminListLayout>
        <OverviewPulseStrip
          items={[
            {
              label: "MRR",
              value: formatUsd(stats.mrr),
              hint: `${subscriptions.length} owner plans`,
              icon: CreditCard,
              active: !hasFilters,
              onClick: () => clearFilters(),
            },
            {
              label: "Healthy",
              value: String(stats.healthy),
              hint: "Active or trialing",
              tone: "ok",
              icon: UserCheck,
              active: status === "healthy",
              onClick: () => exclusiveFilter(status === "healthy", clearFilters, () => setStatus("healthy")),
            },
            {
              label: "Past due",
              value: String(stats.pastDue),
              hint: stats.pastDue ? "Needs billing attention" : "None past due",
              tone: stats.pastDue ? "warn" : "ok",
              icon: AlertTriangle,
              active: status === "past_due",
              onClick: () => exclusiveFilter(status === "past_due", clearFilters, () => setStatus("past_due")),
            },
            {
              label: "Canceling",
              value: String(stats.canceling),
              hint: "Ends at period close",
              icon: RefreshCcw,
              active: cancel === "yes",
              onClick: () => exclusiveFilter(cancel === "yes", clearFilters, () => setCancel("yes")),
            },
          ]}
        />
        <AdminTable
          rows={rows}
          rowKey={(row) => row.id}
          onRowClick={(row) => router.push(adminRoutes.user(row.userId))}
          sort={sort}
          onSort={(key) => setSort((current) => toggleSort(current, key))}
          emptyTitle={subscriptions.length === 0 ? "No subscriptions yet" : "No matching subscriptions"}
          emptyDescription={
            subscriptions.length === 0
              ? "Owner plans will appear here once customers subscribe."
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
                searchPlaceholder="Owner name or email"
                noun="subscriptions"
                resultCount={filtered.length}
                totalCount={subscriptions.length}
                filters={[
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
                      { value: "healthy", label: "Healthy" },
                      { value: "active", label: "Active" },
                      { value: "trialing", label: "Trialing" },
                      { value: "past_due", label: "Past due" },
                      { value: "cancelled", label: "Cancelled" },
                      { value: "expired", label: "Expired" },
                      { value: "incomplete", label: "Incomplete" },
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
                    options: [...PLAN_FILTER_OPTIONS],
                  },
                  {
                    id: "cycle",
                    label: "Cycle",
                    value: cycle,
                    onChange: (value) => {
                      setCycle(value);
                      resetPage();
                    },
                    options: [
                      { value: "all", label: "All cycles" },
                      { value: "monthly", label: "Monthly" },
                      { value: "yearly", label: "Yearly" },
                    ],
                  },
                  {
                    id: "cancel",
                    label: "Cancel",
                    value: cancel,
                    onChange: (value) => {
                      setCancel(value);
                      resetPage();
                    },
                    options: [
                      { value: "all", label: "Any cancel state" },
                      { value: "yes", label: "Cancels at period end" },
                      { value: "no", label: "Renewing" },
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
              header: "Owner",
              sortKey: "owner",
              cell: (row) => (
                <PersonCell name={row.fullName} email={row.email} href={adminRoutes.user(row.userId)} />
              ),
            },
            { header: "Plan", sortKey: "plan", cell: (row) => <PlanBadge name={row.planName} /> },
            { header: "Status", sortKey: "status", cell: (row) => <SubscriptionStatusBadge status={row.status} /> },
            { header: "Cycle", sortKey: "cycle", cell: (row) => row.billingCycle },
            {
              header: "MRR",
              sortKey: "mrr",
              numeric: true,
              cell: (row) => `$${row.mrr.toFixed(0)}`,
            },
            {
              header: "Credits",
              sortKey: "credits",
              numeric: true,
              cell: (row) => `${formatCredits(row.creditsUsed)} / ${formatCredits(row.periodCredits)}`,
            },
            {
              header: "Remaining",
              sortKey: "remaining",
              numeric: true,
              cell: (row) => formatCredits(row.remaining),
            },
            {
              header: "Period end",
              sortKey: "period",
              className: "text-muted-foreground",
              cell: (row) => (row.currentPeriodEnd ? formatDate(row.currentPeriodEnd) : "—"),
            },
            {
              header: "Cancel",
              sortKey: "cancel",
              cell: (row) =>
                row.cancelAtPeriodEnd ? (
                  <span className="text-amber-600 dark:text-amber-400">At period end</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                ),
            },
          ]}
        />
      </AdminListLayout>
    </>
  );
}
