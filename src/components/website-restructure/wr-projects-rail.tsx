"use client";

import { useEffect, useRef, useState } from "react";
import { Check, MoreVertical, PanelRight, PanelRightClose, Plus, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type WrPhase, type WrProjectRow } from "@/lib/website-restructure/types";

type ProjectFilter = "active" | "completed";

type WrProjectsRailProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: WrProjectRow[];
  activeProjectId: string;
  filter: ProjectFilter;
  onFilterChange: (filter: ProjectFilter) => void;
  onSelectProject: (id: string) => void;
  onNewProject: () => void;
  onRenameProject: (id: string, name: string) => void;
  onDeleteProject: (id: string) => void;
  onToggleComplete: (id: string, completed: boolean) => void;
  atProjectCap: boolean;
  projectLimit: number;
  canWrite: boolean;
};

const AVATAR_TONES = [
  "bg-rose-400 text-rose-950",
  "bg-violet-400 text-violet-950",
  "bg-amber-400 text-amber-950",
  "bg-sky-400 text-sky-950",
  "bg-emerald-400 text-emerald-950",
];

function projectTone(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash + id.charCodeAt(i) * (i + 1)) % 97;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

const PHASE_LABELS: Record<WrPhase, string> = {
  collecting: "Loading store data",
  awaiting_images: "Awaiting screenshots",
  awaiting_logo: "Awaiting logo",
  awaiting_competitors: "Awaiting competitors",
  building: "Building…",
  editing: "Ready",
  locked: "Edit limit reached",
  failed: "Build failed",
};

function ProjectAvatar({
  project,
  size = "md",
  lit = true,
}: {
  project: WrProjectRow;
  size?: "sm" | "md";
  lit?: boolean;
}) {
  const dim = size === "sm" ? "h-8 w-8" : "h-9 w-9";
  return (
    <div
      className={`${dim} shrink-0 rounded-full ${projectTone(project.id)} flex items-center justify-center shadow-sm transition-[filter,opacity] duration-200 ${
        lit ? "opacity-100" : "opacity-35 grayscale"
      }`}
      aria-hidden
    >
      <span className="text-[10px] font-bold">{project.name.trim().slice(0, 1).toUpperCase() || "H"}</span>
    </div>
  );
}

/** Collapsible projects rail, adapted from Market Research's for a lean
 *  `WrProjectRow` model (no stage number — a phase label instead). */
