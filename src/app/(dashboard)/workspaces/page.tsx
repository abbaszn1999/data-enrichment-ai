"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
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
  Lock,
  Crown,
  ArrowRight,
  Sparkles,
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
  const [checkingLimit, setCheckingLimit] = useState(false);
  const [limitDialogOpen, setLimitDialogOpen] = useState(false);
  const [workspaceLimit, setWorkspaceLimit] = useState<{
    currentCount: number;
    maxWorkspaces: number;
    planName: string | null;
    hasActiveSubscription: boolean;
  } | null>(null);

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

  const handleNewWorkspaceClick = async () => {
    setCheckingLimit(true);
    try {
      const res = await fetch("/api/workspaces/limit", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to check workspace limit");

      if (json.canCreate) {
        router.push("/workspaces/new");
        return;
      }

      setWorkspaceLimit({
        currentCount: json.currentCount,
        maxWorkspaces: json.maxWorkspaces,
        planName: json.planName,
        hasActiveSubscription: json.hasActiveSubscription,
      });
      setLimitDialogOpen(true);
    } catch (err: any) {
      alert(err?.message || "Failed to check workspace limit");
    } finally {
      setCheckingLimit(false);
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
      <div className="autommerce-dashboard flex min-h-screen items-center justify-center bg-background [font-family:var(--brand-font)]">
        <Loader2 className="h-6 w-6 animate-spin text-[#6B358D] dark:text-[#F76D01]" />
      </div>
    );
  }

  const canCreate = workspaces.some((ws) => ws.owner_id === user?.id) || workspaces.length === 0;

  return (
    <div className="autommerce-dashboard relative min-h-screen overflow-hidden bg-background [font-family:var(--brand-font)]">
      <div className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-[#400095]/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-20 h-96 w-96 rounded-full bg-[#F76D01]/10 blur-3xl" />

      <div className="relative mx-auto max-w-5xl space-y-8 px-6 py-12 sm:py-16">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between"
        >
          <div>
            <div className="mb-4 flex items-center gap-3">
              <div className="relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl border border-border/40 bg-white shadow-[0_8px_25px_rgba(64,0,149,.15)]">
                <Image
                  src="/autommerce.png"
                  alt="Autommerce Logo"
                  fill
                  sizes="44px"
                  className="object-contain p-1.5"
                  priority
                />
              </div>
              <span className="text-[9px] font-black uppercase tracking-[0.24em] text-[#400095] dark:text-[#F76D01]">
                Autommerce Data Entry
              </span>
            </div>
            <h1 className="text-3xl font-black tracking-[-0.035em] sm:text-4xl">
              Your
              <span className="ml-2 bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095] bg-clip-text pb-1 text-transparent">
                Workspaces
              </span>
            </h1>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              Select a workspace to continue, or create a new one to connect a store and start enriching data.
            </p>
          </div>
          {canCreate && (
            <Button
              className="h-10 gap-2 self-start rounded-xl bg-[#400095] px-4 text-sm text-white shadow-[0_8px_24px_rgba(64,0,149,.22)] hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90 sm:self-auto"
              onClick={handleNewWorkspaceClick}
              disabled={checkingLimit}
            >
              {checkingLimit ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              New Workspace
            </Button>
          )}
        </motion.div>

        {/* Pending invites banner */}
        {pendingInvites.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="space-y-3"
          >
            <h2 className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
              <Mail className="h-4 w-4 text-[#6B358D] dark:text-[#F76D01]" /> Pending Invitations
            </h2>
            {pendingInvites.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between gap-4 rounded-2xl border border-[#6B358D]/25 bg-[#400095]/5 p-4 dark:border-[#F76D01]/25 dark:bg-[#F76D01]/5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#400095]/10 dark:bg-[#F76D01]/10">
                    <Building2 className="h-5 w-5 text-[#6B358D] dark:text-[#F76D01]" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {inv.workspace?.name || "Workspace"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Invited as <strong>{inv.role}</strong>
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  className="shrink-0 gap-1.5 rounded-lg bg-[#400095] text-white hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
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
              </div>
            ))}
          </motion.div>
        )}

        {workspaces.length === 0 && pendingInvites.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border/60 bg-card p-12 text-center shadow-sm"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#400095]/10 to-[#F76D01]/10">
              <Building2 className="h-8 w-8 text-[#6B358D] dark:text-[#F76D01]" />
            </div>
            <div>
              <h2 className="text-lg font-black">No workspaces yet</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Create your first workspace to get started
              </p>
            </div>
            <Button
              className="gap-2 rounded-xl bg-[#400095] text-white hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
              onClick={handleNewWorkspaceClick}
              disabled={checkingLimit}
            >
              {checkingLimit ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create Workspace
            </Button>
          </motion.div>
        )}

        {workspaces.length > 0 && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {workspaces.map((ws, i) => (
              <motion.div
                key={ws.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: i * 0.05 }}
                className="group relative overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#6B358D]/40 hover:shadow-lg dark:hover:border-[#F76D01]/40"
              >
                <div className="h-1 bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095] opacity-0 transition-opacity group-hover:opacity-100" />
                <Link href={`/w/${ws.slug}`} className="block p-5">
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#400095]/10 to-[#F76D01]/10">
                      <Building2 className="h-6 w-6 text-[#6B358D] dark:text-[#F76D01]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-base font-bold">{ws.name}</h3>
                        <Badge variant="secondary" className="shrink-0 text-[9px]">
                          {ws.cms_type}
                        </Badge>
                      </div>
                      {ws.description && (
                        <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                          {ws.description}
                        </p>
                      )}
                      <div className="mt-3 flex items-center gap-3 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Package className="h-3 w-3" /> Products
                        </span>
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" /> Team
                        </span>
                        <ArrowRight className="ml-auto h-3.5 w-3.5 text-muted-foreground/30 transition-all group-hover:translate-x-0.5 group-hover:text-[#6B358D] dark:group-hover:text-[#F76D01]" />
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
                      className="flex h-7 w-7 items-center justify-center rounded-lg opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
                    >
                      <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                    </button>
                    <AnimatePresence>
                      {menuOpen === ws.id && (
                        <>
                          <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(null)} />
                          <motion.div
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            transition={{ duration: 0.15 }}
                            className="absolute right-0 top-8 z-40 w-40 rounded-lg border bg-popover py-1 shadow-lg"
                          >
                            <button
                              onClick={() => {
                                setMenuOpen(null);
                                router.push(`/w/${ws.slug}/settings`);
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted"
                            >
                              <Settings className="h-3.5 w-3.5" /> Settings
                            </button>
                            <div className="my-1 border-t" />
                            <button
                              onClick={() => {
                                setMenuOpen(null);
                                handleDelete(ws.id);
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Delete
                            </button>
                          </motion.div>
                        </>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </motion.div>
            ))}

            {canCreate && (
              <motion.button
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: workspaces.length * 0.05 }}
                onClick={handleNewWorkspaceClick}
                disabled={checkingLimit}
                className="group flex min-h-[132px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border/60 bg-transparent p-5 text-center transition-colors hover:border-[#6B358D]/40 hover:bg-[#400095]/5 dark:hover:border-[#F76D01]/40 dark:hover:bg-[#F76D01]/5"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted transition-colors group-hover:bg-[#400095]/10 dark:group-hover:bg-[#F76D01]/10">
                  {checkingLimit ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Plus className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-[#6B358D] dark:group-hover:text-[#F76D01]" />
                  )}
                </div>
                <span className="text-xs font-semibold text-muted-foreground transition-colors group-hover:text-foreground">
                  New Workspace
                </span>
              </motion.button>
            )}
          </div>
        )}

        <p className="flex items-center justify-center gap-1.5 pt-2 text-[11px] text-muted-foreground/70">
          <Sparkles className="h-3 w-3 text-[#6B358D]/60 dark:text-[#F76D01]/60" />
          Powered by Autommerce AI
        </p>

        <Dialog open={limitDialogOpen} onOpenChange={setLimitDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Lock className="h-5 w-5 text-amber-500" /> Workspace limit reached
              </DialogTitle>
              <DialogDescription>
                You have reached the maximum number of workspaces allowed for your current plan.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 rounded-xl border bg-muted/40 p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10">
                  <Crown className="h-5 w-5 text-amber-500" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold">
                    {workspaceLimit?.planName || "Current plan"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {workspaceLimit?.currentCount ?? 0} of {workspaceLimit?.maxWorkspaces ?? 1} workspace slots used.
                  </p>
                </div>
              </div>

              <div className="text-sm leading-6 text-muted-foreground">
                {workspaceLimit?.hasActiveSubscription
                  ? "Upgrade your plan to create more workspaces."
                  : "You can create only one workspace without an active subscription. Upgrade your plan to create more."}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setLimitDialogOpen(false)}>
                Close
              </Button>
              <Button
                className="rounded-xl bg-[#400095] text-white hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
                onClick={() => router.push(workspaces[0] ? `/w/${workspaces[0].slug}/subscription` : "/workspaces")}
              >
                Upgrade Plan
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
