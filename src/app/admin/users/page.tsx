"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageLoader } from "@/components/brand/page-loader";
import { AdminTable } from "@/components/platform-admin/admin-table";
import { DataToolbar } from "@/components/platform-admin/data-toolbar";
import { PageHeader } from "@/components/platform-admin/page-header";
import { PersonCell } from "@/components/platform-admin/person-cell";
import { pageCount, paginate } from "@/components/platform-admin/pagination-bar";
import { PlanBadge, SubscriptionStatusBadge, UserStatusBadge } from "@/components/platform-admin/status-badge";
import { adminJson } from "@/lib/platform-admin/client-api";
import { formatRelative } from "@/lib/platform-admin/format";
import { PLAN_FILTER_OPTIONS, matchesLastSeen, sortRows, toggleSort, type SortState } from "@/lib/platform-admin/list-query";
import type { LiveUserListRow } from "@/lib/platform-admin/live-types";
import { adminRoutes } from "@/lib/platform-admin/paths";

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<LiveUserListRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [plan, setPlan] = useState("all");
  const [status, setStatus] = useState("all");
  const [subscription, setSubscription] = useState("all");
  const [lastSeen, setLastSeen] = useState("all");
  const [workspaces, setWorkspaces] = useState("all");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ key: "lastSeen", dir: "desc" });

  useEffect(() => {
    adminJson<{ users: LiveUserListRow[] }>("/api/platform-admin/users")
      .then((data) => setUsers(data.users))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const resetPage = () => setPage(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((user) => {
      if (plan !== "all" && (user.planId || "none") !== plan) return false;
      if (status !== "all" && user.status !== status) return false;
      if (subscription === "none" && user.subscriptionStatus) return false;
      if (subscription !== "all" && subscription !== "none" && user.subscriptionStatus !== subscription) {
        return false;
      }
      if (!matchesLastSeen(user.lastSeenAt, lastSeen as "all" | "7d" | "30d" | "stale" | "never")) return false;
      if (workspaces === "none" && user.workspaceCount > 0) return false;
      if (workspaces === "has" && user.workspaceCount === 0) return false;
      if (!q) return true;
      return user.fullName.toLowerCase().includes(q) || user.email.toLowerCase().includes(q);
    });
  }, [users, query, plan, status, subscription, lastSeen, workspaces]);

  const sorted = useMemo(
    () =>
      sortRows(filtered, sort, {
        user: (row) => row.fullName,
        plan: (row) => row.planName,
        subscription: (row) => row.subscriptionStatus,
        workspaces: (row) => row.workspaceCount,
        status: (row) => row.status,
        lastSeen: (row) => (row.lastSeenAt ? new Date(row.lastSeenAt).getTime() : null),
      }),
    [filtered, sort]
  );

  const rows = paginate(sorted, page);
  const hasFilters =
    query.trim() !== "" ||
    plan !== "all" ||
    status !== "all" ||
    subscription !== "all" ||
    lastSeen !== "all" ||
    workspaces !== "all";

  const clearFilters = () => {
    setQuery("");
    setPlan("all");
    setStatus("all");
    setSubscription("all");
    setLastSeen("all");
    setWorkspaces("all");
    setPage(1);
  };

  if (loading) return <PageLoader label="Loading users" />;

  return (
    <>
      <PageHeader
        title="Users"
        description="Live accounts. Open a user to sign in as them or delete them and every workspace they own."
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <AdminTable
        rows={rows}
        rowKey={(user) => user.id}
        onRowClick={(user) => router.push(adminRoutes.user(user.id))}
        sort={sort}
        onSort={(key) => setSort((current) => toggleSort(current, key))}
        emptyTitle={users.length === 0 ? "No users yet" : "No matching users"}
        emptyDescription={
          users.length === 0
            ? "Accounts will appear here as people sign up."
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
            searchPlaceholder="Name or email"
            noun="users"
            resultCount={filtered.length}
            totalCount={users.length}
            filters={[
              {
                id: "plan",
                label: "Plan",
                value: plan,
                onChange: (value) => {
                  setPlan(value);
                  resetPage();
                },
                options: [...PLAN_FILTER_OPTIONS, { value: "none", label: "No subscription" }],
              },
              {
                id: "status",
                label: "Account",
                value: status,
                onChange: (value) => {
                  setStatus(value);
                  resetPage();
                },
                options: [
                  { value: "all", label: "All statuses" },
                  { value: "active", label: "Active" },
                  { value: "invited", label: "Invited" },
                  { value: "disabled", label: "Disabled" },
                ],
              },
              {
                id: "subscription",
                label: "Subscription",
                value: subscription,
                onChange: (value) => {
                  setSubscription(value);
                  resetPage();
                },
                options: [
                  { value: "all", label: "All subscriptions" },
                  { value: "active", label: "Active" },
                  { value: "trialing", label: "Trialing" },
                  { value: "past_due", label: "Past due" },
                  { value: "cancelled", label: "Cancelled" },
                  { value: "expired", label: "Expired" },
                  { value: "none", label: "None" },
                ],
              },
              {
                id: "lastSeen",
                label: "Last seen",
                value: lastSeen,
                onChange: (value) => {
                  setLastSeen(value);
                  resetPage();
                },
                options: [
                  { value: "all", label: "Any time" },
                  { value: "7d", label: "Last 7 days" },
                  { value: "30d", label: "Last 30 days" },
                  { value: "stale", label: "Older than 30 days" },
                  { value: "never", label: "Never" },
                ],
              },
              {
                id: "workspaces",
                label: "Workspaces",
                value: workspaces,
                onChange: (value) => {
                  setWorkspaces(value);
                  resetPage();
                },
                options: [
                  { value: "all", label: "Any count" },
                  { value: "has", label: "Has workspaces" },
                  { value: "none", label: "No workspaces" },
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
            header: "User",
            sortKey: "user",
            cell: (user) => <PersonCell name={user.fullName} email={user.email} href={adminRoutes.user(user.id)} />,
          },
          {
            header: "Plan",
            sortKey: "plan",
            cell: (user) =>
              user.planName ? <PlanBadge name={user.planName} /> : <span className="text-muted-foreground">—</span>,
          },
          {
            header: "Subscription",
            sortKey: "subscription",
            cell: (user) =>
              user.subscriptionStatus ? (
                <SubscriptionStatusBadge status={user.subscriptionStatus} />
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
          {
            header: "Workspaces",
            sortKey: "workspaces",
            numeric: true,
            cell: (user) => user.workspaceCount,
          },
          {
            header: "Status",
            sortKey: "status",
            cell: (user) => <UserStatusBadge status={user.status} />,
          },
          {
            header: "Last seen",
            sortKey: "lastSeen",
            className: "text-muted-foreground",
            cell: (user) => formatRelative(user.lastSeenAt),
          },
        ]}
      />
    </>
  );
}
