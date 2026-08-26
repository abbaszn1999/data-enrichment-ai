"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { motion } from "motion/react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Folder,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Tag,
  Trash2,
  Undo2,
  Wallet as WalletIcon,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useWorkspace } from "@/hooks/use-workspace";
import { useWallet } from "@/hooks/use-wallet";
import { formatMoney } from "@/lib/wallet/format";
import {
  fetchLiveProjects,
  projectLabel,
  type LiveProjectOption,
} from "@/lib/growth-sync";
import {
  createSyncRule,
  deleteSyncRule,
  fetchStoreTaxonomies,
  fetchSyncOverview,
  runSyncRule,
  undoAssignments,
  updateSyncRule,
  type ActivityRow,
  type RuleRow,
  type RunRow,
  type TaxonomyOption,
} from "@/lib/growth-sync/client";
import type { SyncInterval, WatchedTaxonomy } from "@/lib/growth-sync/types";

const ACTIVITY_PAGE_SIZES = [10, 20, 50] as const;

function formatWhen(value: string | null): string {
  if (!value) return "Never";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function SyncDashboard() {
  const params = useParams<{ workspaceSlug: string }>();
  const slug = params.workspaceSlug ?? "";
  const { user } = useAuth();
  const { workspace } = useWorkspace(slug, user);
  const workspaceId = workspace?.id ?? "";
  const { wallet } = useWallet(workspaceId || null);
  const walletBalance = wallet?.balance ?? 0;
  const hasWalletBalance = walletBalance > 0;

  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [projects, setProjects] = useState<LiveProjectOption[]>([]);
  const [taxonomies, setTaxonomies] = useState<TaxonomyOption[]>([]);
  const [taxonomyLabel, setTaxonomyLabel] = useState("Categories");
  const [storeConnected, setStoreConnected] = useState(true);
  const [storeNote, setStoreNote] = useState<string | null>(null);
  const [supportsUndo, setSupportsUndo] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [busyRuleId, setBusyRuleId] = useState<string | null>(null);
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const [activityPage, setActivityPage] = useState(1);
  const [activityPageSize, setActivityPageSize] =
    useState<(typeof ACTIVITY_PAGE_SIZES)[number]>(10);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    const data = await fetchSyncOverview(workspaceId);
    setRules(data.rules ?? []);
    setRuns(data.runs ?? []);
    setActivity(data.activity ?? []);
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    setLoading(true);

    void Promise.all([
      fetchSyncOverview(workspaceId),
      fetchStoreTaxonomies(workspaceId).catch(() => null),
      fetchLiveProjects(workspaceId, slug),
    ])
      .then(([overview, store, liveProjects]) => {
        if (cancelled) return;
        setRules(overview.rules ?? []);
        setRuns(overview.runs ?? []);
        setActivity(overview.activity ?? []);
        setProjects(liveProjects);
        if (store) {
          setStoreConnected(store.connected);
          setTaxonomies(store.taxonomies ?? []);
          setTaxonomyLabel(store.taxonomyLabel || "Categories");
          setStoreNote(store.message ?? null);
          setSupportsUndo(Boolean(store.supportsUndo));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "Could not load Sync");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceId, slug]);

  const latestRunByRule = useMemo(() => {
    const map = new Map<string, RunRow>();
    // Runs arrive newest first, so the first one seen per rule is the latest.
    for (const run of runs) {
      if (!map.has(run.rule_id)) map.set(run.rule_id, run);
    }
    return map;
  }, [runs]);

  const activeRuleCount = rules.filter((r) => r.enabled).length;
  const assignedToday = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return activity.filter(
      (row) => row.decision === "assigned" && Date.parse(row.created_at) > cutoff
    ).length;
  }, [activity]);

  useEffect(() => {
    setActivityPage(1);
  }, [activityPageSize]);

  const activityPageCount = Math.max(1, Math.ceil(activity.length / activityPageSize));
  const activityCurrentPage = Math.min(activityPage, activityPageCount);
  const pagedActivity = useMemo(
    () =>
      activity.slice(
        (activityCurrentPage - 1) * activityPageSize,
        activityCurrentPage * activityPageSize
      ),
    [activity, activityCurrentPage, activityPageSize]
  );

  const handleRun = async (rule: RuleRow) => {
    setBusyRuleId(rule.id);
    try {
      const { outcome } = await runSyncRule(workspaceId, rule.id);
      if (outcome.status === "skipped") {
        toast.info("Nothing new since the last check");
      } else if (outcome.status === "failed") {
        toast.error(outcome.error || "The run failed");
      } else {
        const base = outcome.assignedCount > 0
          ? `Assigned ${outcome.assignedCount} product${outcome.assignedCount === 1 ? "" : "s"}`
          : `Checked ${outcome.detectedCount} new product${outcome.detectedCount === 1 ? "" : "s"}, none matched`;
        const deferred = outcome.deferredCount ?? 0;
        if (deferred > 0) {
          // A scheduled rule keeps working the backlog down on its own; a
          // manual one stops here until the user asks for another run.
          const continuation =
            rule.run_interval === "manual"
              ? "click Run now again to continue"
              : "the rest will run automatically over the next few minutes";
          toast.success(
            `${base} — ${deferred} more new product${deferred === 1 ? "" : "s"} queued, ${continuation}`
          );
        } else {
          toast.success(base);
        }
      }
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not run the rule");
    } finally {
      setBusyRuleId(null);
    }
  };

  const handleToggle = async (rule: RuleRow) => {
    if (!rule.enabled && !hasWalletBalance) {
      toast.error("Top up the wallet before turning a rule on");
      return;
    }
    setBusyRuleId(rule.id);
    try {
      await updateSyncRule({
        workspaceId,
        ruleId: rule.id,
        enabled: !rule.enabled,
      });
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the rule");
    } finally {
      setBusyRuleId(null);
    }
  };

  const handleInterval = async (rule: RuleRow, interval: SyncInterval) => {
    setBusyRuleId(rule.id);
    try {
      await updateSyncRule({ workspaceId, ruleId: rule.id, interval });
      await refresh();
      toast.success(
        `Schedule set to ${interval === "manual" ? "manual only" : "every 24 hours"}`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the schedule");
    } finally {
      setBusyRuleId(null);
    }
  };

  const handleDelete = async (rule: RuleRow) => {
    setBusyRuleId(rule.id);
    try {
      await deleteSyncRule(workspaceId, rule.id);
      await refresh();
      toast.success("Rule deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete the rule");
    } finally {
      setBusyRuleId(null);
    }
  };

  const handleUndo = async (row: ActivityRow) => {
    setUndoingId(row.id);
    try {
      const res = await undoAssignments(workspaceId, [row.id]);
      if (res.undoneCount === 0) {
        toast.info("Nothing to undo on this row");
      } else {
        toast.success(
          res.pending
            ? "Removal queued with the store"
            : `Removed from ${row.taxonomy_name}`
        );
      }
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not undo");
    } finally {
      setUndoingId(null);
    }
  };

  if (loading) {
    return (
      <div className="autommerce-dashboard flex items-center justify-center p-16 text-xs text-muted-foreground [font-family:var(--brand-font)]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#6B358D] dark:text-[#F76D01]" />
        Loading Sync
      </div>
    );
  }

  return (
    <div className="autommerce-dashboard min-h-full bg-background [font-family:var(--brand-font)]">
      <section className="relative overflow-hidden border-b border-border/60 bg-gradient-to-br from-[#400095]/[0.08] via-background to-[#F76D01]/[0.08]">
        <div className="absolute -left-20 -top-28 h-64 w-64 rounded-full bg-[#400095]/10 blur-3xl" />
        <div className="absolute -bottom-28 -right-16 h-64 w-64 rounded-full bg-[#F76D01]/10 blur-3xl" />
        <div className="relative mx-auto max-w-[1500px] px-5 py-7 sm:px-7 lg:px-10">
      {/* Hero header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="flex flex-wrap items-end justify-between gap-4"
      >
        <div>
          <div className="mb-3 flex items-center gap-2">
            <span className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-[#400095] text-white shadow-[0_8px_25px_rgba(64,0,149,.22)] dark:bg-[#F76D01]">
              <RefreshCw className="h-4 w-4" />
              <span className="absolute -right-1 -top-1 flex h-3 w-3 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-background">
                <span className="h-1 w-1 rounded-full bg-white" />
              </span>
            </span>
            <span className="text-[9px] font-black uppercase tracking-[0.24em] text-[#400095] dark:text-[#F76D01]">
              Growth engine
            </span>
          </div>
          <h1 className="text-3xl font-black tracking-[-0.035em] sm:text-4xl">
            New products,
            <span className="block bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095] bg-clip-text pb-1 text-transparent">
              classified automatically.
            </span>
          </h1>
          <p className="mt-2 max-w-xl text-xs leading-relaxed text-muted-foreground">
            Watch store {taxonomyLabel.toLowerCase()} and classify products
            added from now on into a Market research project that is live.
          </p>
        </div>
        <Button
          className="h-9 gap-2 rounded-xl bg-[#400095] px-4 text-[10px] text-white shadow-[0_8px_24px_rgba(64,0,149,.2)] hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
          disabled={!storeConnected || taxonomies.length === 0}
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          New sync rule
        </Button>
      </motion.div>

      {/* Stat strip */}
      <div className="mt-7 grid max-w-2xl grid-cols-3 overflow-hidden rounded-2xl border border-border/60 bg-background/70 shadow-sm backdrop-blur">
        <StatTile
          icon={Zap}
          tone="primary"
          label="Active rules"
          value={activeRuleCount.toLocaleString("en-US")}
        />
        <StatTile
          icon={Check}
          tone="emerald"
          label="Assigned (24h)"
          value={assignedToday.toLocaleString("en-US")}
        />
        <StatTile
          icon={WalletIcon}
          tone={hasWalletBalance ? "primary" : "amber"}
          label="Wallet balance"
          value={formatMoney(walletBalance)}
        />
      </div>
      </div>
      </section>

      <main className="mx-auto max-w-[1500px] space-y-5 p-5 sm:p-7 lg:p-10">

      {!storeConnected ? (
        <Notice tone="warning">
          No store is connected to this workspace. Connect one before creating a
          sync rule.
        </Notice>
      ) : storeNote ? (
        <Notice tone="warning">{storeNote}</Notice>
      ) : null}

      {!hasWalletBalance ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 to-amber-500/5 px-4 py-3">
          <p className="flex items-start gap-2 text-[12px] text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            The wallet balance is empty. Rules stay paused until it is topped up —
            Sync deducts from the same wallet, at cost.
          </p>
          <Button
            size="sm"
            className="h-7.5 rounded-lg bg-amber-600 text-[11px] text-white hover:bg-amber-600/90"
            asChild
          >
            <Link href={`/w/${slug}/wallet`}>Top up wallet</Link>
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card px-4 py-3 shadow-sm">
          <p className="text-[12px] text-muted-foreground">
            <span className="font-semibold text-foreground">
              {formatMoney(walletBalance)}
            </span>{" "}
            available. Sync classifications are charged to the wallet at cost.
          </p>
          <Link
            href={`/w/${slug}/wallet?tab=sync`}
            className="flex items-center gap-0.5 text-[11.5px] font-medium text-[#400095] hover:underline dark:text-[#F76D01]"
          >
            View usage
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-black tracking-tight">Rules</h2>
          {rules.length > 0 && (
            <Badge variant="secondary" className="h-5 rounded-full text-[10px]">
              {rules.length}
            </Badge>
          )}
        </div>
        {rules.length === 0 ? (
          <EmptyState
            icon={RefreshCw}
            title="No rules yet"
            description={`Create one to watch a ${taxonomyLabel.toLowerCase()} and feed a project.`}
          />
        ) : (
          <div className="space-y-2.5">
            {rules.map((rule) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                projects={projects}
                latestRun={latestRunByRule.get(rule.id)}
                busy={busyRuleId === rule.id}
                onRun={() => void handleRun(rule)}
                onToggle={() => void handleToggle(rule)}
                onInterval={(interval) => void handleInterval(rule, interval)}
                onDelete={() => void handleDelete(rule)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-1 overflow-hidden rounded-[24px] border border-border/60 bg-card p-5 shadow-[0_15px_50px_rgba(15,23,42,.05)]">
        <div>
          <h2 className="text-sm font-black tracking-tight">
            Recent Sync activity
          </h2>
          <p className="text-[11.5px] text-muted-foreground">
            Every decision Sync reached, including the products it turned down.
          </p>
        </div>
        {activity.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="No sync activity yet"
            description="Run a rule to see classification decisions appear here."
            compact
          />
        ) : (
          <>
            <ul className="mt-1 divide-y divide-border/50">
              {pagedActivity.map((row) => (
                <ActivityItem
                  key={row.id}
                  row={row}
                  canUndo={supportsUndo}
                  undoing={undoingId === row.id}
                  onUndo={() => void handleUndo(row)}
                />
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-3">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                Rows per page
                <div className="flex items-center gap-1">
                  {ACTIVITY_PAGE_SIZES.map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => setActivityPageSize(size)}
                      aria-pressed={activityPageSize === size}
                      className={cn(
                        "rounded-md border px-2 py-0.5 font-medium transition-colors",
                        activityPageSize === size
                          ? "border-transparent bg-muted text-foreground"
                          : "border-border/70 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>
                  Page {activityCurrentPage} of {activityPageCount} ·{" "}
                  {activity.length.toLocaleString("en-US")} total
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 p-0"
                    disabled={activityCurrentPage <= 1}
                    onClick={() => setActivityPage((p) => Math.max(1, p - 1))}
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 p-0"
                    disabled={activityCurrentPage >= activityPageCount}
                    onClick={() =>
                      setActivityPage((p) => Math.min(activityPageCount, p + 1))
                    }
                    aria-label="Next page"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      <CreateRuleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projects={projects}
        taxonomies={taxonomies}
        taxonomyLabel={taxonomyLabel}
        onCreate={async (input) => {
          await createSyncRule({ workspaceId, ...input });
          await refresh();
        }}
      />
      </main>
    </div>
  );
}

function StatTile({
  icon: Icon,
  tone,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: "primary" | "emerald" | "amber";
  label: string;
  value: string;
}) {
  const toneClasses = {
    primary: "text-[#6B358D] dark:text-[#C8A8D2]",
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
  }[tone];
  return (
    <div className="flex items-center gap-3 border-r border-border/60 px-4 py-3.5 last:border-r-0">
      <Icon className={cn("h-4 w-4 shrink-0", toneClasses)} />
      <span>
        <span className="block text-lg font-black tabular-nums leading-none">{value}</span>
        <span className="mt-1 block text-[8px] font-bold uppercase tracking-[.16em] text-muted-foreground">{label}</span>
      </span>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
  compact,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/70 text-center",
        compact ? "py-8" : "py-12"
      )}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted/70 text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-xs font-medium">{title}</p>
        <p className="text-[11px] text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "warning";
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        "dash-animate-in flex items-start gap-2 rounded-2xl border px-4 py-3 text-[12px]",
        tone === "warning" &&
          "border-amber-500/30 bg-amber-500/8 text-amber-800 dark:text-amber-300"
      )}
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {children}
    </p>
  );
}

function ActivityItem({
  row,
  canUndo,
  undoing,
  onUndo,
}: {
  row: ActivityRow;
  canUndo: boolean;
  undoing: boolean;
  onUndo: () => void;
}) {
  const undone = Boolean(row.undone_at);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-3 text-xs">
      <div className="flex min-w-0 items-center gap-2.5">
        <DecisionDot decision={row.decision} undone={undone} />
        <div className="min-w-0">
          <p className="font-medium">
            {row.product_url ? (
              <a
                href={row.product_url}
                target="_blank"
                rel="noreferrer"
                className="underline decoration-border underline-offset-2 hover:decoration-primary"
              >
                {row.product_title}
              </a>
            ) : (
              row.product_title
            )}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {row.decision === "assigned" ? (
              <>
                → {row.taxonomy_name}
                {typeof row.score === "number"
                  ? ` · ${(row.score * 100).toFixed(0)}% match`
                  : ""}
              </>
            ) : (
              row.reason
            )}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <DecisionBadge decision={row.decision} undone={undone} />
        {row.decision === "assigned" && !undone && canUndo ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 gap-1 px-2 text-[10px]"
            disabled={undoing}
            onClick={onUndo}
          >
            {undoing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Undo2 className="h-3 w-3" />
            )}
            Undo
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function DecisionDot({
  decision,
  undone,
}: {
  decision: ActivityRow["decision"];
  undone: boolean;
}) {
  const tone = undone
    ? "bg-muted text-muted-foreground"
    : decision === "assigned"
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
      : decision === "failed"
        ? "bg-destructive/15 text-destructive"
        : "bg-muted text-muted-foreground";
  const Icon = decision === "assigned" ? Check : decision === "failed" ? X : Undo2;
  return (
    <span
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
        tone
      )}
    >
      <Icon className="h-3 w-3" />
    </span>
  );
}

function DecisionBadge({
  decision,
  undone,
}: {
  decision: ActivityRow["decision"];
  undone: boolean;
}) {
  if (undone) {
    return (
      <Badge variant="outline" className="gap-1 text-[10px]">
        <Undo2 className="h-3 w-3" />
        Undone
      </Badge>
    );
  }
  if (decision === "assigned") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-emerald-500/40 text-[10px] text-emerald-700 dark:text-emerald-400"
      >
        <Check className="h-3 w-3" />
        Assigned
      </Badge>
    );
  }
  if (decision === "failed") {
    return (
      <Badge variant="outline" className="gap-1 text-[10px] text-destructive">
        <X className="h-3 w-3" />
        Failed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px]">
      Skipped
    </Badge>
  );
}

function RuleCard({
  rule,
  projects,
  latestRun,
  busy,
  onRun,
  onToggle,
  onInterval,
  onDelete,
}: {
  rule: RuleRow;
  projects: LiveProjectOption[];
  latestRun?: RunRow;
  busy: boolean;
  onRun: () => void;
  onToggle: () => void;
  onInterval: (interval: SyncInterval) => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border bg-card p-4 shadow-sm transition-all hover:shadow-md",
        rule.enabled ? "border-border/60" : "border-border/40 opacity-80"
      )}
    >
      <span
        className={cn(
          "absolute inset-y-0 left-0 w-1 rounded-l-2xl transition-colors",
          rule.enabled ? "bg-[#400095] dark:bg-[#F76D01]" : "bg-border"
        )}
      />
      <div className="flex flex-wrap items-start justify-between gap-3 pl-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold tracking-tight">{rule.name}</p>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                rule.enabled
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground"
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  rule.enabled ? "bg-emerald-500" : "bg-muted-foreground/50"
                )}
              />
              {rule.enabled ? "Active" : "Paused"}
            </span>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
            {rule.watched_taxonomies.map((watched) => (
              <span
                key={watched.ref}
                className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5"
              >
                <Tag className="h-3 w-3" />
                {watched.title || watched.ref}
              </span>
            ))}
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <span className="inline-flex items-center gap-1 rounded-full border border-[#400095]/20 bg-[#400095]/8 px-2 py-0.5 text-[#400095] dark:border-[#F76D01]/20 dark:bg-[#F76D01]/8 dark:text-[#F76D01]">
              <Folder className="h-3 w-3" />
              {projectLabel(rule.project_id, projects)}
            </span>
          </div>

          <p className="mt-2.5 text-[11px] text-muted-foreground">
            Last run: {formatWhen(rule.last_run_at)}
            {latestRun
              ? ` · ${latestRun.assigned_count} assigned of ${latestRun.detected_count} new`
              : ""}
            {rule.enabled && rule.next_run_at
              ? ` · next ${formatWhen(rule.next_run_at)}`
              : ""}
          </p>

          {rule.last_error ? (
            <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-destructive">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {rule.last_error}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <ScheduleToggle
            value={rule.run_interval}
            disabled={busy}
            onChange={onInterval}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7.5 gap-1 rounded-lg text-[11px]"
            disabled={busy}
            onClick={onRun}
          >
            {busy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Run now
          </Button>
          <button
            type="button"
            role="switch"
            aria-checked={rule.enabled}
            aria-label={rule.enabled ? "Pause rule" : "Activate rule"}
            disabled={busy}
            onClick={onToggle}
            className={cn(
              "relative h-5 w-9 rounded-full transition-colors disabled:opacity-50",
              rule.enabled ? "bg-[#400095] dark:bg-[#F76D01]" : "bg-muted"
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-background shadow-sm transition-transform",
                rule.enabled && "translate-x-4"
              )}
            />
          </button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7.5 w-7.5 p-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
            disabled={busy}
            onClick={onDelete}
            aria-label="Delete rule"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Sync only ever runs automatically every 24h or on manual demand — a two-way
 *  toggle communicates that more clearly than a dropdown with one real choice. */
function ScheduleToggle({
  value,
  disabled,
  onChange,
}: {
  value: SyncInterval;
  disabled?: boolean;
  onChange: (interval: SyncInterval) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Schedule"
      className="flex items-center gap-0.5 rounded-lg border border-input bg-transparent p-0.5"
    >
      {(
        [
          ["24h", "Auto · 24h"],
          ["manual", "Manual"],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          disabled={disabled}
          onClick={() => onChange(id)}
          className={cn(
            "rounded-md px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50",
            value === id
              ? "bg-[#400095] text-white dark:bg-[#F76D01]"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function CreateRuleDialog({
  open,
  onOpenChange,
  projects,
  taxonomies,
  taxonomyLabel,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: LiveProjectOption[];
  taxonomies: TaxonomyOption[];
  taxonomyLabel: string;
  onCreate: (input: {
    projectId: string;
    name: string;
    interval: SyncInterval;
    watchedTaxonomies: WatchedTaxonomy[];
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [refs, setRefs] = useState<string[]>([]);
  const [projectId, setProjectId] = useState("");
  const [interval, setInterval] = useState<SyncInterval>("24h");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName("");
    setRefs([]);
    setProjectId("");
    setInterval("24h");
  };

  // No live collection from *any* project belongs in the watch list — every
  // one of them is somewhere Sync (or a manual push) already assigns
  // products to, never a source of new organic ones. This has to cover every
  // project up front, not just whichever one ends up selected below, since
  // the picker is shown before that choice is made.
  const destinationRefs = useMemo(
    () => new Set(projects.flatMap((p) => p.liveCollectionRefs)),
    [projects]
  );

  // Fallback for pushes made before the id/handle got recorded on the slice
  // (or where that write step failed): the store title is always
  // `${prefix} - ${name}`, so a live taxonomy whose title ends in a known
  // proposed name is a push destination too, ref or no ref.
  const destinationNames = useMemo(
    () =>
      new Set(
        projects.flatMap((p) => p.liveCollectionNames.map((n) => n.trim().toLowerCase()))
      ),
    [projects]
  );

  const isWatchable = useCallback(
    (taxonomy: TaxonomyOption) => {
      if (destinationRefs.has(taxonomy.id)) return false;
      if (taxonomy.handle && destinationRefs.has(taxonomy.handle)) return false;
      const sepIdx = taxonomy.title.indexOf(" - ");
      const suffix = (sepIdx === -1 ? taxonomy.title : taxonomy.title.slice(sepIdx + 3))
        .trim()
        .toLowerCase();
      if (destinationNames.has(suffix)) return false;
      return true;
    },
    [destinationRefs, destinationNames]
  );

  const watchableTaxonomies = useMemo(
    () => taxonomies.filter(isWatchable),
    [taxonomies, isWatchable]
  );
  const hiddenCount = taxonomies.length - watchableTaxonomies.length;

  // If picking a project hides a collection that was already checked, drop it
  // rather than silently submit a watch target that is also the destination.
  useEffect(() => {
    setRefs((prev) => prev.filter((ref) => {
      const found = taxonomies.find((t) => t.id === ref);
      return !found || isWatchable(found);
    }));
  }, [taxonomies, isWatchable]);

  const canCreate =
    name.trim().length > 0 && refs.length > 0 && projectId.length > 0 && !saving;

  const submit = async () => {
    setSaving(true);
    try {
      await onCreate({
        projectId,
        name: name.trim(),
        interval,
        watchedTaxonomies: refs.map((ref) => {
          const found = taxonomies.find((t) => t.id === ref);
          return {
            ref,
            title: found?.title ?? ref,
            productCount: found?.productCount,
          };
        }),
      });
      toast.success("Rule created. It will only pick up products added from now on.");
      onOpenChange(false);
      reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the rule");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Sync rule</DialogTitle>
          <DialogDescription>
            Sync records the current moment when the rule is created and only
            looks at products created after it. Existing products are never
            touched.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label className="text-[11px] text-muted-foreground">Rule name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Summer apparel auto-sync"
            className="h-9 text-xs"
          />
        </div>

        <div className="space-y-1.5">
          <div>
            <p className="text-xs font-medium">Watch {taxonomyLabel}</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Products created in these after now will be picked up. Note this
              is the product&apos;s creation date, not the date it was filed
              here.
            </p>
            {hiddenCount > 0 ? (
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {hiddenCount} hidden — already live under a project, so
                there&apos;s nothing new to watch there.
              </p>
            ) : null}
          </div>
          <div className="max-h-40 overflow-y-auto rounded-lg border border-border/70">
            {watchableTaxonomies.length === 0 ? (
              <p className="px-3 py-4 text-center text-[11px] text-muted-foreground">
                Nothing to watch yet.
              </p>
            ) : (
              watchableTaxonomies.map((taxonomy) => (
                <label
                  key={taxonomy.id}
                  className={cn(
                    "flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2 last:border-0",
                    taxonomy.manual
                      ? "cursor-pointer"
                      : "cursor-not-allowed opacity-60"
                  )}
                >
                  <span className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={refs.includes(taxonomy.id)}
                      disabled={!taxonomy.manual}
                      onChange={() =>
                        setRefs((prev) =>
                          prev.includes(taxonomy.id)
                            ? prev.filter((row) => row !== taxonomy.id)
                            : [...prev, taxonomy.id]
                        )
                      }
                    />
                    {taxonomy.title}
                  </span>
                  {taxonomy.manual ? (
                    <span className="rounded-full bg-[#400095]/10 px-2 py-0.5 text-[10px] text-[#400095] dark:bg-[#F76D01]/10 dark:text-[#F76D01]">
                      {taxonomy.productCount.toLocaleString("en-US")} products
                    </span>
                  ) : (
                    <span
                      className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                      title="Membership is decided by rules on the store, so products cannot be added by hand"
                    >
                      rule-based
                    </span>
                  )}
                </label>
              ))
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <div>
            <p className="text-xs font-medium">Sync into project</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Only projects with categories already pushed live can receive
              products.
            </p>
          </div>
          {projects.length === 0 ? (
            <p className="rounded-lg border border-border/70 px-3 py-4 text-center text-[11px] text-muted-foreground">
              No project has been pushed live yet.
            </p>
          ) : (
            <div className="max-h-36 overflow-y-auto rounded-lg border border-border/70">
              {projects.map((project) => (
                <label
                  key={project.id}
                  className="flex cursor-pointer items-center justify-between gap-2 border-b border-border/50 px-3 py-2 last:border-0"
                >
                  <span className="flex items-center gap-2 text-xs">
                    <input
                      type="radio"
                      name="growth-sync-project"
                      checked={projectId === project.id}
                      onChange={() => setProjectId(project.id)}
                    />
                    {project.name}
                  </span>
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-400">
                    {project.liveCount} live
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-[11px] text-muted-foreground">Schedule</Label>
          <ScheduleToggle value={interval} onChange={setInterval} />
        </div>

        <DialogFooter>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1.5 rounded-lg bg-[#400095] text-xs text-white hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
            disabled={!canCreate}
            onClick={() => void submit()}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Create rule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
