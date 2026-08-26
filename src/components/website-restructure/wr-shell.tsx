"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2, Plus, Settings, Unplug } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useWorkspace } from "@/hooks/use-workspace";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createWrProjectApi,
  deleteWrProjectApi,
  fetchWrProjects,
  fetchWrSourcesApi,
  fetchWrVersionApi,
  fetchWrVersionsApi,
  patchWrProjectApi,
  putWrStateApi,
  restoreWrVersionApi,
  runWrBuildApi,
  runWrEditApi,
  uploadWrAssetApi,
  deleteWrAssetApi,
  fileToBase64,
  wrDownloadUrl,
  type WrProjectRowWithUrls,
} from "@/lib/website-restructure/client-api";
import {
  WR_DEFAULT_PROJECT_LIMIT,
  WR_MAX_EDIT_MESSAGES,
  type WrBuildResult,
  type WrChatMessage,
} from "@/lib/website-restructure/types";
import { WrProjectsRail } from "./wr-projects-rail";
import { WrChatPanel } from "./wr-chat-panel";
import { WrPreview, type WrVersionSummary } from "./wr-preview";

function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

// The chat column can be dragged narrower for more preview room, but never
// wider than its default — "as open as it gets" is where it starts.
const WR_CHAT_DEFAULT_WIDTH = 440;
const WR_CHAT_MIN_WIDTH = 320;

