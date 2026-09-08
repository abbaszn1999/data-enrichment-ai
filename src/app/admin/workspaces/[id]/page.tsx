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
import { DetailGrid, Panel } from "@/components/platform-admin/panel";
import { PersonCell } from "@/components/platform-admin/person-cell";
import { SignInAsButton } from "@/components/platform-admin/sign-in-as-button";
import { IntegrationStatusBadge, PlanBadge } from "@/components/platform-admin/status-badge";
import { Button } from "@/components/ui/button";
import { adminJson } from "@/lib/platform-admin/client-api";
import { formatCredits, formatDate, formatUsd, formatBytes } from "@/lib/platform-admin/format";
import { PROVIDER_LABELS, ROLE_LABELS } from "@/lib/platform-admin/labels";
import type { LiveWorkspaceDetail } from "@/lib/platform-admin/live-types";
import { adminRoutes } from "@/lib/platform-admin/paths";

export default function AdminWorkspaceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id ?? "");
  const [workspace, setWorkspace] = useState<LiveWorkspaceDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    adminJson<{ workspace: LiveWorkspaceDetail }>(`/api/platform-admin/workspaces/${id}`)
      .then((data) => setWorkspace(data.workspace))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <PageLoader label="Loading workspace" />;

  if (!workspace) {
    return (
      <>
        <BackLink href={adminRoutes.workspaces()} label="Workspaces" />
        <PageHeader title="Workspace not found" description={error} />
      </>
    );
  }

  const deleteWorkspace = async () => {
    setDeleting(true);
    try {
      await adminJson(`/api/platform-admin/workspaces/${id}`, {
        method: "DELETE",
        body: JSON.stringify({ confirm: workspace.slug }),
      });
      toast.success("Workspace deleted");
      router.replace(adminRoutes.workspaces());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
    }
  };

  return (
    <>
      <BackLink href={adminRoutes.workspaces()} label="Workspaces" />
      <PageHeader
        title={<PageTitle label={workspace.name} badge={<LiveBadge>/{workspace.slug}</LiveBadge>} />}
        description={`Owner ${workspace.ownerEmail}`}
        actions={
          <>
            <SignInAsButton userId={workspace.ownerId} email={workspace.ownerEmail} />
            <Button type="button" variant="destructive" size="sm" onClick={() => setConfirmOpen(true)}>
              Delete workspace
            </Button>
          </>
        }
      />

      <AdminListLayout>
      <DetailGrid
        items={[
          {
            label: "Owner",
            value: (
              <PersonCell
                name={workspace.ownerName}
                email={workspace.ownerEmail}
                href={adminRoutes.user(workspace.ownerId)}
              />
            ),
          },
          { label: "Created", value: formatDate(workspace.createdAt) },
          { label: "Plan (owner)", value: workspace.planName ? <PlanBadge name={workspace.planName} /> : "—" },
          {
            label: "Credits remaining",
            value: workspace.creditsRemaining == null ? "—" : formatCredits(workspace.creditsRemaining),
          },
          { label: "Wallet USD", value: formatUsd(workspace.walletUsd) },
          {
            label: "Storage",
            value: (
              <span className="tabular-nums">
                {formatBytes(workspace.storageBytes)}
                <span className="ml-1.5 font-normal text-muted-foreground">
                  · {workspace.objectCount.toLocaleString("en-US")}{" "}
                  {workspace.objectCount === 1 ? "file" : "files"}
                </span>
              </span>
            ),
          },
          {
            label: "Store",
            value: workspace.integrationProvider ? (
              <span className="flex items-center gap-2">
                {PROVIDER_LABELS[workspace.integrationProvider as keyof typeof PROVIDER_LABELS] ||
                  workspace.integrationProvider}
                {workspace.integrationStatus ? (
                  <IntegrationStatusBadge status={workspace.integrationStatus} />
                ) : null}
              </span>
            ) : (
              "Not connected"
            ),
          },
        ]}
      />

      <Panel title="Members">
        <AdminTable
          embedded
          rows={workspace.members}
          rowKey={(row) => `${row.userId}:${row.role}`}
          onRowClick={(row) => router.push(adminRoutes.user(row.userId))}
          emptyTitle="No members"
          columns={[
            {
              header: "Member",
              cell: (row) => (
                <PersonCell name={row.fullName} email={row.email} href={adminRoutes.user(row.userId)} />
              ),
            },
            { header: "Role", cell: (row) => ROLE_LABELS[row.role] },
            { header: "Joined", className: "text-muted-foreground", cell: (row) => formatDate(row.joinedAt) },
          ]}
        />
      </Panel>
      </AdminListLayout>

      <DangerConfirm
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete this workspace?"
        description={`This removes ${workspace.name}, its products, sessions, members, store connection, files, and workspace activity. A security audit receipt of this deletion is kept. Type the slug to confirm.`}
        confirmLabel={`Type ${workspace.slug}`}
        confirmValue={workspace.slug}
        actionLabel="Delete workspace"
        loading={deleting}
        onConfirm={deleteWorkspace}
      />
    </>
  );
}
