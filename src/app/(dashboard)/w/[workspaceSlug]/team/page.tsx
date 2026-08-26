"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { PageLoader } from "@/components/brand/page-loader";
import {
  Users,
  Mail,
  Shield,
  Loader2,
  Trash2,
  Clock,
  AlertCircle,
  CheckCircle2,
  X,
  Copy,
  Link,
  UserPlus,
  Crown,
  ShieldCheck,
  Eye,
  PenLine,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkspaceContext } from "../workspace-context";
import { useRole } from "@/hooks/use-role";
import { useAuth } from "@/hooks/use-auth";
import { useSubscription } from "@/hooks/use-subscription";
import { useTeam } from "@/hooks/use-team";
import {
  cancelInvite,
  removeMember,
  updateMemberRole,
} from "@/lib/supabase";
import type { Role } from "@/lib/permissions";

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  owner: { label: "Owner", color: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400" },
  admin: { label: "Admin", color: "bg-purple-50 text-purple-700 dark:bg-purple-950/30 dark:text-purple-400" },
  editor: { label: "Editor", color: "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400" },
  viewer: { label: "Viewer", color: "bg-gray-50 text-gray-700 dark:bg-gray-950/30 dark:text-gray-400" },
};

export default function TeamPage() {
  const { workspace, role } = useWorkspaceContext();
  const permissions = useRole(role);
  const { user } = useAuth();
  const router = useRouter();
  const { subscription, plan, isActive, isLoading: subscriptionLoading } = useSubscription(workspace?.id ?? null);

  const { members, invites, isLoading: teamLoading, refresh: refreshTeam } = useTeam(workspace?.id ?? null);

  const [showInvite, setShowInvite] = useState(false);
  const [limitDialogOpen, setLimitDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("editor");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState(false);
  const [inviteLink, setInviteLink] = useState("");
  const [inviteEmailSent, setInviteEmailSent] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [resendingInvite, setResendingInvite] = useState<string | null>(null);

  const pendingInviteCount = invites.length;
  const currentMemberCount = members.length;
  const currentSeatCount = currentMemberCount + pendingInviteCount;
  const maxMembers = plan?.max_members_per_workspace ?? null;
  const hasReachedMemberLimit = !!maxMembers && currentSeatCount >= maxMembers;

  const handleOpenInvite = () => {
    if (subscriptionLoading) return;
    if (!subscription || !isActive) {
      return;
    }
    if (hasReachedMemberLimit) {
      setLimitDialogOpen(true);
      return;
    }
    setInviteError("");
    setShowInvite((prev) => !prev);
  };

  const handleResendInvite = async (inviteId: string) => {
    setResendingInvite(inviteId);
    try {
      const res = await fetch("/api/team/invite-resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to resend");
      alert(data.emailSent ? "Invite email resent successfully!" : "Could not send email. Share the invite link manually.");
      refreshTeam();
    } catch (err: any) {
      alert(err?.message || "Failed to resend invite");
    } finally {
      setResendingInvite(null);
    }
  };

  const handleInvite = async () => {
    if (!workspace || !inviteEmail) return;
    setInviteError("");
    setInviteLoading(true);
    try {
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: workspace.id, email: inviteEmail, role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send invite");
      setInviteSuccess(true);
      setInviteEmail("");
      setInviteLink(data.inviteUrl);
      setInviteEmailSent(!!data.emailSent);
      refreshTeam();
      setTimeout(() => { setInviteSuccess(false); setInviteLink(""); setInviteEmailSent(false); }, 15000);
    } catch (err: any) {
      setInviteError(err?.message || "Failed to send invite");
    } finally {
      setInviteLoading(false);
    }
  };

  const handleCancelInvite = async (inviteId: string) => {
    if (!confirm("Cancel this invite?")) return;
    try {
      await cancelInvite(inviteId);
      refreshTeam();
    } catch (err: any) {
      alert(err?.message || "Failed to cancel invite");
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const handleRemove = async (memberId: string) => {
    try {
      await removeMember(memberId);
      refreshTeam();
    } catch (err: any) {
      alert(err?.message || "Failed to remove member");
    } finally {
      setConfirmRemoveId(null);
    }
  };

  const handleRoleChange = async (memberId: string, newRole: Role) => {
    try {
      await updateMemberRole(memberId, newRole);
      refreshTeam();
    } catch (err: any) {
      alert(err?.message || "Failed to update role");
    }
  };

  const loading = subscriptionLoading || teamLoading;

  if (loading && members.length === 0) {
    return <PageLoader />;
  }

  const adminCount = members.filter(
    (m) => m.role === "owner" || m.role === "admin"
  ).length;
  const editorCount = members.filter((m) => m.role === "editor").length;
  const viewerCount = members.filter((m) => m.role === "viewer").length;

  return (
    <div className="autommerce-dashboard flex-1 overflow-auto bg-background [font-family:var(--brand-font)]">
      <section className="relative overflow-hidden border-b border-border/60 bg-gradient-to-br from-[#400095]/[0.08] via-background to-[#F76D01]/[0.08]">
        <div className="absolute -left-20 -top-28 h-64 w-64 rounded-full bg-[#400095]/10 blur-3xl" />
        <div className="absolute -bottom-28 -right-16 h-64 w-64 rounded-full bg-[#F76D01]/10 blur-3xl" />
        <div className="relative mx-auto max-w-7xl px-6 py-7">
          <motion.header
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="flex flex-wrap items-end justify-between gap-4"
          >
            <div>
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#400095] text-white shadow-[0_8px_25px_rgba(64,0,149,.22)] dark:bg-[#F76D01]">
                  <Users className="h-4 w-4" />
                </span>
                <span className="text-[9px] font-black uppercase tracking-[0.24em] text-[#400095] dark:text-[#F76D01]">
                  Workspace
                </span>
              </div>
              <h1 className="text-3xl font-black tracking-[-0.035em] sm:text-4xl">
                Team
                <span className="block bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095] bg-clip-text pb-1 text-transparent">
                  members & roles.
                </span>
              </h1>
              <p className="mt-2 max-w-xl text-xs leading-relaxed text-muted-foreground">
                Manage members, roles, and invitations for this workspace.
              </p>
            </div>
            {permissions.canAdmin && (
              <Button
                size="sm"
                className="h-9 gap-1.5 self-start rounded-xl bg-[#400095] px-4 text-xs text-white shadow-[0_8px_24px_rgba(64,0,149,.2)] hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90 sm:self-auto"
                onClick={handleOpenInvite}
                disabled={subscriptionLoading}
              >
                <UserPlus className="h-3.5 w-3.5" /> Invite member
              </Button>
            )}
          </motion.header>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            {
              label: "Members",
              value: members.length,
              icon: Users,
              style: "bg-[#400095]/10 text-[#6B358D] dark:bg-[#F76D01]/10 dark:text-[#F76D01]",
            },
            {
              label: "Admins",
              value: adminCount,
              icon: ShieldCheck,
              style: "bg-violet-500/10 text-violet-600",
            },
            {
              label: "Pending",
              value: pendingInviteCount,
              icon: Clock,
              style: "bg-amber-500/10 text-amber-600",
            },
            {
              label: "Seats used",
              value: maxMembers
                ? `${currentSeatCount}/${maxMembers}`
                : currentSeatCount,
              icon: Crown,
              style: "bg-blue-500/10 text-blue-600",
            },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: i * 0.04 }}
              className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm"
            >
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-lg ${stat.style}`}
              >
                <stat.icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-lg font-black leading-none">{stat.value}</p>
                <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {stat.label}
                </p>
              </div>
            </motion.div>
          ))}
        </section>

        {showInvite && permissions.canAdmin && (
          <section className="overflow-hidden rounded-2xl border border-[#6B358D]/20 bg-card shadow-sm dark:border-[#F76D01]/20">
            <div className="border-b bg-muted/20 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#400095]/10 text-[#6B358D] dark:bg-[#F76D01]/10 dark:text-[#F76D01]">
                  <Mail className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold">Send invite</h2>
                  <p className="text-[11px] text-muted-foreground">
                    Invite a new member to your workspace
                  </p>
                </div>
              </div>
            </div>
            <div className="space-y-4 p-5">
              {inviteError && (
                <div className="flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {inviteError}
                </div>
              )}
              {inviteSuccess && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 rounded-xl border border-emerald-200/40 bg-emerald-50 p-3 text-xs text-emerald-700 dark:bg-emerald-950/20">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    {inviteEmailSent
                      ? "Invite sent! An email has been delivered to the user."
                      : "Invite created! Share the link below with the user."}
                  </div>
                  {inviteLink && (
                    <div className="flex items-center gap-2 rounded-xl border border-blue-200/40 bg-blue-50 p-3 text-xs text-blue-700 dark:bg-blue-950/20">
                      <Link className="h-3.5 w-3.5 shrink-0" />
                      <span className="flex-1 truncate font-mono text-[10px]">
                        {inviteLink}
                      </span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(inviteLink)}
                        className="shrink-0 rounded-lg p-1.5 hover:bg-blue-100 dark:hover:bg-blue-900/30"
                        title="Copy invite link"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Label className="text-xs font-semibold">Email address</Label>
                  <Input
                    type="email"
                    placeholder="colleague@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="h-10"
                  />
                </div>
                <div className="w-full space-y-1.5 sm:w-36">
                  <Label className="text-xs font-semibold">Role</Label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as Role)}
                    className="h-10 w-full rounded-md border bg-background px-2.5 text-xs outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="admin">Admin</option>
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </div>
                <Button
                  className="h-10 gap-2 rounded-xl bg-[#400095] text-white hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
                  onClick={handleInvite}
                  disabled={inviteLoading || !inviteEmail}
                >
                  {inviteLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Mail className="h-4 w-4" />
                  )}
                  Send invite
                </Button>
              </div>
            </div>
          </section>
        )}

        {invites.length > 0 && (
          <section className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
            <div className="flex items-center gap-2 border-b bg-muted/20 px-5 py-4">
              <Clock className="h-4 w-4 text-amber-500" />
              <h2 className="text-sm font-bold">Pending invites</h2>
              <Badge className="border-amber-500/20 bg-amber-500/15 px-1.5 py-0 text-[9px] text-amber-600 dark:text-amber-400">
                {invites.length}
              </Badge>
            </div>
            <div className="space-y-2 p-4">
              {invites.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center gap-3 rounded-xl border bg-background p-3"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
                    <Mail className="h-3.5 w-3.5 text-amber-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold">{inv.email}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Clock className="h-2.5 w-2.5" />
                      Expires {new Date(inv.expires_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge
                    variant="secondary"
                    className={`text-[9px] ${ROLE_LABELS[inv.role]?.color}`}
                  >
                    {ROLE_LABELS[inv.role]?.label}
                  </Badge>
                  <button
                    type="button"
                    onClick={() => handleResendInvite(inv.id)}
                    disabled={resendingInvite === inv.id}
                    className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-[#400095]/10 dark:hover:bg-[#F76D01]/10"
                    title="Resend invite email"
                  >
                    <RefreshCw
                      className={`h-3 w-3 text-[#6B358D] dark:text-[#F76D01] ${
                        resendingInvite === inv.id ? "animate-spin" : ""
                      }`}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard(
                        `${window.location.origin}/invite/${inv.token}`
                      )
                    }
                    className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-muted"
                    title="Copy invite link"
                  >
                    <Copy className="h-3 w-3 text-muted-foreground" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCancelInvite(inv.id)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-destructive/10"
                    title="Cancel invite"
                  >
                    <X className="h-3 w-3 text-destructive" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
          <div className="flex flex-col gap-1 border-b bg-muted/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#400095]/10 text-[#6B358D] dark:bg-[#F76D01]/10 dark:text-[#F76D01]">
                <Users className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold">Members</h2>
                <p className="text-[11px] text-muted-foreground">
                  {members.length} total · {editorCount} editors · {viewerCount}{" "}
                  viewers
                </p>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-border bg-card">
                  <th className="bg-card px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Member
                  </th>
                  <th className="bg-card px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Role
                  </th>
                  <th className="bg-card px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Joined
                  </th>
                  {permissions.canAdmin && (
                    <th className="bg-card px-5 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Actions
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {members.map((member) => {
                  const rl = ROLE_LABELS[member.role] || ROLE_LABELS.viewer;
                  const initials = (
                    member.profiles?.full_name ||
                    member.email ||
                    "??"
                  )
                    .split(/[\s@]/)
                    .filter(Boolean)
                    .map((n) => n[0])
                    .join("")
                    .toUpperCase()
                    .slice(0, 2);

                  return (
                    <tr
                      key={member.id}
                      className="border-b last:border-0 hover:bg-muted/30"
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#400095]/10 dark:bg-[#F76D01]/10">
                            <span className="text-[10px] font-bold text-[#6B358D] dark:text-[#F76D01]">
                              {initials}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold">
                              {member.profiles?.full_name ||
                                member.email?.split("@")[0] ||
                                "Member"}
                            </p>
                            <p className="truncate text-[10px] text-muted-foreground">
                              {member.email || member.user_id?.slice(0, 8)}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        {permissions.canAdmin &&
                        member.role !== "owner" &&
                        member.user_id !== user?.id ? (
                          <select
                            value={member.role}
                            onChange={(e) =>
                              handleRoleChange(
                                member.id,
                                e.target.value as Role
                              )
                            }
                            className="h-7 cursor-pointer rounded-md border bg-background px-2.5 text-[11px] font-semibold outline-none hover:border-[#6B358D]/50 dark:hover:border-[#F76D01]/50 focus:ring-1 focus:ring-ring"
                          >
                            <option value="admin">Admin</option>
                            <option value="editor">Editor</option>
                            <option value="viewer">Viewer</option>
                          </select>
                        ) : (
                          <Badge
                            variant="secondary"
                            className={`gap-1 text-[9px] ${rl.color}`}
                          >
                            <Shield className="h-2.5 w-2.5" />
                            {rl.label}
                          </Badge>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-muted-foreground">
                        {new Date(member.joined_at).toLocaleDateString()}
                      </td>
                      {permissions.canAdmin && (
                        <td className="px-5 py-3.5 text-center">
                          {member.role !== "owner" &&
                            member.user_id !== user?.id && (
                              <button
                                type="button"
                                onClick={() => setConfirmRemoveId(member.id)}
                                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-destructive/20 bg-destructive/5 px-2.5 text-[11px] font-medium text-destructive transition-colors hover:border-destructive/40 hover:bg-destructive/15"
                                title={`Remove ${member.profiles?.full_name || member.email || "member"}`}
                              >
                                <Trash2 className="h-3 w-3" />
                                Remove
                              </button>
                            )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
          <div className="flex items-center gap-3 border-b bg-muted/20 px-5 py-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold">Role permissions</h2>
              <p className="text-[11px] text-muted-foreground">
                What each role can do in this workspace
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-border bg-card">
                  <th className="bg-card px-5 py-3 text-left font-semibold text-muted-foreground">
                    Permission
                  </th>
                  {[
                    { label: "Owner", icon: Crown, color: "text-amber-500" },
                    {
                      label: "Admin",
                      icon: ShieldCheck,
                      color: "text-violet-500",
                    },
                    { label: "Editor", icon: PenLine, color: "text-blue-500" },
                    { label: "Viewer", icon: Eye, color: "text-muted-foreground" },
                  ].map((r) => (
                    <th key={r.label} className="bg-card px-4 py-3 text-center font-semibold">
                      <div className="flex flex-col items-center gap-1">
                        <r.icon className={`h-3.5 w-3.5 ${r.color}`} />
                        <span className={r.color}>{r.label}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ["Workspace settings", true, true, false, false],
                  ["Delete workspace", true, false, false, false],
                  ["Manage team", true, true, false, false],
                  ["Manage categories", true, true, false, false],
                  ["Edit / select products", true, true, true, false],
                  ["Delete all products", true, true, false, false],
                  ["Upload files", true, true, true, false],
                  ["New catalog intelligence / enrichment", true, true, true, false],
                  ["Delete catalog intelligence sessions", true, true, false, false],
                  ["View data", true, true, true, true],
                ].map(([label, ...vals]) => (
                  <tr
                    key={label as string}
                    className="border-b last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-5 py-2.5 text-muted-foreground">
                      {label as string}
                    </td>
                    {(vals as boolean[]).map((v, i) => (
                      <td key={i} className="px-4 py-2.5 text-center">
                        {v ? (
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10">
                            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                          </span>
                        ) : (
                          <span className="font-bold text-muted-foreground/30">
                            —
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {confirmRemoveId &&
        (() => {
          const target = members.find((m) => m.id === confirmRemoveId);
          const displayName =
            target?.profiles?.full_name ||
            target?.email?.split("@")[0] ||
            "this member";
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div
                className="fixed inset-0 bg-black/50"
                onClick={() => setConfirmRemoveId(null)}
              />
              <div className="relative z-50 mx-4 w-full max-w-sm space-y-4 rounded-xl border bg-background p-6 shadow-xl">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
                    <Trash2 className="h-5 w-5 text-destructive" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold">Remove member?</h3>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      This action cannot be undone
                    </p>
                  </div>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Are you sure you want to remove{" "}
                  <strong className="text-foreground">{displayName}</strong> from
                  this workspace?
                </p>
                <div className="flex gap-2 pt-1">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setConfirmRemoveId(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    className="flex-1"
                    onClick={() => handleRemove(confirmRemoveId)}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            </div>
          );
        })()}

      <Dialog open={limitDialogOpen} onOpenChange={setLimitDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-amber-500" /> Team member limit
              reached
            </DialogTitle>
            <DialogDescription>
              You have reached the maximum number of team members allowed for
              your current plan.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 rounded-xl border bg-muted/40 p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10">
                <Crown className="h-5 w-5 text-amber-500" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold">
                  {plan?.display_name || "Current plan"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {currentSeatCount} of {maxMembers ?? 0} team member slots
                  used.
                </p>
              </div>
            </div>

            <p className="text-sm leading-6 text-muted-foreground">
              Upgrade your plan to invite more team members to this workspace.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setLimitDialogOpen(false)}>
              Close
            </Button>
            <Button
              className="rounded-xl bg-[#400095] text-white hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
              onClick={() =>
                router?.push(`/w/${workspace?.slug}/subscription`)
              }
            >
              Upgrade Plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