export function WebsiteRestructureShell() {
  const params = useParams();
  const router = useRouter();
  const slug = params.workspaceSlug as string;
  const basePath = `/w/${slug}`;
  const { user } = useAuth();
  const { workspace, role, hasIntegration, isLoading: wsLoading } = useWorkspace(slug, user);
  const workspaceId = workspace?.id ?? "";
  const canWrite = role !== "viewer";

  const [projects, setProjects] = useState<WrProjectRowWithUrls[]>([]);
  const [projectLimit, setProjectLimit] = useState(WR_DEFAULT_PROJECT_LIMIT);
  const [projectsCreatedTotal, setProjectsCreatedTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [railOpen, setRailOpen] = useState(true);
  const [filter, setFilter] = useState<"active" | "completed">("active");
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);

  const [busy, setBusy] = useState(false);
  const [progressSteps, setProgressSteps] = useState<string[]>([]);
  const [resultByProject, setResultByProject] = useState<Record<string, WrBuildResult>>({});
  const [logoUrlByProject, setLogoUrlByProject] = useState<Record<string, string | null>>({});
  const [versionsByProject, setVersionsByProject] = useState<Record<string, WrVersionSummary[]>>({});
  const sourcesFetchedRef = useRef<Set<string>>(new Set());

  const [chatWidth, setChatWidth] = useState(WR_CHAT_DEFAULT_WIDTH);
  const [isDraggingDivider, setIsDraggingDivider] = useState(false);
  const dragStartRef = useRef({ x: 0, width: WR_CHAT_DEFAULT_WIDTH });

  const handleDividerPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragStartRef.current = { x: e.clientX, width: chatWidth };
      setIsDraggingDivider(true);
      document.body.style.userSelect = "none";
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [chatWidth]
  );

  const handleDividerPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!isDraggingDivider) return;
      const delta = e.clientX - dragStartRef.current.x;
      const next = Math.min(WR_CHAT_DEFAULT_WIDTH, Math.max(WR_CHAT_MIN_WIDTH, dragStartRef.current.width + delta));
      setChatWidth(next);
    },
    [isDraggingDivider]
  );

  const handleDividerPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    setIsDraggingDivider(false);
    document.body.style.userSelect = "";
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const handleDividerDoubleClick = useCallback(() => {
    setChatWidth(WR_CHAT_DEFAULT_WIDTH);
  }, []);

  const reload = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const { projects: rows, projectLimit: limit, projectsCreatedTotal: createdTotal } =
        await fetchWrProjects(workspaceId);
      setProjects(rows);
      setProjectLimit(limit);
      setProjectsCreatedTotal(createdTotal);
      setActiveProjectId((prev) => (prev && rows.some((p) => p.id === prev) ? prev : rows[0]?.id ?? ""));
    } catch (err) {
      toast.error("Failed to load projects", { description: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId]
  );

  const updateProjectLocal = useCallback((id: string, patch: Partial<WrProjectRowWithUrls>) => {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  // Fresh project → fetch store taxonomy/navigation once, which also advances
  // phase "collecting" → "awaiting_images" server-side.
  useEffect(() => {
    if (!activeProject || !workspaceId) return;
    if (activeProject.phase !== "collecting") return;
    if (sourcesFetchedRef.current.has(activeProject.id)) return;
    sourcesFetchedRef.current.add(activeProject.id);
    fetchWrSourcesApi(workspaceId, activeProject.id)
      .then(() => {
        updateProjectLocal(activeProject.id, { phase: "awaiting_images" });
      })
      .catch((err) => {
        sourcesFetchedRef.current.delete(activeProject.id);
        toast.error("Could not load store categories", { description: (err as Error).message });
      });
  }, [activeProject, workspaceId, updateProjectLocal]);

  // Load the active version's code once a project reaches editing/locked/failed
  // (i.e. it has built at least once) and it isn't already in memory.
  useEffect(() => {
    if (!activeProject || !workspaceId) return;
    if (activeProject.activeVersion <= 0) return;
    if (resultByProject[activeProject.id]) return;
    fetchWrVersionApi(workspaceId, activeProject.id, activeProject.activeVersion)
      .then(({ version, logoUrl }) => {
        setResultByProject((prev) => ({ ...prev, [activeProject.id]: version.result }));
        setLogoUrlByProject((prev) => ({ ...prev, [activeProject.id]: logoUrl }));
      })
      .catch((err) => {
        console.error("[website-restructure] failed to load version:", err);
      });
  }, [activeProject, workspaceId, resultByProject]);

  const refreshVersions = useCallback(
    async (projectId: string) => {
      try {
        const res = await fetchWrVersionsApi(workspaceId, projectId);
        setVersionsByProject((prev) => ({ ...prev, [projectId]: res.versions }));
      } catch {
        // Non-critical — the version switcher just won't show history.
      }
    },
    [workspaceId]
  );

  const activeProjectId_ = activeProject?.id;
  const activeProjectVersion_ = activeProject?.activeVersion;
  useEffect(() => {
    if (activeProjectId_ && activeProjectVersion_ && activeProjectVersion_ > 0) {
      void refreshVersions(activeProjectId_);
    }
  }, [activeProjectId_, activeProjectVersion_, refreshVersions]);

  const persistState = useCallback(
    async (projectId: string, state: WrProjectRowWithUrls["state"]) => {
      updateProjectLocal(projectId, { state });
      try {
        await putWrStateApi(workspaceId, projectId, {
          chat: state.chat,
          images: state.images,
          logo: state.logo,
          competitors: state.competitors,
          competitorsSkipped: state.competitorsSkipped,
        });
      } catch (err) {
        toast.error("Failed to save", { description: (err as Error).message });
      }
    },
    [workspaceId, updateProjectLocal]
  );

  const atProjectCap = projectsCreatedTotal >= projectLimit;

  const handleNewProject = () => {
    if (atProjectCap) {
      toast.error("Limit reached", {
        description: `Your plan allows up to ${projectLimit} header project${projectLimit === 1 ? "" : "s"} in total. Upgrade your plan to create more.`,
      });
      return;
    }
    setCreateName("");
    setCreateOpen(true);
  };

  const handleCreateProject = async () => {
    // Guards against a double-fire: hitting Enter in the input and then also
    // clicking "Create" (or a fast double-click) before the dialog has a
    // chance to close, which used to send two POSTs and create two projects.
    if (creatingProject) return;
    setCreatingProject(true);
    const name = createName.trim() || "New header";
    try {
      const project = await createWrProjectApi(workspaceId, name);
      setCreateOpen(false);
      await reload();
      setActiveProjectId(project.id);
    } catch (err) {
      toast.error("Failed to create project", { description: (err as Error).message });
    } finally {
      setCreatingProject(false);
    }
  };

  const handleDeleteProject = async (id: string) => {
    try {
      await deleteWrProjectApi(workspaceId, id);
      setResultByProject((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await reload();
    } catch (err) {
      toast.error("Failed to delete project", { description: (err as Error).message });
    }
  };

  const handleRenameProject = async (id: string, name: string) => {
    updateProjectLocal(id, { name });
    try {
      await patchWrProjectApi(workspaceId, id, { name });
    } catch (err) {
      toast.error("Failed to rename", { description: (err as Error).message });
    }
  };

  const handleToggleComplete = async (id: string, completed: boolean) => {
    updateProjectLocal(id, { status: completed ? "completed" : "active" });
    try {
      await patchWrProjectApi(workspaceId, id, { status: completed ? "completed" : "active" });
    } catch (err) {
      toast.error("Failed to update project", { description: (err as Error).message });
    }
  };

  const withProject = (fn: (p: WrProjectRowWithUrls) => Promise<void>) => {
    if (!activeProject) return;
    void fn(activeProject);
  };

  const handleUploadImages = (files: File[]) => {
    withProject(async (project) => {
      for (const file of files) {
        try {
          const dataBase64 = await fileToBase64(file);
          const res = await uploadWrAssetApi({
            workspaceId,
            projectId: project.id,
            kind: "image",
            filename: file.name,
            mimeType: file.type || "image/jpeg",
            dataBase64,
          });
          setProjects((prev) =>
            prev.map((p) =>
              p.id === project.id
                ? {
                    ...p,
                    state: {
                      ...p.state,
                      images: [...p.state.images, res.asset],
                      imageUrls: { ...p.state.imageUrls, [res.asset.id]: res.url ?? "" },
                    },
                  }
                : p
            )
          );
        } catch (err) {
          toast.error("Upload failed", { description: (err as Error).message });
        }
      }
    });
  };

  const handleDeleteImage = (imageId: string) => {
    withProject(async (project) => {
      try {
        await deleteWrAssetApi({ workspaceId, projectId: project.id, kind: "image", imageId });
        updateProjectLocal(project.id, {
          state: { ...project.state, images: project.state.images.filter((img) => img.id !== imageId) },
        });
      } catch (err) {
        toast.error("Failed to remove image", { description: (err as Error).message });
      }
    });
  };

  const handleUploadLogo = (file: File) => {
    withProject(async (project) => {
      try {
        const dataBase64 = await fileToBase64(file);
        const res = await uploadWrAssetApi({
          workspaceId,
          projectId: project.id,
          kind: "logo",
          filename: file.name,
          mimeType: file.type || "image/png",
          dataBase64,
        });
        setProjects((prev) =>
          prev.map((p) =>
            p.id === project.id
              ? {
                  ...p,
                  state: {
                    ...p.state,
                    logo: res.asset,
                    imageUrls: { ...p.state.imageUrls, [res.asset.id]: res.url ?? "" },
                  },
                }
              : p
          )
        );
      } catch (err) {
        toast.error("Upload failed", { description: (err as Error).message });
      }
    });
  };

  const handleDeleteLogo = () => {
    withProject(async (project) => {
      try {
        await deleteWrAssetApi({ workspaceId, projectId: project.id, kind: "logo" });
        updateProjectLocal(project.id, { state: { ...project.state, logo: null } });
      } catch (err) {
        toast.error("Failed to remove logo", { description: (err as Error).message });
      }
    });
  };

  const handleDoneWithImages = () => {
    withProject(async (project) => {
      try {
        await patchWrProjectApi(workspaceId, project.id, { phase: "awaiting_logo" });
        updateProjectLocal(project.id, { phase: "awaiting_logo" });
      } catch (err) {
        toast.error("Failed to continue", { description: (err as Error).message });
      }
    });
  };

  const handleDoneWithLogo = () => {
    withProject(async (project) => {
      try {
        await patchWrProjectApi(workspaceId, project.id, { phase: "awaiting_competitors" });
        updateProjectLocal(project.id, { phase: "awaiting_competitors" });
      } catch (err) {
        toast.error("Failed to continue", { description: (err as Error).message });
      }
    });
  };

  const handleAddCompetitor = (raw: string) => {
    withProject(async (project) => {
      const next = { ...project.state, competitors: [...project.state.competitors, { raw }] };
      await persistState(project.id, next);
    });
  };

  const handleRemoveCompetitor = (index: number) => {
    withProject(async (project) => {
      const next = { ...project.state, competitors: project.state.competitors.filter((_, i) => i !== index) };
      await persistState(project.id, next);
    });
  };

  const handleStartBuild = (skipCompetitors: boolean) => {
    withProject(async (project) => {
      if (skipCompetitors && !project.state.competitorsSkipped) {
        await persistState(project.id, { ...project.state, competitorsSkipped: true });
      }
      setBusy(true);
      setProgressSteps([]);
      try {
        await runWrBuildApi({ workspaceId, projectId: project.id }, (event) => {
          if (event.type === "status") setProgressSteps((prev) => [...prev, event.message]);
          else if (event.type === "version") {
            setResultByProject((prev) => ({ ...prev, [project.id]: event.data.result }));
            setLogoUrlByProject((prev) => ({ ...prev, [project.id]: event.logoUrl }));
            updateProjectLocal(project.id, { phase: "editing", activeVersion: event.data.version, lastError: null });
            void refreshVersions(project.id);
            toast.success("Your header is ready");
          } else if (event.type === "error") {
            updateProjectLocal(project.id, { phase: "failed", lastError: event.error });
            toast.error("Build failed", { description: event.error });
          }
        });
      } catch (err) {
        updateProjectLocal(project.id, { phase: "failed", lastError: (err as Error).message });
        toast.error("Build failed", { description: (err as Error).message });
      } finally {
        setBusy(false);
      }
    });
  };

  const handleSendEdit = (instruction: string) => {
    withProject(async (project) => {
      setBusy(true);
      setProgressSteps([]);
      const userMessage: WrChatMessage = { id: newId(), role: "user", text: instruction };
      updateProjectLocal(project.id, { state: { ...project.state, chat: [...project.state.chat, userMessage] } });
      try {
        await runWrEditApi({ workspaceId, projectId: project.id, instruction }, (event) => {
          if (event.type === "status") setProgressSteps((prev) => [...prev, event.message]);
          else if (event.type === "version") {
            setResultByProject((prev) => ({ ...prev, [project.id]: event.data.result }));
            setLogoUrlByProject((prev) => ({ ...prev, [project.id]: event.logoUrl }));
            const agentMessage: WrChatMessage = {
              id: newId(),
              role: "agent",
              text: event.data.notes || "Updated your header.",
            };
            updateProjectLocal(project.id, {
              activeVersion: event.data.version,
              editMessagesUsed: event.editMessagesUsed ?? project.editMessagesUsed + 1,
              phase:
                (event.editMessagesUsed ?? project.editMessagesUsed + 1) >= WR_MAX_EDIT_MESSAGES
                  ? "locked"
                  : "editing",
              state: { ...project.state, chat: [...project.state.chat, userMessage, agentMessage] },
            });
            void refreshVersions(project.id);
          } else if (event.type === "error") {
            const errorMessage: WrChatMessage = { id: newId(), role: "agent", text: event.error, isError: true };
            updateProjectLocal(project.id, {
              state: { ...project.state, chat: [...project.state.chat, userMessage, errorMessage] },
            });
            toast.error("Edit failed", { description: event.error });
          }
        });
      } catch (err) {
        toast.error("Edit failed", { description: (err as Error).message });
      } finally {
        setBusy(false);
      }
    });
  };

  const handleSelectVersion = (version: number) => {
    withProject(async (project) => {
      try {
        await restoreWrVersionApi(workspaceId, project.id, version);
        const { version: v, logoUrl } = await fetchWrVersionApi(workspaceId, project.id, version);
        setResultByProject((prev) => ({ ...prev, [project.id]: v.result }));
        setLogoUrlByProject((prev) => ({ ...prev, [project.id]: logoUrl }));
        updateProjectLocal(project.id, { activeVersion: version });
      } catch (err) {
        toast.error("Failed to restore version", { description: (err as Error).message });
      }
    });
  };

  if (wsLoading || loading) {
    return (
      <div className="autommerce-dashboard flex h-full min-h-0 items-center justify-center [font-family:var(--brand-font)]">
        <Loader2 className="h-5 w-5 animate-spin text-[#6B358D] dark:text-[#F76D01]" />
      </div>
    );
  }

  if (!hasIntegration) {
    return (
      <div className="autommerce-dashboard flex h-full min-h-0 items-center justify-center p-8 [font-family:var(--brand-font)]">
        <div className="max-w-md text-center space-y-6">
          <div className="mx-auto h-16 w-16 rounded-2xl bg-gradient-to-br from-[#400095]/10 to-[#F76D01]/10 flex items-center justify-center">
            <Unplug className="h-8 w-8 text-[#6B358D] dark:text-[#F76D01]" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-black">Integration Required</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Website Restructure reads your store&apos;s real categories and navigation to build the header, so
              connect a platform in Settings before it can start.
            </p>
          </div>
          <Button
            onClick={() => router.push(`${basePath}/settings`)}
            className="gap-2 rounded-xl bg-[#400095] text-white hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
          >
            <Settings className="h-4 w-4" />
            Go to Settings
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="autommerce-dashboard flex h-full min-h-0 w-full gap-3 p-3 [font-family:var(--brand-font)]">
      <div
        className="wr-shell-frame min-h-0 flex-1 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm"
        style={{ "--wr-chat-w": `${chatWidth}px` } as CSSProperties}
      >
        {activeProject ? (
          <>
            <div className="min-h-0 overflow-hidden border-b border-border/60 md:border-b-0">
              <WrChatPanel
                project={activeProject}
                canWrite={canWrite}
                busy={busy}
                progressSteps={progressSteps}
                onUploadImages={handleUploadImages}
                onDeleteImage={handleDeleteImage}
                onUploadLogo={handleUploadLogo}
                onDeleteLogo={handleDeleteLogo}
                onDoneWithImages={handleDoneWithImages}
                onDoneWithLogo={handleDoneWithLogo}
                onAddCompetitor={handleAddCompetitor}
                onRemoveCompetitor={handleRemoveCompetitor}
                onStartBuild={handleStartBuild}
                onSendEdit={handleSendEdit}
              />
            </div>

            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize chat panel"
              className={`wr-resize-handle hidden md:block ${isDraggingDivider ? "is-dragging" : ""}`}
              onPointerDown={handleDividerPointerDown}
              onPointerMove={handleDividerPointerMove}
              onPointerUp={handleDividerPointerUp}
              onDoubleClick={handleDividerDoubleClick}
              title="Drag to resize, double-click to reset"
            />

            <div className="min-h-0 overflow-hidden">
              <WrPreview
                result={resultByProject[activeProject.id] ?? null}
                logoUrl={logoUrlByProject[activeProject.id] ?? null}
                versions={versionsByProject[activeProject.id] ?? []}
                activeVersion={activeProject.activeVersion}
                onSelectVersion={handleSelectVersion}
                downloadUrl={wrDownloadUrl(workspaceId, activeProject.id, activeProject.activeVersion)}
                busy={busy}
              />
            </div>
          </>
        ) : (
          <div className="col-span-full flex flex-col items-center justify-center gap-3 p-8 text-center">
            <h2 className="text-base font-black">Build a new storefront header</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              Upload a few screenshots of your current header and I&apos;ll design a new one from your store&apos;s
              real categories and navigation.
            </p>
            {canWrite ? (
              <Button
                onClick={handleNewProject}
                disabled={atProjectCap}
                className="rounded-xl bg-[#400095] text-white hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
              >
                <Plus className="h-4 w-4" />
                New header project
              </Button>
            ) : null}
          </div>
        )}
      </div>

      <WrProjectsRail
        open={railOpen}
        onOpenChange={setRailOpen}
        projects={projects}
        activeProjectId={activeProjectId}
        filter={filter}
        onFilterChange={setFilter}
        onSelectProject={setActiveProjectId}
        onNewProject={handleNewProject}
        onRenameProject={handleRenameProject}
        onDeleteProject={handleDeleteProject}
        onToggleComplete={handleToggleComplete}
        atProjectCap={atProjectCap}
        projectLimit={projectLimit}
        canWrite={canWrite}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-black">Name this header project</DialogTitle>
            <DialogDescription>You can rename it later from the projects list.</DialogDescription>
          </DialogHeader>
          <Input
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder="e.g. New homepage header"
            maxLength={120}
            disabled={creatingProject}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleCreateProject();
              }
            }}
            autoFocus
            className="rounded-xl"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creatingProject}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleCreateProject()}
              disabled={creatingProject}
              className="rounded-xl bg-[#400095] text-white hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
            >
              {creatingProject ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
