"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, CreditCard, UserCheck, Users } from "lucide-react";
import { PageLoader } from "@/components/brand/page-loader";
import { AdminTable } from "@/components/platform-admin/admin-table";
import { DataToolbar } from "@/components/platform-admin/data-toolbar";
import { AdminListLayout, LiveBadge, PageTitle, TableToolbar, exclusiveFilter } from "@/components/platform-admin/list-chrome";
import { OverviewPulseStrip } from "@/components/platform-admin/overview-pulse-strip";
import { PageHeader } from "@/components/platform-admin/page-header";
import { pageCount, paginate } from "@/components/platform-admin/pagination-bar";
import { PlanBadge, SubscriptionStatusBadge, UserStatusBadge } from "@/components/platform-admin/status-badge";
import { adminJson } from "@/lib/platform-admin/client-api";
import { formatBytes, formatRelative, initials } from "@/lib/platform-admin/format";
import { PLAN_FILTER_OPTIONS, matchesLastSeen, sortRows, toggleSort, type SortState } from "@/lib/platform-admin/list-query";
import type { LiveUserListRow } from "@/lib/platform-admin/live-types";
import { adminRoutes } from "@/lib/platform-admin/paths";
import { cn } from "@/lib/utils";

const DAY_MS = 86_400_000;

function isRecent(iso: string | null, withinMs = DAY_MS) {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < withinMs;
}

function UserDirectoryCell({ user }: { user: LiveUserListRow }) {
  const recent = isRecent(user.lastSeenAt);
  return (
    <div className="flex items-center gap-3">
      <span className="relative shrink-0">
        <span className="flex size-10 items-center justify-center rounded-full bg-[#400095]/10 text-xs font-semibold text-[#400095] ring-1 ring-[#400095]/10 dark:bg-[#F76D01]/15 dark:text-[#F76D01] dark:ring-[#F76D01]/20">
          {initials(user.fullName)}
        </span>
        {recent ? (
          <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-card" />
        ) : null}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium leading-tight">{user.fullName}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{user.email}</span>
      </span>
    </div>
  );
}

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
      if (plan === "has" && !user.planId) return false;
      if (plan !== "all" && plan !== "has" && (user.planId || "none") !== plan) return false;
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
        storage: (row) => row.storageBytes,
        status: (row) => row.status,
        lastSeen: (row) => (row.lastSeenAt ? new Date(row.lastSeenAt).getTime() : null),
      }),
    [filtered, sort]
  );

  const stats = useMemo(() => {
    const invited = users.filter((user) => user.status === "invited").length;
    const active = users.filter((user) => user.status === "active").length;
    const withPlan = users.filter((user) => Boolean(user.planId)).length;
    const seen7d = users.filter((user) => isRecent(user.lastSeenAt, 7 * DAY_MS)).length;
    const never = users.filter((user) => !user.lastSeenAt).length;
    return { invited, active, withPlan, seen7d, never };
  }, [users]);

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

  const toggleStat = (apply: () => void, isActive: boolean) => {
    exclusiveFilter(isActive, clearFilters, apply);
  };

  if (loading) return <PageLoader label="Loading users" />;

  return (
    <>
      <PageHeader
        title={<PageTitle label="Users" badge={<LiveBadge>{users.length} live</LiveBadge>} />}
        description="Live accounts. Open a row to inspect, impersonate, or delete the owner and every workspace they own."
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <AdminListLayout>
        <OverviewPulseStrip
          items={[
            {
              label: "Accounts",
              value: String(users.length),
              hint: stats.invited ? `${stats.invited} invited` : "All registered",
              icon: Users,
              active: !hasFilters,
              onClick: () => clearFilters(),
            },
            {
              label: "Active",
              value: String(stats.active),
              hint: `${users.length - stats.active} not active`,
              tone: "ok",
              icon: UserCheck,
              active: status === "active" && plan === "all" && lastSeen === "all" && !query.trim(),
              onClick: () =>
                toggleStat(() => {
                  setStatus("active");
                  resetPage();
                }, status === "active" && plan === "all" && lastSeen === "all" && !query.trim()),
            },
            {
              label: "On a plan",
              value: String(stats.withPlan),
              hint: `${users.length - stats.withPlan} with no plan`,
              icon: CreditCard,
              active: plan === "has",
              onClick: () =>
                toggleStat(() => {
                  setPlan("has");
                  resetPage();
                }, plan === "has"),
            },
            {
              label: "Seen 7d",
              value: String(stats.seen7d),
              hint: stats.never ? `${stats.never} never seen` : "Recent sessions",
              icon: Clock,
              active: lastSeen === "7d",
              onClick: () =>
                toggleStat(() => {
                  setLastSeen("7d");
                  resetPage();
                }, lastSeen === "7d"),
            },
          ]}
        />

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
            <TableToolbar>
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
                    options: [
                      ...PLAN_FILTER_OPTIONS,
                      { value: "has", label: "Has a plan" },
                      { value: "none", label: "No subscription" },
                    ],
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
              header: "User",
              sortKey: "user",
              cell: (user) => <UserDirectoryCell user={user} />,
            },
            {
              header: "Plan",
              sortKey: "plan",
              cell: (user) =>
                user.planName ? (
                  <PlanBadge name={user.planName} />
                ) : (
                  <span className="text-muted-foreground">No plan</span>
                ),
            },
            {
              header: "Subscription",
              sortKey: "subscription",
              cell: (user) =>
                user.subscriptionStatus ? (
                  <SubscriptionStatusBadge status={user.subscriptionStatus} />
                ) : (
                  <span className="text-muted-foreground">None</span>
                ),
            },
            {
              header: "Workspaces",
              sortKey: "workspaces",
              numeric: true,
              cell: (user) => (
                <span className={cn(user.workspaceCount === 0 && "text-muted-foreground")}>
                  {user.workspaceCount}
                </span>
              ),
            },
            {
              header: "Storage",
              sortKey: "storage",
              numeric: true,
              cell: (user) => (
                <span className={cn("tabular-nums", user.storageBytes <= 0 && "text-muted-foreground")}>
                  {formatBytes(user.storageBytes)}
                </span>
              ),
            },
            {
              header: "Status",
              sortKey: "status",
              cell: (user) => <UserStatusBadge status={user.status} />,
            },
            {
              header: "Last seen",
              sortKey: "lastSeen",
              cell: (user) => (
                <span
                  className={cn(
                    "text-muted-foreground",
                    isRecent(user.lastSeenAt) && "font-medium text-emerald-600 dark:text-emerald-400"
                  )}
                >
                  {formatRelative(user.lastSeenAt)}
                </span>
              ),
            },
          ]}
        />
      </AdminListLayout>
    </>
  );
}
