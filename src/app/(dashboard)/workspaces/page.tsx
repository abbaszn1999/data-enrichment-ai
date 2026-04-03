"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  Building2,
  Package,
  Users,
  Settings,
  Loader2,
  MoreHorizontal,
  Trash2,
  Mail,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getWorkspaces, deleteWorkspace, type WorkspaceWithRole } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";

export default function WorkspacesPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState<WorkspaceWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [pendingInvites, setPendingInvites] = useState<any[]>([]);
  const [acceptingInvite, setAcceptingInvite] = useState<string | null>(null);

  useEffect(() => {
    getWorkspaces()
      .then(setWorkspaces)
      .catch(console.error)
      .finally(() => setLoading(false));

    // Check for pending invites for this user
    fetch("/api/team/pending-invites")
      .then((r) => r.json())
      .then((data) => setPendingInvites(data.invites || []))
      .catch(() => {});
  }, []);

  const handleAcceptInvite = async (inviteId: string, workspaceSlug?: string) => {
    setAcceptingInvite(inviteId);
    try {
      const res = await fetch("/api/team/invite-accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setPendingInvites((prev) => prev.filter((i) => i.id !== inviteId));
      // Refresh workspaces to show the new one
      const updated = await getWorkspaces();
      setWorkspaces(updated);
      if (workspaceSlug) router.push(`/w/${workspaceSlug}`);
    } catch (err: any) {
      alert(err?.message || "Failed to accept invite");
    } finally {
      setAcceptingInvite(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this workspace? This action cannot be undone.")) return;
    try {
      await deleteWorkspace(id);
      setWorkspaces((prev) => prev.filter((w) => w.id !== id));
    } catch (err: any) {
      alert(err?.message || "Failed to delete workspace");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Workspaces</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Select a workspace or create a new one
            </p>
          </div>
          {workspaces.some((ws) => ws.owner_id === user?.id) || workspaces.length === 0 ? (
            <Link href="/workspaces/new">
              <Button className="gap-2">
                <Plus className="h-4 w-4" /> New Workspace
              </Button>
            </Link>
          ) : null}
        </div>

        {/* Pending invites banner */}
        {pendingInvites.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
              <Mail className="h-4 w-4" /> Pending Invitations
            </h2>
            {pendingInvites.map((inv) => (
              <Card key={inv.id} className="p-4 flex items-center justify-between gap-4 border-primary/30 bg-primary/5">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Building2 className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {inv.workspace?.name || "Workspace"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Invited as <strong>{inv.role}</strong>
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  className="gap-1.5 shrink-0"
                  disabled={acceptingInvite === inv.id}
                  onClick={() => handleAcceptInvite(inv.id, inv.workspace?.slug)}
                >
                  {acceptingInvite === inv.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  Accept
                </Button>
              </Card>
            ))}
          </div>
        )}

        {workspaces.length === 0 && pendingInvites.length === 0 ? (
          <Card className="p-12 flex flex-col items-center gap-4 text-center">
            <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Building2 className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">No workspaces yet</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Create your first workspace to get started
              </p>
            </div>
            <Link href="/workspaces/new">
              <Button className="gap-2">
                <Plus className="h-4 w-4" /> Create Workspace
              </Button>
            </Link>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {workspaces.map((ws) => (
              <Card
                key={ws.id}
                className="group relative hover:border-primary/40 hover:shadow-md transition-all cursor-pointer"
              >
                <Link href={`/w/${ws.slug}`} className="block p-5">
                  <div className="flex items-start gap-4">
                    <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <Building2 className="h-6 w-6 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold truncate">{ws.name}</h3>
                        <Badge variant="secondary" className="text-[9px] shrink-0">
                          {ws.cms_type}
                        </Badge>
                      </div>
                      {ws.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                          {ws.description}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-3 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Package className="h-3 w-3" /> Products
                        </span>
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" /> Team
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>

                {ws.owner_id === user?.id && (
                  <div className="absolute top-3 right-3">
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setMenuOpen(menuOpen === ws.id ? null : ws.id);
                      }}
                      className="h-7 w-7 rounded-md hover:bg-muted flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                    </button>
                    {menuOpen === ws.id && (
                      <>
                        <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(null)} />
                        <div className="absolute right-0 top-8 w-40 bg-popover border rounded-lg shadow-lg py-1 z-40">
                          <button
                            onClick={() => {
                              setMenuOpen(null);
                              router.push(`/w/${ws.slug}/settings`);
                            }}
                            className="w-full px-3 py-2 text-xs text-left hover:bg-muted flex items-center gap-2"
                          >
                            <Settings className="h-3.5 w-3.5" /> Settings
                          </button>
                          <div className="border-t my-1" />
                          <button
                            onClick={() => {
                              setMenuOpen(null);
                              handleDelete(ws.id);
                            }}
                            className="w-full px-3 py-2 text-xs text-left hover:bg-destructive/10 text-destructive flex items-center gap-2"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
