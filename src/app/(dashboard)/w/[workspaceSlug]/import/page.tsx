"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { motion } from "motion/react";
import {
  ArrowRight,
  Check,
  Clock3,
  Database,
  FileSpreadsheet,
  FolderOpen,
  FolderTree,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ProjectListPagination,
  ProjectListToolbar,
  matchesProjectDateFilter,
  paginateProjects,
  sortProjectsByOption,
  type ProjectDateFilter,
  type ProjectSortOption,
} from "@/components/media/project-list-controls";
import { DeleteProjectDialog } from "@/components/media/delete-project-dialog";
import { useWorkspaceContext } from "../workspace-context";
import { useRole } from "@/hooks/use-role";
import { getImportSessions, deleteImportSession, type ImportSession } from "@/lib/supabase";
import type { SessionKind } from "@/types";

const STATUS_LABEL: Record<string, string> = {
  matching: "Matching",
  rules: "Rules",
  review: "Review",
  enriching: "Enriching",
  completed: "Ready",
  cancelled: "Cancelled",
};

function sessionKindOf(session: ImportSession): SessionKind {
  return (session.kind as SessionKind) ?? "product";
}

const KIND_FILTERS: { value: "all" | SessionKind; label: string }[] = [
  { value: "all", label: "All types" },
  { value: "product", label: "Products" },
  { value: "plp", label: "PLP pages" },
];

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (Number.isNaN(diff) || diff < 0) return "Updated just now";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Updated yesterday";
  if (days < 30) return `Updated ${days}d ago`;
  return `Updated ${Math.floor(days / 30)}mo ago`;
}

function sessionHref(slug: string, session: ImportSession): string {
  const base = `/w/${slug}/import/${session.id}`;
  if (session.status === "enriching" || session.status === "completed") {
    return `${base}/enrich`;
  }
  if (session.status === "review") return `${base}/review`;
  return `${base}/rules`;
}

function sessionProgress(session: ImportSession): number {
  if (session.status === "completed") return 100;
  if (session.status === "cancelled") return 0;
  const totalRows = session.total_rows || 0;
  if (totalRows <= 0) {
    if (session.status === "enriching") return 40;
    if (session.status === "review") return 25;
    if (session.status === "rules" || session.status === "matching") return 10;
    return 0;
  }
  const enriched = session.enriched_count || 0;
  return Math.min(99, Math.round((enriched / totalRows) * 100));
}

