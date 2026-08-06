"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Boxes,
  Check,
  Clock3,
  Cloud,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FolderOpen,
  ImageIcon,
  Loader2,
  Maximize2,
  Plus,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceContext } from "../layout";
import { useRole } from "@/hooks/use-role";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  createVisualizerSession,
  deleteVisualizerSession,
  deleteVisualizerAsset,
  exportVisualizer,
  generateVisualizerDescriptions,
  generateVisualizerImages,
  getVisualizerSession,
  listVisualizerSessions,
  requestVisualizerGenerationStop,
  saveVisualizerSettings,
  uploadVisualizerAsset,
  VisualizerApiError,
} from "@/lib/visualizer/client";
import { resolveVisualizerHtmlImages } from "@/lib/visualizer/html-embed";
import { productDisplayName } from "@/lib/visualizer/row-fields";
import {
  DescriptionLayoutDialog,
  LayoutSettingsButton,
} from "@/components/visualizer/description-layout-dialog";
import {
  DEFAULT_VISUALIZER_SETTINGS,
  type VisualizerProjectSettings,
  type VisualizerRow,
  type VisualizerSession,
  type VisualizerSessionStatus,
  type VisualizerWorksheetJson,
} from "@/lib/visualizer/types";

const STATUS_LABEL: Record<VisualizerSessionStatus, string> = {
  draft: "Draft",
  ready: "Ready",
  processing: "Processing",
  paused: "Paused",
  completed: "Completed",
  failed: "Failed",
};

const RESULT_DESCRIPTION = "\u0000visualizer:description";
const RESULT_IMAGES = "\u0000visualizer:images";

