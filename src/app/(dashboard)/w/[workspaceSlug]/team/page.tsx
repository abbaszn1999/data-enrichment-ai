"use client";

import { useEffect, useState } from "react";
import {
  Users,
  Plus,
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkspaceContext } from "../layout";
import { useRole } from "@/hooks/use-role";
import { useAuth } from "@/hooks/use-auth";
import {
  getWorkspaceMembers,
  getWorkspaceInvites,
  cancelInvite,
  removeMember,
  updateMemberRole,
  type WorkspaceMember,
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
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("editor");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState(false);
  const [inviteLink, setInviteLink] = useState("");
  const [inviteEmailSent, setInviteEmailSent] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace) return;
    async function load() {
      try {
        const m = await getWorkspaceMembers(workspace!.id);
        setMembers(m);
      } catch (err: any) {
        console.error("Failed to load members:", err?.message || err?.code || JSON.stringify(err));
      }
      try {
        const i = await getWorkspaceInvites(workspace!.id);
        setInvites(i);
      } catch (err: any) {
        console.error("Failed to load invites:", err?.message || err?.code || JSON.stringify(err));
      }
      setLoading(false);
    }
    load();
  }, [workspace]);

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
      const i = await getWorkspaceInvites(workspace.id);
      setInvites(i);
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
      setInvites((prev) => prev.filter((inv) => inv.id !== inviteId));
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
      setMembers((prev) => prev.filter((m) => m.id !== memberId));
    } catch (err: any) {
      alert(err?.message || "Failed to remove member");
    } finally {
      setConfirmRemoveId(null);
    }
  };

  const handleRoleChange = async (memberId: string, newRole: Role) => {
    try {
      await updateMemberRole(memberId, newRole);
      setMembers((prev) =>
        prev.map((m) => (m.id === memberId ? { ...m, role: newRole } : m))
      );
    } catch (err: any) {
      alert(err?.message || "Failed to update role");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-bold">Team</h1>
          </div>
          <p className="text-xs text-muted-foreground">
            {members.length} member{members.length !== 1 && "s"} in this workspace
          </p>
        </div>
        {permissions.canAdmin && (
          <Button size="sm" className="gap-1.5" onClick={() => setShowInvite(!showInvite)}>
            <UserPlus className="h-4 w-4" />
            Invite Member
          </Button>
        )}
      </div>

      {/* Invite Form */}
      {showInvite && permissions.canAdmin && (
        <div className="rounded-2xl border-2 border-primary/20 p-6 space-y-4 bg-primary/[0.02]">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Mail className="h-4.5 w-4.5 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-bold">Send Invite</h3>
              <p className="text-[11px] text-muted-foreground">Invite a new member to your workspace</p>
            </div>
          </div>

          {inviteError && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 text-destructive text-xs border border-destructive/20">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {inviteError}
            </div>
          )}
          {inviteSuccess && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 p-3 rounded-xl bg-green-50 dark:bg-green-950/20 text-green-700 text-xs border border-green-200/40">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                {inviteEmailSent
                  ? "Invite sent! An email has been delivered to the user."
                  : "Invite created! Share the link below with the user."}
              </div>
              {inviteLink && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-blue-50 dark:bg-blue-950/20 text-blue-700 text-xs border border-blue-200/40">
                  <Link className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="truncate flex-1 font-mono text-[10px]">{inviteLink}</span>
                  <button
                    onClick={() => copyToClipboard(inviteLink)}
                    className="flex-shrink-0 hover:bg-blue-100 dark:hover:bg-blue-900/30 p-1.5 rounded-lg"
                    title="Copy invite link"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <Label className="text-xs font-semibold">Email address</Label>
              <Input
                type="email"
                placeholder="colleague@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="h-10"
              />
            </div>
            <div className="w-36 space-y-1.5">
              <Label className="text-xs font-semibold">Role</Label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as Role)}
                className="w-full h-10 px-2.5 text-xs rounded-lg border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
              >
                <option value="admin">Admin</option>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>
            <Button className="h-10 gap-2" onClick={handleInvite} disabled={inviteLoading || !inviteEmail}>
              {inviteLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              Send Invite
            </Button>
          </div>
        </div>
      )}

      {/* Pending Invites */}
      {invites.length > 0 && (
        <div className="rounded-2xl border-2 border-amber-500/20 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-bold">Pending Invites</h3>
            <Badge className="text-[9px] px-1.5 py-0 bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20">
              {invites.length}
            </Badge>
          </div>
          <div className="space-y-2">
            {invites.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 p-3 rounded-xl bg-muted/40 border border-border/50">
                <div className="h-8 w-8 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
                  <Mail className="h-3.5 w-3.5 text-amber-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold truncate">{inv.email}</div>
                  <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Clock className="h-2.5 w-2.5" />
                    Expires {new Date(inv.expires_at).toLocaleDateString()}
                  </div>
                </div>
                <Badge variant="secondary" className={`text-[9px] ${ROLE_LABELS[inv.role]?.color}`}>
                  {ROLE_LABELS[inv.role]?.label}
                </Badge>
                <button
                  onClick={() => copyToClipboard(`${window.location.origin}/invite/${inv.token}`)}
                  className="h-7 w-7 rounded-lg hover:bg-muted flex items-center justify-center transition-colors"
                  title="Copy invite link"
                >
                  <Copy className="h-3 w-3 text-muted-foreground" />
                </button>
                <button
                  onClick={() => handleCancelInvite(inv.id)}
                  className="h-7 w-7 rounded-lg hover:bg-destructive/10 flex items-center justify-center transition-colors"
                  title="Cancel invite"
                >
                  <X className="h-3 w-3 text-destructive" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Members Table */}
      <div className="rounded-2xl border-2 border-border/60 overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border/60 bg-muted/20">
          <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <Users className="h-4.5 w-4.5 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-bold">Members</h2>
            <p className="text-[11px] text-muted-foreground">{members.length} total members</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Member</th>
                <th className="text-left px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Role</th>
                <th className="text-left px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Joined</th>
                {permissions.canAdmin && (
                  <th className="text-center px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const rl = ROLE_LABELS[member.role] || ROLE_LABELS.viewer;
                const initials = (member.profiles?.full_name || member.email || "??")
                  .split(/[\s@]/)
                  .filter(Boolean)
                  .map((n) => n[0])
                  .join("")
                  .toUpperCase()
                  .slice(0, 2);

                return (
                  <tr key={member.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <span className="text-[10px] font-bold text-primary">{initials}</span>
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold truncate">{member.profiles?.full_name || member.email?.split("@")[0] || "Member"}</div>
                          <div className="text-[10px] text-muted-foreground truncate">{member.email || member.user_id?.slice(0, 8)}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      {permissions.canAdmin && member.role !== "owner" && member.user_id !== user?.id ? (
                        <select
                          value={member.role}
                          onChange={(e) => handleRoleChange(member.id, e.target.value as Role)}
                          className="h-7 px-2.5 text-[11px] font-semibold rounded-lg border bg-background text-foreground cursor-pointer transition-colors hover:border-primary/50 focus:ring-1 focus:ring-primary/30 focus:outline-none"
                        >
                          <option value="admin">Admin</option>
                          <option value="editor">Editor</option>
                          <option value="viewer">Viewer</option>
                        </select>
                      ) : (
                        <Badge variant="secondary" className={`text-[9px] gap-1 ${rl.color}`}>
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
                        {member.role !== "owner" && member.user_id !== user?.id && (
                          <button
                            onClick={() => setConfirmRemoveId(member.id)}
                            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[11px] font-medium text-destructive bg-destructive/5 hover:bg-destructive/15 border border-destructive/20 hover:border-destructive/40 transition-colors"
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
      </div>

      {/* Permissions Reference */}
      <div className="rounded-2xl border-2 border-border/60 overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border/60 bg-muted/20">
          <div className="h-9 w-9 rounded-xl bg-amber-500/10 flex items-center justify-center">
            <ShieldCheck className="h-4.5 w-4.5 text-amber-500" />
          </div>
          <div>
            <h3 className="text-sm font-bold">Role Permissions</h3>
            <p className="text-[11px] text-muted-foreground">What each role can do in this workspace</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b bg-muted/10">
                <th className="text-left px-5 py-3 font-semibold text-muted-foreground">Permission</th>
                {[
                  { label: "Owner", icon: Crown, color: "text-amber-500" },
                  { label: "Admin", icon: ShieldCheck, color: "text-purple-500" },
                  { label: "Editor", icon: PenLine, color: "text-blue-500" },
                  { label: "Viewer", icon: Eye, color: "text-gray-400" },
                ].map((r) => (
                  <th key={r.label} className="text-center px-4 py-3 font-semibold">
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
                ["New import / enrichment", true, true, true, false],
                ["Delete import sessions", true, true, false, false],
                ["View data", true, true, true, true],
              ].map(([label, ...vals]) => (
                <tr key={label as string} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-5 py-2.5 text-muted-foreground">{label as string}</td>
                  {(vals as boolean[]).map((v, i) => (
                    <td key={i} className="text-center px-4 py-2.5">
                      {v ? (
                        <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-green-500/10">
                          <CheckCircle2 className="h-3 w-3 text-green-500" />
                        </span>
                      ) : (
                        <span className="text-muted-foreground/30 font-bold">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Remove Member Confirmation Dialog */}
      {confirmRemoveId && (() => {
        const target = members.find((m) => m.id === confirmRemoveId);
        const displayName = target?.profiles?.full_name || target?.email?.split("@")[0] || "this member";
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="fixed inset-0 bg-black/50" onClick={() => setConfirmRemoveId(null)} />
            <div className="relative z-50 w-full max-w-sm mx-4 rounded-2xl border-2 border-border bg-background shadow-xl p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                  <Trash2 className="h-5 w-5 text-destructive" />
                </div>
                <div>
                  <h3 className="text-sm font-bold">Remove Member</h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">This action cannot be undone</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Are you sure you want to remove{" "}
                <strong className="text-foreground">{displayName}</strong>{" "}
                from this workspace?
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setConfirmRemoveId(null)}
                  className="flex-1 h-9 rounded-lg border text-sm font-medium hover:bg-muted transition-colors"
                >
                  No, Cancel
                </button>
                <button
                  onClick={() => handleRemove(confirmRemoveId)}
                  className="flex-1 h-9 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 transition-colors"
                >
                  Yes, Remove
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