export default function ImportPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.workspaceSlug as string;
  const { workspace, role } = useWorkspaceContext();
  const permissions = useRole(role);
  const canEdit = permissions.canImport;
  const canAdmin = permissions.canAdmin;

  const [sessions, setSessions] = useState<ImportSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectSearch, setProjectSearch] = useState("");
  const [projectStatusFilter, setProjectStatusFilter] = useState("all");
  const [projectDateFilter, setProjectDateFilter] =
    useState<ProjectDateFilter>("all");
  const [projectSort, setProjectSort] =
    useState<ProjectSortOption>("updated_desc");
  const [projectPage, setProjectPage] = useState(1);
  const [kindFilter, setKindFilter] = useState<"all" | SessionKind>("all");
  const [deleteTarget, setDeleteTarget] = useState<ImportSession | null>(null);
  const [deletingProject, setDeletingProject] = useState(false);

  useEffect(() => {
    if (!workspace) return;
    getImportSessions(workspace.id)
      .then((data) => setSessions((data ?? []) as ImportSession[]))
      .catch((err) => console.error("Failed to load import sessions:", err))
      .finally(() => setLoading(false));
  }, [workspace]);

  const projectStats = useMemo(
    () => ({
      total: sessions.length,
      ready: sessions.filter((s) => s.status === "completed").length,
      processing: sessions.filter(
        (s) => s.status !== "completed" && s.status !== "cancelled"
      ).length,
      products: sessions.reduce((sum, s) => sum + (s.total_rows || 0), 0),
      // A workspace mixing both kinds cannot call this total "Products".
      hasPlp: sessions.some((s) => sessionKindOf(s) === "plp"),
      hasProduct: sessions.some((s) => sessionKindOf(s) === "product"),
    }),
    [sessions]
  );

  const rowsMetricLabel =
    projectStats.hasPlp && projectStats.hasProduct
      ? "Rows"
      : projectStats.hasPlp
        ? "Pages"
        : "Products";

  const filteredProjects = useMemo(() => {
    const query = projectSearch.trim().toLowerCase();
    const filtered = sessions.filter((session) => {
      const matchesSearch =
        !query ||
        session.name.toLowerCase().includes(query) ||
        (session.notes || "").toLowerCase().includes(query);
      if (!matchesSearch) return false;

      if (kindFilter !== "all" && sessionKindOf(session) !== kindFilter) {
        return false;
      }

      if (projectStatusFilter === "ready") {
        if (session.status !== "completed") return false;
      } else if (projectStatusFilter === "processing") {
        if (
          session.status === "completed" ||
          session.status === "cancelled"
        ) {
          return false;
        }
      } else if (projectStatusFilter !== "all") {
        if (session.status !== projectStatusFilter) return false;
      }

      return matchesProjectDateFilter(
        session.updated_at || session.created_at,
        projectDateFilter
      );
    });
    return sortProjectsByOption(filtered, projectSort);
  }, [
    kindFilter,
    projectDateFilter,
    projectSearch,
    projectSort,
    projectStatusFilter,
    sessions,
  ]);

  const {
    pageItems: pagedProjects,
    totalPages: projectTotalPages,
    safePage: safeProjectPage,
  } = useMemo(
    () => paginateProjects(filteredProjects, projectPage),
    [filteredProjects, projectPage]
  );

  useEffect(() => {
    setProjectPage(1);
  }, [projectSearch, projectStatusFilter, projectDateFilter, projectSort, kindFilter]);

  useEffect(() => {
    if (projectPage !== safeProjectPage) setProjectPage(safeProjectPage);
  }, [projectPage, safeProjectPage]);

  const openProject = (session: ImportSession) => {
    router.push(sessionHref(slug, session));
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeletingProject(true);
    try {
      await deleteImportSession(deleteTarget.id);
      setSessions((prev) => prev.filter((s) => s.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      alert((err as Error)?.message || "Failed to delete");
    } finally {
      setDeletingProject(false);
    }
  };

  return (
    <div className="autommerce-dashboard min-h-full bg-background [font-family:var(--brand-font)]">
      <section className="relative overflow-hidden border-b border-border/60 bg-gradient-to-br from-[#400095]/[0.08] via-background to-[#F76D01]/[0.08]">
        <div className="absolute -left-20 -top-28 h-64 w-64 rounded-full bg-[#400095]/10 blur-3xl" />
        <div className="absolute -bottom-28 -right-16 h-64 w-64 rounded-full bg-[#F76D01]/10 blur-3xl" />
        <div className="relative mx-auto max-w-[1500px] px-5 py-7 sm:px-7 lg:px-10">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between"
          >
            <div>
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#400095] text-white shadow-[0_8px_25px_rgba(64,0,149,.22)] dark:bg-[#F76D01]">
                  <Sparkles className="h-4 w-4" />
                </span>
                <span className="text-[9px] font-black uppercase tracking-[0.24em] text-[#400095] dark:text-[#F76D01]">
                  Catalog intelligence
                </span>
              </div>
              <h1 className="text-3xl font-black tracking-[-0.035em] sm:text-4xl">
                Raw worksheets in.
                <span className="block bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095] bg-clip-text pb-1 text-transparent">
                  Agent-ready product data out.
                </span>
              </h1>
              <p className="mt-2 max-w-xl text-xs leading-relaxed text-muted-foreground">
                Upload, match, review, and enrich product data through one guided workflow.
                Every project preserves its progress so your team can continue at any time.
              </p>
            </div>
            {canEdit && (
              <Button
                size="sm"
                className="h-9 gap-2 self-start rounded-xl bg-[#400095] px-4 text-[10px] text-white shadow-[0_8px_24px_rgba(64,0,149,.2)] hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90 lg:self-auto"
                asChild
              >
                <Link href={`/w/${slug}/import/new`}>
                  <Plus className="h-3.5 w-3.5" /> New project
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </Button>
            )}
          </motion.div>

          <div className="mt-7 grid max-w-3xl grid-cols-2 overflow-hidden rounded-2xl border border-border/60 bg-background/70 shadow-sm backdrop-blur sm:grid-cols-4">
            {[
              { label: "Projects", value: projectStats.total, icon: FolderOpen },
              { label: "Ready", value: projectStats.ready, icon: Check },
              { label: "Processing", value: projectStats.processing, icon: Loader2 },
              { label: rowsMetricLabel, value: projectStats.products.toLocaleString(), icon: Database },
            ].map((metric, index) => (
              <motion.div
                key={metric.label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + index * 0.08 }}
                className="flex items-center gap-3 border-r border-border/60 px-4 py-3.5 last:border-r-0"
              >
                <metric.icon
                  className={`h-4 w-4 shrink-0 text-[#6B358D] dark:text-[#C8A8D2] ${
                    metric.label === "Processing" && projectStats.processing ? "animate-spin" : ""
                  }`}
                />
                <span>
                  <span className="block text-lg font-black tabular-nums leading-none">{metric.value}</span>
                  <span className="mt-1 block text-[8px] font-bold uppercase tracking-[.16em] text-muted-foreground">
                    {metric.label}
                  </span>
                </span>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-[1500px] space-y-4 p-5 sm:p-7 lg:p-10">
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12 }}
          className="overflow-hidden rounded-[24px] border border-border/60 bg-card shadow-[0_15px_50px_rgba(15,23,42,.05)]"
        >
          <div className="h-1 bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095]" />
          <ProjectListToolbar
            title="Catalog Intelligence projects"
            description="Open a project to continue matching, review, or enrichment."
            search={projectSearch}
            onSearchChange={setProjectSearch}
            status={projectStatusFilter}
            onStatusChange={setProjectStatusFilter}
            statusOptions={[
              { value: "all", label: "All statuses" },
              { value: "ready", label: "Ready" },
              { value: "processing", label: "In progress" },
              { value: "matching", label: "Matching" },
              { value: "review", label: "Review" },
              { value: "enriching", label: "Enriching" },
              { value: "cancelled", label: "Cancelled" },
            ]}
            dateFilter={projectDateFilter}
            onDateFilterChange={setProjectDateFilter}
            sort={projectSort}
            onSortChange={setProjectSort}
          />

          <div className="flex items-center gap-1.5 border-b bg-muted/10 px-4 py-2">
            {KIND_FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setKindFilter(option.value)}
                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                  kindFilter === option.value
                    ? "bg-[#400095] text-white dark:bg-[#F76D01]"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#400095]/10 dark:bg-[#F76D01]/10">
                <Loader2 className="h-5 w-5 animate-spin text-[#400095] dark:text-[#F76D01]" />
              </span>
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#F76D01]/15 to-[#400095]/15">
                <Upload className="h-7 w-7 text-[#6B358D]" />
              </div>
              <h3 className="text-sm font-black">
                Create your first catalog intelligence project
              </h3>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                Upload an Excel or CSV product worksheet to start matching and
                enrichment.
              </p>
              {canEdit && (
                <Button size="sm" className="mt-5 gap-1.5 rounded-xl bg-[#400095] text-white dark:bg-[#F76D01]" asChild>
                  <Link href={`/w/${slug}/import/new`}>
                    <Plus className="h-3.5 w-3.5" /> New project
                  </Link>
                </Button>
              )}
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="px-6 py-14 text-center text-xs text-muted-foreground">
              No projects match your search or filters.
            </div>
          ) : (
            <>
              <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
                {pagedProjects.map((session, index) => {
                  const statusLabel =
                    STATUS_LABEL[session.status] ?? session.status;
                  const isReady = session.status === "completed";
                  const progress = sessionProgress(session);
                  const kind = sessionKindOf(session);
                  const isPlp = kind === "plp";

                  return (
                    <motion.article
                      key={session.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(index * 0.04, 0.2) }}
                      role="button"
                      tabIndex={0}
                      onClick={() => openProject(session)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          openProject(session);
                        }
                      }}
                      className="group relative cursor-pointer overflow-hidden rounded-2xl border border-border/60 bg-background p-4 outline-none transition-all hover:-translate-y-1 hover:border-[#6B358D]/35 hover:shadow-[0_16px_40px_rgba(64,0,149,.08)] focus-visible:ring-2 focus-visible:ring-[#6B358D]/30"
                    >
                      <div className="absolute inset-x-0 top-0 h-0.5 origin-left scale-x-0 bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095] transition-transform duration-300 group-hover:scale-x-100" />
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#F76D01]/10 to-[#400095]/10 text-[#6B358D] transition-transform group-hover:scale-105 dark:text-[#C8A8D2]">
                            {isPlp ? (
                              <FolderTree className="h-4 w-4" />
                            ) : (
                              <FileSpreadsheet className="h-4 w-4" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <h3 className="truncate text-sm font-black transition-colors group-hover:text-[#400095] dark:group-hover:text-[#F76D01]">
                              {session.name}
                            </h3>
                            <span className="mt-0.5 inline-block rounded-full bg-muted/60 px-1.5 py-px text-[8px] font-bold uppercase tracking-wider text-muted-foreground">
                              {isPlp ? "PLP pages" : "Products"}
                            </span>
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className={`shrink-0 text-[9px] ${
                            isReady
                              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600"
                              : session.status === "cancelled"
                                ? "border-muted-foreground/30 bg-muted/40 text-muted-foreground"
                                : "border-amber-500/30 bg-amber-500/5 text-amber-600"
                          }`}
                        >
                          {statusLabel}
                        </Badge>
                      </div>

                      <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-lg bg-muted/35 px-2 py-2">
                          <p className="text-xs font-semibold">
                            {session.total_rows || 0}
                          </p>
                          <p className="text-[9px] text-muted-foreground">
                            {isPlp ? "Pages" : "Products"}
                          </p>
                        </div>
                        <div className="rounded-lg bg-muted/35 px-2 py-2">
                          <p className="text-xs font-semibold text-blue-600">
                            {session.new_count || 0}
                          </p>
                          <p className="text-[9px] text-muted-foreground">New</p>
                        </div>
                        <div className="rounded-lg bg-muted/35 px-2 py-2">
                          <p className="text-xs font-semibold text-emerald-600">
                            {session.enriched_count || 0}
                          </p>
                          <p className="text-[9px] text-muted-foreground">
                            Enriched
                          </p>
                        </div>
                      </div>

                      <div className="mt-4">
                        <div className="mb-1.5 flex justify-between text-[9px] text-muted-foreground">
                          <span>Project progress</span>
                          <span>{progress}%</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095] transition-all"
                            style={{ width: `${Math.min(100, progress)}%` }}
                          />
                        </div>
                      </div>

                      <div className="mt-4 flex items-center justify-between border-t pt-3">
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Clock3 className="h-3 w-3" />
                          {timeAgo(session.updated_at || session.created_at)}
                        </span>
                        {canAdmin && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setDeleteTarget(session);
                            }}
                            className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-3 w-3" /> Delete
                          </button>
                        )}
                      </div>
                    </motion.article>
                  );
                })}
              </div>
              <ProjectListPagination
                page={safeProjectPage}
                totalPages={projectTotalPages}
                totalItems={filteredProjects.length}
                onPageChange={setProjectPage}
              />
            </>
          )}
        </motion.section>
      </main>

      <DeleteProjectDialog
        open={!!deleteTarget}
        projectName={deleteTarget?.name}
        deleting={deletingProject}
        onOpenChange={(open) => {
          if (!open && !deletingProject) setDeleteTarget(null);
        }}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