function descriptionSnippet(html: string | undefined, maxWords = 5): string {
  if (!html?.trim()) return "";
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  const words = text.split(" ").filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function ConfigSelect({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-full rounded-md border bg-background px-2.5 text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

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

function rowProductLabel(
  row: VisualizerRow,
  settings: VisualizerProjectSettings
): string {
  return productDisplayName(row, settings);
}

function rowStatusTone(status: VisualizerRow["status"]): string {
  switch (status) {
    case "description_ready":
    case "images_ready":
      return "bg-emerald-500/10 text-emerald-700";
    case "generating":
      return "bg-amber-500/10 text-amber-700";
    case "failed":
      return "bg-destructive/10 text-destructive";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export default function ProductsVisualizerPage() {
  const { workspace, role } = useWorkspaceContext();
  const { canEdit, canAdmin } = useRole(role);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project");

  const [sessions, setSessions] = useState<VisualizerSession[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [projectSearch, setProjectSearch] = useState("");
  const [projectStatusFilter, setProjectStatusFilter] = useState("all");
  const [projectDateFilter, setProjectDateFilter] =
    useState<ProjectDateFilter>("all");
  const [projectSort, setProjectSort] =
    useState<ProjectSortOption>("updated_desc");
  const [projectPage, setProjectPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<VisualizerSession | null>(null);
  const [deletingProject, setDeletingProject] = useState(false);

  const [session, setSession] = useState<VisualizerSession | null>(null);
  const [worksheet, setWorksheet] = useState<VisualizerWorksheetJson | null>(null);
  const [loadingProject, setLoadingProject] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "dirty" | "saving" | "saved" | "error">(
    "idle"
  );
  const [settings, setSettings] = useState<VisualizerProjectSettings>(
    DEFAULT_VISUALIZER_SETTINGS
  );
  const [generating, setGenerating] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [reviewRowId, setReviewRowId] = useState<string | null>(null);
  const [reviewTab, setReviewTab] = useState<"preview" | "html" | "briefs">(
    "preview"
  );
  const [imageDialogRowId, setImageDialogRowId] = useState<string | null>(null);
  const [imagePreviewKey, setImagePreviewKey] = useState<string | null>(null);
  const [layoutDialogOpen, setLayoutDialogOpen] = useState(false);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [generationRun, setGenerationRun] = useState<{
    total: number;
    completed: number;
    runId?: string;
  } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [tableScrollWidth, setTableScrollWidth] = useState(0);
  const [tableViewportWidth, setTableViewportWidth] = useState(0);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const stickyScrollRef = useRef<HTMLDivElement>(null);
  const settingsRevisionRef = useRef(0);
  const worksheetRevisionRef = useRef(0);
  const settingsRef = useRef(settings);
  const sessionRef = useRef(session);
  const worksheetRef = useRef(worksheet);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  useEffect(() => {
    worksheetRef.current = worksheet;
  }, [worksheet]);
  useEffect(() => {
    settingsRevisionRef.current = Number(session?.settings_revision ?? 0);
    worksheetRevisionRef.current = Number(session?.worksheet_revision ?? 0);
  }, [session?.settings_revision, session?.worksheet_revision]);

  const openProject = useCallback(
    (sessionId: string) => {
      router.push(`${pathname}?project=${encodeURIComponent(sessionId)}`);
    },
    [pathname, router]
  );

  const closeProject = useCallback(() => {
    router.push(pathname);
  }, [pathname, router]);

  const loadSessions = useCallback(async () => {
    if (!workspace?.id) return;
    setLoadingList(true);
    try {
      const result = await listVisualizerSessions(workspace.id);
      setSessions(result.sessions);
    } catch (error) {
      toast.error(
        error instanceof VisualizerApiError
          ? error.message
          : "Failed to load projects"
      );
    } finally {
      setLoadingList(false);
    }
  }, [workspace?.id]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const loadProject = useCallback(async () => {
    if (!workspace?.id || !projectId) {
      setSession(null);
      setWorksheet(null);
      setSignedUrls({});
      return;
    }
    setLoadingProject(true);
    try {
      const result = await getVisualizerSession(workspace.id, projectId, {
        includeSignedUrls: true,
      });
      setSession(result.session);
      setWorksheet(result.worksheet);
      setSettings(result.session.settings || DEFAULT_VISUALIZER_SETTINGS);
      setSignedUrls(result.signedUrls || {});
      settingsRevisionRef.current = Number(
        result.session.settings_revision ?? 0
      );
      worksheetRevisionRef.current = Number(
        result.session.worksheet_revision ?? 0
      );
      setSaveStatus("saved");
    } catch (error) {
      toast.error(
        error instanceof VisualizerApiError
          ? error.message
          : "Failed to open project"
      );
      closeProject();
    } finally {
      setLoadingProject(false);
    }
  }, [closeProject, projectId, workspace?.id]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

  useEffect(() => {
    setSelectedRowIds(new Set());
    setReviewRowId(null);
    setGenerationRun(null);
  }, [projectId]);

  useEffect(() => {
    if (!reviewRowId || !worksheet) return;
    if (!worksheet.rows.some((row) => row.id === reviewRowId)) {
      setReviewRowId(null);
    }
  }, [reviewRowId, worksheet]);

  const shouldPollGeneration = generating || generationRun !== null;
  useEffect(() => {
    if (!workspace?.id || !projectId || !shouldPollGeneration) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const pollProgress = async () => {
      try {
        const fresh = await getVisualizerSession(workspace.id, projectId, {
          includeSignedUrls: false,
        });
        if (cancelled || !fresh.worksheet) return;
        setSession(fresh.session);
        setWorksheet(fresh.worksheet);
        if (fresh.signedUrls) setSignedUrls(fresh.signedUrls);
        const run = fresh.worksheet.activeRun;
        if (run && (run.status === "running" || run.status === "queued")) {
          setGenerationRun({
            total: run.total,
            completed: run.completed + run.failed,
            runId: run.id,
          });
          if (fresh.session.cancel_requested) setStopping(true);
        } else if (!generating) {
          setGenerationRun(null);
          setStopping(false);
        }
      } catch {
        // Next poll or final generate response recovers.
      } finally {
        if (!cancelled) timer = setTimeout(pollProgress, 750);
      }
    };

    timer = setTimeout(pollProgress, 250);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [generating, projectId, shouldPollGeneration, workspace?.id]);

  const projectStats = useMemo(
    () => ({
      total: sessions.length,
      ready: sessions.filter(
        (item) => item.status === "ready" || item.status === "completed"
      ).length,
      processing: sessions.filter((item) => item.status === "processing").length,
      products: sessions.reduce((sum, item) => sum + (item.total_rows || 0), 0),
    }),
    [sessions]
  );

  const filteredProjects = useMemo(() => {
    const query = projectSearch.trim().toLowerCase();
    const filtered = sessions.filter((item) => {
      const matchesSearch =
        !query ||
        item.name.toLowerCase().includes(query) ||
        item.source_file_name.toLowerCase().includes(query);
      if (!matchesSearch) return false;

      if (projectStatusFilter === "ready") {
        if (!(item.status === "ready" || item.status === "completed")) {
          return false;
        }
      } else if (projectStatusFilter !== "all") {
        if (item.status !== projectStatusFilter) return false;
      }

      return matchesProjectDateFilter(
        item.updated_at || item.created_at,
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

  const createProject = async () => {
    if (!workspace || !canEdit || !projectName.trim() || !uploadFile) return;
    setCreating(true);
    try {
      const result = await createVisualizerSession({
        workspaceId: workspace.id,
        name: projectName.trim(),
        file: uploadFile,
      });
      setShowCreate(false);
      setProjectName("");
      setUploadFile(null);
      await loadSessions();
      openProject(result.session.id);
      toast.success("Project created");
    } catch (error) {
      toast.error(
        error instanceof VisualizerApiError
          ? error.message
          : "Failed to create project"
      );
    } finally {
      setCreating(false);
    }
  };

  const deleteProject = async () => {
    if (!workspace || !deleteTarget) return;
    setDeletingProject(true);
    try {
      await deleteVisualizerSession({
        workspaceId: workspace.id,
        sessionId: deleteTarget.id,
      });
      setDeleteTarget(null);
      if (projectId === deleteTarget.id) closeProject();
      await loadSessions();
      toast.success("Project deleted");
    } catch (error) {
      toast.error(
        error instanceof VisualizerApiError
          ? error.message
          : "Failed to delete project"
      );
    } finally {
      setDeletingProject(false);
    }
  };

  const updateDescriptionTier = (tier: "standard" | "premium") => {
    setSettings((current) => ({
      ...current,
      description: { ...current.description, tier },
    }));
    setSaveStatus("dirty");
  };

  const updateDescriptionField = <
    K extends keyof VisualizerProjectSettings["description"],
  >(
    key: K,
    value: VisualizerProjectSettings["description"][K]
  ) => {
    setSettings((current) => ({
      ...current,
      description: { ...current.description, [key]: value },
    }));
    setSaveStatus("dirty");
  };

  const updateImagesField = <K extends keyof VisualizerProjectSettings["images"]>(
    key: K,
    value: VisualizerProjectSettings["images"][K]
  ) => {
    setSettings((current) => {
      const images = { ...current.images, [key]: value };
      const brand =
        key === "brandColors" && Array.isArray(value)
          ? {
              ...current.brand,
              colorPrimary: String(value[0] || current.brand.colorPrimary),
              colorSecondary: String(value[1] || current.brand.colorSecondary),
            }
          : current.brand;
      return { ...current, images, brand };
    });
    setSaveStatus("dirty");
  };

  const selectedColumnSet = useMemo(
    () => new Set(settings.selectedColumns),
    [settings.selectedColumns]
  );

  const productColumns = useMemo(() => {
    if (!worksheet) return [];
    const imageColumn = settings.productImageColumn;
    return worksheet.columns.filter(
      (column) => !(imageColumn && column === imageColumn)
    );
  }, [settings.productImageColumn, worksheet]);

  const toggleColumn = (column: string) => {
    if (settings.productImageColumn && column === settings.productImageColumn) {
      return;
    }
    setSettings((current) => {
      const next = new Set(current.selectedColumns);
      if (next.has(column)) next.delete(column);
      else next.add(column);
      return {
        ...current,
        columnsSelectionExplicit: true,
        selectedColumns: productColumns.filter((item) => next.has(item)),
      };
    });
    setSaveStatus("dirty");
  };

  const toggleAllColumns = () => {
    if (!worksheet || productColumns.length === 0) return;
    setSettings((current) => {
      const allSelected = productColumns.every((column) =>
        current.selectedColumns.includes(column)
      );
      return {
        ...current,
        columnsSelectionExplicit: true,
        selectedColumns: allSelected ? [] : [...productColumns],
      };
    });
    setSaveStatus("dirty");
  };

  const sampleForColumn = (column: string) => {
    const sample = worksheet?.rows
      .map((row) => String(row.originalData[column] ?? "").trim())
      .find(Boolean);
    return sample ? sample.slice(0, 80) : "Empty sample";
  };

  const logoInputRef = useRef<HTMLInputElement>(null);
  const brandGuideInputRef = useRef<HTMLInputElement>(null);
  const [assetBusy, setAssetBusy] = useState<"logo" | "brandGuide" | null>(
    null
  );

  const handleAssetUpload = async (
    kind: "logo" | "brandGuide",
    file: File | null
  ) => {
    if (!workspace || !session || !file || !canEdit) return;
    setAssetBusy(kind);
    try {
      // Send the current UI settings with the upload so layout/branding are not
      // overwritten by a stale DB copy. Keep the UI on the same local settings.
      const uiSettings = {
        ...settingsRef.current,
        images: {
          ...settingsRef.current.images,
          brandingEnabled: true,
        },
      };
      const result = await uploadVisualizerAsset({
        workspaceId: workspace.id,
        sessionId: session.id,
        kind,
        file,
        settings: uiSettings,
      });
      const pathKey = kind === "logo" ? "logoPath" : "brandGuidePath";
      setSettings((current) => {
        const next = {
          ...current,
          images: {
            ...current.images,
            brandingEnabled: true,
            [pathKey]: result.path,
          },
        };
        settingsRef.current = next;
        return next;
      });
      setSession((current) =>
        current
          ? {
              ...current,
              settings_revision: Number(
                result.session.settings_revision ?? current.settings_revision
              ),
            }
          : current
      );
      settingsRevisionRef.current = Number(
        result.session.settings_revision ?? settingsRevisionRef.current
      );
      setSignedUrls((current) => ({ ...current, ...result.signedUrls }));
      // Settings (layout, etc.) were synced with the asset write.
      setSaveStatus("saved");
      toast.success("Reference image uploaded");
    } catch (error) {
      toast.error(
        error instanceof VisualizerApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Upload failed"
      );
    } finally {
      setAssetBusy(null);
    }
  };

  const handleAssetDelete = async (kind: "logo" | "brandGuide") => {
    if (!workspace || !session || !canEdit) return;
    setAssetBusy(kind);
    try {
      const result = await deleteVisualizerAsset({
        workspaceId: workspace.id,
        sessionId: session.id,
        kind,
        settings: settingsRef.current,
      });
      const pathKey = kind === "logo" ? "logoPath" : "brandGuidePath";
      setSettings((current) => {
        const next = {
          ...current,
          images: {
            ...current.images,
            [pathKey]: null,
          },
        };
        settingsRef.current = next;
        return next;
      });
      setSession((current) =>
        current
          ? {
              ...current,
              settings_revision: Number(
                result.session.settings_revision ?? current.settings_revision
              ),
            }
          : current
      );
      settingsRevisionRef.current = Number(
        result.session.settings_revision ?? settingsRevisionRef.current
      );
      setSaveStatus("saved");
      toast.success("Reference image removed");
    } catch (error) {
      toast.error(
        error instanceof VisualizerApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Remove failed"
      );
    } finally {
      setAssetBusy(null);
    }
  };

  const persistSettings = async (options?: { silent?: boolean }) => {
    if (!workspace || !sessionRef.current || !worksheetRef.current || !canEdit) {
      return null;
    }
    setSaveStatus("saving");
    const attemptSave = async () => {
      const activeSession = sessionRef.current!;
      const activeWorksheet = worksheetRef.current!;
      const activeSettings = settingsRef.current;
      return saveVisualizerSettings({
        workspaceId: workspace.id,
        sessionId: activeSession.id,
        expectedRevision: settingsRevisionRef.current,
        expectedWorksheetRevision: worksheetRevisionRef.current,
        settings: activeSettings,
        worksheet: {
          ...activeWorksheet,
          settings: activeSettings,
        },
      });
    };

    try {
      let result;
      try {
        result = await attemptSave();
      } catch (error) {
        // Revision / sync mismatch: refresh session and retry once with current UI settings.
        const message =
          error instanceof VisualizerApiError ? error.message : "";
        if (
          error instanceof VisualizerApiError &&
          error.status === 409 &&
          /synchroniz|changed|reload/i.test(message)
        ) {
          const fresh = await getVisualizerSession(
            workspace.id,
            sessionRef.current!.id,
            {
              includeSignedUrls: false,
            }
          );
          settingsRevisionRef.current = Number(
            fresh.session.settings_revision ?? 0
          );
          worksheetRevisionRef.current = Number(
            fresh.session.worksheet_revision ?? 0
          );
          setSession((current) =>
            current
              ? {
                  ...current,
                  settings_revision: settingsRevisionRef.current,
                  worksheet_revision: worksheetRevisionRef.current,
                }
              : fresh.session
          );
          if (fresh.worksheet) {
            const syncedWorksheet: VisualizerWorksheetJson = {
              ...fresh.worksheet,
              settings: settingsRef.current,
            };
            setWorksheet((current) =>
              current
                ? {
                    ...current,
                    revision: syncedWorksheet.revision,
                    rows: syncedWorksheet.rows,
                    columns: syncedWorksheet.columns,
                    // Keep the user's current settings in the worksheet object.
                    settings: settingsRef.current,
                  }
                : syncedWorksheet
            );
            worksheetRef.current = syncedWorksheet;
          }
          // Brief pause when storage is still catching up.
          if (/synchroniz/i.test(message)) {
            await new Promise((resolve) => setTimeout(resolve, 600));
          }
          result = await attemptSave();
        } else {
          throw error;
        }
      }

      setSession(result.session);
      setWorksheet(result.worksheet);
      // Prefer the settings we just saved (already parsed on server).
      setSettings(result.settings);
      settingsRef.current = result.settings;
      worksheetRef.current = result.worksheet;
      sessionRef.current = result.session;
      settingsRevisionRef.current = Number(
        result.session.settings_revision ?? 0
      );
      worksheetRevisionRef.current = Number(
        result.session.worksheet_revision ?? 0
      );
      setSaveStatus("saved");
      if (!options?.silent) toast.success("Settings saved");
      return result;
    } catch (error) {
      setSaveStatus("error");
      toast.error(
        error instanceof VisualizerApiError ? error.message : "Save failed"
      );
      return null;
    }
  };

  const settingsReady =
    settings.selectedColumns.length > 0 && !!settings.productImageColumn;

  const rows = useMemo(() => worksheet?.rows ?? [], [worksheet?.rows]);

  const displayColumns = useMemo(() => {
    if (!worksheet) return [RESULT_DESCRIPTION, RESULT_IMAGES];
    const productImage =
      settings.productImageColumn &&
      worksheet.columns.includes(settings.productImageColumn)
        ? settings.productImageColumn
        : null;
    return [
      RESULT_DESCRIPTION,
      RESULT_IMAGES,
      ...(productImage ? [productImage] : []),
      ...worksheet.columns.filter((column) => column !== productImage),
    ];
  }, [settings.productImageColumn, worksheet]);

  const tableMinWidthPx = useMemo(
    () => Math.max(900, 56 + displayColumns.length * 160),
    [displayColumns.length]
  );

  useEffect(() => {
    const viewport = tableScrollRef.current;
    if (!viewport) return;
    const measure = () => {
      setTableScrollWidth(viewport.scrollWidth);
      setTableViewportWidth(viewport.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    const table = viewport.querySelector("table");
    if (table) observer.observe(table);
    return () => observer.disconnect();
  }, [displayColumns, rows.length, projectId]);

  const allRowsSelected =
    rows.length > 0 && rows.every((row) => selectedRowIds.has(row.id));

  const toggleRow = (rowId: string) => {
    setSelectedRowIds((current) => {
      const next = new Set(current);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  const toggleAllRows = () => {
    setSelectedRowIds((current) => {
      if (rows.length > 0 && rows.every((row) => current.has(row.id))) {
        return new Set();
      }
      return new Set(rows.map((row) => row.id));
    });
  };

  const selectedDescriptionTargets = useMemo(() => {
    return rows
      .filter(
        (row) =>
          selectedRowIds.has(row.id) &&
          (row.status === "not_started" ||
            row.status === "failed" ||
            row.status === "description_ready" ||
            row.status === "images_ready")
      )
      .map((row) => row.id);
  }, [rows, selectedRowIds]);

  const selectedImageTargets = useMemo(() => {
    return rows
      .filter(
        (row) =>
          selectedRowIds.has(row.id) &&
          !!row.generatedDescription &&
          (row.imagePlaceholders?.length ?? 0) > 0 &&
          (row.status === "description_ready" ||
            row.status === "images_ready" ||
            (row.status === "failed" && !!row.generatedDescription))
      )
      .map((row) => row.id);
  }, [rows, selectedRowIds]);

  const imagesReadyCount = useMemo(() => {
    return rows.filter((row) => row.status === "images_ready").length;
  }, [rows]);

  const columnLabel = (column: string) => {
    if (column === RESULT_DESCRIPTION) return "AI Description";
    if (column === RESULT_IMAGES) return "Generated Images";
    return column;
  };

  const prepareRunSession = async () => {
    if (!workspace || !session || !worksheet) return null;
    let activeSession = session;
    let activeWorksheet = { ...worksheet, settings: settingsRef.current };
    let activeSettings = settingsRef.current;
    if (saveStatus === "dirty" || saveStatus === "error") {
      const saved = await persistSettings({ silent: true });
      if (!saved) return null;
      activeSession = saved.session;
      activeWorksheet = saved.worksheet;
      activeSettings = saved.settings;
    }
    return {
      activeSession,
      activeWorksheet,
      activeSettings,
    };
  };

  const handleGenerateError = async (error: unknown, fallback: string) => {
    const payload =
      error instanceof VisualizerApiError ? error.payload : null;
    const required =
      payload && typeof payload === "object" && "required" in payload
        ? Number((payload as { required?: number }).required)
        : null;
    toast.error(
      error instanceof VisualizerApiError
        ? required
          ? `${error.message} (need ~${required} credits)`
          : error.message
        : fallback
    );
    await loadProject();
  };

  const runDescriptions = async (retryFailed = false) => {
    if (!workspace || !session || !worksheet || !canEdit || generating) return;
    if (!settingsReady) {
      toast.error("Select worksheet columns and a Product image column first");
      return;
    }
    const rowIds = retryFailed
      ? rows
          .filter(
            (row) =>
              row.status === "failed" &&
              (selectedRowIds.size === 0 || selectedRowIds.has(row.id))
          )
          .map((row) => row.id)
      : selectedDescriptionTargets;
    if (rowIds.length === 0) {
      toast.error(
        selectedRowIds.size === 0
          ? "Select products in the worksheet first"
          : "No selected products need descriptions"
      );
      return;
    }

    const prepared = await prepareRunSession();
    if (!prepared) return;
    const { activeSession, activeWorksheet, activeSettings } = prepared;

    setGenerating(true);
    setGenerationRun({ total: rowIds.length, completed: 0 });
    setWorksheet((current) =>
      current
        ? {
            ...current,
            rows: current.rows.map((row) =>
              rowIds.includes(row.id)
                ? { ...row, status: "generating" as const, errorMessage: undefined }
                : row
            ),
          }
        : current
    );
    try {
      const result = await generateVisualizerDescriptions({
        workspaceId: workspace.id,
        sessionId: activeSession.id,
        settingsSnapshot: activeSettings,
        worksheetSnapshot: activeWorksheet,
        worksheetRevision: Number(activeSession.worksheet_revision ?? 0),
        rowIds,
        retryFailed,
      });

      if (result.session) setSession(result.session);
      if (result.worksheet) setWorksheet(result.worksheet);
      setSaveStatus("saved");

      if (result.status === "paused") {
        toast.success(
          result.message ||
            `Descriptions ready (${result.completed ?? 0}). Review before images.`
        );
      } else if (result.status === "failed") {
        toast.error("Description generation failed");
      } else {
        toast.success(
          `Stopped after ${result.completed ?? 0} description${
            (result.completed ?? 0) === 1 ? "" : "s"
          }`
        );
      }
    } catch (error) {
      await handleGenerateError(error, "Description generation failed");
    } finally {
      setGenerating(false);
      setStopping(false);
      setGenerationRun(null);
    }
  };

  const runImages = async (retryFailed = false) => {
    if (!workspace || !session || !worksheet || !canEdit || generating) return;
    const rowIds = retryFailed
      ? rows
          .filter(
            (row) =>
              row.status === "failed" &&
              !!row.generatedDescription &&
              (selectedRowIds.size === 0 || selectedRowIds.has(row.id))
          )
          .map((row) => row.id)
      : selectedImageTargets;
    if (rowIds.length === 0) {
      toast.error(
        selectedRowIds.size === 0
          ? "Select products in the worksheet first"
          : "Selected products need reviewed descriptions before images"
      );
      return;
    }

    const prepared = await prepareRunSession();
    if (!prepared) return;
    const { activeSession, activeWorksheet, activeSettings } = prepared;

    setGenerating(true);
    setGenerationRun({ total: rowIds.length, completed: 0 });
    setWorksheet((current) =>
      current
        ? {
            ...current,
            rows: current.rows.map((row) =>
              rowIds.includes(row.id)
                ? { ...row, status: "generating" as const, errorMessage: undefined }
                : row
            ),
          }
        : current
    );
    try {
      const result = await generateVisualizerImages({
        workspaceId: workspace.id,
        sessionId: activeSession.id,
        settingsSnapshot: activeSettings,
        worksheetSnapshot: activeWorksheet,
        worksheetRevision: Number(activeSession.worksheet_revision ?? 0),
        rowIds,
        retryFailed,
      });

      if (result.session) setSession(result.session);
      if (result.worksheet) setWorksheet(result.worksheet);
      if (result.signedUrls) setSignedUrls(result.signedUrls);
      else await loadProject();
      setSaveStatus("saved");

      if (result.status === "completed") {
        toast.success(
          result.message ||
            `Images ready (${result.completed ?? 0}). You can download results.`
        );
      } else if (result.status === "failed") {
        toast.error("Image generation failed");
      } else {
        toast.success(
          `Stopped after ${result.completed ?? 0} product${
            (result.completed ?? 0) === 1 ? "" : "s"
          }`
        );
      }
    } catch (error) {
      await handleGenerateError(error, "Image generation failed");
    } finally {
      setGenerating(false);
      setStopping(false);
      setGenerationRun(null);
    }
  };

  const stopGeneration = async () => {
    if (!workspace || !session || stopping) return;
    setStopping(true);
    try {
      await requestVisualizerGenerationStop({
        workspaceId: workspace.id,
        sessionId: session.id,
      });
      toast.message(
        "Stop requested. The current product will finish, then generation will stop."
      );
    } catch (error) {
      setStopping(false);
      toast.error(
        error instanceof VisualizerApiError
          ? error.message
          : "Could not stop generation"
      );
    }
  };

  const handleExport = async () => {
    if (!workspace || !session) return;
    setIsExporting(true);
    try {
      await exportVisualizer({
        workspaceId: workspace.id,
        sessionId: session.id,
        fileName: `${session.name || "visualizer"}_export.xlsx`,
      });
    } catch (error) {
      toast.error(
        error instanceof VisualizerApiError
          ? error.message
          : "Export failed"
      );
    } finally {
      setIsExporting(false);
    }
  };

  if (projectId) {
    if (loadingProject || !session || !worksheet) {
      return (
        <div className="flex min-h-[50vh] items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      );
    }

    return (
      <div className="flex h-[calc(100vh-3.5rem)] flex-col bg-background">
        <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={closeProject}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">{session.name}</h1>
              <p className="truncate text-[11px] text-muted-foreground">
                {session.source_file_name} · {session.total_rows} products ·{" "}
                {STATUS_LABEL[session.status]}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {generating ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={stopping}
                onClick={() => void stopGeneration()}
                className="gap-1.5 text-xs"
              >
                {stopping ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Square className="h-3.5 w-3.5" />
                )}
                {stopping ? "Stopping…" : "Stop"}
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={
                    !canEdit ||
                    !settingsReady ||
                    selectedRowIds.size === 0 ||
                    selectedDescriptionTargets.length === 0 ||
                    session.status === "processing"
                  }
                  onClick={() => void runDescriptions(false)}
                  className="gap-1.5 text-xs"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Descriptions
                  {selectedRowIds.size > 0
                    ? ` (${selectedDescriptionTargets.length})`
                    : ""}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    !canEdit ||
                    selectedRowIds.size === 0 ||
                    selectedImageTargets.length === 0 ||
                    session.status === "processing"
                  }
                  onClick={() => void runImages(false)}
                  className="gap-1.5 text-xs"
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  Generate images
                  {selectedRowIds.size > 0
                    ? ` (${selectedImageTargets.length})`
                    : ""}
                </Button>
              </>
            )}
            {(imagesReadyCount > 0 ||
              session.status === "completed" ||
              session.status === "paused" ||
              rows.some((row) => !!row.generatedDescription)) && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5 text-xs"
                disabled={isExporting || generating}
                onClick={() => void handleExport()}
              >
                {isExporting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                Export
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant={saveStatus === "dirty" ? "default" : "outline"}
              disabled={
                !canEdit ||
                generating ||
                saveStatus === "saving" ||
                saveStatus === "saved"
              }
              onClick={() => void persistSettings()}
              className="gap-1.5 text-xs"
            >
              {saveStatus === "saving" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Cloud className="h-3.5 w-3.5" />
              )}
              {saveStatus === "saving"
                ? "Saving…"
                : saveStatus === "dirty"
                  ? "Save"
                  : saveStatus === "error"
                    ? "Retry save"
                    : "Saved"}
            </Button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[320px_1fr]">
          <aside className="space-y-5 overflow-y-auto border-r p-4">
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground" />
                <h2 className="text-xs font-semibold">Worksheet columns</h2>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Both agents use the selected columns to understand each product.
              </p>
              <ConfigSelect
                label="Product image column *"
                value={settings.productImageColumn || "none"}
                disabled={!canEdit}
                onChange={(value) => {
                  const nextImage = value === "none" ? null : value;
                  setSettings((current) => ({
                    ...current,
                    productImageColumn: nextImage,
                    selectedColumns: current.selectedColumns.filter(
                      (column) => column !== nextImage
                    ),
                  }));
                  setSaveStatus("dirty");
                }}
                options={[
                  { value: "none", label: "Not selected" },
                  ...worksheet.columns.map((column) => ({
                    value: column,
                    label: column,
                  })),
                ]}
              />
              <div className="overflow-hidden rounded-md border">
                <div className="grid grid-cols-[auto_1fr] gap-x-2 border-b bg-muted/50 px-2.5 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={
                      productColumns.length > 0 &&
                      productColumns.every((column) =>
                        selectedColumnSet.has(column)
                      )
                    }
                    ref={(element) => {
                      if (!element) return;
                      const selectedCount = productColumns.filter((column) =>
                        selectedColumnSet.has(column)
                      ).length;
                      element.indeterminate =
                        selectedCount > 0 &&
                        selectedCount < productColumns.length;
                    }}
                    disabled={!canEdit || productColumns.length === 0}
                    onChange={toggleAllColumns}
                    aria-label="Select all columns"
                    className="mt-0.5 h-3.5 w-3.5 accent-primary"
                  />
                  <span>Column from worksheet</span>
                </div>
                <div className="max-h-[218px] overflow-y-auto">
                  {productColumns.map((column) => {
                    const isSelected = selectedColumnSet.has(column);
                    return (
                      <label
                        key={column}
                        className="grid cursor-pointer grid-cols-[auto_1fr] gap-x-2 border-b px-2.5 py-2 last:border-0 hover:bg-muted/30"
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={!canEdit}
                          onChange={() => toggleColumn(column)}
                          className="mt-0.5 h-3.5 w-3.5 accent-primary"
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-medium">
                            {column}
                          </span>
                          <span className="block truncate text-[10px] text-muted-foreground">
                            {sampleForColumn(column)}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">
                {
                  settings.selectedColumns.filter((column) =>
                    productColumns.includes(column)
                  ).length
                }{" "}
                of {productColumns.length} columns selected
              </p>
            </section>

            <section className="space-y-3 border-t pt-4">
              <div>
                <h2 className="text-xs font-semibold">Description agent</h2>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Powered by Standard or Premium writing.
                </p>
              </div>
              <div className="grid grid-cols-2 rounded-lg bg-muted p-1">
                {(["standard", "premium"] as const).map((tier) => (
                  <button
                    key={tier}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => updateDescriptionTier(tier)}
                    className={`rounded-md py-1.5 text-xs font-medium transition-colors ${
                      settings.description.tier === tier
                        ? "bg-background shadow-sm"
                        : "text-muted-foreground"
                    }`}
                  >
                    {tier === "standard" ? "Standard" : "Premium"}
                  </button>
                ))}
              </div>
              <LayoutSettingsButton
                layoutId={settings.description.layoutId}
                imageCount={settings.description.imageCount}
                disabled={!canEdit}
                onClick={() => setLayoutDialogOpen(true)}
              />
              <label className="block space-y-1.5">
                <span className="text-[11px] font-medium text-muted-foreground">
                  Custom instructions
                </span>
                <textarea
                  value={settings.description.instructions}
                  disabled={!canEdit}
                  onChange={(event) =>
                    updateDescriptionField("instructions", event.target.value)
                  }
                  className="min-h-24 w-full resize-none rounded-md border bg-background p-3 text-xs leading-relaxed outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring disabled:opacity-60"
                  placeholder="Tone, SEO keywords, claims to emphasize or avoid…"
                />
              </label>
            </section>

            <section className="space-y-3 border-t pt-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-xs font-semibold">Branding</h2>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Apply logo, brand guide, and colors to generated visuals.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.images.brandingEnabled}
                  aria-label="Toggle branding"
                  disabled={!canEdit}
                  onClick={() =>
                    updateImagesField(
                      "brandingEnabled",
                      !settings.images.brandingEnabled
                    )
                  }
                  className={`relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-60 ${
                    settings.images.brandingEnabled
                      ? "bg-foreground"
                      : "bg-muted"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-background shadow-sm transition-transform ${
                      settings.images.brandingEnabled
                        ? "translate-x-4"
                        : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
              {settings.images.brandingEnabled ? (
                <div className="space-y-3 rounded-md border p-2.5">
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">
                      Brand logo
                    </span>
                    <div className="group relative">
                      <button
                        type="button"
                        disabled={!canEdit || assetBusy === "logo"}
                        onClick={() => logoInputRef.current?.click()}
                        className="relative flex min-h-16 w-full items-center justify-center overflow-hidden rounded-md border border-dashed bg-muted/20 text-xs hover:bg-muted/40 disabled:opacity-60"
                      >
                        {settings.images.logoPath &&
                        signedUrls[settings.images.logoPath] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={signedUrls[settings.images.logoPath]}
                            alt="Brand logo"
                            className="absolute inset-0 h-full w-full object-cover"
                          />
                        ) : (
                          <span>Upload brand logo</span>
                        )}
                      </button>
                      {settings.images.logoPath && canEdit ? (
                        <button
                          type="button"
                          aria-label="Remove brand logo"
                          disabled={assetBusy === "logo"}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void handleAssetDelete("logo");
                          }}
                          className="absolute top-1.5 right-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white opacity-0 shadow transition-opacity group-hover:opacity-100 hover:bg-destructive"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(event) => {
                        void handleAssetUpload(
                          "logo",
                          event.target.files?.[0] ?? null
                        );
                        event.target.value = "";
                      }}
                    />
                  </div>

                  <div className="space-y-2">
                    <span className="text-[11px] font-medium text-muted-foreground">
                      Brand guide
                    </span>
                    <div className="grid grid-cols-2 rounded-md bg-muted p-1">
                      {(
                        [
                          ["image", "Upload image"],
                          ["colors", "Manual colors"],
                        ] as const
                      ).map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          disabled={!canEdit}
                          onClick={() =>
                            updateImagesField("brandGuideMode", mode)
                          }
                          className={`rounded-md py-1.5 text-[11px] font-medium transition-colors ${
                            settings.images.brandGuideMode === mode
                              ? "bg-background shadow-sm"
                              : "text-muted-foreground"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {settings.images.brandGuideMode === "image" ? (
                      <div className="group relative">
                        <button
                          type="button"
                          disabled={!canEdit || assetBusy === "brandGuide"}
                          onClick={() => brandGuideInputRef.current?.click()}
                          className="relative flex min-h-16 w-full items-center justify-center overflow-hidden rounded-md border border-dashed bg-muted/20 text-xs hover:bg-muted/40 disabled:opacity-60"
                        >
                          {settings.images.brandGuidePath &&
                          signedUrls[settings.images.brandGuidePath] ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={signedUrls[settings.images.brandGuidePath]}
                              alt="Brand guide"
                              className="absolute inset-0 h-full w-full object-cover"
                            />
                          ) : (
                            <span>Upload brand guide</span>
                          )}
                        </button>
                        {settings.images.brandGuidePath && canEdit ? (
                          <button
                            type="button"
                            aria-label="Remove brand guide"
                            disabled={assetBusy === "brandGuide"}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void handleAssetDelete("brandGuide");
                            }}
                            className="absolute top-1.5 right-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white opacity-0 shadow transition-opacity group-hover:opacity-100 hover:bg-destructive"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                        <input
                          ref={brandGuideInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          onChange={(event) => {
                            void handleAssetUpload(
                              "brandGuide",
                              event.target.files?.[0] ?? null
                            );
                            event.target.value = "";
                          }}
                        />
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        {(
                          [
                            [0, "Primary"],
                            [1, "Secondary"],
                            [2, "Accent"],
                          ] as const
                        ).map(([index, label]) => (
                          <label key={label} className="block space-y-1">
                            <span className="text-[10px] text-muted-foreground">
                              {label}
                            </span>
                            <input
                              type="color"
                              disabled={!canEdit}
                              value={
                                settings.images.brandColors[index] || "#111827"
                              }
                              onChange={(event) => {
                                const next = [...settings.images.brandColors];
                                while (next.length < 3) next.push("#111827");
                                next[index] = event.target.value;
                                updateImagesField(
                                  "brandColors",
                                  next.slice(0, 3)
                                );
                              }}
                              className="h-8 w-full cursor-pointer rounded border bg-background"
                            />
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </section>
          </aside>

          <main className="flex min-h-0 flex-col overflow-hidden p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-xs font-semibold">Worksheet</h2>
                <p className="text-[11px] text-muted-foreground">
                  Select products, then run Descriptions or Generate images.
                  Open the eye to review AI output.
                </p>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                {selectedRowIds.size > 0 ? (
                  <span>
                    {selectedRowIds.size} of {rows.length} selected
                  </span>
                ) : (
                  <span>{rows.length} products</span>
                )}
                {generationRun ? (
                  <span className="font-medium text-amber-700">
                    {generationRun.completed}/{generationRun.total} done
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div
                ref={tableScrollRef}
                onScroll={(event) => {
                  if (stickyScrollRef.current) {
                    stickyScrollRef.current.scrollLeft =
                      event.currentTarget.scrollLeft;
                  }
                }}
                className="min-h-0 w-full flex-1 overflow-auto rounded-lg border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                <table
                  className="w-full text-left text-xs"
                  style={{
                    minWidth: `${Math.max(tableMinWidthPx, tableViewportWidth || 0)}px`,
                  }}
                >
                  <thead className="sticky top-0 z-20 border-b bg-muted text-[10px] uppercase tracking-wide text-muted-foreground shadow-sm">
                    <tr>
                      <th className="sticky left-0 top-0 z-30 w-10 bg-muted px-3 py-3">
                        <input
                          type="checkbox"
                          checked={allRowsSelected}
                          onChange={toggleAllRows}
                          className="h-3.5 w-3.5 accent-primary"
                          aria-label="Select all products"
                        />
                      </th>
                      {displayColumns.map((column) => (
                        <th
                          key={column}
                          className={`whitespace-nowrap bg-muted px-3 py-3 ${
                            column === RESULT_DESCRIPTION ||
                            column === RESULT_IMAGES
                              ? "min-w-[220px] text-foreground"
                              : "min-w-[160px]"
                          }`}
                        >
                          {columnLabel(column)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={displayColumns.length + 1}
                          className="px-3 py-8 text-center text-muted-foreground"
                        >
                          No rows in this worksheet.
                        </td>
                      </tr>
                    ) : (
                      rows.map((row) => {
                        const hasDescription = !!row.generatedDescription?.trim();
                        const snippet =
                          descriptionSnippet(row.generatedDescription) ||
                          row.errorMessage ||
                          "—";
                        const placeholders = row.imagePlaceholders ?? [];
                        return (
                          <tr
                            key={row.id}
                            className={`border-b transition-colors last:border-0 hover:bg-muted/40 ${
                              selectedRowIds.has(row.id) ? "bg-primary/5" : ""
                            }`}
                          >
                            <td
                              className={`sticky left-0 z-10 px-3 py-3 ${
                                selectedRowIds.has(row.id)
                                  ? "bg-primary/5"
                                  : "bg-background"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={selectedRowIds.has(row.id)}
                                onChange={() => toggleRow(row.id)}
                                className="h-3.5 w-3.5 accent-primary"
                                aria-label={`Select row ${row.rowIndex + 1}`}
                              />
                            </td>
                            {displayColumns.map((column) => {
                              if (column === RESULT_DESCRIPTION) {
                                return (
                                  <td key={column} className="px-3 py-3 align-top">
                                    <div className="flex min-w-[200px] items-start gap-2">
                                      {row.status === "generating" ? (
                                        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-amber-600" />
                                      ) : (
                                        <button
                                          type="button"
                                          disabled={!hasDescription}
                                          onClick={() => {
                                            setReviewRowId(row.id);
                                            setReviewTab("preview");
                                          }}
                                          className={`mt-0.5 rounded p-0.5 transition-colors ${
                                            hasDescription
                                              ? "text-foreground hover:bg-muted"
                                              : "cursor-not-allowed text-muted-foreground/40"
                                          }`}
                                          aria-label={
                                            hasDescription
                                              ? "Review AI description"
                                              : "No description yet"
                                          }
                                          title={
                                            hasDescription
                                              ? "Review description & image prompts"
                                              : "Generate a description first"
                                          }
                                        >
                                          {hasDescription ? (
                                            <Eye className="h-4 w-4" />
                                          ) : (
                                            <EyeOff className="h-4 w-4" />
                                          )}
                                        </button>
                                      )}
                                      <div className="min-w-0 flex-1">
                                        <p className="truncate text-[11px] leading-relaxed text-foreground">
                                          {snippet}
                                        </p>
                                        <span
                                          className={`mt-1 inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-medium capitalize ${rowStatusTone(row.status)}`}
                                        >
                                          {row.status.replaceAll("_", " ")}
                                        </span>
                                      </div>
                                    </div>
                                  </td>
                                );
                              }
                              if (column === RESULT_IMAGES) {
                                const thumbs = placeholders
                                  .map((item) => {
                                    const path = item.storagePath;
                                    if (!path) return null;
                                    const src =
                                      signedUrls[path] ||
                                      (/^https?:\/\//i.test(path) ? path : null);
                                    return src
                                      ? {
                                          key: path,
                                          src,
                                          alt:
                                            item.alt || `Image ${item.index}`,
                                        }
                                      : null;
                                  })
                                  .filter(
                                    (
                                      item
                                    ): item is {
                                      key: string;
                                      src: string;
                                      alt: string;
                                    } => !!item
                                  );
                                const openImageDialog = (key: string) => {
                                  setImageDialogRowId(row.id);
                                  setImagePreviewKey(key);
                                };
                                return (
                                  <td
                                    key={column}
                                    className="min-w-[180px] px-3 py-3 align-top"
                                  >
                                    {thumbs.length > 0 ? (
                                      <div className="flex items-center gap-1">
                                        {thumbs.slice(0, 3).map((thumb, idx) => (
                                          <button
                                            key={`${row.id}:img:${idx}:${thumb.key}`}
                                            type="button"
                                            onClick={() =>
                                              openImageDialog(thumb.key)
                                            }
                                            className="group/image relative h-10 w-10 shrink-0 overflow-hidden rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                            aria-label={`Preview generated image ${idx + 1}`}
                                          >
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                              src={thumb.src}
                                              alt={thumb.alt}
                                              className="h-full w-full object-cover transition-transform group-hover/image:scale-105"
                                            />
                                          </button>
                                        ))}
                                        {thumbs.length > 3 && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              openImageDialog(
                                                thumbs[0]?.key ?? ""
                                              )
                                            }
                                            className="flex h-10 items-center gap-1 rounded border bg-muted/30 px-2 text-[10px] font-medium text-muted-foreground hover:border-primary/40 hover:text-foreground"
                                          >
                                            <Maximize2 className="h-3 w-3" />
                                            +{thumbs.length - 3}
                                          </button>
                                        )}
                                      </div>
                                    ) : placeholders.length > 0 ? (
                                      <span className="text-[11px] text-muted-foreground">
                                        {placeholders.length} placeholder
                                        {placeholders.length === 1 ? "" : "s"}
                                      </span>
                                    ) : (
                                      <span className="text-[11px] text-muted-foreground">
                                        —
                                      </span>
                                    )}
                                  </td>
                                );
                              }
                              const value = row.originalData[column] ?? "";
                              const isImageCol =
                                column === settings.productImageColumn &&
                                /^https?:\/\//i.test(value.trim());
                              return (
                                <td
                                  key={column}
                                  className="max-w-[220px] px-3 py-3 align-top"
                                >
                                  {isImageCol ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={value.trim()}
                                      alt=""
                                      className="h-12 w-12 rounded border object-cover"
                                    />
                                  ) : (
                                    <span className="line-clamp-3 break-words text-[11px] text-muted-foreground">
                                      {value || "—"}
                                    </span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              {tableScrollWidth > tableViewportWidth + 1 && (
                <div
                  ref={stickyScrollRef}
                  onScroll={(event) => {
                    if (tableScrollRef.current) {
                      tableScrollRef.current.scrollLeft =
                        event.currentTarget.scrollLeft;
                    }
                  }}
                  className="z-30 mt-1 h-4 w-full shrink-0 overflow-x-auto overflow-y-hidden border-x border-b bg-background"
                  aria-label="Worksheet horizontal scrollbar"
                >
                  <div
                    className="h-px"
                    style={{ width: `${tableScrollWidth}px` }}
                  />
                </div>
              )}
            </div>

            {(() => {
              const reviewRow = reviewRowId
                ? rows.find((row) => row.id === reviewRowId) ?? null
                : null;
              if (!reviewRow) return null;
              const placeholders = reviewRow.imagePlaceholders ?? [];
              const rawHtml = reviewRow.generatedDescription || "";
              const html = resolveVisualizerHtmlImages(rawHtml, signedUrls)
                .replace(/src="vz-storage:[^"]+"/g, 'src="" data-missing="1"')
                .replace(
                  /\[imageplaceholder-(\d+)\]/gi,
                  (_match, index) => {
                    const brief =
                      placeholders.find(
                        (item) => item.index === Number(index)
                      )?.visualBrief || "";
                    return `<figure style="margin:0;padding:1rem;border:1px dashed #94a3b8;border-radius:8px;background:#f8fafc;color:#475569;font-family:ui-sans-serif,system-ui,sans-serif;font-size:12px"><strong>Image placeholder ${index}</strong>${
                      brief
                        ? `<div style="margin-top:.5rem;line-height:1.45">${brief
                            .replace(/&/g, "&amp;")
                            .replace(/</g, "&lt;")
                            .replace(/>/g, "&gt;")}</div>`
                        : ""
                    }</figure>`;
                  }
                );

              return (
                <Dialog
                  open={!!reviewRowId}
                  onOpenChange={(open) => {
                    if (!open) setReviewRowId(null);
                  }}
                >
                  <DialogContent className="flex max-h-[90vh] w-[min(96vw,1100px)] max-w-[min(96vw,1100px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,1100px)]">
                    <DialogHeader className="shrink-0 border-b px-5 py-4 text-left">
                      <DialogTitle className="truncate text-sm">
                        {rowProductLabel(reviewRow, settings)}
                      </DialogTitle>
                      <DialogDescription className="text-[11px]">
                        {placeholders.length} image placeholder
                        {placeholders.length === 1 ? "" : "s"}
                        {reviewRow.errorMessage
                          ? ` · ${reviewRow.errorMessage}`
                          : ""}
                      </DialogDescription>
                      <div className="mt-3 flex w-fit rounded-lg bg-muted p-1">
                        {(
                          [
                            ["preview", "Preview"],
                            ["html", "HTML"],
                            ["briefs", "Image prompts"],
                          ] as const
                        ).map(([id, label]) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setReviewTab(id)}
                            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                              reviewTab === id
                                ? "bg-background shadow-sm"
                                : "text-muted-foreground"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </DialogHeader>
                    <div className="min-h-0 flex-1 overflow-auto p-5">
                      {!rawHtml && reviewRow.status !== "failed" ? (
                        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                          Generate descriptions to review output here.
                        </div>
                      ) : reviewTab === "preview" && html ? (
                        <iframe
                          title="Generated description preview"
                          sandbox=""
                          srcDoc={`<!doctype html><html><head><meta charset="utf-8"/><style>
                              body{font-family:Georgia,serif;line-height:1.55;color:#111;margin:0;padding:12px 8px;max-width:980px}
                              h1,h2,h3{line-height:1.25;margin:1.2em 0 .5em}
                              p,ul{margin:.75em 0}
                              section{box-sizing:border-box}
                              figure{margin:0}
                              img{max-width:100%;height:auto;border-radius:8px;display:block}
                              figure:has(img[data-missing]){padding:1rem;border:1px dashed #94a3b8;border-radius:8px;background:#f8fafc;color:#475569;font-family:ui-sans-serif,system-ui,sans-serif;font-size:13px}
                            </style></head><body>${html}</body></html>`}
                          className="h-[min(60vh,560px)] w-full rounded-md border bg-white"
                        />
                      ) : reviewTab === "html" && rawHtml ? (
                        <pre className="overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-[11px] leading-relaxed text-foreground">
                          {resolveVisualizerHtmlImages(rawHtml, signedUrls)}
                        </pre>
                      ) : reviewTab === "briefs" ? (
                        placeholders.length === 0 ? (
                          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                            No image prompts for this product yet.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {placeholders.map((item) => {
                              const imageUrl = item.storagePath
                                ? signedUrls[item.storagePath] ||
                                  (/^https?:\/\//i.test(item.storagePath)
                                    ? item.storagePath
                                    : null)
                                : null;
                              return (
                                <article
                                  key={item.index}
                                  className="rounded-lg border p-3"
                                >
                                  <div className="mb-1 flex items-center justify-between gap-2">
                                    <h4 className="text-xs font-semibold">
                                      Placeholder {item.index}
                                    </h4>
                                    <span className="text-[10px] text-muted-foreground">
                                      {item.alt || "No alt text"}
                                    </span>
                                  </div>
                                  {imageUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={imageUrl}
                                      alt={
                                        item.alt || `Placeholder ${item.index}`
                                      }
                                      className="mb-2 max-h-56 w-full rounded-md border object-contain bg-muted/20"
                                    />
                                  ) : null}
                                  <p className="text-[12px] leading-relaxed text-muted-foreground">
                                    {item.visualBrief}
                                  </p>
                                </article>
                              );
                            })}
                          </div>
                        )
                      ) : (
                        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                          {reviewRow.errorMessage ||
                            "No generated description for this product."}
                        </div>
                      )}
                    </div>
                  </DialogContent>
                </Dialog>
              );
            })()}

            {(() => {
              const imageDialogRow = imageDialogRowId
                ? rows.find((row) => row.id === imageDialogRowId) ?? null
                : null;
              if (!imageDialogRow) return null;
              const dialogThumbs = (imageDialogRow.imagePlaceholders ?? [])
                .map((item) => {
                  const path = item.storagePath;
                  if (!path) return null;
                  const src =
                    signedUrls[path] ||
                    (/^https?:\/\//i.test(path) ? path : null);
                  return src
                    ? {
                        key: path,
                        src,
                        alt: item.alt || `Image ${item.index}`,
                      }
                    : null;
                })
                .filter(
                  (
                    item
                  ): item is { key: string; src: string; alt: string } => !!item
                );
              const active =
                dialogThumbs.find((item) => item.key === imagePreviewKey) ??
                dialogThumbs[0] ??
                null;

              return (
                <Dialog
                  open={!!imageDialogRowId}
                  onOpenChange={(open) => {
                    if (!open) {
                      setImageDialogRowId(null);
                      setImagePreviewKey(null);
                    }
                  }}
                >
                  <DialogContent className="w-[min(96vw,1120px)] max-w-[min(96vw,1120px)] overflow-hidden p-0 sm:max-w-[min(96vw,1120px)]">
                    <DialogHeader className="border-b px-6 py-4">
                      <DialogTitle className="flex items-center gap-2">
                        <ImageIcon className="h-4 w-4 text-primary" />
                        Generated images
                      </DialogTitle>
                      <DialogDescription>
                        {`${rowProductLabel(imageDialogRow, settings)} · ${dialogThumbs.length} image${dialogThumbs.length === 1 ? "" : "s"}`}
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid min-h-[480px] md:grid-cols-[minmax(0,1fr)_132px]">
                      <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 bg-muted/20 p-6 md:min-h-[62vh]">
                        {active ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={active.src}
                            alt={active.alt}
                            className="max-h-[62vh] max-w-full rounded-lg object-contain shadow-sm"
                          />
                        ) : (
                          <div className="text-center text-xs text-muted-foreground">
                            <ImageIcon className="mx-auto mb-2 h-8 w-8 opacity-50" />
                            No generated images
                          </div>
                        )}
                      </div>
                      <div className="border-l p-3">
                        <p className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          All images
                        </p>
                        <div className="flex max-h-[62vh] flex-col gap-2 overflow-y-auto pr-1">
                          {dialogThumbs.map((thumb, index) => (
                            <button
                              key={`${imageDialogRow.id}:dialog:${index}:${thumb.key}`}
                              type="button"
                              onClick={() => setImagePreviewKey(thumb.key)}
                              className={`aspect-square w-full shrink-0 overflow-hidden rounded-md border-2 ${
                                active?.key === thumb.key
                                  ? "border-primary"
                                  : "border-transparent"
                              }`}
                              aria-label={`View image ${index + 1}`}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={thumb.src}
                                alt={thumb.alt}
                                className="h-full w-full object-cover"
                              />
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              );
            })()}

            <DescriptionLayoutDialog
              open={layoutDialogOpen}
              onOpenChange={setLayoutDialogOpen}
              layoutId={settings.description.layoutId}
              imageCount={settings.description.imageCount}
              disabled={!canEdit}
              onApply={({ layoutId, imageCount }) => {
                setSettings((current) => ({
                  ...current,
                  description: {
                    ...current.description,
                    layoutId,
                    imageCount,
                    maxPlaceholders: imageCount,
                  },
                }));
                setSaveStatus("dirty");
              }}
            />
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-gradient-to-b from-muted/20 via-background to-background">
      <div className="mx-auto max-w-7xl space-y-6 p-5 sm:p-6 lg:p-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-background shadow-sm">
              <Boxes className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">
                Products Visualizer
              </h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Generate SEO product descriptions and matching lifestyle images.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            className="gap-1.5 self-start shadow-sm sm:self-auto"
            disabled={!canEdit}
            onClick={() => setShowCreate(true)}
          >
            <Plus className="h-3.5 w-3.5" /> New project
          </Button>
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
              icon: FileSpreadsheet,
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
                    stat.label === "Processing" && stat.value ? "animate-spin" : ""
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
            title="Visualizer projects"
            description="Open a project to manage its worksheet and generated assets."
            search={projectSearch}
            onSearchChange={setProjectSearch}
            status={projectStatusFilter}
            onStatusChange={setProjectStatusFilter}
            statusOptions={[
              { value: "all", label: "All statuses" },
              { value: "ready", label: "Ready" },
              { value: "processing", label: "Processing" },
              { value: "paused", label: "Paused" },
              { value: "draft", label: "Draft" },
              { value: "failed", label: "Failed" },
            ]}
            dateFilter={projectDateFilter}
            onDateFilterChange={setProjectDateFilter}
            sort={projectSort}
            onSortChange={setProjectSort}
          />

          {loadingList ? (
            <div className="flex h-56 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Boxes className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-semibold">
                Create your first visualizer project
              </h3>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                Upload an Excel or CSV product worksheet and let the visualizer
                generate SEO descriptions and matching lifestyle images.
              </p>
              {canEdit && (
                <Button
                  size="sm"
                  className="mt-5 gap-1.5"
                  onClick={() => setShowCreate(true)}
                >
                  <Plus className="h-3.5 w-3.5" /> New project
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
              {pagedProjects.map((item) => {
                const statusLabel = STATUS_LABEL[item.status] ?? item.status;
                const isReady =
                  item.status === "ready" || item.status === "completed";
                const progress =
                  item.total_rows > 0
                    ? Math.round(
                        ((item.ready_rows + item.failed_rows) / item.total_rows) *
                          100
                      )
                    : 0;
                return (
                  <article
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openProject(item.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        openProject(item.id);
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
                            {item.name}
                          </h3>
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className={`shrink-0 text-[9px] ${
                          isReady
                            ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600"
                            : item.status === "failed"
                              ? "border-destructive/30 bg-destructive/5 text-destructive"
                              : "border-amber-500/30 bg-amber-500/5 text-amber-600"
                        }`}
                      >
                        {statusLabel}
                      </Badge>
                    </div>

                    <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-muted/35 px-2 py-2">
                        <p className="text-xs font-semibold">{item.total_rows}</p>
                        <p className="text-[9px] text-muted-foreground">Products</p>
                      </div>
                      <div className="rounded-lg bg-muted/35 px-2 py-2">
                        <p className="text-xs font-semibold text-emerald-600">
                          {item.ready_rows}
                        </p>
                        <p className="text-[9px] text-muted-foreground">Ready</p>
                      </div>
                      <div className="rounded-lg bg-muted/35 px-2 py-2">
                        <p className="text-xs font-semibold text-destructive">
                          {item.failed_rows}
                        </p>
                        <p className="text-[9px] text-muted-foreground">Failed</p>
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
                        {timeAgo(item.updated_at)}
                      </span>
                      {canAdmin && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setDeleteTarget(item);
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

      <Dialog
        open={showCreate}
        onOpenChange={(open) => {
          if (creating) return;
          setShowCreate(open);
          if (!open) {
            setProjectName("");
            setUploadFile(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New visualizer project</DialogTitle>
            <DialogDescription>
              Upload an Excel or CSV product sheet to create a project.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="visualizer-project-name">Project name</Label>
              <Input
                id="visualizer-project-name"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="Summer collection descriptions"
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="visualizer-file">Product worksheet</Label>
              <Input
                id="visualizer-file"
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(event) =>
                  setUploadFile(event.target.files?.[0] ?? null)
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={creating}
              onClick={() => setShowCreate(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                creating || !projectName.trim() || !uploadFile || !canEdit
              }
              onClick={() => void createProject()}
            >
              {creating ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              Create project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteProjectDialog
        open={!!deleteTarget}
        projectName={deleteTarget?.name}
        deleting={deletingProject}
        onOpenChange={(open) => {
          if (!open && !deletingProject) setDeleteTarget(null);
        }}
        onConfirm={() => void deleteProject()}
      />
    </div>
  );
}
