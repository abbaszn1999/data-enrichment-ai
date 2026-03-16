"use client";

import { useState } from "react";
import {
  Users,
  UserPlus,
  MoreVertical,
  Shield,
  ShieldCheck,
  Pencil,
  Eye,
  Trash2,
  Copy,
  Check,
  X,
  Mail,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { mockTeamMembers, mockPendingInvites } from "../mock-data";

const roleColors: Record<string, string> = {
  owner: "bg-purple-50 dark:bg-purple-950/30 text-purple-700 border-purple-200",
  admin: "bg-blue-50 dark:bg-blue-950/30 text-blue-700 border-blue-200",
  editor: "bg-green-50 dark:bg-green-950/30 text-green-700 border-green-200",
  viewer: "bg-gray-50 dark:bg-gray-950/30 text-gray-500 border-gray-200",
};

const roleIcons: Record<string, any> = {
  owner: ShieldCheck,
  admin: Shield,
  editor: Pencil,
  viewer: Eye,
};

export default function DemoTeamPage() {
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("editor");
  const [copied, setCopied] = useState(false);
  const [inviteSent, setInviteSent] = useState(false);

  const handleInvite = () => {
    setInviteSent(true);
    setTimeout(() => { setInviteSent(false); setShowInvite(false); setInviteEmail(""); }, 2000);
  };

  const handleCopyLink = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Users className="h-5 w-5" /> Team Management
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">{mockTeamMembers.length} members in TechStore Electronics</p>
        </div>
        <Button size="sm" className="gap-1.5 text-xs" onClick={() => setShowInvite(true)}>
          <UserPlus className="h-3.5 w-3.5" /> Invite Member
        </Button>
      </div>

      {/* Members Table */}
      <Card className="overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left px-4 py-2.5 font-semibold">Member</th>
              <th className="text-left px-4 py-2.5 font-semibold">Role</th>
              <th className="text-left px-4 py-2.5 font-semibold">Joined</th>
              <th className="text-center px-4 py-2.5 font-semibold w-10"></th>
            </tr>
          </thead>
          <tbody>
            {mockTeamMembers.map((member) => {
              const RoleIcon = roleIcons[member.role];
              return (
                <tr key={member.id} className="border-b hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <span className="text-[10px] font-bold text-primary">
                          {member.fullName.split(" ").map((n) => n[0]).join("")}
                        </span>
                      </div>
                      <div>
                        <div className="font-medium">{member.fullName}</div>
                        <div className="text-[10px] text-muted-foreground">{member.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className={`text-[9px] gap-1 ${roleColors[member.role]}`}>
                      <RoleIcon className="h-2.5 w-2.5" />
                      {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(member.joinedAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {member.role !== "owner" && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="p-1 rounded hover:bg-muted">
                            <MoreVertical className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem className="text-xs gap-2">
                            <Shield className="h-3 w-3" /> Change Role
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-xs gap-2 text-destructive">
                            <Trash2 className="h-3 w-3" /> Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* Pending Invites */}
      {mockPendingInvites.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Pending Invites</h2>
          {mockPendingInvites.map((invite) => (
            <Card key={invite.id} className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div>
                  <div className="text-xs font-medium">{invite.email}</div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <Badge variant="outline" className={`text-[8px] ${roleColors[invite.role]}`}>
                      {invite.role}
                    </Badge>
                    <span className="flex items-center gap-1">
                      <Clock className="h-2.5 w-2.5" />
                      Expires {new Date(invite.expiresAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="text-[10px] h-7 gap-1" onClick={handleCopyLink}>
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copied ? "Copied!" : "Copy Link"}
                </Button>
                <Button size="sm" variant="ghost" className="text-[10px] h-7 text-destructive">
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Roles Explanation */}
      <Card className="p-4">
        <h3 className="text-xs font-semibold mb-3">Role Permissions</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="border-b">
                <th className="text-left py-1.5 font-medium">Permission</th>
                <th className="text-center py-1.5 font-medium text-purple-600">Owner</th>
                <th className="text-center py-1.5 font-medium text-blue-600">Admin</th>
                <th className="text-center py-1.5 font-medium text-green-600">Editor</th>
                <th className="text-center py-1.5 font-medium text-gray-500">Viewer</th>
              </tr>
            </thead>
            <tbody>
              {[
                { perm: "Manage workspace settings", o: true, a: true, e: false, v: false },
                { perm: "Edit master products", o: true, a: true, e: false, v: false },
                { perm: "Upload supplier sheets", o: true, a: true, e: true, v: false },
                { perm: "Run AI enrichment", o: true, a: true, e: true, v: false },
                { perm: "Export data", o: true, a: true, e: true, v: true },
                { perm: "View data", o: true, a: true, e: true, v: true },
                { perm: "Invite members", o: true, a: true, e: false, v: false },
                { perm: "Delete workspace", o: true, a: false, e: false, v: false },
              ].map((row) => (
                <tr key={row.perm} className="border-b">
                  <td className="py-1.5">{row.perm}</td>
                  <td className="py-1.5 text-center">{row.o ? <Check className="h-3 w-3 text-green-500 mx-auto" /> : <X className="h-3 w-3 text-muted-foreground/30 mx-auto" />}</td>
                  <td className="py-1.5 text-center">{row.a ? <Check className="h-3 w-3 text-green-500 mx-auto" /> : <X className="h-3 w-3 text-muted-foreground/30 mx-auto" />}</td>
                  <td className="py-1.5 text-center">{row.e ? <Check className="h-3 w-3 text-green-500 mx-auto" /> : <X className="h-3 w-3 text-muted-foreground/30 mx-auto" />}</td>
                  <td className="py-1.5 text-center">{row.v ? <Check className="h-3 w-3 text-green-500 mx-auto" /> : <X className="h-3 w-3 text-muted-foreground/30 mx-auto" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Invite Dialog */}
      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <UserPlus className="h-4 w-4" /> Invite Team Member
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label className="text-xs">Email Address</Label>
              <Input placeholder="colleague@company.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Role</Label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="w-full h-9 px-3 text-xs rounded-lg border bg-background"
              >
                <option value="admin">Admin — Full access except delete workspace</option>
                <option value="editor">Editor — Import, enrich, export</option>
                <option value="viewer">Viewer — Read-only + export</option>
              </select>
            </div>
            <Button onClick={handleInvite} disabled={!inviteEmail || inviteSent} className="w-full gap-1.5 text-xs">
              {inviteSent ? <Check className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}
              {inviteSent ? "Invite Sent!" : "Send Invite"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
