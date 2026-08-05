"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  AlertCircle,
  Check,
  ChevronDown,
  Clock3,
  Cloud,
  CloudCheck,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FolderOpen,
  GalleryHorizontalEnd,
  Info,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Palette,
  Pencil,
  Plus,
  Search,
  Square,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  RotateCcw,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWorkspaceContext } from "../layout";
import { useRole } from "@/hooks/use-role";
import {
  listGallerySessions,
  createGallerySession,
  getGallerySession,
  patchGallerySession,
  saveGallerySettings,
  generateGallery,
  requestGalleryGenerationStop,
  exportGallery,
  deleteGallerySession,
  deleteGalleryImage,
  deleteGalleryRows,
  uploadGalleryAiAsset,
  deleteGalleryAiAsset,
  type GalleryAiAssetKind,
  GalleryApiError,
} from "@/lib/gallery/client";
import type {
  GalleryAiSettings,
  GalleryScrapingSettings,
  GalleryRow,
  GalleryProjectSettings,
  GallerySession,
  GallerySessionStatus,
  GalleryWorksheetJson,
} from "@/lib/gallery/types";
import { shouldApplySubmittedResponse } from "@/lib/gallery/settings-schema";
import {
  DEFAULT_AI_SETTINGS,
  DEFAULT_SCRAPING_SETTINGS,
  resolveSelectionRunPhase,
} from "@/lib/gallery/types";
import { parseImageUrls, listColumnsWithHttpUrls } from "@/lib/gallery/image-urls";
import { imageRefsMatch } from "@/lib/gallery/image-refs";
import {
  pendingImageDeleteKey,
  stripPendingImageDeletes as stripPendingDeletesFromWorksheet,
} from "@/lib/gallery/pending-image-deletes";

type ImageUploadPreview = {
  name: string;
  previewUrl: string;
};

type RowDraft = {
  id: string;
  originalData: Record<string, string>;
};

type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

const SESSION_STATUS_LABEL: Record<GallerySessionStatus, string> = {
  draft: "Draft",
  ready: "Ready",
  processing: "Processing",
  completed: "Ready",
  failed: "Failed",
};

// NUL is forbidden in XLSX/XML header text, so these UI-only IDs cannot
// collide with user-provided worksheet columns.
const RESULT_MAIN = "\u0000gallery:main";
const RESULT_GALLERY = "\u0000gallery:images";

