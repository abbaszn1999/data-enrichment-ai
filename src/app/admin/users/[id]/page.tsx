"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { PageLoader } from "@/components/brand/page-loader";
import { AdminTable } from "@/components/platform-admin/admin-table";
import { BackLink } from "@/components/platform-admin/back-link";
import { DangerConfirm } from "@/components/platform-admin/danger-confirm";
import { AdminListLayout, LiveBadge, PageTitle } from "@/components/platform-admin/list-chrome";
import { PageHeader } from "@/components/platform-admin/page-header";
import { Panel, DetailGrid } from "@/components/platform-admin/panel";
import { SignInAsButton } from "@/components/platform-admin/sign-in-as-button";
import { PlanBadge, SubscriptionStatusBadge, UserStatusBadge } from "@/components/platform-admin/status-badge";
import { Button } from "@/components/ui/button";
import { adminJson } from "@/lib/platform-admin/client-api";
import { formatCredits, formatDate, formatRelative } from "@/lib/platform-admin/format";
import { ROLE_LABELS } from "@/lib/platform-admin/labels";
import type { LiveUserDetail } from "@/lib/platform-admin/live-types";
import { adminRoutes } from "@/lib/platform-admin/paths";

export default function AdminUserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id ?? "");
  const [user, setUser] = useState<LiveUserDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    adminJson<{ user: LiveUserDetail }>(`/api/platform-admin/users/${id}`)
      .then((data) => setUser(data.user))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <PageLoader label="Loading user" />;

  if (!user) {
    return (
      <>
        <BackLink href={adminRoutes.users()} label="Users" />
        <PageHeader title="User not found" description={error || "This account is not in the live directory."} />
      </>
    );
  }

  const deleteUser = async () => {
    setDeleting(true);
    try {
      await adminJson(`/api/platform-admin/users/${id}`, {
        method: "DELETE",
        body: JSON.stringify({ confirm: user.email }),
      });
      toast.success("User deleted");
      router.replace(adminRoutes.users());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
    }
  };

  return (
    <>
      <BackLink href={adminRoutes.users()} label="Users" />
      <PageHeader
        title={<PageTitle label={user.fullName} badge={<LiveBadge><span className="capitalize">{user.status}</span></LiveBadge>} />}
        description={user.email}
        actions={
          <>
            <SignInAsButton userId={user.id} email={user.email} />
            <Button type="button" variant="destructive" size="sm" onClick={() => setConfirmOpen(true)}>
              Delete user
            </Button>
          </>
        }
      />

      <AdminListLayout>
      <DetailGrid
        items={[
          { label: "Status", value: <UserStatusBadge status={user.status} /> },
          { label: "Joined", value: formatDate(user.createdAt) },
          { label: "Last seen", value: formatRelative(user.lastSeenAt) },
          { label: "Plan", value: user.planName ? <PlanBadge name={user.planName} /> : "No owner subscription" },
          {
            label: "Subscription",
            value: user.subscriptionStatus ? <SubscriptionStatusBadge status={user.subscriptionStatus} /> : "—",
          },
          { label: "Workspaces", value: String(user.workspaceCount) },
        ]}
      />

      {user.subscriptionStatus ? (
        <Panel title="Billing">
          <DetailGrid
            nested
            items={[
              { label: "Cycle", value: user.billingCycle || "—" },
              { label: "Period end", value: user.currentPeriodEnd ? formatDate(user.currentPeriodEnd) : "—" },
              { label: "Cancel at period end", value: user.cancelAtPeriodEnd ? "Yes" : "No" },
              { label: "Credits used", value: user.creditsUsed == null ? "—" : formatCredits(user.creditsUsed) },
              { label: "Period credits", value: user.periodCredits == null ? "—" : formatCredits(user.periodCredits) },
              { label: "Bonus credits", value: user.bonusCredits == null ? "—" : formatCredits(user.bonusCredits) },
              { label: "Remaining", value: user.creditsRemaining == null ? "—" : formatCredits(user.creditsRemaining) },
              {
                label: "Stripe customer",
                value: user.stripeCustomerId ? (
                  <span className="font-mono text-xs">{user.stripeCustomerId}</span>
                ) : (
                  "—"
                ),
              },
            ]}
          />
        </Panel>
      ) : null}

      <Panel title="Owned workspaces">
        <AdminTable
          embedded
          rows={user.ownedWorkspaces}
          rowKey={(row) => row.id}
          onRowClick={(row) => router.push(adminRoutes.workspace(row.id))}
          emptyTitle="No owned workspaces"
          emptyDescription="This user does not own a workspace."
          columns={[
            { header: "Workspace", cell: (row) => row.name },
            { header: "Slug", className: "text-muted-foreground", cell: (row) => `/${row.slug}` },
            { header: "Members", numeric: true, cell: (row) => row.memberCount },
          ]}
        />
      </Panel>

      <Panel title="Memberships">
        <AdminTable
          embedded
          rows={user.memberships}
          rowKey={(row) => `${row.workspaceId}:${row.userId}`}
          onRowClick={(row) => router.push(adminRoutes.workspace(row.workspaceId))}
          emptyTitle="No memberships"
          emptyDescription="This user is not a member of any workspace."
          columns={[
            { header: "Workspace", cell: (row) => row.workspaceName },
            { header: "Role", cell: (row) => ROLE_LABELS[row.role] },
            { header: "Joined", className: "text-muted-foreground", cell: (row) => formatDate(row.joinedAt) },
          ]}
        />
      </Panel>
      </AdminListLayout>

      <DangerConfirm
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete this user?"
        description={`This removes ${user.email}, every workspace they own, all files in those workspaces, and their auth account. Type the email to confirm.`}
        confirmLabel={`Type ${user.email}`}
        confirmValue={user.email}
        actionLabel="Delete user and owned workspaces"
        loading={deleting}
        onConfirm={deleteUser}
      />
    </>
  );
}
