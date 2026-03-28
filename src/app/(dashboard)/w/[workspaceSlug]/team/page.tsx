"use client";

import { useEffect, useState } from "react";
import {
  Users,
  Plus,
  Mail,
  Shield,
  Loader2,
  MoreHorizontal,
  Trash2,
  ChevronDown,
  Clock,
  AlertCircle,
  CheckCircle2,
  X,
  Copy,
  Link,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkspaceContext } from "../layout";
import { useRole } from "@/hooks/use-role";
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
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

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
    if (!confirm("Remove this member from the workspace?")) return;
    try {
      await removeMember(memberId);
      setMembers((prev) => prev.filter((m) => m.id !== memberId));
    } catch (err: any) {
      alert(err?.message || "Failed to remove member");
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
    setMenuOpen(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Users className="h-5 w-5" /> Team
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {members.length} member{members.length !== 1 && "s"}
          </p>
        </div>
        {permissions.canAdmin && (
          <Button size="sm" className="gap-1.5 text-xs" onClick={() => setShowInvite(!showInvite)}>
            <Plus className="h-3.5 w-3.5" /> Invite Member
          </Button>
        )}
      </div>

      {/* Invite Form */}
      {showInvite && permissions.canAdmin && (
        <Card className="p-4 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Mail className="h-4 w-4" /> Send Invite
          </h3>
          {inviteError && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-destructive/10 text-destructive text-xs">
              <AlertCircle className="h-3.5 w-3.5" /> {inviteError}
            </div>
          )}
          {inviteSuccess && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 p-2 rounded-lg bg-green-50 dark:bg-green-950/20 text-green-700 text-xs">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {inviteEmailSent
                  ? "Invite sent! An email has been delivered to the user."
                  : "Invite created! Share the link below with the user."}
              </div>
              {inviteLink && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-blue-50 dark:bg-blue-950/20 text-blue-700 text-xs">
                  <Link className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="truncate flex-1 font-mono text-[10px]">{inviteLink}</span>
                  <button
                    onClick={() => copyToClipboard(inviteLink)}
                    className="flex-shrink-0 hover:bg-blue-100 dark:hover:bg-blue-900/30 p-1 rounded"
                    title="Copy invite link"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1">
              <Label className="text-[10px]">Email</Label>
              <Input
                type="email"
                placeholder="colleague@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="w-32 space-y-1">
              <Label className="text-[10px]">Role</Label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as Role)}
                className="w-full h-9 px-2 text-xs rounded-md border bg-background"
              >
                <option value="admin">Admin</option>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>
            <Button size="sm" className="h-9 gap-1.5 text-xs" onClick={handleInvite} disabled={inviteLoading || !inviteEmail}>
              {inviteLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
              Send
            </Button>
          </div>
        </Card>
      )}

      {/* Pending Invites */}
      {invites.length > 0 && (
        <Card className="p-4">
          <h3 className="text-xs font-semibold text-muted-foreground mb-3">
            Pending Invites ({invites.length})
          </h3>
          <div className="space-y-2">
            {invites.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/30">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{inv.email}</div>
                  <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Clock className="h-2.5 w-2.5" />
                    Expires {new Date(inv.expires_at).toLocaleDateString()}
                  </div>
                </div>
                <Badge variant="secondary" className={`text-[9px] ${ROLE_LABELS[inv.role]?.color}`}>
                  {ROLE_LABELS[inv.role]?.label}
                </Badge>
                <button
                  onClick={() => copyToClipboard(`${window.location.origin}/invite/${inv.token}`)}
                  className="h-7 w-7 rounded-md hover:bg-muted flex items-center justify-center"
                  title="Copy invite link"
                >
                  <Copy className="h-3 w-3 text-muted-foreground" />
                </button>
                <button
                  onClick={() => handleCancelInvite(inv.id)}
                  className="h-7 w-7 rounded-md hover:bg-destructive/10 flex items-center justify-center"
                  title="Cancel invite"
                >
                  <X className="h-3 w-3 text-destructive" />
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Members Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-muted-foreground uppercase">Member</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-muted-foreground uppercase">Role</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-muted-foreground uppercase">Joined</th>
                {permissions.canAdmin && (
                  <th className="text-right px-4 py-3 text-[10px] font-semibold text-muted-foreground uppercase">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const rl = ROLE_LABELS[member.role] || ROLE_LABELS.viewer;
                const initials = (member.profiles?.full_name || "??")
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .toUpperCase()
                  .slice(0, 2);

                return (
                  <tr key={member.id} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                          <span className="text-[10px] font-bold text-primary">{initials}</span>
                        </div>
                        <div>
                          <div className="text-xs font-medium">{member.profiles?.full_name || member.user_id?.slice(0, 8) || "Member"}</div>
                          <div className="text-[10px] text-muted-foreground">{member.role === "owner" ? "Owner" : `Member since ${new Date(member.joined_at).toLocaleDateString()}`}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary" className={`text-[9px] ${rl.color}`}>
                        <Shield className="h-2.5 w-2.5 mr-0.5" />
                        {rl.label}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(member.joined_at).toLocaleDateString()}
                    </td>
                    {permissions.canAdmin && (
                      <td className="px-4 py-3 text-right">
                        {member.role !== "owner" && (
                          <div className="relative inline-block">
                            <button
                              onClick={() => setMenuOpen(menuOpen === member.id ? null : member.id)}
                              className="h-7 w-7 rounded-md hover:bg-muted flex items-center justify-center"
                            >
                              <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                            </button>
                            {menuOpen === member.id && (
                              <>
                                <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(null)} />
                                <div className="absolute right-0 top-8 w-40 bg-popover border rounded-lg shadow-lg py-1 z-40">
                                  {(["admin", "editor", "viewer"] as Role[]).map((r) => (
                                    <button
                                      key={r}
                                      onClick={() => handleRoleChange(member.id, r)}
                                      className={`w-full px-3 py-1.5 text-[11px] text-left hover:bg-muted flex items-center gap-2 ${
                                        member.role === r ? "font-medium text-primary" : ""
                                      }`}
                                    >
                                      <Shield className="h-3 w-3" />
                                      Set as {ROLE_LABELS[r]?.label}
                                    </button>
                                  ))}
                                  <div className="border-t my-1" />
                                  <button
                                    onClick={() => {
                                      setMenuOpen(null);
                                      handleRemove(member.id);
                                    }}
                                    className="w-full px-3 py-1.5 text-[11px] text-left hover:bg-destructive/10 text-destructive flex items-center gap-2"
                                  >
                                    <Trash2 className="h-3 w-3" /> Remove
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Permissions Reference */}
      <Card className="p-4">
        <h3 className="text-xs font-semibold mb-3">Role Permissions</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 pr-4 font-medium">Permission</th>
                <th className="text-center py-2 px-2 font-medium">Owner</th>
                <th className="text-center py-2 px-2 font-medium">Admin</th>
                <th className="text-center py-2 px-2 font-medium">Editor</th>
                <th className="text-center py-2 px-2 font-medium">Viewer</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Workspace settings", true, true, false, false],
                ["Delete workspace", true, false, false, false],
                ["Manage team", true, true, false, false],
                ["Edit products", true, true, false, false],
                ["Upload files", true, true, true, false],
                ["Run enrichment", true, true, true, false],
                ["View data", true, true, true, true],
              ].map(([label, ...vals]) => (
                <tr key={label as string} className="border-b last:border-0">
                  <td className="py-2 pr-4 text-muted-foreground">{label as string}</td>
                  {(vals as boolean[]).map((v, i) => (
                    <td key={i} className="text-center py-2 px-2">
                      {v ? "✓" : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
