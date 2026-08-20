"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Check,
  Clock3,
  FileSpreadsheet,
  FolderOpen,
  Loader2,
  Package,
  Plus,
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
import { useWorkspaceContext } from "../layout";
import { useRole } from "@/hooks/use-role";
import { getImportSessions, deleteImportSession, type ImportSession } from "@/lib/supabase";

const STATUS_LABEL: Record<string, string> = {
  matching: "Matching",
  rules: "Rules",
  review: "Review",
  enriching: "Enriching",
  completed: "Ready",
  cancelled: "Cancelled",
};

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
    }),
    [sessions]
  );

  const filteredProjects = useMemo(() => {
    const query = projectSearch.trim().toLowerCase();
    const filtered = sessions.filter((session) => {
      const matchesSearch =
        !query ||
        session.name.toLowerCase().includes(query) ||
        (session.notes || "").toLowerCase().includes(query);
      if (!matchesSearch) return false;

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
  }, [projectSearch, projectStatusFilter, projectDateFilter, projectSort]);

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
    <div className="min-h-full bg-gradient-to-b from-muted/20 via-background to-background">
      <div className="mx-auto max-w-7xl space-y-6 p-5 sm:p-6 lg:p-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-background shadow-sm">
              <Upload className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">
                Catalog Intelligence
              </h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Upload worksheets, match products, and enrich catalog data.
              </p>
            </div>
          </div>
          {canEdit && (
            <Button
              size="sm"
              className="gap-1.5 self-start shadow-sm sm:self-auto"
              asChild
            >
              <Link href={`/w/${slug}/import/new`}>
                <Plus className="h-3.5 w-3.5" /> New project
              </Link>
            </Button>
          )}
        </header>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            {
              label: "Projects",
              value: projectStats.total,
              icon: FolderOpen,
              style: "bg-primary/10 text-primary",
            },
            {
              label: "Ready",
              value: projectStats.ready,
              icon: Check,
              style: "bg-emerald-500/10 text-emerald-600",
            },
            {
              label: "Processing",
              value: projectStats.processing,
              icon: Loader2,
              style: "bg-amber-500/10 text-amber-600",
            },
            {
              label: "Products",
              value: projectStats.products.toLocaleString(),
              icon: Package,
              style: "bg-blue-500/10 text-blue-600",
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="flex items-center gap-3 rounded-xl border bg-card p-3.5 shadow-sm"
            >
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-lg ${stat.style}`}
              >
                <stat.icon
                  className={`h-4 w-4 ${
                    stat.label === "Processing" && stat.value
                      ? "animate-spin"
                      : ""
                  }`}
                />
              </div>
              <div>
                <p className="text-lg font-bold leading-none">{stat.value}</p>
                <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {stat.label}
                </p>
              </div>
            </div>
          ))}
        </section>

        <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
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

          {loading ? (
            <div className="flex h-56 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Upload className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-semibold">
                Create your first catalog intelligence project
              </h3>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                Upload an Excel or CSV product worksheet to start matching and
                enrichment.
              </p>
              {canEdit && (
                <Button size="sm" className="mt-5 gap-1.5" asChild>
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
              <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
                {pagedProjects.map((session) => {
                  const statusLabel =
                    STATUS_LABEL[session.status] ?? session.status;
                  const isReady = session.status === "completed";
                  const progress = sessionProgress(session);

                  return (
                    <article
                      key={session.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openProject(session)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          openProject(session);
                        }
                      }}
                      className="group relative cursor-pointer rounded-xl border bg-background p-4 outline-none transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-muted/40 text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                            <FileSpreadsheet className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <h3 className="truncate text-sm font-semibold group-hover:text-primary">
                              {session.name}
                            </h3>
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
                            Products
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
                        <div className="h-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
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
                    </article>
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
        </section>
      </div>

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
