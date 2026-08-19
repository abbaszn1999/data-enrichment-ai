"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  Folder,
  Plus,
  RefreshCw,
  Tag,
  Trash2,
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
import {
  STORE_COLLECTIONS,
  SYNC_INTERVALS,
  collectionById,
  fetchLiveProjects,
  intervalLabel,
  loadGrowthSync,
  projectLabel,
  saveGrowthSync,
  type LiveProjectOption,
  type SyncInterval,
  type SyncRule,
  type SyncState,
} from "@/lib/growth-sync";

export function SyncDashboard() {
  const params = useParams<{ workspaceSlug: string }>();
  const slug = params.workspaceSlug ?? "";
  const { user } = useAuth();
  const { workspace } = useWorkspace(slug, user);
  const workspaceId = workspace?.id ?? "";
  const [state, setState] = useState<SyncState | null>(null);
  const [projects, setProjects] = useState<LiveProjectOption[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [draftInterval, setDraftInterval] = useState<SyncInterval>("1h");

  useEffect(() => {
    const loaded = loadGrowthSync(slug);
    setState(loaded);
    setDraftInterval(loaded.interval);
  }, [slug]);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    void fetchLiveProjects(workspaceId, slug).then((rows) => {
      if (!cancelled) setProjects(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, slug]);

  const persist = (next: SyncState) => {
    setState(next);
    saveGrowthSync(slug, next);
  };

  if (!state) return null;

  const creditsReady = Boolean(state.planId);
  const base = `/w/${slug}/growth-sync`;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <RefreshCw className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Sync</h1>
            <p className="max-w-xl text-xs text-muted-foreground leading-relaxed">
              Watch store collections and classify newly added products into
              Market research projects that have been pushed live.
            </p>
          </div>
        </div>
        <Button
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          New sync rule
        </Button>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-border/70 bg-muted/30 px-3 py-2.5 text-[11px] text-muted-foreground">
        <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>
          Schedule: <span className="font-medium text-foreground">{intervalLabel(state.interval)}</span>
          . Active rules run on this interval. Change it below, or use Resync
          for an immediate run.
        </p>
      </div>

      {!creditsReady ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/8 px-3 py-2.5">
          <p className="flex items-start gap-2 text-[11px] text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Sync credits are not set up. Add a classification pack before
            turning rules on.
          </p>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" asChild>
            <Link href={`${base}/subscription`}>Choose a pack</Link>
          </Button>
        </div>
      ) : null}

      <section className="space-y-3 rounded-xl border border-border/70 p-4">
        <div className="flex items-start gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
            <RefreshCw className="h-3.5 w-3.5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Sync schedule</h2>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Automatically run every rule that is turned on, on this interval.
              Use Resync on a rule anytime for an immediate run.
            </p>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-[11px] text-muted-foreground">
            Auto-sync interval
          </Label>
          <select
            value={draftInterval}
            onChange={(e) => setDraftInterval(e.target.value as SyncInterval)}
            className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          >
            {SYNC_INTERVALS.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-muted-foreground">
            Only rules with Auto Sync on are included. Manual only means Resync
            is the only way a rule runs.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          disabled={draftInterval === state.interval}
          onClick={() => {
            persist({ ...state, interval: draftInterval });
            toast.success("Schedule saved");
          }}
        >
          Save Sync schedule
        </Button>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">Rules</h2>
        {state.rules.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border/70 px-4 py-8 text-center text-xs text-muted-foreground">
            No rules yet. Create one to watch a collection and feed a project.
          </p>
        ) : (
          state.rules.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              projects={projects}
              onToggle={() => {
                if (!rule.enabled && !creditsReady) {
                  toast.error("Add a Sync pack before turning a rule on");
                  return;
                }
                persist({
                  ...state,
                  rules: state.rules.map((row) =>
                    row.id === rule.id ? { ...row, enabled: !row.enabled } : row
                  ),
                });
              }}
              onResync={() => {
                persist({
                  ...state,
                  rules: state.rules.map((row) =>
                    row.id === rule.id
                      ? {
                          ...row,
                          lastSyncAt: Date.now(),
                          itemsSynced: row.itemsSynced + 3,
                        }
                      : row
                  ),
                  creditsUsed: creditsReady
                    ? state.creditsUsed + 3
                    : state.creditsUsed,
                  activity: [
                    {
                      id: `act-${Date.now()}`,
                      at: Date.now(),
                      ruleName: rule.name,
                      productTitle: "Sample product",
                      collectionName:
                        collectionById(rule.collectionIds[0] ?? "")?.name ??
                        "Collection",
                      projectName: projectLabel(
                        rule.projectIds[0] ?? "",
                        projects
                      ),
                      status: "classified" as const,
                    },
                    ...state.activity,
                  ].slice(0, 20),
                });
                toast.success("Resync queued (example)");
              }}
              onDelete={() => {
                persist({
                  ...state,
                  rules: state.rules.filter((row) => row.id !== rule.id),
                });
                toast.success("Rule deleted");
              }}
            />
          ))
        )}
      </section>

      <section className="space-y-2 rounded-xl border border-border/70 p-4">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">
            Recent Sync activity
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Newly added products that Sync has processed.
          </p>
        </div>
        {state.activity.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No sync activity yet.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {state.activity.slice(0, 8).map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-xs"
              >
                <div>
                  <p className="font-medium">{row.productTitle}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {row.collectionName} → {row.projectName}
                  </p>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  {row.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <CreateRuleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projects={projects}
        onCreate={(rule) => {
          persist({ ...state, rules: [rule, ...state.rules] });
          toast.success("Rule created");
        }}
      />
    </div>
  );
}

function RuleCard({
  rule,
  projects,
  onToggle,
  onResync,
  onDelete,
}: {
  rule: SyncRule;
  projects: LiveProjectOption[];
  onToggle: () => void;
  onResync: () => void;
  onDelete: () => void;
}) {
  const sources = rule.collectionIds
    .map((id) => collectionById(id)?.name)
    .filter(Boolean);
  const destinations = rule.projectIds.map((id) => projectLabel(id, projects));

  return (
    <div className="rounded-xl border border-border/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold tracking-tight">{rule.name}</p>
            <Badge variant="secondary" className="text-[10px]">
              {rule.enabled ? "Active" : "Paused"}
            </Badge>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
            {sources.map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/40 px-2 py-0.5"
              >
                <Tag className="h-3 w-3" />
                {name}
              </span>
            ))}
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            {destinations.map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/8 px-2 py-0.5 text-primary"
              >
                <Folder className="h-3 w-3" />
                {name}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Last sync:{" "}
            {rule.lastSyncAt
              ? new Date(rule.lastSyncAt).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })
              : "Never"}{" "}
            · {rule.itemsSynced} items synced
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            onClick={onResync}
          >
            Resync
          </Button>
          <button
            type="button"
            role="switch"
            aria-checked={rule.enabled}
            onClick={onToggle}
            className={cn(
              "relative h-5 w-9 rounded-full transition-colors",
              rule.enabled ? "bg-primary" : "bg-muted"
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
            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
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

function CreateRuleDialog({
  open,
  onOpenChange,
  projects,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: LiveProjectOption[];
  onCreate: (rule: SyncRule) => void;
}) {
  const [name, setName] = useState("");
  const [collectionIds, setCollectionIds] = useState<string[]>([]);
  const [projectIds, setProjectIds] = useState<string[]>([]);

  const reset = () => {
    setName("");
    setCollectionIds([]);
    setProjectIds([]);
  };

  const toggle = (list: string[], id: string, set: (next: string[]) => void) => {
    set(list.includes(id) ? list.filter((row) => row !== id) : [...list, id]);
  };

  const canCreate =
    name.trim().length > 0 &&
    collectionIds.length > 0 &&
    projectIds.length > 0;

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
            When Sync runs, newly added products in the selected collections
            are classified into the chosen projects’ live collections.
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
            <p className="text-xs font-medium">Watch existing collections</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              New products added into these collections will be picked up by
              Sync. Only your own store collections are shown — never ones
              Market research created.
            </p>
          </div>
          <div className="max-h-40 overflow-y-auto rounded-lg border border-border/70">
            {STORE_COLLECTIONS.map((collection) => (
              <label
                key={collection.id}
                className="flex cursor-pointer items-center justify-between gap-2 border-b border-border/50 px-3 py-2 last:border-0"
              >
                <span className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={collectionIds.includes(collection.id)}
                    onChange={() =>
                      toggle(collectionIds, collection.id, setCollectionIds)
                    }
                  />
                  {collection.name}
                </span>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                  {collection.productCount.toLocaleString("en-US")} products
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <div>
            <p className="text-xs font-medium">Sync into projects</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Only projects with live (pushed) collections can be selected.
            </p>
          </div>
          <div className="max-h-36 overflow-y-auto rounded-lg border border-border/70">
            {projects.map((project) => (
              <label
                key={project.id}
                className="flex cursor-pointer items-center justify-between gap-2 border-b border-border/50 px-3 py-2 last:border-0"
              >
                <span className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={projectIds.includes(project.id)}
                    onChange={() =>
                      toggle(projectIds, project.id, setProjectIds)
                    }
                  />
                  {project.name}
                </span>
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-400">
                  {project.liveCount} live collections
                </span>
              </label>
            ))}
          </div>
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
            className="h-8 text-xs"
            disabled={!canCreate}
            onClick={() => {
              onCreate({
                id: `rule-${Date.now()}`,
                name: name.trim(),
                enabled: false,
                collectionIds,
                projectIds,
                lastSyncAt: null,
                itemsSynced: 0,
              });
              onOpenChange(false);
              reset();
            }}
          >
            Create rule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
