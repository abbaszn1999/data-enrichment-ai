"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { motion } from "motion/react";
import {
  ArrowRight,
  Check,
  Clock3,
  FolderOpen,
  ImageIcon,
  Layers,
  Loader2,
  Plus,
  Trash2,
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
import {
  getImageClassificationSessions,
  deleteImageClassificationSession,
  type ImageClassificationSession,
} from "@/lib/supabase";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  processing: "Processing",
  completed: "Ready",
  failed: "Failed",
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

export default function ImageClassifyPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.workspaceSlug as string;
  const { workspace, role } = useWorkspaceContext();
  const permissions = useRole(role);
  const canEdit = permissions.canImport;
  const canAdmin = permissions.canAdmin;
  const [sessions, setSessions] = useState<ImageClassificationSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectSearch, setProjectSearch] = useState("");
  const [projectStatusFilter, setProjectStatusFilter] = useState("all");
  const [projectDateFilter, setProjectDateFilter] =
    useState<ProjectDateFilter>("all");
  const [projectSort, setProjectSort] =
    useState<ProjectSortOption>("updated_desc");
  const [projectPage, setProjectPage] = useState(1);
  const [deleteTarget, setDeleteTarget] =
    useState<ImageClassificationSession | null>(null);
  const [deletingProject, setDeletingProject] = useState(false);

  useEffect(() => {
    if (!workspace) return;
    getImageClassificationSessions(workspace.id)
      .then(setSessions)
      .catch((err) =>
        console.error("Failed to load image classification sessions:", err)
      )
      .finally(() => setLoading(false));
  }, [workspace]);

  const projectStats = useMemo(
    () => ({
      total: sessions.length,
      ready: sessions.filter((s) => s.status === "completed").length,
      processing: sessions.filter((s) => s.status === "processing").length,
      images: sessions.reduce((sum, s) => sum + (s.total_images || 0), 0),
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

  const openProject = (id: string) => {
    router.push(`/w/${slug}/image-classify/${id}`);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeletingProject(true);
    try {
      await deleteImageClassificationSession(deleteTarget.id);
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
        <motion.header initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#400095] text-white shadow-[0_8px_25px_rgba(64,0,149,.22)] dark:bg-[#F76D01]"><ImageIcon className="h-4 w-4" /></span>
              <span className="text-[9px] font-black uppercase tracking-[.24em] text-[#400095] dark:text-[#F76D01]">Visual intelligence</span>
            </div>
            <h1 className="text-3xl font-black tracking-[-.035em] sm:text-4xl">
              Images understood.
              <span className="block bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095] bg-clip-text pb-1 text-transparent">Product groups created by AI.</span>
            </h1>
            <p className="mt-2 max-w-xl text-xs leading-relaxed text-muted-foreground">Turn unstructured product photography into consistent, exportable groups with multimodal intelligence.</p>
          </div>
          {canEdit && (
            <Button
              size="sm"
              className="h-9 gap-2 self-start rounded-xl bg-[#400095] px-4 text-[10px] text-white shadow-[0_8px_24px_rgba(64,0,149,.2)] hover:bg-[#6B358D] dark:bg-[#F76D01] sm:self-auto"
              asChild
            >
              <Link href={`/w/${slug}/image-classify/new`}>
                <Plus className="h-3.5 w-3.5" /> New project <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          )}
        </motion.header>

        <section className="mt-7 grid max-w-3xl grid-cols-2 overflow-hidden rounded-2xl border border-border/60 bg-background/70 shadow-sm backdrop-blur sm:grid-cols-4">
          {[
            {
              label: "Projects",
              value: projectStats.total,
              icon: FolderOpen,
            },
            {
              label: "Ready",
              value: projectStats.ready,
              icon: Check,
            },
            {
              label: "Processing",
              value: projectStats.processing,
              icon: Loader2,
            },
            {
              label: "Images",
              value: projectStats.images.toLocaleString(),
              icon: ImageIcon,
            },
          ].map((stat) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-3 border-r border-border/60 px-4 py-3.5 last:border-r-0"
            >
                <stat.icon
                  className={`h-4 w-4 text-[#6B358D] dark:text-[#C8A8D2] ${
                    stat.label === "Processing" && stat.value ? "animate-spin" : ""
                  }`}
                />
              <div>
                <p className="text-lg font-black leading-none">{stat.value}</p>
                <p className="mt-1 text-[8px] font-bold uppercase tracking-[.16em] text-muted-foreground">
                  {stat.label}
                </p>
              </div>
            </motion.div>
          ))}
        </section>
        </div>
      </section>

      <main className="mx-auto max-w-[1500px] p-5 sm:p-7 lg:p-10">
        <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="overflow-hidden rounded-[24px] border border-border/60 bg-card shadow-[0_15px_50px_rgba(15,23,42,.05)]">
          <div className="h-1 bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095]" />
          <ProjectListToolbar
            title="Image classification projects"
            description="Open a project to review image groups and classification results."
            search={projectSearch}
            onSearchChange={setProjectSearch}
            status={projectStatusFilter}
            onStatusChange={setProjectStatusFilter}
            statusOptions={[
              { value: "all", label: "All statuses" },
              { value: "ready", label: "Ready" },
              { value: "processing", label: "Processing" },
              { value: "pending", label: "Pending" },
              { value: "failed", label: "Failed" },
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
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#F76D01]/15 to-[#400095]/15">
                <ImageIcon className="h-7 w-7 text-[#6B358D]" />
              </div>
              <h3 className="text-sm font-semibold">
                Create your first classify project
              </h3>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                Upload product images and let AI group them into consistent
                product sets automatically.
              </p>
              {canEdit && (
                <Button size="sm" className="mt-5 gap-1.5" asChild>
                  <Link href={`/w/${slug}/image-classify/new`}>
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
                {pagedProjects.map((session, index) => {
                  const statusLabel =
                    STATUS_LABEL[session.status] ?? session.status;
                  const isReady = session.status === "completed";
                  const totalImages = session.total_images || 0;
                  const groups = session.group_count || 0;
                  const failed = session.status === "failed" ? 1 : 0;
                  const progress =
                    session.status === "completed" ||
                    session.status === "failed"
                      ? 100
                      : session.status === "processing"
                        ? totalImages > 0 && groups > 0
                          ? Math.min(
                              99,
                              Math.round(
                                (groups / Math.max(1, totalImages)) * 100
                              )
                            )
                          : 40
                        : 0;

                  return (
                    <motion.article
                      key={session.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(index * .04, .2) }}
                      role="button"
                      tabIndex={0}
                      onClick={() => openProject(session.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          openProject(session.id);
                        }
                      }}
                      className="group relative cursor-pointer overflow-hidden rounded-2xl border border-border/60 bg-background p-4 outline-none transition-all hover:-translate-y-1 hover:border-[#6B358D]/35 hover:shadow-[0_16px_40px_rgba(64,0,149,.08)]"
                    >
                      <div className="absolute inset-x-0 top-0 h-0.5 origin-left scale-x-0 bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095] transition-transform group-hover:scale-x-100" />
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#F76D01]/10 to-[#400095]/10 text-[#6B358D]">
                            <Layers className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <h3 className="truncate text-sm font-black group-hover:text-[#400095] dark:group-hover:text-[#F76D01]">
                              {session.name}
                            </h3>
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className={`shrink-0 text-[9px] ${
                            isReady
                              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600"
                              : session.status === "failed"
                                ? "border-destructive/30 bg-destructive/5 text-destructive"
                                : "border-amber-500/30 bg-amber-500/5 text-amber-600"
                          }`}
                        >
                          {statusLabel}
                        </Badge>
                      </div>

                      <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-lg bg-muted/35 px-2 py-2">
                          <p className="text-xs font-semibold">{totalImages}</p>
                          <p className="text-[9px] text-muted-foreground">
                            Images
                          </p>
                        </div>
                        <div className="rounded-lg bg-muted/35 px-2 py-2">
                          <p className="text-xs font-semibold text-emerald-600">
                            {groups}
                          </p>
                          <p className="text-[9px] text-muted-foreground">
                            Groups
                          </p>
                        </div>
                        <div className="rounded-lg bg-muted/35 px-2 py-2">
                          <p className="text-xs font-semibold text-destructive">
                            {failed}
                          </p>
                          <p className="text-[9px] text-muted-foreground">
                            Failed
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