export function WrProjectsRail({
  open,
  onOpenChange,
  projects,
  activeProjectId,
  filter,
  onFilterChange,
  onSelectProject,
  onNewProject,
  onRenameProject,
  onDeleteProject,
  onToggleComplete,
  atProjectCap,
  projectLimit,
  canWrite,
}: WrProjectsRailProps) {
  const filtered = projects.filter((p) => p.status === filter);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<WrProjectRow | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!renamingId) return;
    const t = window.setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 40);
    return () => window.clearTimeout(t);
  }, [renamingId]);

  const beginRename = (project: WrProjectRow) => {
    setRenamingId(project.id);
    setRenameValue(project.name);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue("");
  };

  const confirmRename = () => {
    if (!renamingId) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      renameInputRef.current?.focus();
      return;
    }
    onRenameProject(renamingId, trimmed);
    cancelRename();
  };

  return (
    <>
      <aside
        className={`autommerce-dashboard relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] [font-family:var(--brand-font)] ${
          open ? "w-[260px]" : "w-[56px]"
        }`}
      >
        <div
          className={`absolute inset-0 flex flex-col items-center gap-3 px-2 py-3 transition-opacity duration-200 ${
            open ? "pointer-events-none opacity-0" : "opacity-100 delay-75"
          }`}
        >
          <button
            type="button"
            onClick={() => onOpenChange(true)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-foreground/90 hover:bg-muted transition-colors"
            title="Open projects"
            aria-label="Open projects sidebar"
          >
            <PanelRight className="h-4 w-4" />
          </button>
          {canWrite ? (
            <button
              type="button"
              onClick={onNewProject}
              disabled={atProjectCap}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-border/80 text-muted-foreground hover:text-foreground hover:border-foreground/30 disabled:opacity-40 transition-colors"
              title={atProjectCap ? "Project limit reached" : "New project"}
              aria-label="New project"
            >
              <Plus className="h-4 w-4" />
            </button>
          ) : null}
          <div className="no-scrollbar mt-1 flex w-full flex-col items-center gap-2 overflow-y-auto overflow-x-hidden">
            {projects.map((project) => {
              const active = project.id === activeProjectId;
              return (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => onSelectProject(project.id)}
                  className="rounded-xl p-0.5 transition-transform hover:scale-105"
                  title={project.name}
                >
                  <ProjectAvatar project={project} size="sm" lit={active} />
                </button>
              );
            })}
          </div>
        </div>

        <div
          className={`flex h-full min-h-0 w-[260px] flex-col transition-opacity duration-200 ${
            open ? "opacity-100 delay-75" : "pointer-events-none opacity-0"
          }`}
        >
          <div className="flex items-center justify-between gap-2 px-3.5 pt-3.5 pb-2 shrink-0">
            <h2 className="text-sm font-black tracking-tight">Projects</h2>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Collapse projects"
              aria-label="Collapse projects sidebar"
            >
              <PanelRightClose className="h-4 w-4" />
            </button>
          </div>

          <div className="flex gap-1.5 px-3.5 pb-3 shrink-0">
            {(["active", "completed"] as const).map((tab) => {
              const selected = filter === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => onFilterChange(tab)}
                  className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                    selected
                      ? "bg-[#400095] text-white dark:bg-[#F76D01]"
                      : "border border-border/70 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab}
                </button>
              );
            })}
          </div>

          {canWrite ? (
            <button
              type="button"
              onClick={onNewProject}
              disabled={atProjectCap}
              className="mx-3.5 mb-2 flex items-center gap-2 rounded-lg px-1.5 py-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors shrink-0"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full border border-border/80">
                <Plus className="h-3.5 w-3.5" />
              </span>
              {atProjectCap ? `Limit ${projectLimit}/${projectLimit}` : "New project"}
            </button>
          ) : null}

          <div className="no-scrollbar flex-1 min-h-0 overflow-y-auto px-2.5 pb-3 space-y-1">
            {filtered.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">No {filter} headers</p>
            ) : (
              filtered.map((project) => {
                const active = project.id === activeProjectId;
                const isRenaming = renamingId === project.id;

                if (isRenaming) {
                  return (
                    <div
                      key={project.id}
                      className="flex w-full items-center gap-2 rounded-2xl border border-border/80 bg-muted/80 px-2 py-2 animate-in fade-in-0 zoom-in-95 duration-200"
                    >
                      <ProjectAvatar project={project} lit />
                      <input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            confirmRename();
                          }
                          if (e.key === "Escape") {
                            e.preventDefault();
                            cancelRename();
                          }
                        }}
                        maxLength={80}
                        className="min-w-0 flex-1 border-b border-foreground/25 bg-transparent pb-0.5 text-sm font-medium outline-none"
                        aria-label="Rename project"
                      />
                      <button
                        type="button"
                        onClick={cancelRename}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                        aria-label="Cancel rename"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={confirmRename}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                        aria-label="Save name"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                }

                return (
                  <div
                    key={project.id}
                    className={`group flex w-full items-center gap-1 rounded-xl pl-2.5 pr-1 py-1.5 transition-colors ${
                      active ? "bg-muted" : "hover:bg-muted/60"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectProject(project.id)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 py-1 text-left"
                    >
                      <ProjectAvatar project={project} lit={active} />
                      <div className="min-w-0 flex-1">
                        <div
                          className={`text-sm font-medium truncate ${
                            active ? "text-foreground" : "text-muted-foreground"
                          }`}
                        >
                          {project.name}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {project.status === "completed" ? "Completed" : PHASE_LABELS[project.phase]}
                        </div>
                      </div>
                    </button>

                    {canWrite ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground opacity-70 hover:bg-background/60 hover:text-foreground group-hover:opacity-100 data-[state=open]:opacity-100 data-[state=open]:bg-background/60"
                            aria-label={`Options for ${project.name}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem onClick={() => beginRename(project)} className="text-xs">
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => onToggleComplete(project.id, project.status !== "completed")}
                            className="text-xs"
                          >
                            {project.status === "completed" ? "Reopen project" : "Mark complete"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setDeleteTarget(project)}
                            className="text-xs text-destructive focus:text-destructive"
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </aside>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this header project?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `“${deleteTarget.name}” and every uploaded image and generated version will be removed. This cannot be undone.`
                : "This project will be removed."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (!deleteTarget) return;
                onDeleteProject(deleteTarget.id);
                if (renamingId === deleteTarget.id) cancelRename();
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
