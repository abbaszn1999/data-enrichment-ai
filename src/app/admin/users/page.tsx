"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageLoader } from "@/components/brand/page-loader";
import { AdminTable } from "@/components/platform-admin/admin-table";
import { FilterSelect } from "@/components/platform-admin/filter-select";
import { PageHeader } from "@/components/platform-admin/page-header";
import { PaginationBar, pageCount, paginate } from "@/components/platform-admin/pagination-bar";
import { PersonCell } from "@/components/platform-admin/person-cell";
import { SearchInput } from "@/components/platform-admin/search-input";
import { PlanBadge, SubscriptionStatusBadge, UserStatusBadge } from "@/components/platform-admin/status-badge";
import { formatRelative } from "@/lib/platform-admin/format";
import { adminJson } from "@/lib/platform-admin/client-api";
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
  const [page, setPage] = useState(1);

  useEffect(() => {
    adminJson<{ users: LiveUserListRow[] }>("/api/platform-admin/users")
      .then((data) => setUsers(data.users))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((user) => {
      if (plan !== "all" && (user.planId || "none") !== plan) return false;
      if (status !== "all" && user.status !== status) return false;
      if (!q) return true;
      return user.fullName.toLowerCase().includes(q) || user.email.toLowerCase().includes(q);
    });
  }, [users, query, plan, status]);

  const rows = paginate(filtered, page);

  if (loading) return <PageLoader label="Loading users" />;

  return (
    <>
      <PageHeader
        title="Users"
        description="Live accounts. Open a user to sign in as them or delete them and every workspace they own."
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="Name or email" />
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
            { value: "none", label: "No subscription" },
          ]}
        />
        <FilterSelect
          label="Status"
          value={status}
          onChange={(value) => { setStatus(value); setPage(1); }}
          options={[
            { value: "all", label: "All statuses" },
            { value: "active", label: "Active" },
            { value: "invited", label: "Invited" },
            { value: "disabled", label: "Disabled" },
          ]}
        />
      </div>
      <AdminTable
        rows={rows}
        rowKey={(user) => user.id}
        onRowClick={(user) => router.push(adminRoutes.user(user.id))}
        empty="No users match these filters."
        columns={[
          {
            header: "User",
            cell: (user) => <PersonCell name={user.fullName} email={user.email} href={adminRoutes.user(user.id)} />,
          },
          {
            header: "Plan",
            cell: (user) =>
              user.planName ? <PlanBadge name={user.planName} /> : <span className="text-muted-foreground">—</span>,
          },
          {
            header: "Subscription",
            cell: (user) =>
              user.subscriptionStatus ? (
                <SubscriptionStatusBadge status={user.subscriptionStatus} />
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
          { header: "Workspaces", cell: (user) => user.workspaceCount },
          { header: "Status", cell: (user) => <UserStatusBadge status={user.status} /> },
          {
            header: "Last seen",
            className: "text-muted-foreground",
            cell: (user) => formatRelative(user.lastSeenAt),
          },
        ]}
      />
      <PaginationBar page={page} pageCount={pageCount(filtered.length)} onPage={setPage} total={filtered.length} />
    </>
  );
}