function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(trimmed)) return trimmed.toUpperCase();
  if (/^#[0-9A-Fa-f]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  if (/^[0-9A-Fa-f]{6}$/.test(trimmed)) return `#${trimmed.toUpperCase()}`;
  if (/^[0-9A-Fa-f]{3}$/.test(trimmed)) {
    const [r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return null;
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

function ConfigSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-full rounded-md border bg-background px-2.5 text-xs outline-none focus:ring-1 focus:ring-ring"
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

function InfoTip({ children }: { children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="More information"
        >
          <Info className="h-3 w-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={6} className="max-w-60 text-left leading-relaxed">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

export default function ProductsGalleryPage() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { workspace, role } = useWorkspaceContext();
  const { canEdit, canAdmin } = useRole(role);

  const projectId = searchParams.get("project");

  const [sessions, setSessions] = useState<GallerySession[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [activeSession, setActiveSession] = useState<GallerySession | null>(null);
  const [worksheet, setWorksheet] = useState<GalleryWorksheetJson | null>(null);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<GallerySession | null>(null);
  const [deletingProject, setDeletingProject] = useState(false);
  const [imageDialogRowId, setImageDialogRowId] = useState<string | null>(null);
  const [imageDialogKind, setImageDialogKind] = useState<"main" | "gallery">(
    "gallery"
  );
  const [imagePreviewPath, setImagePreviewPath] = useState<string | null>(null);
  /** Set of pendingImageDeleteKey(rowId, path) — never path-only. */
  const [pendingImageDeletes, setPendingImageDeletes] = useState<Set<string>>(
    () => new Set()
  );
  const pendingImageDeletesRef = useRef<Set<string>>(new Set());
  const [showDeleteRows, setShowDeleteRows] = useState(false);
  const [deletingRows, setDeletingRows] = useState(false);
  const [showLeaveWithoutSaving, setShowLeaveWithoutSaving] = useState(false);

  const [activeTab, setActiveTab] = useState<"scraping" | "ai">("scraping");
  const [showMore, setShowMore] = useState(false);
  const [originalImageColumn, setOriginalImageColumn] = useState("none");
  const [
    originalImageSelectionExplicit,
    setOriginalImageSelectionExplicit,
  ] = useState(false);
  const [scrapingMainImages, setScrapingMainImages] = useState("1");
  const [scrapingMainInstructions, setScrapingMainInstructions] = useState("");
  const [aiMainImages, setAiMainImages] = useState("1");
  const [aiMainInstructions, setAiMainInstructions] = useState("");
  const [scrapingImages, setScrapingImages] = useState("4");
  const [scrapingInstructions, setScrapingInstructions] = useState("");
  const [scrapingModel, setScrapingModel] = useState<"standard" | "pro">("standard");
  const [scrapingSearchDepth, setScrapingSearchDepth] = useState("medium");
  const [scrapingSourcePolicy, setScrapingSourcePolicy] = useState("prefer-official");
  const [scrapingResolution, setScrapingResolution] = useState("1200");
  const [scrapingAspectRatio, setScrapingAspectRatio] = useState("any");
  const [aiModel, setAiModel] = useState<"standard" | "pro">("standard");
  const [aiImages, setAiImages] = useState("4");
  const [aiAspectRatio, setAiAspectRatio] = useState("1:1");
  const [aiResolution, setAiResolution] = useState("1K");
  const [aiOutputFormat, setAiOutputFormat] = useState("image/jpeg");
  const [aiStyle, setAiStyle] = useState("studio");
  const [aiInstructions, setAiInstructions] = useState("");
  const [aiGroundWithSearch, setAiGroundWithSearch] = useState(false);
  const [brandingEnabled, setBrandingEnabled] = useState(false);
  const [brandGuideMode, setBrandGuideMode] = useState<"image" | "colors">(
    "colors"
  );
  const [aiAssetBusy, setAiAssetBusy] = useState<GalleryAiAssetKind | null>(null);
  const [sceneReference, setSceneReference] = useState<ImageUploadPreview | null>(null);
  const [brandLogo, setBrandLogo] = useState<ImageUploadPreview | null>(null);
  const [brandGuide, setBrandGuide] = useState<ImageUploadPreview | null>(null);
  const [brandColors, setBrandColors] = useState(["#111827", "#2563EB", "#F59E0B"]);
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set());

  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [worksheetSearch, setWorksheetSearch] = useState("");
  const [worksheetFilter, setWorksheetFilter] = useState<"all" | "selected" | "not-started" | "ready">(
    "all"
  );
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [rowDraft, setRowDraft] = useState<RowDraft | null>(null);

  const [generationRun, setGenerationRun] = useState<{
    total: number;
    completed: number;
    runId?: string;
  } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isStoppingGeneration, setIsStoppingGeneration] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [tableScrollWidth, setTableScrollWidth] = useState(0);
  const [tableViewportWidth, setTableViewportWidth] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const sceneReferenceInputRef = useRef<HTMLInputElement>(null);
  const brandLogoInputRef = useRef<HTMLInputElement>(null);
  const brandGuideInputRef = useRef<HTMLInputElement>(null);
  const imagePreviewUrlsRef = useRef<string[]>([]);
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const settingsReadyRef = useRef(false);
  const lastSavedSettingsSignatureRef = useRef("");
  const currentSettingsSignatureRef = useRef("");
  const worksheetRevisionRef = useRef(0);
  const settingsRevisionRef = useRef(0);
  const lastSavedRowSignatureRef = useRef("");
  const aiAssetPathsRef = useRef<{
    logoPath: string | null;
    brandGuidePath: string | null;
    sceneReferencePath: string | null;
  }>({
    logoPath: null,
    brandGuidePath: null,
    sceneReferencePath: null,
  });

  const rememberAiAssetPaths = useCallback(
    (
      ws: GalleryWorksheetJson | null,
      mode: "merge" | "replace" = "merge"
    ) => {
      if (!ws) {
        if (mode === "replace") {
          aiAssetPathsRef.current = {
            logoPath: null,
            brandGuidePath: null,
            sceneReferencePath: null,
          };
        }
        return;
      }
      const next = {
        logoPath: ws.settings.ai.logoPath ?? null,
        brandGuidePath: ws.settings.ai.brandGuidePath ?? null,
        sceneReferencePath: ws.settings.ai.sceneReferencePath ?? null,
      };
      if (mode === "replace") {
        aiAssetPathsRef.current = next;
        return;
      }
      const prev = aiAssetPathsRef.current;
      // Never let a stale worksheet null wipe a path we already know from upload.
      aiAssetPathsRef.current = {
        logoPath: next.logoPath ?? prev.logoPath ?? null,
        brandGuidePath: next.brandGuidePath ?? prev.brandGuidePath ?? null,
        sceneReferencePath:
          next.sceneReferencePath ?? prev.sceneReferencePath ?? null,
      };
    },
    []
  );

  const clearAiAssetPath = useCallback((kind: GalleryAiAssetKind) => {
    if (kind === "logo") aiAssetPathsRef.current.logoPath = null;
    else if (kind === "brandGuide") aiAssetPathsRef.current.brandGuidePath = null;
    else aiAssetPathsRef.current.sceneReferencePath = null;
  }, []);
  const currentRowSignatureRef = useRef("");
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const stickyScrollRef = useRef<HTMLDivElement>(null);

  const hasOriginalImageColumn = originalImageColumn !== "none";
  const isSavingSettings = saveStatus === "saving";
  const hasAdvancedSettings = activeTab === "scraping" || aiModel === "pro";
  const worksheetColumns = useMemo(
    () => worksheet?.columns ?? [],
    [worksheet?.columns]
  );
  const hasWorksheet = !!worksheet;

  const syncSettingsFromWorksheet = useCallback((
    ws: GalleryWorksheetJson,
    urls: Record<string, string> = {}
  ) => {
    settingsReadyRef.current = false;
    setOriginalImageSelectionExplicit(
      ws.originalImageSelectionExplicit ?? false
    );
    setOriginalImageColumn(
      ws.originalImageSelectionExplicit ? ws.originalImageColumn ?? "none" : "none"
    );
    const imageColumn =
      ws.originalImageSelectionExplicit && ws.originalImageColumn
        ? ws.originalImageColumn
        : null;
    const initialSelected = ws.selectedColumns.length
      ? ws.selectedColumns
      : ws.columns;
    setSelectedColumns(
      new Set(
        initialSelected.filter((column) => column !== imageColumn)
      )
    );
    setActiveTab(ws.settings.provider === "ai" ? "ai" : "scraping");

    const g = ws.settings.scraping ?? DEFAULT_SCRAPING_SETTINGS;
    setScrapingMainImages(String(g.main?.imagesPerRow ?? 1));
    setScrapingMainInstructions(g.main?.instructions || "");
    setScrapingImages(String(g.imagesPerRow ?? 4));
    setScrapingInstructions(g.instructions || "");
    setScrapingModel(g.tier === "premium" ? "pro" : "standard");
    setScrapingSearchDepth(g.searchDepth || "medium");
    setScrapingSourcePolicy(g.sourcePolicy || "prefer-official");
    setScrapingResolution(String(g.minResolution ?? 1200));
    setScrapingAspectRatio(g.aspectRatio || "any");

    const a = ws.settings.ai ?? DEFAULT_AI_SETTINGS;
    setAiMainImages(String(a.main?.imagesPerRow ?? 1));
    setAiMainInstructions(a.main?.instructions || "");
    setAiModel(a.tier === "premium" ? "pro" : "standard");
    setAiImages(String(a.imagesPerRow ?? 4));
    setAiAspectRatio(a.aspectRatio || "1:1");
    setAiResolution(a.resolution || "1K");
    setAiOutputFormat(a.outputFormat || "image/jpeg");
    setAiStyle(a.style || "studio");
    setAiInstructions(a.instructions || "");
    setAiGroundWithSearch(a.groundWithSearch ?? false);
    setBrandingEnabled(a.brandingEnabled ?? false);
    setBrandGuideMode(
      a.brandGuideMode ?? (a.brandGuidePath ? "image" : "colors")
    );
    setBrandColors(
      a.brandColors?.length ? a.brandColors : [...DEFAULT_AI_SETTINGS.brandColors]
    );
    setSceneReference(
      a.sceneReferencePath
        ? {
            name: "Scene or model reference",
            previewUrl: urls[a.sceneReferencePath] || "",
          }
        : null
    );
    setBrandLogo(
      a.logoPath
        ? { name: "Brand logo", previewUrl: urls[a.logoPath] || "" }
        : null
    );
    setBrandGuide(
      a.brandGuidePath
        ? {
            name: "Brand guide",
            previewUrl: urls[a.brandGuidePath] || "",
          }
        : null
    );

    if (ws.activeRun && (ws.activeRun.status === "running" || ws.activeRun.status === "queued")) {
      setGenerationRun({
        total: ws.activeRun.total,
        completed: ws.activeRun.completed + ws.activeRun.failed,
        runId: ws.activeRun.id,
      });
    } else {
      setGenerationRun(null);
    }
  }, []);

  const stripPendingImageDeletes = useCallback(
    (ws: GalleryWorksheetJson): GalleryWorksheetJson =>
      stripPendingDeletesFromWorksheet(ws, pendingImageDeletesRef.current),
    []
  );

  const applySessionPayload = useCallback(
    (
      session: GallerySession,
      ws: GalleryWorksheetJson | null,
      syncSettings = true,
      urls?: Record<string, string>
    ) => {
      worksheetRevisionRef.current = Number(session.worksheet_revision ?? 0);
      settingsRevisionRef.current = Number(session.settings_revision ?? 0);
      setActiveSession(session);
      const nextWs = ws ? stripPendingImageDeletes(ws) : ws;
      setWorksheet(nextWs);
      rememberAiAssetPaths(nextWs, syncSettings ? "replace" : "merge");
      if (urls) setSignedUrls(urls);
      if (nextWs && syncSettings) syncSettingsFromWorksheet(nextWs, urls);
      else if (nextWs?.activeRun && (nextWs.activeRun.status === "running" || nextWs.activeRun.status === "queued")) {
        setGenerationRun({
          total: nextWs.activeRun.total,
          completed: nextWs.activeRun.completed + nextWs.activeRun.failed,
          runId: nextWs.activeRun.id,
        });
      } else {
        setGenerationRun(null);
      }
      setSessions((current) => {
        const idx = current.findIndex((s) => s.id === session.id);
        if (idx < 0) return [session, ...current];
        const next = [...current];
        next[idx] = session;
        return next;
      });
    },
    [rememberAiAssetPaths, stripPendingImageDeletes, syncSettingsFromWorksheet]
  );

  const buildSettingsPatch = useCallback((): GalleryProjectSettings => {
    const scraping: GalleryScrapingSettings = {
      main: {
        imagesPerRow: Number(scrapingMainImages) || 1,
        instructions: scrapingMainInstructions.slice(0, 2_000),
      },
      tier: scrapingModel === "pro" ? "premium" : "standard",
      imagesPerRow: Number(scrapingImages) || 4,
      instructions: scrapingInstructions.slice(0, 2_000),
      searchDepth:
        scrapingSearchDepth === "low" || scrapingSearchDepth === "high"
          ? scrapingSearchDepth
          : "medium",
      sourcePolicy: scrapingSourcePolicy as GalleryScrapingSettings["sourcePolicy"],
      excludeMarketplaces: false,
      minResolution: Number(scrapingResolution) || 0,
      aspectRatio: scrapingAspectRatio,
      duplicates: "avoid",
      matchStrictness: "strict",
    };
    const ai: GalleryAiSettings = {
      main: {
        imagesPerRow: Number(aiMainImages) || 1,
        instructions: aiMainInstructions.slice(0, 2_000),
      },
      tier: aiModel === "pro" ? "premium" : "standard",
      imagesPerRow: Number(aiImages) || 4,
      aspectRatio: aiAspectRatio,
      resolution: aiResolution,
      outputFormat: aiOutputFormat,
      style: aiStyle,
      instructions: aiInstructions,
      groundWithSearch: aiGroundWithSearch,
      brandingEnabled,
      brandGuideMode,
      brandColors: brandColors
        .map((c) => normalizeHexColor(c) ?? c)
        .filter(Boolean),
      logoPath:
        worksheet?.settings.ai.logoPath ??
        aiAssetPathsRef.current.logoPath ??
        null,
      brandGuidePath:
        worksheet?.settings.ai.brandGuidePath ??
        aiAssetPathsRef.current.brandGuidePath ??
        null,
      sceneReferencePath:
        worksheet?.settings.ai.sceneReferencePath ??
        aiAssetPathsRef.current.sceneReferencePath ??
        null,
    };
    return {
      provider: activeTab,
      originalImageColumn: originalImageColumn === "none" ? null : originalImageColumn,
      originalImageSelectionExplicit,
      selectedColumns: Array.from(selectedColumns).filter(
        (column) =>
          !(originalImageColumn !== "none" && column === originalImageColumn)
      ),
      scraping,
      ai,
    };
  }, [
    activeTab,
    aiMainImages,
    aiMainInstructions,
    aiAspectRatio,
    aiImages,
    aiInstructions,
    aiModel,
    aiOutputFormat,
    aiResolution,
    aiStyle,
    aiGroundWithSearch,
    brandColors,
    brandingEnabled,
    brandGuideMode,
    scrapingMainImages,
    scrapingMainInstructions,
    scrapingAspectRatio,
    scrapingImages,
    scrapingInstructions,
    scrapingModel,
    scrapingResolution,
    scrapingSearchDepth,
    scrapingSourcePolicy,
    originalImageColumn,
    originalImageSelectionExplicit,
    selectedColumns,
    worksheet?.settings.ai.brandGuidePath,
    worksheet?.settings.ai.logoPath,
    worksheet?.settings.ai.sceneReferencePath,
  ]);

  const enqueueMutation = useCallback(
    <T,>(operation: () => Promise<T>): Promise<T> => {
      const run = mutationQueueRef.current.catch(() => undefined).then(operation);
      mutationQueueRef.current = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    },
    []
  );

  const persistSettings = useCallback(async (
    worksheetOverride?: NonNullable<typeof worksheet>
  ) => {
    const worksheetToSave = worksheetOverride ?? worksheet;
    if (!workspace || !projectId || !canEdit || !worksheetToSave) return null;
    const settings = buildSettingsPatch();
    const signature = JSON.stringify(settings);
    if (signature === lastSavedSettingsSignatureRef.current) {
      setSaveStatus("saved");
      return worksheetToSave;
    }
    setSaveStatus("saving");
    try {
      const result = await enqueueMutation(() =>
        saveGallerySettings({
          workspaceId: workspace.id,
          sessionId: projectId,
          expectedRevision: settingsRevisionRef.current,
          expectedWorksheetRevision: worksheetRevisionRef.current,
          settings,
          worksheet: worksheetToSave,
        })
      );
      settingsRevisionRef.current = Number(result.session.settings_revision);
      worksheetRevisionRef.current = Number(result.session.worksheet_revision);
      lastSavedSettingsSignatureRef.current = signature;
      setActiveSession(result.session);
      setSessions((current) =>
        current.map((session) =>
          session.id === result.session.id ? result.session : session
        )
      );
      setWorksheet((current) =>
        current
          ? {
              ...result.worksheet,
              rows: result.worksheet.rows,
              originalImageColumn: result.settings.originalImageColumn,
              originalImageSelectionExplicit:
                result.settings.originalImageSelectionExplicit,
              selectedColumns: [...result.settings.selectedColumns],
              settings: {
                provider: result.settings.provider,
                scraping: result.settings.scraping,
                ai: result.settings.ai,
              },
            }
          : current
      );
      const latestSignature = JSON.stringify(buildSettingsPatch());
      currentSettingsSignatureRef.current = latestSignature;
      setSaveStatus(latestSignature === signature ? "saved" : "dirty");
      toast.success("Settings saved");
      return worksheet;
    } catch (error) {
      setSaveStatus("error");
      throw error;
    }
  }, [
    buildSettingsPatch,
    canEdit,
    enqueueMutation,
    projectId,
    workspace,
    worksheet,
  ]);

  useEffect(() => {
    if (!worksheet || !projectId || !canEdit) return;
    const signature = JSON.stringify(buildSettingsPatch());
    currentSettingsSignatureRef.current = signature;
    if (!settingsReadyRef.current) {
      settingsReadyRef.current = true;
      lastSavedSettingsSignatureRef.current = signature;
      setSaveStatus("saved");
      return;
    }
    if (saveStatus !== "saving") {
      setSaveStatus(
        signature === lastSavedSettingsSignatureRef.current ? "saved" : "dirty"
      );
    }
  }, [
    buildSettingsPatch,
    canEdit,
    projectId,
    saveStatus,
    worksheet,
  ]);

  const setAiAssetPreview = (
    kind: GalleryAiAssetKind,
    preview: ImageUploadPreview | null
  ) => {
    if (kind === "sceneReference") setSceneReference(preview);
    else if (kind === "logo") setBrandLogo(preview);
    else setBrandGuide(preview);
  };

  const uploadAiAsset = async (
    kind: GalleryAiAssetKind,
    file: File | undefined
  ) => {
    if (!file || !workspace || !projectId || !canEdit) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      toast.error("Use a JPEG, PNG, or WebP image up to 10 MB");
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    imagePreviewUrlsRef.current.push(previewUrl);
    setAiAssetPreview(kind, { name: file.name, previewUrl });
    setAiAssetBusy(kind);
    try {
      const result = await enqueueMutation(() =>
        uploadGalleryAiAsset({
          workspaceId: workspace.id,
          sessionId: projectId,
          kind,
          file,
        })
      );
      settingsRevisionRef.current = Number(result.session.settings_revision);
      setActiveSession(result.session);
      setSignedUrls((current) => ({ ...current, ...result.signedUrls }));
      const setting =
        kind === "logo"
          ? "logoPath"
          : kind === "brandGuide"
            ? "brandGuidePath"
            : "sceneReferencePath";
      const path = result.settings.ai[setting];
      if (!path) {
        throw new Error("Reference image was uploaded but no storage path was saved");
      }
      // Pin the uploaded kind explicitly in case worksheet merge is briefly stale.
      if (kind === "logo") {
        aiAssetPathsRef.current.logoPath = path;
        setBrandingEnabled(true);
      } else if (kind === "brandGuide") {
        aiAssetPathsRef.current.brandGuidePath = path;
        setBrandGuideMode("image");
        setBrandingEnabled(true);
      } else aiAssetPathsRef.current.sceneReferencePath = path;
      setAiAssetPreview(kind, {
        name: file.name,
        previewUrl: result.signedUrls[path] || previewUrl,
      });
      setWorksheet((current) =>
        current
          ? {
              ...current,
              settings: {
                ...current.settings,
                ai: { ...current.settings.ai, [setting]: path },
              },
            }
          : current
      );
      const currentSettings = buildSettingsPatch();
      currentSettings.ai = { ...currentSettings.ai, [setting]: path };
      lastSavedSettingsSignatureRef.current = JSON.stringify(result.settings);
      currentSettingsSignatureRef.current = JSON.stringify(currentSettings);
      setSaveStatus(
        currentSettingsSignatureRef.current ===
          lastSavedSettingsSignatureRef.current
          ? "saved"
          : "dirty"
      );
      toast.success("Reference image saved");
    } catch (error) {
      setAiAssetPreview(kind, null);
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setAiAssetBusy(null);
    }
  };

  const removeAiAsset = async (kind: GalleryAiAssetKind) => {
    if (!workspace || !projectId || !canEdit) return;
    setAiAssetBusy(kind);
    try {
      const result = await enqueueMutation(() =>
        deleteGalleryAiAsset({
          workspaceId: workspace.id,
          sessionId: projectId,
          kind,
        })
      );
      settingsRevisionRef.current = Number(result.session.settings_revision);
      setActiveSession(result.session);
      clearAiAssetPath(kind);
      setSignedUrls((current) => ({ ...current, ...result.signedUrls }));
      setAiAssetPreview(kind, null);
      const setting =
        kind === "logo"
          ? "logoPath"
          : kind === "brandGuide"
            ? "brandGuidePath"
            : "sceneReferencePath";
      setWorksheet((current) =>
        current
          ? {
              ...current,
              settings: {
                ...current.settings,
                ai: { ...current.settings.ai, [setting]: null },
              },
            }
          : current
      );
      const currentSettings = buildSettingsPatch();
      currentSettings.ai = { ...currentSettings.ai, [setting]: null };
      lastSavedSettingsSignatureRef.current = JSON.stringify(result.settings);
      currentSettingsSignatureRef.current = JSON.stringify(currentSettings);
      setSaveStatus(
        currentSettingsSignatureRef.current ===
          lastSavedSettingsSignatureRef.current
          ? "saved"
          : "dirty"
      );
      toast.success("Reference image removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove image");
    } finally {
      setAiAssetBusy(null);
    }
  };

  const productColumns = useMemo(
    () =>
      worksheetColumns.filter(
        (column) =>
          !(hasOriginalImageColumn && column === originalImageColumn)
      ),
    [hasOriginalImageColumn, originalImageColumn, worksheetColumns]
  );

  /** Original-image picker: only columns whose values are primarily http(s) URLs. */
  const originalImageCandidateColumns = useMemo(() => {
    const detected = listColumnsWithHttpUrls({
      columns: worksheetColumns,
      rows: worksheet?.rows ?? [],
      sampleSize: 40,
      minUrlShare: 0.25,
    });
    // Keep a previously saved choice visible even if the sample is sparse.
    if (
      hasOriginalImageColumn &&
      originalImageColumn !== "none" &&
      worksheetColumns.includes(originalImageColumn) &&
      !detected.includes(originalImageColumn)
    ) {
      return [originalImageColumn, ...detected];
    }
    return detected;
  }, [
    hasOriginalImageColumn,
    originalImageColumn,
    worksheet?.rows,
    worksheetColumns,
  ]);

  const toggleColumn = (columnId: string) => {
    if (hasOriginalImageColumn && columnId === originalImageColumn) return;
    setSelectedColumns((current) => {
      const next = new Set(current);
      if (next.has(columnId)) next.delete(columnId);
      else next.add(columnId);
      return next;
    });
  };

  const toggleAllColumns = () => {
    setSelectedColumns((current) => {
      const allSelected =
        productColumns.length > 0 &&
        productColumns.every((column) => current.has(column));
      return allSelected ? new Set() : new Set(productColumns);
    });
  };

  const toggleRow = (rowId: string) => {
    setSelectedRowIds((current) => {
      const next = new Set(current);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  useEffect(() => {
    return () => {
      imagePreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      imagePreviewUrlsRef.current = [];
    };
  }, []);

  // Load session list
  useEffect(() => {
    if (!workspace?.id) return;
    let cancelled = false;
    setListLoading(true);
    setListError(null);
    listGallerySessions(workspace.id)
      .then(({ sessions: next }) => {
        if (!cancelled) setSessions(next);
      })
      .catch((err) => {
        if (!cancelled) {
          setListError((err as Error)?.message || "Failed to load gallery projects");
        }
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspace?.id]);

  // Load selected session + worksheet
  useEffect(() => {
    if (!workspace?.id || !projectId) {
      setActiveSession(null);
      setWorksheet(null);
      setSignedUrls({});
      setSessionError(null);
      setSelectedRowIds(new Set());
      setEditingRowId(null);
      setRowDraft(null);
      setGenerationRun(null);
      return;
    }
    let cancelled = false;
    setActiveSession(null);
    setWorksheet(null);
    setSignedUrls({});
    setSelectedRowIds(new Set());
    setEditingRowId(null);
    setRowDraft(null);
    setGenerationRun(null);
    setSessionLoading(true);
    setSessionError(null);
    getGallerySession(workspace.id, projectId)
      .then(({ session, worksheet: ws, signedUrls: urls }) => {
        if (cancelled) return;
        applySessionPayload(session, ws, true, urls);
      })
      .catch((err) => {
        if (!cancelled) {
          setSessionError((err as Error)?.message || "Failed to load project");
          setActiveSession(null);
          setWorksheet(null);
        }
      })
      .finally(() => {
        if (!cancelled) setSessionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspace?.id, projectId, applySessionPayload]);

  // Signed image URLs live for one hour. Refresh them before expiry and when
  // the user returns to the tab after leaving it idle.
  useEffect(() => {
    if (!workspace?.id || !projectId || !hasWorksheet) return;
    let cancelled = false;
    const refreshSignedUrls = async () => {
      try {
        const payload = await getGallerySession(workspace.id, projectId);
        if (!cancelled && payload.signedUrls) {
          setSignedUrls(payload.signedUrls);
        }
      } catch {
        // A later focus/timer refresh can recover transient failures.
      }
    };
    const onFocus = () => void refreshSignedUrls();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(refreshSignedUrls, 50 * 60 * 1000);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [workspace?.id, projectId, hasWorksheet]);

  const shouldPollGeneration = isGenerating || generationRun !== null;
  useEffect(() => {
    if (!workspace?.id || !projectId || !shouldPollGeneration) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const pollProgress = async () => {
      try {
        const fresh = await getGallerySession(workspace.id, projectId, {
          includeSignedUrls: false,
        });
        if (cancelled) return;
        if (!fresh.worksheet) return;
        const freshWorksheet = fresh.worksheet;
        worksheetRevisionRef.current = Number(
          fresh.session.worksheet_revision ?? worksheetRevisionRef.current
        );
        setActiveSession(fresh.session);
        setSessions((current) =>
          current.map((session) =>
            session.id === fresh.session.id ? fresh.session : session
          )
        );
        const mergedFresh = stripPendingDeletesFromWorksheet(
          freshWorksheet,
          pendingImageDeletesRef.current
        );
        setWorksheet((current) =>
          current
            ? {
                ...current,
                rows: mergedFresh.rows,
                activeRun: mergedFresh.activeRun,
                revision: mergedFresh.revision,
              }
            : mergedFresh
        );
        const run = mergedFresh.activeRun;
        if (run && (run.status === "running" || run.status === "queued")) {
          setGenerationRun({
            total: run.total,
            completed: run.completed + run.failed,
            runId: run.id,
          });
          if (fresh.session.cancel_requested) {
            setIsStoppingGeneration(true);
          }
        } else if (!isGenerating) {
          setGenerationRun(null);
          setIsStoppingGeneration(false);
        }
      } catch {
        // The next poll or the final generate response will recover.
      } finally {
        if (!cancelled) {
          timer = setTimeout(pollProgress, 750);
        }
      }
    };

    timer = setTimeout(pollProgress, 250);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isGenerating, projectId, shouldPollGeneration, workspace?.id]);

  const displayColumns = useMemo(() => {
    const selectedImageColumn =
      hasOriginalImageColumn && worksheetColumns.includes(originalImageColumn)
        ? originalImageColumn
        : null;
    // Keep the original-image column visible in the sheet; only hide it from
    // the Worksheet columns picker (productColumns).
    return [
      ...(selectedImageColumn ? [selectedImageColumn] : []),
      RESULT_MAIN,
      RESULT_GALLERY,
      ...productColumns,
    ];
  }, [
    hasOriginalImageColumn,
    originalImageColumn,
    productColumns,
    worksheetColumns,
  ]);

  const tableMinWidthPx = useMemo(
    () => Math.max(900, 56 + displayColumns.length * 160 + 80),
    [displayColumns.length]
  );

  const rows = useMemo(() => worksheet?.rows ?? [], [worksheet?.rows]);

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
  }, [displayColumns, rows.length]);

  const projectStats = useMemo(
    () => ({
      total: sessions.length,
      ready: sessions.filter(
        (session) =>
          session.status === "ready" || session.status === "completed"
      ).length,
      processing: sessions.filter((session) => session.status === "processing")
        .length,
      products: sessions.reduce(
        (sum, session) => sum + Number(session.total_rows || 0),
        0
      ),
    }),
    [sessions]
  );

  const filteredProjects = useMemo(() => {
    const query = projectSearch.trim().toLowerCase();
    if (!query) return sessions;
    return sessions.filter(
      (session) =>
        session.name.toLowerCase().includes(query) ||
        session.source_file_name.toLowerCase().includes(query)
    );
  }, [projectSearch, sessions]);

  const visibleRows = useMemo(() => {
    return rows.filter((row) => {
      const search = worksheetSearch.trim().toLowerCase();
      const matchesSearch =
        !search ||
        Object.values(row.originalData).some((value) =>
          String(value ?? "")
            .toLowerCase()
            .includes(search)
        );
      const matchesFilter =
        worksheetFilter === "all" ||
        (worksheetFilter === "selected" && selectedRowIds.has(row.id)) ||
        (worksheetFilter === "ready" && row.status === "ready") ||
        (worksheetFilter === "not-started" && row.status === "not_started");
      return matchesSearch && matchesFilter;
    });
  }, [rows, selectedRowIds, worksheetFilter, worksheetSearch]);

  const toggleAllRows = () => {
    setSelectedRowIds((current) => {
      const allVisibleSelected =
        visibleRows.length > 0 &&
        visibleRows.every((row) => current.has(row.id));
      if (!allVisibleSelected) {
        return new Set([...current, ...visibleRows.map((row) => row.id)]);
      }
      const next = new Set(current);
      for (const row of visibleRows) next.delete(row.id);
      return next;
    });
  };

  const openProject = (sessionId: string) => {
    router.push(`${pathname}?project=${sessionId}`, { scroll: false });
  };

  const closeProject = () => {
    router.push(pathname, { scroll: false });
  };

  const createProject = async () => {
    if (!workspace || !canEdit || !projectName.trim() || !uploadFile) return;
    setCreating(true);
    try {
      const { session } = await createGallerySession({
        workspaceId: workspace.id,
        name: projectName.trim(),
        file: uploadFile,
      });
      setSessions((current) => [session, ...current.filter((s) => s.id !== session.id)]);
      setShowCreate(false);
      setProjectName("");
      setUploadFile(null);
      openProject(session.id);
    } catch (err) {
      toast.error((err as Error)?.message || "Failed to create project");
    } finally {
      setCreating(false);
    }
  };

  const deleteProject = async () => {
    if (!workspace || !deleteTarget || !canAdmin) return;
    setDeletingProject(true);
    try {
      await deleteGallerySession(workspace.id, deleteTarget.id);
      setSessions((current) =>
        current.filter((session) => session.id !== deleteTarget.id)
      );
      toast.success(`Deleted “${deleteTarget.name}” and all project files`);
      setDeleteTarget(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete project"
      );
    } finally {
      setDeletingProject(false);
    }
  };

  const stopGeneration = async () => {
    if (
      !workspace ||
      !projectId ||
      !canEdit ||
      isStoppingGeneration
    ) {
      return;
    }
    setIsStoppingGeneration(true);
    try {
      await requestGalleryGenerationStop({
        workspaceId: workspace.id,
        sessionId: projectId,
      });
      toast.message(
        "Stop requested. The current product will finish, then generation will stop."
      );
    } catch (error) {
      setIsStoppingGeneration(false);
      toast.error(
        error instanceof Error ? error.message : "Could not request stop"
      );
    }
  };

  const runGeneration = async (rowIds: string[]) => {
    if (!workspace || !projectId || !canEdit || rowIds.length === 0) return;

    if (activeTab === "ai") {
      let aiSettings = worksheet?.settings.ai;
      // Soft-refresh once if previews exist but paths were wiped by a stale worksheet.
      const needsPathRefresh =
        (sceneReference &&
          !(
            aiSettings?.sceneReferencePath ||
            aiAssetPathsRef.current.sceneReferencePath
          )) ||
        (brandingEnabled &&
          brandLogo &&
          !(aiSettings?.logoPath || aiAssetPathsRef.current.logoPath)) ||
        (brandingEnabled &&
          brandGuideMode === "image" &&
          brandGuide &&
          !(
            aiSettings?.brandGuidePath ||
            aiAssetPathsRef.current.brandGuidePath
          ));
      if (needsPathRefresh) {
        try {
          const fresh = await getGallerySession(workspace.id, projectId, {
            includeSignedUrls: true,
          });
          applySessionPayload(
            fresh.session,
            fresh.worksheet,
            false,
            fresh.signedUrls
          );
          aiSettings = fresh.worksheet?.settings.ai;
        } catch {
          // Fall through to the local path checks below.
        }
      }
      const scenePath =
        aiSettings?.sceneReferencePath ||
        aiAssetPathsRef.current.sceneReferencePath;
      const logoPath =
        aiSettings?.logoPath || aiAssetPathsRef.current.logoPath;
      const brandGuidePath =
        aiSettings?.brandGuidePath || aiAssetPathsRef.current.brandGuidePath;
      if (sceneReference && !scenePath) {
        toast.error(
          "Scene/model reference is not saved yet. Re-upload it and wait for “Reference image saved”."
        );
        return;
      }
      if (brandingEnabled && brandLogo && !logoPath) {
        toast.error(
          "Brand logo is not saved yet. Re-upload it and wait for “Reference image saved”."
        );
        return;
      }
      if (
        brandingEnabled &&
        brandGuideMode === "image" &&
        brandGuide &&
        !brandGuidePath
      ) {
        toast.error(
          "Brand guide is not saved yet. Re-upload it and wait for “Reference image saved”."
        );
        return;
      }
      if (aiAssetBusy) {
        toast.error("Wait for the reference upload to finish");
        return;
      }
    }

    setIsStoppingGeneration(false);
    setIsGenerating(true);
    const worksheetBeforeGeneration = worksheet;
    let receivedResult = false;
    setGenerationRun({ total: rowIds.length, completed: 0 });
    setWorksheet((current) =>
      current
        ? {
            ...current,
            rows: current.rows.map((row) =>
              rowIds.includes(row.id) ? { ...row, status: "queued" as const } : row
            ),
          }
        : current
    );

    try {
      const settingsSnapshot = buildSettingsPatch();
      const selectedRows =
        worksheet?.rows.filter((row) => rowIds.includes(row.id)) ?? [];
      const selectionPhase = resolveSelectionRunPhase({
        originalImageColumn:
          originalImageColumn === "none" ? null : originalImageColumn,
        rows: selectedRows,
      });
      const result = await generateGallery({
        workspaceId: workspace.id,
        sessionId: projectId,
        rowIds,
        provider: activeTab,
        settingsSnapshot,
        worksheetSnapshot: worksheet!,
        worksheetRevision: worksheetRevisionRef.current,
        // Mixed selections omit runPhase so the server resolves per row.
        ...(selectionPhase.phase === "mixed"
          ? {}
          : { runPhase: selectionPhase.phase }),
      });
      receivedResult = true;
      if (result.worksheet) {
        setWorksheet(result.worksheet);
        if (result.signedUrls) setSignedUrls(result.signedUrls);
        if (
          result.worksheet.activeRun &&
          (result.worksheet.activeRun.status === "running" ||
            result.worksheet.activeRun.status === "queued")
        ) {
          setGenerationRun({
            total: result.worksheet.activeRun.total,
            completed:
              result.worksheet.activeRun.completed + result.worksheet.activeRun.failed,
            runId: result.worksheet.activeRun.id,
          });
        } else {
          setGenerationRun(null);
        }
      }
      if (result.session) {
        worksheetRevisionRef.current = Number(
          result.session.worksheet_revision ?? worksheetRevisionRef.current
        );
        setActiveSession(result.session);
        setSessions((current) => {
          const idx = current.findIndex((s) => s.id === result.session!.id);
          if (idx < 0) return [result.session!, ...current];
          const next = [...current];
          next[idx] = result.session!;
          return next;
        });
      }
      if (result.status === "cancelled") {
        toast.message("Generation cancelled");
      } else if ((result.failed ?? 0) > 0) {
        toast.message(
          `Finished with ${result.completed ?? 0} ready, ${result.failed} failed`
        );
      }
    } catch (err) {
      toast.error((err as Error)?.message || "Generation failed");
      // Refresh worksheet after failure
      try {
        const fresh = await getGallerySession(workspace.id, projectId);
        applySessionPayload(fresh.session, fresh.worksheet, false, fresh.signedUrls);
      } catch {
        setWorksheet(worksheetBeforeGeneration);
        setGenerationRun(null);
      }
    } finally {
      setIsGenerating(false);
      setIsStoppingGeneration(false);
      if (receivedResult) {
        setGenerationRun(null);
        return;
      }
      try {
        const fresh = await getGallerySession(workspace.id, projectId);
        applySessionPayload(fresh.session, fresh.worksheet, false, fresh.signedUrls);
        const run = fresh.worksheet?.activeRun;
        if (run && (run.status === "running" || run.status === "queued")) {
          setGenerationRun({
            total: run.total,
            completed: run.completed + run.failed,
            runId: run.id,
          });
        } else {
          setGenerationRun(null);
        }
      } catch {
        if (!receivedResult) setWorksheet(worksheetBeforeGeneration);
        setGenerationRun(null);
      }
    }
  };

  const retryRow = async (rowId: string) => {
    if (!workspace || !projectId || !canEdit) return;
    setIsStoppingGeneration(false);
    setIsGenerating(true);
    setGenerationRun({ total: 1, completed: 0 });
    let receivedResult = false;
    try {
      const settingsSnapshot = buildSettingsPatch();
      const targetRow = worksheet?.rows.find((row) => row.id === rowId);
      const retryPhase = resolveSelectionRunPhase({
        originalImageColumn:
          originalImageColumn === "none" ? null : originalImageColumn,
        rows: targetRow ? [targetRow] : [],
      });
      const result = await generateGallery({
        workspaceId: workspace.id,
        sessionId: projectId,
        rowIds: [rowId],
        provider: activeTab,
        settingsSnapshot,
        worksheetSnapshot: worksheet!,
        worksheetRevision: worksheetRevisionRef.current,
        retryFailed: true,
        ...(retryPhase.phase === "mixed"
          ? {}
          : { runPhase: retryPhase.phase }),
      });
      receivedResult = true;
      if (result.worksheet) setWorksheet(result.worksheet);
      if (result.signedUrls) setSignedUrls(result.signedUrls);
      if (result.session) {
        worksheetRevisionRef.current = Number(
          result.session.worksheet_revision ?? worksheetRevisionRef.current
        );
        setActiveSession(result.session);
        setSessions((current) => {
          const idx = current.findIndex((s) => s.id === result.session!.id);
          if (idx < 0) return current;
          const next = [...current];
          next[idx] = result.session!;
          return next;
        });
      }
    } catch (err) {
      toast.error((err as Error)?.message || "Retry failed");
    } finally {
      setIsGenerating(false);
      setIsStoppingGeneration(false);
      setGenerationRun(null);
      if (receivedResult) return;
      try {
        const fresh = await getGallerySession(workspace.id, projectId);
        applySessionPayload(fresh.session, fresh.worksheet, false, fresh.signedUrls);
      } catch {
        // ignore
      }
    }
  };

  const startEditingRow = (row: GalleryRow) => {
    const signature = JSON.stringify(row.originalData);
    lastSavedRowSignatureRef.current = signature;
    currentRowSignatureRef.current = signature;
    setEditingRowId(row.id);
    setRowDraft({ id: row.id, originalData: { ...row.originalData } });
  };

  const persistRowDraft = useCallback(async (draft: RowDraft) => {
    if (
      !workspace ||
      !projectId ||
      !canEdit ||
      savingRowId ||
      generationRun ||
      isGenerating
    ) return null;
    const signature = JSON.stringify(draft.originalData);
    if (signature === lastSavedRowSignatureRef.current) return worksheet;
    setSavingRowId(draft.id);
    setSaveStatus("saving");
    try {
      const result = await enqueueMutation(() =>
        patchGallerySession({
          workspaceId: workspace.id,
          sessionId: projectId,
          revision: worksheetRevisionRef.current,
          worksheet: {
            rows: [
              {
                id: draft.id,
                originalData: draft.originalData,
              } as GalleryRow,
            ],
          },
        })
      );
      lastSavedRowSignatureRef.current = signature;
      worksheetRevisionRef.current = Number(
        result.session.worksheet_revision ?? worksheetRevisionRef.current
      );
      if (
        shouldApplySubmittedResponse(currentRowSignatureRef.current, signature)
      ) {
        setWorksheet(result.worksheet);
      }
      setActiveSession(result.session);
      setSaveStatus(
        currentRowSignatureRef.current === signature ? "saved" : "dirty"
      );
      return result.worksheet;
    } catch (err) {
      setSaveStatus("error");
      throw err;
    } finally {
      setSavingRowId(null);
    }
  }, [
    canEdit,
    enqueueMutation,
    generationRun,
    isGenerating,
    projectId,
    savingRowId,
    workspace,
    worksheet,
  ]);

  useEffect(() => {
    if (!rowDraft || !editingRowId) return;
    const signature = JSON.stringify(rowDraft.originalData);
    currentRowSignatureRef.current = signature;
    if (
      signature !== lastSavedRowSignatureRef.current &&
      saveStatus !== "saving"
    ) {
      setSaveStatus("dirty");
    }
  }, [editingRowId, rowDraft, saveStatus]);

  const saveRow = async () => {
    if (!rowDraft) return;
    try {
      await persistRowDraft(rowDraft);
      setEditingRowId(null);
      setRowDraft(null);
    } catch (err) {
      toast.error((err as Error)?.message || "Failed to save row");
    }
  };

  const closeProjectSafely = async () => {
    if (saveStatus === "dirty" || rowDraft) {
      setShowLeaveWithoutSaving(true);
      return;
    }
    closeProject();
  };

  const confirmLeaveWithoutSaving = () => {
    setShowLeaveWithoutSaving(false);
    closeProject();
  };

  const saveAndLeave = async () => {
    try {
      let latestWorksheet = worksheet;
      if (rowDraft) {
        latestWorksheet = (await persistRowDraft(rowDraft)) ?? latestWorksheet;
        setEditingRowId(null);
        setRowDraft(null);
      }
      await persistSettings(latestWorksheet ?? undefined);
      setShowLeaveWithoutSaving(false);
      closeProject();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Save failed"
      );
    }
  };

  const handleExport = async () => {
    if (!workspace || !projectId) return;
    setIsExporting(true);
    try {
      await exportGallery({
        workspaceId: workspace.id,
        sessionId: projectId,
        fileName: `${activeSession?.name || "gallery"}_export.xlsx`,
      });
    } catch (err) {
      toast.error((err as Error)?.message || "Export failed");
    } finally {
      setIsExporting(false);
    }
  };

  const resolvePathUrl = (path: string | null | undefined): string | null => {
    if (!path) return null;
    if (/^https?:\/\//i.test(path)) return path;
    if (signedUrls[path]) return signedUrls[path];
    if (!workspace?.id || !projectId) return null;
    const params = new URLSearchParams({
      workspaceId: workspace.id,
      sessionId: projectId,
      path,
    });
    return `/api/gallery/images?${params.toString()}`;
  };

  const getRowMainPaths = (row: GalleryRow): string[] => {
    // Explicit [] means cleared — do not revive via legacy mainImagePath.
    if (Array.isArray(row.mainImagePaths)) return row.mainImagePaths;
    return row.mainImagePath ? [row.mainImagePath] : [];
  };

  const getRowOriginalSrc = (row: GalleryRow): string | null => {
    if (!hasOriginalImageColumn || !originalImageColumn) return null;
    return parseImageUrls(row.originalData[originalImageColumn])[0] ?? null;
  };

  const getImageMeta = (
    row: GalleryRow,
    imageUrl: string | null
  ): { pageUrl?: unknown; fallbackUrl?: unknown } | null => {
    if (!imageUrl || !row.sourceMeta || typeof row.sourceMeta !== "object") return null;
    const images = (row.sourceMeta as { images?: unknown }).images;
    if (!Array.isArray(images)) return null;
    return (images.find(
      (image) =>
        !!image &&
        typeof image === "object" &&
        String(
          (image as { ref?: unknown; url?: unknown }).ref ||
            (image as { url?: unknown }).url ||
            ""
        ) === imageUrl
    ) as { pageUrl?: unknown; fallbackUrl?: unknown } | undefined) ?? null;
  };

  const getImageSourceUrl = (row: GalleryRow, imageUrl: string | null): string | null => {
    const pageUrl = String(getImageMeta(row, imageUrl)?.pageUrl || "").trim();
    return /^https?:\/\//i.test(pageUrl) ? pageUrl : null;
  };

  const getImageFallbackUrl = (row: GalleryRow, imageUrl: string | null): string | null => {
    const fallbackUrl = String(getImageMeta(row, imageUrl)?.fallbackUrl || "").trim();
    return /^https?:\/\//i.test(fallbackUrl) ? fallbackUrl : null;
  };

  const removeProductImage = async (rowId: string, path: string) => {
    if (
      !workspace ||
      !projectId ||
      !worksheet ||
      !canEdit ||
      pendingImageDeletes.has(pendingImageDeleteKey(rowId, path))
    ) return;
    const deleteKey = pendingImageDeleteKey(rowId, path);
    setPendingImageDeletes((current) => {
      const next = new Set(current).add(deleteKey);
      pendingImageDeletesRef.current = next;
      return next;
    });
    setSaveStatus("saving");
    setWorksheet((current) =>
      current
        ? {
            ...current,
            rows: current.rows.map((row) =>
              row.id === rowId
                ? (() => {
                    const mainPaths = getRowMainPaths(row);
                    if (mainPaths.includes(path)) {
                      const nextMainPaths = mainPaths.filter((item) => item !== path);
                      return {
                        ...row,
                        mainImagePaths: nextMainPaths,
                        mainImagePath: nextMainPaths[0] ?? null,
                      };
                    }
                    return {
                      ...row,
                      galleryImagePaths: row.galleryImagePaths.filter(
                        (item) => item !== path
                      ),
                    };
                  })()
                : row
            ),
          }
        : current
    );
    try {
      const result = await enqueueMutation(async () => {
        const attemptDelete = (revision: number) =>
          deleteGalleryImage({
            workspaceId: workspace.id,
            sessionId: projectId,
            rowId,
            path,
            revision,
          });
        try {
          return await attemptDelete(worksheetRevisionRef.current);
        } catch (error) {
          if (!(error instanceof GalleryApiError) || error.status !== 409) {
            throw error;
          }
          // Revision race or transient sync — reload and retry once.
          const fresh = await getGallerySession(workspace.id, projectId, {
            includeSignedUrls: false,
          });
          worksheetRevisionRef.current = Number(
            fresh.session.worksheet_revision ?? 0
          );
          if (fresh.worksheet) {
            setWorksheet(
              stripPendingDeletesFromWorksheet(
                fresh.worksheet,
                pendingImageDeletesRef.current
              )
            );
          }
          setActiveSession(fresh.session);
          return await attemptDelete(worksheetRevisionRef.current);
        }
      });
      worksheetRevisionRef.current = Number(
        result.session.worksheet_revision ?? worksheetRevisionRef.current
      );
      // Clear this row+path from pending BEFORE applying the server worksheet so a
      // failed server-side delete is not masked by stripPendingImageDeletes.
      setPendingImageDeletes((current) => {
        const next = new Set(current);
        next.delete(deleteKey);
        pendingImageDeletesRef.current = next;
        return next;
      });
      const merged = stripPendingImageDeletes(result.worksheet);
      setWorksheet(merged);
      setActiveSession(result.session);
      setSignedUrls((current) => {
        const stillUsedElsewhere = merged.rows.some(
          (row) =>
            row.id !== rowId &&
            (getRowMainPaths(row).some((item) => imageRefsMatch(item, path)) ||
              row.galleryImagePaths.some((item) => imageRefsMatch(item, path)))
        );
        if (stillUsedElsewhere || !(path in current)) return current;
        const next = { ...current };
        delete next[path];
        return next;
      });
      const updatedRow = merged.rows.find((row) => row.id === rowId);
      const stillPresent =
        !!updatedRow &&
        (getRowMainPaths(updatedRow).some((item) => imageRefsMatch(item, path)) ||
          updatedRow.galleryImagePaths.some((item) =>
            imageRefsMatch(item, path)
          ));
      if (stillPresent) {
        setSaveStatus("error");
        toast.error("Image was not removed from the saved worksheet. Try again.");
      } else {
        if (imagePreviewPath === path && imageDialogRowId === rowId) {
          const remaining =
            imageDialogKind === "main"
              ? updatedRow
                ? getRowMainPaths(updatedRow)
                : []
              : updatedRow?.galleryImagePaths ?? [];
          setImagePreviewPath(remaining[0] ?? null);
          if (!remaining.length) {
            setImageDialogRowId(null);
          }
        }
        setSaveStatus("saved");
      }
    } catch (error) {
      // Never restore a stale local snapshot — that brings deleted images back.
      try {
        const fresh = await getGallerySession(workspace.id, projectId, {
          includeSignedUrls: true,
        });
        applySessionPayload(
          fresh.session,
          fresh.worksheet,
          false,
          fresh.signedUrls
        );
      } catch {
        // Keep the optimistic removal if the refresh fails.
      }
      setSaveStatus("error");
      toast.error(
        error instanceof Error ? error.message : "Failed to delete image"
      );
    } finally {
      setPendingImageDeletes((current) => {
        const next = new Set(current);
        next.delete(deleteKey);
        pendingImageDeletesRef.current = next;
        return next;
      });
    }
  };

  const deleteSelectedRows = async () => {
    if (
      !workspace ||
      !projectId ||
      !worksheet ||
      !canEdit ||
      selectedRowIds.size === 0 ||
      generationIsActive
    ) return;
    const rowIds = Array.from(selectedRowIds);
    const selected = new Set(rowIds);
    const pathsToForget = worksheet.rows
      .filter((row) => selected.has(row.id))
      .flatMap((row) => [
        ...getRowMainPaths(row),
        ...row.galleryImagePaths,
      ]);
    setDeletingRows(true);
    setSaveStatus("saving");
    try {
      const result = await enqueueMutation(() =>
        deleteGalleryRows({
          workspaceId: workspace.id,
          sessionId: projectId,
          rowIds,
          revision: worksheetRevisionRef.current,
        })
      );
      worksheetRevisionRef.current = Number(
        result.session.worksheet_revision ?? worksheetRevisionRef.current
      );
      setWorksheet(result.worksheet);
      setActiveSession(result.session);
      setSessions((current) =>
        current.map((session) =>
          session.id === result.session.id ? result.session : session
        )
      );
      setSignedUrls((current) => {
        const next = { ...current };
        for (const path of pathsToForget) delete next[path];
        return next;
      });
      setSelectedRowIds(new Set());
      setShowDeleteRows(false);
      setSaveStatus("saved");
      toast.success(
        `Deleted ${rowIds.length} product${rowIds.length === 1 ? "" : "s"}`
      );
    } catch (error) {
      setSaveStatus("error");
      toast.error(
        error instanceof Error ? error.message : "Failed to delete selected rows"
      );
    } finally {
      setDeletingRows(false);
    }
  };

  const columnLabel = (column: string) => {
    if (column === RESULT_MAIN) return "Main Image";
    if (column === RESULT_GALLERY) return "Gallery Images";
    return column;
  };

  const sampleForColumn = (columnId: string): string => {
    const first = rows[0]?.originalData[columnId];
    if (!first) return "Empty in this row";
    return first.length > 48 ? `${first.slice(0, 48)}…` : first;
  };

  const imageDialogRow =
    rows.find((row) => row.id === imageDialogRowId) ?? null;
  const imageDialogPaths = imageDialogRow
    ? imageDialogKind === "main"
      ? getRowMainPaths(imageDialogRow)
      : imageDialogRow.galleryImagePaths
    : [];
  const activeImagePreviewPath = imageDialogPaths.includes(
    imagePreviewPath || ""
  )
    ? imagePreviewPath
    : imageDialogPaths[0] ?? null;
  const activeImagePreviewSrc = resolvePathUrl(activeImagePreviewPath);
  const activeImageFallbackSrc = imageDialogRow
    ? getImageFallbackUrl(imageDialogRow, activeImagePreviewPath)
    : null;
  const activeImageSourceUrl = imageDialogRow
    ? getImageSourceUrl(imageDialogRow, activeImagePreviewPath)
    : null;
  const serverRunIsActive =
    worksheet?.activeRun?.status === "running" ||
    worksheet?.activeRun?.status === "queued";
  const generationIsActive = isGenerating || serverRunIsActive;

  // ── Project detail view ──────────────────────────────────────────────
  if (projectId) {
    if (sessionLoading && !worksheet) {
      return (
        <div className="flex h-[calc(100vh-3rem)] items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      );
    }

    if (sessionError && !worksheet) {
      return (
        <div className="mx-auto max-w-lg p-8 text-center">
          <p className="text-sm text-destructive">{sessionError}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={closeProject}>
            Back to projects
          </Button>
        </div>
      );
    }

    const title = activeSession?.name ?? "Gallery project";
    const fileLabel = activeSession?.source_file_name ?? "Worksheet";
    const productCount = activeSession?.total_rows ?? rows.length;
    const allVisibleSelected =
      visibleRows.length > 0 && visibleRows.every((row) => selectedRowIds.has(row.id));
    const generateDisabled =
      !canEdit ||
      selectedRowIds.size === 0 ||
      !!generationRun ||
      isGenerating ||
      !!aiAssetBusy ||
      isSavingSettings ||
      !!editingRowId;
    const selectedRowsForPhase = rows.filter((row) => selectedRowIds.has(row.id));
    const selectionPhase = resolveSelectionRunPhase({
      originalImageColumn:
        originalImageColumn === "none" ? null : originalImageColumn,
      rows: selectedRowsForPhase,
    });
    const generateButtonLabel =
      isGenerating || generationRun
        ? "Generating..."
        : `${selectionPhase.label}${
            selectedRowIds.size > 0 ? ` (${selectedRowIds.size})` : ""
          }`;

    return (
      <div className="flex h-[calc(100vh-3rem)] min-h-0 flex-col bg-background">
        <header className="flex h-14 shrink-0 items-center justify-between border-b px-5">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => void closeProjectSafely()}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">{title}</h1>
              <p className="truncate text-[11px] text-muted-foreground">
                {fileLabel} · {productCount} products
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant={saveStatus === "dirty" ? "default" : "outline"}
              size="sm"
              disabled={
                !canEdit ||
                saveStatus === "saving" ||
                saveStatus === "saved" ||
                !!generationRun ||
                isGenerating ||
                !!editingRowId
              }
              onClick={() => {
                void persistSettings().catch((error) => {
                  toast.error(
                    error instanceof Error ? error.message : "Save failed"
                  );
                });
              }}
              className="gap-1.5 text-xs"
              aria-live="polite"
            >
              {saveStatus === "saving" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : saveStatus === "error" ? (
                <AlertCircle className="h-3.5 w-3.5" />
              ) : saveStatus === "saved" ? (
                <CloudCheck className="h-3.5 w-3.5 text-emerald-600" />
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
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              disabled={isExporting || !worksheet || !!generationRun || isGenerating}
              onClick={handleExport}
            >
              {isExporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Export
            </Button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <aside className="max-h-[40vh] w-full shrink-0 overflow-y-auto border-b bg-muted/15 md:h-full md:max-h-none md:w-[310px] md:border-b-0 md:border-r">
            <div className="border-b p-4">
              <div className="grid grid-cols-2 rounded-lg bg-muted p-1">
                <button
                  type="button"
                  onClick={() => setActiveTab("scraping")}
                  disabled={!canEdit || !!generationRun || isGenerating}
                  className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
                    activeTab === "scraping" ? "bg-background shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  <Search className="h-3.5 w-3.5" /> Scraping
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("ai")}
                  disabled={!canEdit || !!generationRun || isGenerating}
                  className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
                    activeTab === "ai" ? "bg-background shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  <Sparkles className="h-3.5 w-3.5" /> AI
                </button>
              </div>
            </div>

            <fieldset
              disabled={!canEdit || !!generationRun || isGenerating}
              className="space-y-5 p-4 disabled:opacity-60"
            >
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  <h3 className="text-xs font-semibold">Original product image</h3>
                  <InfoTip>
                    This is never detected automatically. Select a column only when its first URL
                    should be the trusted main-image reference. Otherwise the agent finds a new
                    main image for every product.
                  </InfoTip>
                </div>
                <select
                  value={originalImageColumn}
                  onChange={(event) => {
                    const next = event.target.value;
                    setOriginalImageSelectionExplicit(true);
                    setOriginalImageColumn(next);
                    if (next !== "none") {
                      setSelectedColumns((current) => {
                        if (!current.has(next)) return current;
                        const nextSelected = new Set(current);
                        nextSelected.delete(next);
                        return nextSelected;
                      });
                    }
                  }}
                  disabled={!canEdit}
                  className="h-8 w-full rounded-md border bg-background px-2.5 text-xs outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="none">Find a new main image for every product</option>
                  {originalImageCandidateColumns.map((column) => (
                    <option key={column} value={column}>
                      {column}
                    </option>
                  ))}
                </select>
                {originalImageCandidateColumns.length === 0 &&
                originalImageColumn === "none" ? (
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    No URL columns detected in this sheet. Use “Find a new main
                    image” or add a column with image/page links.
                  </p>
                ) : null}
                {originalImageColumn === "none" ? (
                  <>
                    <ConfigSelect
                      label="Main images per product"
                      value={activeTab === "scraping" ? scrapingMainImages : aiMainImages}
                      onChange={
                        activeTab === "scraping" ? setScrapingMainImages : setAiMainImages
                      }
                      options={[
                        { value: "1", label: "1 image" },
                        { value: "2", label: "2 images" },
                        { value: "3", label: "3 images" },
                        { value: "4", label: "4 images" },
                        { value: "5", label: "5 images" },
                        { value: "6", label: "6 images" },
                      ]}
                    />
                    <label className="block space-y-1.5">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        Main · Custom instructions
                      </span>
                      <textarea
                        value={
                          activeTab === "scraping"
                            ? scrapingMainInstructions
                            : aiMainInstructions
                        }
                        onChange={(event) =>
                          activeTab === "scraping"
                            ? setScrapingMainInstructions(event.target.value)
                            : setAiMainInstructions(event.target.value)
                        }
                        className="min-h-28 w-full resize-none rounded-md border bg-background p-3 text-xs leading-relaxed outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
                        placeholder="Prefer clean white-background packshots, front-facing product shots, official brand photography..."
                      />
                    </label>
                  </>
                ) : null}
              </section>

              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground" />
                  <h3 className="text-xs font-semibold">Worksheet columns</h3>
                  <InfoTip>
                    The agent uses the selected columns to understand each product. All columns are
                    selected by default.
                  </InfoTip>
                </div>
                <div className="overflow-hidden rounded-md border">
                  <div className="grid grid-cols-[auto_1fr] gap-x-2 border-b bg-muted/50 px-2.5 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={
                        productColumns.length > 0 &&
                        productColumns.every((column) => selectedColumns.has(column))
                      }
                      ref={(element) => {
                        if (!element) return;
                        const selectedCount = productColumns.filter((column) =>
                          selectedColumns.has(column)
                        ).length;
                        element.indeterminate =
                          selectedCount > 0 && selectedCount < productColumns.length;
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
                      const isSelected = selectedColumns.has(column);
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
                            <span className="block truncate text-xs font-medium">{column}</span>
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
                    productColumns.filter((column) => selectedColumns.has(column))
                      .length
                  }{" "}
                  of {productColumns.length} columns selected
                </p>
              </section>

              <section className="space-y-3 border-t pt-5">
                {activeTab === "scraping" ? (
                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h3 className="text-xs font-semibold">Find product images</h3>
                        <InfoTip>
                          One web image-search request identifies the exact product and selects Main
                          plus distinct Gallery angles together. If you provide an original image,
                          it is kept as Main and used as the visual reference. If no reliable Gallery
                          images are found, the cell shows “No gallery images found”.
                        </InfoTip>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Powered by Standard or Premium image search.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 rounded-lg bg-muted p-1">
                      <button
                        type="button"
                        onClick={() => setScrapingModel("standard")}
                        className={`rounded-md py-1.5 text-xs font-medium transition-colors ${
                          scrapingModel === "standard"
                            ? "bg-background shadow-sm"
                            : "text-muted-foreground"
                        }`}
                      >
                        Standard
                      </button>
                      <button
                        type="button"
                        onClick={() => setScrapingModel("pro")}
                        className={`rounded-md py-1.5 text-xs font-medium transition-colors ${
                          scrapingModel === "pro"
                            ? "bg-background shadow-sm"
                            : "text-muted-foreground"
                        }`}
                      >
                        Premium
                      </button>
                    </div>
                    <ConfigSelect
                      label="Gallery images per product"
                      value={scrapingImages}
                      onChange={setScrapingImages}
                      options={[
                        { value: "1", label: "1 image" },
                        { value: "2", label: "2 images" },
                        { value: "4", label: "4 images" },
                        { value: "6", label: "6 images" },
                        { value: "8", label: "8 images" },
                        { value: "10", label: "10 images" },
                      ]}
                    />
                    <label className="block space-y-1.5">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        Gallery · Custom instructions
                      </span>
                      <textarea
                        value={scrapingInstructions}
                        onChange={(event) => setScrapingInstructions(event.target.value)}
                        className="min-h-28 w-full resize-none rounded-md border bg-background p-3 text-xs leading-relaxed outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
                        placeholder="Prefer official brand pages, white-background packshots, side and detail angles. Avoid watermarks and marketplace screenshots..."
                      />
                    </label>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h3 className="text-xs font-semibold">Generate product images</h3>
                        <InfoTip>
                          Creates a main product image when necessary, then matching gallery images.
                        </InfoTip>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Powered by Nano Banana 2 or Nano Banana Pro.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 rounded-lg bg-muted p-1">
                      <button
                        type="button"
                        onClick={() => setAiModel("standard")}
                        className={`rounded-md py-1.5 text-xs font-medium transition-colors ${
                          aiModel === "standard"
                            ? "bg-background shadow-sm"
                            : "text-muted-foreground"
                        }`}
                      >
                        Standard
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAiModel("pro");
                          setAiResolution((current) => (current === "0.5K" ? "1K" : current));
                        }}
                        className={`rounded-md py-1.5 text-xs font-medium transition-colors ${
                          aiModel === "pro" ? "bg-background shadow-sm" : "text-muted-foreground"
                        }`}
                      >
                        Premium
                      </button>
                    </div>
                    <ConfigSelect
                      label="Gallery images"
                      value={aiImages}
                      onChange={setAiImages}
                      options={[
                        { value: "1", label: "1 gallery image" },
                        { value: "2", label: "2 gallery images" },
                        { value: "4", label: "4 gallery images" },
                        { value: "6", label: "6 gallery images" },
                        { value: "8", label: "8 gallery images" },
                      ]}
                    />
                    <p className="text-[11px] text-muted-foreground -mt-1">
                      Main Image is separate: copied from the original column when selected, otherwise generated. It is never counted here.
                    </p>
                    <div className="grid grid-cols-2 gap-2.5">
                      <ConfigSelect
                        label="Aspect ratio"
                        value={aiAspectRatio}
                        onChange={setAiAspectRatio}
                        options={[
                          { value: "1:1", label: "1:1 Square" },
                          { value: "4:5", label: "4:5 Portrait" },
                          { value: "3:4", label: "3:4 Portrait" },
                          { value: "2:3", label: "2:3 Portrait" },
                          { value: "3:2", label: "3:2 Landscape" },
                          { value: "4:3", label: "4:3 Landscape" },
                          { value: "16:9", label: "16:9 Wide" },
                          { value: "9:16", label: "9:16 Vertical" },
                          { value: "21:9", label: "21:9 Ultra-wide" },
                        ]}
                      />
                      <ConfigSelect
                        label="Output resolution"
                        value={aiResolution}
                        onChange={setAiResolution}
                        options={
                          aiModel === "pro"
                            ? [
                                { value: "1K", label: "1K" },
                                { value: "2K", label: "2K" },
                                { value: "4K", label: "4K" },
                              ]
                            : [
                                { value: "0.5K", label: "0.5K" },
                                { value: "1K", label: "1K" },
                                { value: "2K", label: "2K" },
                                { value: "4K", label: "4K" },
                              ]
                        }
                      />
                    </div>
                    <ConfigSelect
                      label="Style"
                      value={aiStyle}
                      onChange={setAiStyle}
                      options={[
                        { value: "studio", label: "Clean ecommerce studio" },
                        { value: "white", label: "White background product shot" },
                        { value: "lifestyle", label: "Lifestyle" },
                        { value: "editorial", label: "Editorial campaign" },
                        { value: "custom", label: "Custom instructions only" },
                      ]}
                    />
                    <label className="block space-y-1.5">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        Gallery · Custom instructions
                      </span>
                      <textarea
                        value={aiInstructions}
                        onChange={(event) => setAiInstructions(event.target.value)}
                        className="min-h-28 w-full resize-none rounded-md border bg-background p-3 text-xs leading-relaxed outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
                        placeholder="Describe the visual direction, camera angle, background, product details, and anything the image must avoid..."
                      />
                    </label>
                    <div className="space-y-1.5">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        Scene or model reference
                      </span>
                      <div className="group relative">
                        <button
                          type="button"
                          onClick={() => sceneReferenceInputRef.current?.click()}
                          disabled={aiAssetBusy === "sceneReference"}
                          className="relative flex min-h-24 w-full flex-col items-center justify-center gap-1.5 overflow-hidden rounded-md border border-dashed bg-muted/20 text-center transition-colors hover:bg-muted/40 disabled:opacity-60"
                        >
                          {sceneReference ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={sceneReference.previewUrl}
                              alt={sceneReference.name}
                              className="absolute inset-0 h-full w-full object-cover"
                            />
                          ) : (
                            <>
                              <Upload className="h-4 w-4 text-muted-foreground" />
                              <span className="max-w-full truncate px-3 text-xs font-medium">
                                Upload a scene or model image
                              </span>
                            </>
                          )}
                        </button>
                        {sceneReference ? (
                          <button
                            type="button"
                            aria-label="Remove scene or model reference"
                            disabled={aiAssetBusy === "sceneReference"}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void removeAiAsset("sceneReference");
                            }}
                            className="absolute top-1.5 right-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white opacity-0 shadow transition-opacity group-hover:opacity-100 hover:bg-destructive"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </div>
                      <input
                        ref={sceneReferenceInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(event) => {
                          void uploadAiAsset(
                            "sceneReference",
                            event.target.files?.[0]
                          );
                          event.target.value = "";
                        }}
                      />
                    </div>
                    <div className="space-y-3 rounded-md border bg-muted/15 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Palette className="h-3.5 w-3.5 text-muted-foreground" />
                            <h4 className="text-xs font-semibold">Branding</h4>
                            <InfoTip>
                              When enabled, logo and either a brand-guide image or
                              manual colors are sent to the image model — matching
                              the Visualizer branding flow.
                            </InfoTip>
                          </div>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Apply logo, brand guide, and colors to generated visuals.
                          </p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={brandingEnabled}
                          aria-label="Toggle branding"
                          onClick={() => setBrandingEnabled((current) => !current)}
                          className={`relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors ${
                            brandingEnabled ? "bg-foreground" : "bg-muted"
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-background shadow-sm transition-transform ${
                              brandingEnabled ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </button>
                      </div>
                      {brandingEnabled ? (
                        <div className="space-y-3 rounded-md border bg-background p-2.5">
                          <div className="space-y-1.5">
                            <span className="text-[11px] font-medium text-muted-foreground">
                              Brand logo
                            </span>
                            <div className="group relative">
                              <button
                                type="button"
                                disabled={aiAssetBusy === "logo"}
                                onClick={() => brandLogoInputRef.current?.click()}
                                className="relative flex min-h-16 w-full items-center justify-center overflow-hidden rounded-md border border-dashed bg-muted/20 text-xs hover:bg-muted/40 disabled:opacity-60"
                              >
                                {brandLogo ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={brandLogo.previewUrl}
                                    alt={brandLogo.name}
                                    className="absolute inset-0 h-full w-full object-contain p-1"
                                  />
                                ) : (
                                  <span>Upload brand logo</span>
                                )}
                              </button>
                              {brandLogo ? (
                                <button
                                  type="button"
                                  aria-label="Remove brand logo"
                                  disabled={aiAssetBusy === "logo"}
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    void removeAiAsset("logo");
                                  }}
                                  className="absolute top-1.5 right-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white opacity-0 shadow transition-opacity group-hover:opacity-100 hover:bg-destructive"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              ) : null}
                            </div>
                            <input
                              ref={brandLogoInputRef}
                              type="file"
                              accept="image/png,image/jpeg,image/webp"
                              className="hidden"
                              onChange={(event) => {
                                void uploadAiAsset(
                                  "logo",
                                  event.target.files?.[0]
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
                                  onClick={() => setBrandGuideMode(mode)}
                                  className={`rounded-md py-1.5 text-[11px] font-medium transition-colors ${
                                    brandGuideMode === mode
                                      ? "bg-background shadow-sm"
                                      : "text-muted-foreground"
                                  }`}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>

                            {brandGuideMode === "image" ? (
                              <div className="group relative">
                                <button
                                  type="button"
                                  disabled={aiAssetBusy === "brandGuide"}
                                  onClick={() =>
                                    brandGuideInputRef.current?.click()
                                  }
                                  className="relative flex min-h-16 w-full items-center justify-center overflow-hidden rounded-md border border-dashed bg-muted/20 text-xs hover:bg-muted/40 disabled:opacity-60"
                                >
                                  {brandGuide ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={brandGuide.previewUrl}
                                      alt={brandGuide.name}
                                      className="absolute inset-0 h-full w-full object-cover"
                                    />
                                  ) : (
                                    <span>Upload brand guide</span>
                                  )}
                                </button>
                                {brandGuide ? (
                                  <button
                                    type="button"
                                    aria-label="Remove brand guide"
                                    disabled={aiAssetBusy === "brandGuide"}
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      void removeAiAsset("brandGuide");
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
                                    void uploadAiAsset(
                                      "brandGuide",
                                      event.target.files?.[0]
                                    );
                                    event.target.value = "";
                                  }}
                                />
                              </div>
                            ) : (
                              <div className="grid grid-cols-3 gap-2">
                                {brandColors.map((color, index) => {
                                  const normalized =
                                    normalizeHexColor(color) ?? "#000000";
                                  return (
                                    <label key={index} className="space-y-1">
                                      <span className="block text-[10px] text-muted-foreground">
                                        {
                                          ["Primary", "Secondary", "Accent"][
                                            index
                                          ]
                                        }
                                      </span>
                                      <span className="flex h-8 items-center gap-1 rounded-md border bg-background px-1.5">
                                        <input
                                          type="color"
                                          value={normalized}
                                          onChange={(event) =>
                                            setBrandColors((current) =>
                                              current.map((item, itemIndex) =>
                                                itemIndex === index
                                                  ? event.target.value.toUpperCase()
                                                  : item
                                              )
                                            )
                                          }
                                          className="h-4 w-4 shrink-0 cursor-pointer border-0 bg-transparent p-0"
                                        />
                                        <input
                                          type="text"
                                          value={color}
                                          spellCheck={false}
                                          onChange={(event) => {
                                            const nextValue = event.target.value;
                                            setBrandColors((current) =>
                                              current.map((item, itemIndex) =>
                                                itemIndex === index
                                                  ? nextValue
                                                  : item
                                              )
                                            );
                                          }}
                                          onBlur={() => {
                                            const normalizedOnBlur =
                                              normalizeHexColor(color);
                                            if (!normalizedOnBlur) return;
                                            setBrandColors((current) =>
                                              current.map((item, itemIndex) =>
                                                itemIndex === index
                                                  ? normalizedOnBlur
                                                  : item
                                              )
                                            );
                                          }}
                                          className="min-w-0 flex-1 bg-transparent text-[10px] uppercase outline-none"
                                          placeholder="#000000"
                                        />
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}

                {hasAdvancedSettings && (
                  <button
                    type="button"
                    onClick={() => setShowMore(!showMore)}
                    className="flex w-full items-center justify-between text-xs text-muted-foreground hover:text-foreground"
                  >
                    <span className="flex items-center gap-1.5">
                      <SlidersHorizontal className="h-3.5 w-3.5" /> Advanced settings
                    </span>
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${showMore ? "rotate-180" : ""}`}
                    />
                  </button>
                )}
                {hasAdvancedSettings &&
                  showMore &&
                  (activeTab === "scraping" ? (
                    <div className="space-y-3 rounded-md border bg-muted/20 p-2.5">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Selection filters
                      </p>
                      <ConfigSelect
                        label="Candidate depth"
                        value={scrapingSearchDepth}
                        onChange={setScrapingSearchDepth}
                        options={[
                          { value: "low", label: "Low — fewer candidates" },
                          { value: "medium", label: "Medium — recommended" },
                          { value: "high", label: "High — more candidates" },
                        ]}
                      />
                      <p className="text-[10px] leading-snug text-muted-foreground">
                        Collects more image candidates than your target count, then filters down to
                        the best matches.
                      </p>
                      <ConfigSelect
                        label="Source preference"
                        value={scrapingSourcePolicy}
                        onChange={setScrapingSourcePolicy}
                        options={[
                          { value: "any", label: "Any source" },
                          { value: "prefer-official", label: "Prefer official brand sources" },
                          { value: "official-only", label: "Official brand sources only" },
                        ]}
                      />
                      <ConfigSelect
                        label="Preferred gallery resolution"
                        value={scrapingResolution}
                        onChange={setScrapingResolution}
                        options={[
                          { value: "0", label: "Any resolution" },
                          { value: "800", label: "800 × 800 px" },
                          { value: "1200", label: "1200 × 1200 px" },
                          { value: "1600", label: "1600 × 1600 px" },
                          { value: "2000", label: "2000 × 2000 px" },
                        ]}
                      />
                      <ConfigSelect
                        label="Preferred gallery aspect ratio"
                        value={scrapingAspectRatio}
                        onChange={setScrapingAspectRatio}
                        options={[
                          { value: "any", label: "Any aspect ratio" },
                          { value: "square", label: "Square" },
                          { value: "portrait", label: "Portrait" },
                          { value: "landscape", label: "Landscape" },
                        ]}
                      />
                      <p className="px-0.5 text-[10px] leading-snug text-muted-foreground">
                        These filters apply to the Gallery agent only. Main uses only its image
                        count and custom instructions. Exact product matching is always enforced.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3 rounded-md border bg-muted/20 p-2.5">
                      {aiModel === "pro" && (
                        <>
                          <ConfigSelect
                            label="Output file type"
                            value={aiOutputFormat}
                            onChange={setAiOutputFormat}
                            options={[
                              { value: "image/jpeg", label: "JPEG" },
                              { value: "image/png", label: "PNG" },
                            ]}
                          />
                          <label className="flex cursor-pointer items-center justify-between rounded-md border bg-background px-2.5 py-2">
                            <span className="text-xs">Use Google Search</span>
                            <input
                              type="checkbox"
                              checked={aiGroundWithSearch}
                              onChange={(event) => setAiGroundWithSearch(event.target.checked)}
                              className="h-3.5 w-3.5 accent-primary"
                            />
                          </label>
                        </>
                      )}
                    </div>
                  ))}
              </section>
              <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-[10px] text-muted-foreground">
                <CloudCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                Settings and worksheet edits save automatically.
              </div>
            </fieldset>
          </aside>

          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-5">
              <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 shadow-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAllRows}
                      className="h-3.5 w-3.5 accent-primary"
                    />
                    Select visible
                  </label>
                  <div className="relative w-52">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={worksheetSearch}
                      onChange={(event) => setWorksheetSearch(event.target.value)}
                      placeholder="Search products or SKU..."
                      className="h-8 pl-8 text-xs"
                    />
                  </div>
                  <select
                    value={worksheetFilter}
                    onChange={(event) =>
                      setWorksheetFilter(event.target.value as typeof worksheetFilter)
                    }
                    className="h-8 rounded-md border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="all">All products</option>
                    <option value="selected">Selected</option>
                    <option value="not-started">Not started</option>
                    <option value="ready">Ready</option>
                  </select>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      {selectedRowIds.size} of {rows.length} products selected
                    </span>
                    {selectedRowIds.size > 0 && (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        className="gap-1.5 text-xs"
                        disabled={
                          generationIsActive ||
                          deletingRows ||
                          isSavingSettings ||
                          !!editingRowId
                        }
                        onClick={() => setShowDeleteRows(true)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete ({selectedRowIds.size})
                      </Button>
                    )}
                    {generationIsActive ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        className="gap-1.5 text-xs"
                        disabled={!canEdit || isStoppingGeneration}
                        onClick={() => void stopGeneration()}
                      >
                        {isStoppingGeneration ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Square className="h-3.5 w-3.5 fill-current" />
                        )}
                        {isStoppingGeneration ? "Stopping…" : "Stop"}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className="gap-1.5 text-xs"
                        disabled={generateDisabled}
                        onClick={() => runGeneration(Array.from(selectedRowIds))}
                      >
                        <WandSparkles className="h-3.5 w-3.5" />
                        {generateButtonLabel}
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {generationRun && generationIsActive && (
                <div className="mb-3 flex shrink-0 flex-wrap items-center gap-3 rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <div className="min-w-36">
                    <p className="text-xs font-medium">
                      Processing {generationRun.total} products
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {isStoppingGeneration
                        ? "Finishing the current product before stopping"
                        : "Keep this page open until generation finishes"}
                    </p>
                  </div>
                </div>
              )}

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
                  className="text-left text-xs"
                  style={{ minWidth: `${tableMinWidthPx}px`, width: "max-content" }}
                >
                  <thead className="sticky top-0 z-20 border-b bg-muted text-[10px] uppercase tracking-wide text-muted-foreground shadow-sm">
                    <tr>
                      <th className="sticky left-0 top-0 z-30 w-10 bg-muted px-3 py-3">
                        <input
                          type="checkbox"
                          checked={allVisibleSelected}
                          onChange={toggleAllRows}
                          className="h-3.5 w-3.5 accent-primary"
                          aria-label="Select visible products"
                        />
                      </th>
                      {displayColumns.map((column) => (
                        <th
                          key={column}
                          className={`whitespace-nowrap bg-muted px-3 py-3 ${
                            column === RESULT_MAIN || column === RESULT_GALLERY
                              ? "min-w-[140px] text-foreground"
                              : "min-w-[160px]"
                          }`}
                        >
                          {columnLabel(column)}
                        </th>
                      ))}
                      <th className="sticky right-0 top-0 z-30 w-16 border-l bg-muted px-3 py-3 shadow-[-8px_0_12px_-10px_rgba(0,0,0,0.65)]">
                        Edit
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={displayColumns.length + 2}
                          className="px-3 py-8 text-center text-muted-foreground"
                        >
                          {rows.length === 0
                            ? "No rows in this worksheet."
                            : "No products match the current filters."}
                        </td>
                      </tr>
                    ) : (
                      visibleRows.map((row) => {
                        const isEditing = editingRowId === row.id && rowDraft;
                        const rowIsGenerating =
                          generationIsActive && row.status === "generating";
                        const mainIsLoading =
                          rowIsGenerating &&
                          ((row.generationStage === "planning" &&
                            (row.generationTarget === "main" ||
                              row.generationTarget === "full")) ||
                            row.generationStage === "searching" ||
                            row.generationStage === "main" ||
                            (!row.generationStage &&
                              row.generationTarget !== "gallery"));
                        const galleryIsLoading =
                          rowIsGenerating &&
                          (row.generationStage === "gallery" ||
                            (row.generationStage === "planning" &&
                              row.generationTarget === "gallery"));
                        return (
                          <tr
                            key={row.id}
                            className={`border-b transition-colors last:border-0 hover:bg-muted/40 ${
                              selectedRowIds.has(row.id) ? "bg-primary/5" : ""
                            }`}
                          >
                            <td
                              className={`sticky left-0 z-10 px-3 py-3 ${
                                selectedRowIds.has(row.id) ? "bg-primary/5" : "bg-background"
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
                              if (column === RESULT_MAIN) {
                                const mainImages = getRowMainPaths(row)
                                  .map((path) => ({
                                    path,
                                    src: resolvePathUrl(path),
                                    fallbackSrc: getImageFallbackUrl(row, path),
                                  }))
                                  .filter(
                                    (
                                      item
                                    ): item is {
                                      path: string;
                                      src: string;
                                      fallbackSrc: string | null;
                                    } => !!item.src
                                  );
                                return (
                                  <td key={column} className="min-w-[140px] px-3 py-3">
                                    {mainImages.length > 0 ? (
                                      <div className="flex items-center gap-1">
                                        {mainImages.map(
                                          ({ path, src, fallbackSrc }, idx) => (
                                            <div
                                              key={`${row.id}:main:${idx}:${path}`}
                                              className="group/image relative h-10 w-10 shrink-0 overflow-visible"
                                            >
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setImageDialogKind("main");
                                                  setImageDialogRowId(row.id);
                                                  setImagePreviewPath(path);
                                                }}
                                                className="block h-full w-full overflow-hidden rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                                aria-label={`Preview main image ${idx + 1}`}
                                              >
                                                <img
                                                  className="h-full w-full object-cover transition-transform group-hover/image:scale-105"
                                                  src={src}
                                                  alt=""
                                                  onError={(event) => {
                                                    if (
                                                      fallbackSrc &&
                                                      event.currentTarget.src !==
                                                        fallbackSrc
                                                    ) {
                                                      event.currentTarget.src =
                                                        fallbackSrc;
                                                    }
                                                  }}
                                                />
                                              </button>
                                              {canEdit && (
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    void removeProductImage(row.id, path)
                                                  }
                                                  disabled={pendingImageDeletes.has(
                                                    pendingImageDeleteKey(row.id, path)
                                                  )}
                                                  className="absolute -right-1.5 -top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border bg-background text-destructive opacity-0 shadow-sm transition-opacity hover:bg-destructive hover:text-destructive-foreground group-hover/image:opacity-100 focus:opacity-100 disabled:opacity-60"
                                                  aria-label={`Delete main image ${idx + 1}`}
                                                >
                                                  {pendingImageDeletes.has(
                                                    pendingImageDeleteKey(row.id, path)
                                                  ) ? (
                                                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                                  ) : (
                                                    <X className="h-2.5 w-2.5" />
                                                  )}
                                                </button>
                                              )}
                                            </div>
                                          )
                                        )}
                                        {mainIsLoading && (
                                          <div
                                            className="ml-1 flex h-8 w-8 items-center justify-center rounded border border-primary/30 bg-primary/5"
                                            title="Finding more main images"
                                          >
                                            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                                          </div>
                                        )}
                                      </div>
                                    ) : mainIsLoading ? (
                                      <div
                                        className="flex h-12 w-12 items-center justify-center rounded border border-primary/30 bg-primary/5"
                                        title="Finding the main product image"
                                      >
                                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                                      </div>
                                    ) : row.status === "failed" ? (
                                      <div className="max-w-[180px] space-y-1.5">
                                        <p
                                          className="text-[10px] leading-snug text-amber-700 dark:text-amber-400"
                                          title={row.errorMessage || undefined}
                                        >
                                          {/no suitable main image found/i.test(
                                            row.errorMessage || ""
                                          )
                                            ? "No suitable main image found for this product"
                                            : row.errorMessage ||
                                              "Main image generation failed"}
                                        </p>
                                        {!/no suitable main image found/i.test(
                                          row.errorMessage || ""
                                        ) && (
                                          <button
                                            type="button"
                                            onClick={() => retryRow(row.id)}
                                            disabled={!canEdit || isGenerating || !!generationRun}
                                            className="inline-flex items-center gap-1 rounded border border-destructive/30 px-2 py-0.5 text-[10px] text-destructive hover:bg-destructive/5 disabled:opacity-50"
                                          >
                                            <RotateCcw className="h-3 w-3" /> Retry
                                          </button>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="flex h-12 w-12 items-center justify-center rounded border border-dashed text-muted-foreground">
                                        <ImageIcon className="h-3.5 w-3.5" />
                                      </div>
                                    )}
                                  </td>
                                );
                              }

                              if (column === RESULT_GALLERY) {
                                const galleryImages = row.galleryImagePaths
                                  .map((path) => ({
                                    path,
                                    src: resolvePathUrl(path),
                                    fallbackSrc: getImageFallbackUrl(row, path),
                                  }))
                                  .filter(
                                    (
                                      item
                                    ): item is {
                                      path: string;
                                      src: string;
                                      fallbackSrc: string | null;
                                    } =>
                                      !!item.src
                                  );
                                return (
                                  <td key={column} className="min-w-[180px] px-3 py-3">
                                    {galleryImages.length > 0 ? (
                                      <div className="flex items-center gap-1">
                                        {galleryImages.slice(0, 3).map(({ path, src, fallbackSrc }, idx) => (
                                          <div
                                            key={`${row.id}:gallery:${idx}:${path}`}
                                            className="group/image relative h-10 w-10 shrink-0"
                                          >
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setImageDialogKind("gallery");
                                                setImageDialogRowId(row.id);
                                                setImagePreviewPath(path);
                                              }}
                                              className="block h-full w-full overflow-hidden rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                              aria-label={`Preview gallery image ${idx + 1}`}
                                            >
                                              <img
                                                className="h-full w-full object-cover transition-transform group-hover/image:scale-105"
                                                src={src}
                                                alt=""
                                                onError={(event) => {
                                                  if (
                                                    fallbackSrc &&
                                                    event.currentTarget.src !== fallbackSrc
                                                  ) {
                                                    event.currentTarget.src = fallbackSrc;
                                                  }
                                                }}
                                              />
                                            </button>
                                            {canEdit && (
                                              <button
                                                type="button"
                                                onClick={() => void removeProductImage(row.id, path)}
                                                disabled={pendingImageDeletes.has(
                                                  pendingImageDeleteKey(row.id, path)
                                                )}
                                                className="absolute -right-1.5 -top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border bg-background text-destructive opacity-0 shadow-sm transition-opacity hover:bg-destructive hover:text-destructive-foreground group-hover/image:opacity-100 focus:opacity-100 disabled:opacity-60"
                                                aria-label={`Delete gallery image ${idx + 1}`}
                                              >
                                                {pendingImageDeletes.has(
                                                  pendingImageDeleteKey(row.id, path)
                                                ) ? (
                                                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                                ) : (
                                                  <X className="h-2.5 w-2.5" />
                                                )}
                                              </button>
                                            )}
                                          </div>
                                        ))}
                                        {galleryImages.length > 3 && (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setImageDialogKind("gallery");
                                              setImageDialogRowId(row.id);
                                              setImagePreviewPath(
                                                galleryImages[0]?.path ?? null
                                              );
                                            }}
                                            className="flex h-10 items-center gap-1 rounded border bg-muted/30 px-2 text-[10px] font-medium text-muted-foreground hover:border-primary/40 hover:text-foreground"
                                          >
                                            <Maximize2 className="h-3 w-3" />
                                            +{galleryImages.length - 3}
                                          </button>
                                        )}
                                        {galleryIsLoading && (
                                          <div
                                            className="ml-1 flex h-8 w-8 items-center justify-center rounded border border-primary/30 bg-primary/5"
                                            title="Finding more gallery images"
                                          >
                                            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                                          </div>
                                        )}
                                      </div>
                                    ) : galleryIsLoading ? (
                                      <div
                                        className="flex h-10 w-10 items-center justify-center rounded border border-primary/30 bg-primary/5"
                                        title="Finding gallery images"
                                      >
                                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                                      </div>
                                    ) : row.status === "failed" ? (
                                      getRowMainPaths(row).length === 0 ? (
                                        <span className="text-[10px] text-muted-foreground">—</span>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => retryRow(row.id)}
                                          disabled={!canEdit || isGenerating || !!generationRun}
                                          title={row.errorMessage || "Generation failed"}
                                          className="inline-flex items-center gap-1 rounded border border-destructive/30 px-2 py-1 text-[10px] text-destructive hover:bg-destructive/5 disabled:opacity-50"
                                        >
                                          <RotateCcw className="h-3 w-3" /> Retry
                                        </button>
                                      )
                                    ) : row.status === "ready" &&
                                      /no gallery images found/i.test(
                                        row.errorMessage || ""
                                      ) ? (
                                      <span
                                        className="text-[10px] text-amber-700 dark:text-amber-400"
                                        title={row.errorMessage || undefined}
                                      >
                                        No gallery images found
                                      </span>
                                    ) : (
                                      <span className="text-[10px] text-muted-foreground">—</span>
                                    )}
                                  </td>
                                );
                              }

                              const value = isEditing
                                ? rowDraft.originalData[column] ?? ""
                                : row.originalData[column] ?? "";
                              const isImageCol =
                                column === originalImageColumn && hasOriginalImageColumn;
                              return (
                                <td
                                  key={column}
                                  className="min-w-[160px] max-w-72 px-3 py-3 text-muted-foreground"
                                >
                                  {isEditing ? (
                                    <Input
                                      value={value}
                                      onChange={(event) =>
                                        setRowDraft({
                                          ...rowDraft,
                                          originalData: {
                                            ...rowDraft.originalData,
                                            [column]: event.target.value,
                                          },
                                        })
                                      }
                                      className="h-7 text-xs"
                                    />
                                  ) : isImageCol ? (
                                    getRowOriginalSrc(row) ? (
                                      <img
                                        className="h-9 w-9 rounded object-cover"
                                        src={getRowOriginalSrc(row)!}
                                        alt=""
                                      />
                                    ) : (
                                      <div className="flex h-9 w-9 items-center justify-center rounded border border-dashed text-muted-foreground">
                                        <ImageIcon className="h-3.5 w-3.5" />
                                      </div>
                                    )
                                  ) : (
                                    <span className="line-clamp-2">{value || "—"}</span>
                                  )}
                                </td>
                              );
                            })}
                            <td className="sticky right-0 z-20 border-l bg-background px-3 py-3 shadow-[-8px_0_12px_-10px_rgba(0,0,0,0.65)]">
                              {isEditing ? (
                                <button
                                  type="button"
                                  onClick={saveRow}
                                  disabled={savingRowId === row.id}
                                  className="rounded p-1 text-emerald-600 hover:bg-emerald-500/10"
                                  aria-label="Finish editing"
                                  title="Finish editing — changes save automatically"
                                >
                                  {savingRowId === row.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Check className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={!canEdit || (!!editingRowId && editingRowId !== row.id)}
                                  onClick={() => startEditingRow(row)}
                                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                                  aria-label={`Edit row ${row.rowIndex + 1}`}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </td>
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
            </div>
          </main>
        </div>
        <Dialog open={showDeleteRows} onOpenChange={setShowDeleteRows}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Delete selected products?</DialogTitle>
              <DialogDescription>
                {selectedRowIds.size} selected product
                {selectedRowIds.size === 1 ? "" : "s"} will be permanently
                removed from this worksheet. Their generated images will also
                be deleted from storage.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={deletingRows}
                onClick={() => setShowDeleteRows(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={deletingRows || selectedRowIds.size === 0}
                onClick={() => void deleteSelectedRows()}
              >
                {deletingRows ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                )}
                Delete permanently
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog
          open={showLeaveWithoutSaving}
          onOpenChange={setShowLeaveWithoutSaving}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-400">
                <AlertCircle className="h-4 w-4" />
              </div>
              <DialogTitle>Leave without saving?</DialogTitle>
              <DialogDescription>
                You have unsaved changes in this project. If you leave now,
                those changes will be lost.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="default"
                disabled={saveStatus === "saving" || !!savingRowId}
                onClick={() => void saveAndLeave()}
                className="gap-1.5"
              >
                {saveStatus === "saving" || savingRowId ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Cloud className="h-3.5 w-3.5" />
                )}
                {saveStatus === "saving" || savingRowId ? "Saving…" : "Save"}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={saveStatus === "saving" || !!savingRowId}
                onClick={confirmLeaveWithoutSaving}
              >
                Leave without saving
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog
          open={!!imageDialogRowId}
          onOpenChange={(open) => {
            if (!open) {
              setImageDialogRowId(null);
              setImagePreviewPath(null);
            }
          }}
        >
          <DialogContent className="max-w-4xl overflow-hidden p-0">
            <DialogHeader className="border-b px-6 py-4">
              <DialogTitle className="flex items-center gap-2">
                {imageDialogKind === "main" ? (
                  <ImageIcon className="h-4 w-4 text-primary" />
                ) : (
                  <GalleryHorizontalEnd className="h-4 w-4 text-primary" />
                )}
                {imageDialogKind === "main" ? "Main images" : "Product gallery"}
              </DialogTitle>
              <DialogDescription>
                {imageDialogRow
                  ? `${imageDialogRow.originalData.Name || imageDialogRow.originalData.name || `Product ${imageDialogRow.rowIndex + 1}`} · ${imageDialogPaths.length} image${imageDialogPaths.length === 1 ? "" : "s"}`
                  : "Preview and manage product images"}
              </DialogDescription>
            </DialogHeader>
            <div className="grid min-h-[430px] md:grid-cols-[1fr_260px]">
              <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 bg-muted/20 p-6">
                {activeImagePreviewSrc ? (
                  <>
                    <img
                      src={activeImagePreviewSrc}
                      alt=""
                      className="max-h-[60vh] max-w-full rounded-lg object-contain shadow-sm"
                      onError={(event) => {
                        if (
                          activeImageFallbackSrc &&
                          event.currentTarget.src !== activeImageFallbackSrc
                        ) {
                          event.currentTarget.src = activeImageFallbackSrc;
                        }
                      }}
                    />
                    {activeImageSourceUrl && (
                      <a
                        href={activeImageSourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        View image source
                      </a>
                    )}
                  </>
                ) : (
                  <div className="text-center text-xs text-muted-foreground">
                    <ImageIcon className="mx-auto mb-2 h-8 w-8 opacity-50" />
                    {imageDialogKind === "main"
                      ? "No main images"
                      : "No gallery images"}
                  </div>
                )}
              </div>
              <div className="border-l p-4">
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  All images
                </p>
                <div className="grid max-h-[58vh] grid-cols-2 gap-2 overflow-y-auto pr-1">
                  {imageDialogPaths.map((path, index) => {
                    if (!imageDialogRow) return null;
                    const src = resolvePathUrl(path);
                    const fallbackSrc = getImageFallbackUrl(imageDialogRow, path);
                    if (!src) return null;
                    return (
                      <div
                        key={`${imageDialogRow.id}:${imageDialogKind}:${index}:${path}`}
                        className={`group/dialog-image relative aspect-square overflow-hidden rounded-md border-2 ${
                          activeImagePreviewPath === path
                            ? "border-primary"
                            : "border-transparent"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setImagePreviewPath(path)}
                          className="h-full w-full"
                          aria-label={`View image ${index + 1}`}
                        >
                          <img
                            src={src}
                            alt=""
                            className="h-full w-full object-cover"
                            onError={(event) => {
                              if (
                                fallbackSrc &&
                                event.currentTarget.src !== fallbackSrc
                              ) {
                                event.currentTarget.src = fallbackSrc;
                              }
                            }}
                          />
                        </button>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() =>
                              void removeProductImage(imageDialogRow.id, path)
                            }
                            disabled={pendingImageDeletes.has(
                              pendingImageDeleteKey(imageDialogRow.id, path)
                            )}
                            className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-background/95 text-destructive opacity-0 shadow transition-opacity hover:bg-destructive hover:text-destructive-foreground group-hover/dialog-image:opacity-100 focus:opacity-100 disabled:opacity-60"
                            aria-label={`Delete image ${index + 1}`}
                          >
                            {pendingImageDeletes.has(
                              pendingImageDeleteKey(imageDialogRow.id, path)
                            ) ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ── Project list view ────────────────────────────────────────────────
  return (
    <div className="min-h-full bg-gradient-to-b from-muted/20 via-background to-background">
      <div className="mx-auto max-w-7xl space-y-6 p-5 sm:p-6 lg:p-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-background shadow-sm">
              <GalleryHorizontalEnd className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Products Gallery</h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Source, validate, and organize product imagery from your worksheets.
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
          <div className="flex flex-col gap-3 border-b bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold">Gallery projects</h2>
              <p className="text-[11px] text-muted-foreground">
                Open a project to manage its worksheet and generated assets.
              </p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={projectSearch}
                onChange={(event) => setProjectSearch(event.target.value)}
                placeholder="Search projects..."
                className="h-8 bg-background pl-8 text-xs"
              />
            </div>
          </div>

          {listLoading ? (
            <div className="flex h-56 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : listError ? (
            <div className="m-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              {listError}
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <GalleryHorizontalEnd className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-semibold">Create your first gallery project</h3>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                Upload an Excel or CSV product worksheet and let the gallery agent
                prepare consistent product imagery.
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
              No projects match “{projectSearch}”.
            </div>
          ) : (
            <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredProjects.map((session) => {
                const statusLabel =
                  SESSION_STATUS_LABEL[session.status] ?? session.status;
                const isReady =
                  session.status === "ready" || session.status === "completed";
                const progress =
                  session.total_rows > 0
                    ? Math.round(
                        ((session.ready_rows + session.failed_rows) /
                          session.total_rows) *
                          100
                      )
                    : 0;
                return (
                  <article
                    key={session.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openProject(session.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        openProject(session.id);
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
                          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                            {session.source_file_name}
                          </p>
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
                        <p className="text-xs font-semibold">{session.total_rows}</p>
                        <p className="text-[9px] text-muted-foreground">Products</p>
                      </div>
                      <div className="rounded-lg bg-muted/35 px-2 py-2">
                        <p className="text-xs font-semibold text-emerald-600">
                          {session.ready_rows}
                        </p>
                        <p className="text-[9px] text-muted-foreground">Ready</p>
                      </div>
                      <div className="rounded-lg bg-muted/35 px-2 py-2">
                        <p className="text-xs font-semibold text-destructive">
                          {session.failed_rows}
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
                        {timeAgo(session.updated_at)}
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
        <DialogContent className="overflow-hidden p-0 sm:max-w-xl">
          <div className="border-b bg-gradient-to-br from-primary/10 via-primary/5 to-transparent px-6 py-5">
            <DialogHeader>
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                <Plus className="h-4 w-4" />
              </div>
              <DialogTitle>Create gallery project</DialogTitle>
              <DialogDescription>
                Start with a product worksheet. You decide explicitly whether any column is used
                as the original-image reference.
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="space-y-5 px-6 py-5">
            <div className="space-y-1.5">
              <Label htmlFor="project-name">Project name</Label>
              <Input
                id="project-name"
                autoFocus
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="e.g. Autumn collection"
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Product worksheet</Label>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className={`flex min-h-28 w-full flex-col items-center justify-center rounded-xl border border-dashed px-5 py-4 text-center transition-colors ${
                  uploadFile
                    ? "border-primary/40 bg-primary/5"
                    : "hover:border-primary/40 hover:bg-muted/30"
                }`}
              >
                <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  {uploadFile ? (
                    <FileSpreadsheet className="h-4 w-4 text-primary" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                </div>
                <span className="max-w-full truncate text-xs font-medium">
                  {uploadFile?.name || "Choose an Excel or CSV file"}
                </span>
                <span className="mt-1 text-[10px] text-muted-foreground">
                  {uploadFile
                    ? `${(uploadFile.size / 1024 / 1024).toFixed(2)} MB · Click to replace`
                    : "XLSX, XLS, or CSV · Maximum 20 MB"}
                </span>
              </button>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(event) => setUploadFile(event.target.files?.[0] || null)}
              />
            </div>
          </div>
          <DialogFooter className="border-t bg-muted/20 px-6 py-4">
            <Button
              variant="outline"
              disabled={creating}
              onClick={() => setShowCreate(false)}
            >
              Cancel
            </Button>
            <Button
              className="gap-1.5"
              disabled={!projectName.trim() || !uploadFile || creating || !canEdit}
              onClick={createProject}
            >
              {creating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Create project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !deletingProject) setDeleteTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <Trash2 className="h-4 w-4" />
            </div>
            <DialogTitle>Delete gallery project?</DialogTitle>
            <DialogDescription>
              This permanently deletes “{deleteTarget?.name}”, its worksheet,
              source file, generated images, and exports from storage.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-[11px] text-destructive">
            This action cannot be undone.
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={deletingProject}
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="gap-1.5"
              disabled={deletingProject}
              onClick={deleteProject}
            >
              {deletingProject ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
