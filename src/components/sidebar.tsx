"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Sparkles,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Database,
  Columns3,
  ChevronDown,
  ChevronRight,
  Settings2,
  Zap,
  PanelLeftClose,
  PanelLeft,
  Plus,
  X,
  ArrowLeft,
  Lock,
  Search,
  FileEdit,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSheetStore } from "@/store/sheet-store";
import { useWorkspaceStore } from "@/store/workspace-store";
import { ExportDialog } from "@/components/export-dialog";
import { FunctionsPanel } from "@/components/functions-panel";
import {
  LANGUAGE_OPTIONS,
  MODEL_OPTIONS,
  TONE_OPTIONS,
  getDefaultEnrichmentColumns,
  resolveEnrichmentModel,
  type OutputLanguage,
  type EnrichmentModel,
  type WritingTone,
  type ContentLength,
  type CategoryItem,
  type EnrichmentPreset,
  type EnrichmentColumn,
} from "@/types";
import type { EnrichSettings } from "@/lib/enrich";
import type { ProjectJson } from "@/lib/storage-helpers";
import { getEnrichmentPresets, saveEnrichmentPreset } from "@/lib/supabase";
import type { ProductRow } from "@/types";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function projectJsonToProductRows(project: ProjectJson): ProductRow[] {
  return project.rows.map((r, idx) => ({
    id: r.id,
    rowIndex: r.rowIndex ?? idx,
    selected: true,
    status: r.status as ProductRow["status"],
    errorMessage: r.errorMessage,
    originalData: r.originalData || {},
    enrichedData: r.enrichedData || {},
    matchType: r.matchType,
  }));
}

export function Sidebar() {
  const router = useRouter();
  const { workspace, invalidateCredits, role } = useWorkspaceStore();
  const isViewer = role === "viewer";
  const {
    rows,
    fileName,
    originalColumns,
    sourceColumns,
    enrichmentColumns,
    enrichmentSettings,
    selectedRowIds,
    activeSheet,
    sessionKind,
    workspaceId: sheetWorkspaceId,
    projectId,
    applyProjectRows,
    applyEnrichmentPreset,
    toggleEnrichmentColumn,
    setAllEnrichmentColumns,
    addCustomEnrichmentColumn,
    removeCustomEnrichmentColumn,
    updateEnrichmentColumnConfig,
    toggleSourceColumn,
    setAllSourceColumns,
    existingColumnsToEnrich,
    toggleExistingColumnEnrich,
    clearExistingColumnEnrich,
    existingColumnInstructions,
    setExistingColumnInstruction,
    updateCellValue,
    isEnriching,
    isPaused,
    setIsEnriching,
    setPaused,
    enrichProgress,
    totalToEnrich,
    completedEnrich,
    errorCount,
    setRowStatus,
    setRowEnrichedData,
    setEnrichProgress,
    incrementError,
    resetEnrichState,
    sidebarOpen,
    setSidebarOpen,
    updateSettings,
    setEnrichingContext,
  } = useSheetStore();

  const abortControllerRef = useRef<AbortController | null>(null);
  const enrichRunIdRef = useRef<string | null>(null);
  const enrichPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPlp = sessionKind === "plp";

  const [sidebarTab, setSidebarTab] = useState<"ai" | "functions">("ai");

  // Functions (Math, Generate, Clean, Copy & Fill) act on matched product
  // rows — PLP has none of that, so it only ever gets the AI tab.
  useEffect(() => {
    if (isPlp) setSidebarTab("ai");
  }, [isPlp]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [enrichSectionOpen, setEnrichSectionOpen] = useState(true);
  const [sourceSectionOpen, setSourceSectionOpen] = useState(true);
  const [settingsSectionOpen, setSettingsSectionOpen] = useState(false);
  const [showAddColumn, setShowAddColumn] = useState(false);
  const [newColLabel, setNewColLabel] = useState("");
  const [newColType, setNewColType] = useState<"text" | "list">("text");
  const [newColPrompt, setNewColPrompt] = useState("");
  const [expandedColumns, setExpandedColumns] = useState<Set<string>>(new Set());
  const [enrichOutputTab, setEnrichOutputTab] = useState<"new" | "existing">("new");
  const [existingSearch, setExistingSearch] = useState("");
  const [expandedExistingCols, setExpandedExistingCols] = useState<Set<string>>(new Set());
  const [existingColDrafts, setExistingColDrafts] = useState<Record<string, string>>({});
  const [presets, setPresets] = useState<EnrichmentPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState("");

  // Saved settings are kind-specific: a product column set is meaningless in a
  // PLP session. Presets saved before the split are treated as product.
  const kindPresets = useMemo(
    () => presets.filter((p) => (p.kind ?? "product") === sessionKind),
    [presets, sessionKind]
  );

  const refreshPresets = useCallback(async () => {
    if (!workspace?.id) return;
    try {
      setPresets(await getEnrichmentPresets(workspace.id));
    } catch (error) {
      console.error("Failed to load saved settings", error);
    }
  }, [workspace?.id]);

  useEffect(() => {
    refreshPresets();
  }, [refreshPresets]);

  const [pendingPreset, setPendingPreset] = useState<EnrichmentPreset | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [savePresetName, setSavePresetName] = useState("AI Setting");
  const [savingPreset, setSavingPreset] = useState(false);

  const handleSelectPreset = useCallback(
    (presetId: string) => {
      if (presetId === "") {
        setSelectedPresetId("");
        applyEnrichmentPreset({
          enrichmentColumns: getDefaultEnrichmentColumns(sessionKind),
        });
        return;
      }

      const preset = kindPresets.find((p) => p.id === presetId);
      if (!preset) return;

      setPendingPreset(preset);
    },
    [kindPresets, applyEnrichmentPreset, sessionKind]
  );

  const confirmApplyPreset = useCallback(() => {
    if (!pendingPreset) return;
    setSelectedPresetId(pendingPreset.id);
    applyEnrichmentPreset(pendingPreset.settings);
    toast.success("Setting applied", { description: pendingPreset.name });
    setPendingPreset(null);
  }, [pendingPreset, applyEnrichmentPreset]);

  const enabledColumns = enrichmentColumns
    .filter((col) => col.enabled)
    .map((col) => col.id);

  // Scope selection to active sheet
  const sheetRows = rows.filter((r) =>
    activeSheet === "existing" ? r.matchType === "existing" : r.matchType !== "existing"
  );
  const selectedRows = sheetRows.filter((r) => selectedRowIds.has(r.id));
  const enrichableRows = selectedRows.filter(
    (r) => r.status === "pending" || r.status === "error" || r.status === "done"
  );

  // AI Generated source options: only columns that have data on the currently
  // selected product(s). Empty on the selected row(s) → do not list the column.
  const enrichedColumnsWithData = useMemo(() => {
    if (selectedRowIds.size === 0) return [];
    const selected = rows.filter(
      (r) =>
        selectedRowIds.has(r.id) &&
        (activeSheet === "existing"
          ? r.matchType === "existing"
          : r.matchType !== "existing")
    );
    if (selected.length === 0) return [];
    return enrichmentColumns.filter((col) =>
      selected.some((r) => {
        const val = r.enrichedData?.[col.id];
        if (Array.isArray(val)) return val.length > 0;
        return val !== undefined && val !== null && val !== "";
      })
    );
  }, [activeSheet, enrichmentColumns, rows, selectedRowIds]);

  const handleStopEnrich = useCallback(async () => {
    const workspaceId = workspace?.id || sheetWorkspaceId;
    if (enrichPollRef.current) {
      clearTimeout(enrichPollRef.current);
      enrichPollRef.current = null;
    }
    if (workspaceId) {
      try {
        await fetch("/api/enrich/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId,
            sessionId: projectId,
            runId: enrichRunIdRef.current,
          }),
        });
      } catch {
        // Cancellation is best-effort; the orchestrator also watches the flag.
      }
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsEnriching(false);
    setPaused(false);
    setEnrichingContext(null, []);
    for (const row of rows) {
      if (row.status === "processing") {
        setRowStatus(row.id, "pending");
      }
    }
    toast.info("Enrichment stop requested");
  }, [
    workspace?.id,
    sheetWorkspaceId,
    projectId,
    rows,
    setIsEnriching,
    setPaused,
    setRowStatus,
    setEnrichingContext,
  ]);

  const applyStatusPayload = useCallback(
    (payload: {
      run?: {
        id: string;
        status: string;
        completed_count: number;
        failed_count: number;
        target_ids: string[];
      } | null;
      project?: ProjectJson | null;
    }) => {
      if (payload.project) {
        const productRows = projectJsonToProductRows(payload.project);
        const total = payload.run?.target_ids.length || productRows.length;
        applyProjectRows(productRows, {
          completed: payload.run?.completed_count ?? productRows.filter((r) => r.status === "done").length,
          total,
          errors: payload.run?.failed_count ?? productRows.filter((r) => r.status === "error").length,
        });
      }
    },
    [applyProjectRows]
  );

  const pollEnrichRun = useCallback(async () => {
    const workspaceId = workspace?.id || sheetWorkspaceId;
    if (!workspaceId || !projectId) return false;
    const params = new URLSearchParams({
      workspaceId,
      sessionId: projectId,
    });
    if (enrichRunIdRef.current) params.set("runId", enrichRunIdRef.current);
    const res = await fetch(`/api/enrich/status?${params.toString()}`);
    if (!res.ok) return false;
    const data = (await res.json()) as {
      run?: {
        id: string;
        status: string;
        completed_count: number;
        failed_count: number;
        target_ids: string[];
      } | null;
      project?: ProjectJson | null;
    };
    if (data.run?.id) enrichRunIdRef.current = data.run.id;
    applyStatusPayload(data);
    const active =
      data.run && (data.run.status === "queued" || data.run.status === "running");
    if (!active) {
      setIsEnriching(false);
      setEnrichingContext(null, []);
      invalidateCredits();
      if (data.run?.status === "paused_no_credits") {
        setLastError("NO_CREDITS");
        toast.error("No credits remaining", {
          description: "Enrichment paused. Add credits and resume from this session.",
        });
      } else if (data.run?.status === "failed") {
        toast.error("Enrichment failed");
      } else if (data.run?.status === "completed") {
        toast.success("Enrichment complete", {
          description: `${data.run.completed_count} rows processed`,
        });
      }
      return false;
    }
    const run = data.run;
    if (!run) return false;
    setIsEnriching(true);
    setEnrichProgress(
      run.completed_count + run.failed_count,
      run.target_ids.length
    );
    invalidateCredits();
    return true;
  }, [
    workspace?.id,
    sheetWorkspaceId,
    projectId,
    applyStatusPayload,
    setIsEnriching,
    setEnrichingContext,
    setEnrichProgress,
    invalidateCredits,
  ]);

  const handleEnrich = useCallback(async () => {
    const isNewTab = enrichOutputTab === "new";
    if ((isNewTab ? enabledColumns.length === 0 : existingColumnsToEnrich.length === 0) || enrichableRows.length === 0) return;
    const workspaceId = workspace?.id || sheetWorkspaceId;
    if (!workspaceId || !projectId) {
      toast.error("Session is not saved yet");
      return;
    }

    setIsEnriching(true);
    setPaused(false);
    setEnrichProgress(0, enrichableRows.length);
    setLastError(null);
    setEnrichingContext(isNewTab ? "new" : "existing", isNewTab ? [] : existingColumnsToEnrich);

    const resolvedLanguage = enrichmentSettings.outputLanguage === "custom"
      ? enrichmentSettings.customLanguage || "English"
      : enrichmentSettings.outputLanguage;

    const enrichSettings: EnrichSettings = {
      enrichmentModel: resolveEnrichmentModel(enrichmentSettings.enrichmentModel),
      outputLanguage: resolvedLanguage,
    };

    let workspaceCategories: CategoryItem[] | undefined;
    let categoriesRawRows: Record<string, string>[] | undefined;
    const categoriesEnabled = enabledColumns.some((id) =>
      ["categories", "parentCategory", "internalLinks"].includes(id)
    );
    if (categoriesEnabled && workspaceId) {
      try {
        const catRes = await fetch(`/api/categories?workspaceId=${workspaceId}`);
        if (catRes.ok) {
          const catData = await catRes.json();
          workspaceCategories = catData.categories;
          categoriesRawRows = catData.rawRows?.length ? catData.rawRows : undefined;
        }
      } catch (err: unknown) {
        console.warn("[Sidebar] Failed to fetch categories:", (err as Error)?.message);
      }
    }

    const existingAsEnrichCols = !isNewTab
      ? existingColumnsToEnrich.map((col) => {
          const displayLabel = col.replace("__EMPTY_", "Col ").replace("__EMPTY", "Col");
          const customInstruction = existingColumnInstructions[col]?.trim();
          return {
            id: `existing__${col}`,
            label: displayLabel,
            description: customInstruction
              ? customInstruction
              : `Fill in the "${displayLabel}" field for this product. Use the available product data to generate an accurate and appropriate value.`,
            type: "text" as const,
            enabled: true,
            isCustom: true,
          };
        })
      : [];

    try {
      const response = await fetch("/api/enrich/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          sessionId: projectId,
          rowIds: enrichableRows.map((r) => r.id),
          enabledColumns: isNewTab
            ? enabledColumns
            : existingColumnsToEnrich.map((c) => `existing__${c}`),
          enrichmentColumns: isNewTab
            ? enrichmentColumns.filter((c) => c.enabled)
            : existingAsEnrichCols,
          settings: enrichSettings,
          kind: sessionKind,
          cmsType: workspace?.cms_type || undefined,
          sourceColumns,
          workspaceCategories,
          categoriesRawRows,
        }),
      });

      if (response.status === 402) {
        setIsEnriching(false);
        setEnrichingContext(null, []);
        let errorCode = "NO_CREDITS";
        try {
          const errorBody = await response.json();
          if (typeof errorBody?.error === "string") errorCode = errorBody.error;
        } catch {}
        setLastError(errorCode);
        toast.error(
          errorCode === "INACTIVE_SUBSCRIPTION"
            ? "Subscription inactive"
            : "No credits remaining"
        );
        return;
      }

      if (response.status === 409) {
        const body = (await response.json().catch(() => ({}))) as { runId?: string };
        if (body.runId) enrichRunIdRef.current = body.runId;
      } else if (!response.ok) {
        const errBody = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error || `Start failed (${response.status})`);
      } else {
        const body = (await response.json()) as { runId?: string };
        if (body.runId) enrichRunIdRef.current = body.runId;
      }

      toast.message("Enrichment is running in the background", {
        description: "You can leave this page. We'll notify you when it finishes.",
      });

      const tick = async () => {
        try {
          const keep = await pollEnrichRun();
          if (keep) {
            enrichPollRef.current = setTimeout(tick, 2500);
          }
        } catch (error) {
          console.error("Enrichment poll failed:", error);
          enrichPollRef.current = setTimeout(tick, 4000);
        }
      };
      void tick();
    } catch (error) {
      console.error("Enrichment failed:", error);
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      setLastError(errMsg);
      toast.error("Enrichment failed", { description: errMsg });
      setIsEnriching(false);
      setEnrichingContext(null, []);
    }
  }, [
    enrichableRows,
    enrichOutputTab,
    enabledColumns,
    existingColumnsToEnrich,
    existingColumnInstructions,
    enrichmentColumns,
    enrichmentSettings,
    sourceColumns,
    sessionKind,
    workspace,
    sheetWorkspaceId,
    projectId,
    pollEnrichRun,
    setIsEnriching,
    setPaused,
    setEnrichProgress,
    setEnrichingContext,
  ]);

  useEffect(() => {
    const workspaceId = workspace?.id || sheetWorkspaceId;
    if (!workspaceId || !projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const keep = await pollEnrichRun();
        if (cancelled || !keep) return;
        const tick = async () => {
          if (cancelled) return;
          const still = await pollEnrichRun();
          if (still && !cancelled) {
            enrichPollRef.current = setTimeout(tick, 2500);
          }
        };
        enrichPollRef.current = setTimeout(tick, 2500);
      } catch {
        // No active run.
      }
    })();
    return () => {
      cancelled = true;
      if (enrichPollRef.current) {
        clearTimeout(enrichPollRef.current);
        enrichPollRef.current = null;
      }
    };
  }, [workspace?.id, sheetWorkspaceId, projectId, pollEnrichRun]);

  const doneCount = rows.filter((r) => r.status === "done").length;
  const failedCount = rows.filter((r) => r.status === "error").length;
  const handleRetryFailed = useCallback(() => {
    const errorRows = rows.filter((r) => r.status === "error");
    for (const row of errorRows) {
      setRowStatus(row.id, "pending");
    }
  }, [rows, setRowStatus]);

  const handleSavePreset = useCallback(() => {
    if (!workspace?.id) return;
    const selectedColumns = enrichmentColumns.filter((col) => col.enabled);
    if (selectedColumns.length === 0) {
      toast.error("Select at least one AI output column");
      return;
    }
    setSavePresetName("AI Setting");
    setSaveDialogOpen(true);
  }, [workspace?.id, enrichmentColumns]);

  const confirmSavePreset = useCallback(async () => {
    if (!workspace?.id || savingPreset) return;
    const name = savePresetName.trim();
    if (!name) {
      toast.error("Enter a setting name");
      return;
    }
    setSavingPreset(true);
    const now = new Date().toISOString();
    const preset: EnrichmentPreset = {
      id: crypto.randomUUID(),
      name,
      createdAt: now,
      updatedAt: now,
      kind: sessionKind,
      settings: {
        sourceColumns: [...sourceColumns],
        enrichmentColumns: enrichmentColumns.map((col) => ({ ...col })),
        enrichmentSettings: { ...enrichmentSettings },
      },
    };
    try {
      await saveEnrichmentPreset(workspace.id, preset);
      setSelectedPresetId(preset.id);
      await refreshPresets();
      setSaveDialogOpen(false);
      toast.success("Setting saved", { description: preset.name });
    } catch (error) {
      toast.error("Failed to save setting", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setSavingPreset(false);
    }
  }, [
    workspace?.id,
    savingPreset,
    savePresetName,
    enrichmentColumns,
    sourceColumns,
    enrichmentSettings,
    sessionKind,
    refreshPresets,
  ]);

  const handleAddCustomColumn = useCallback(() => {
    if (!newColLabel.trim()) return;
    addCustomEnrichmentColumn({
      label: newColLabel.trim(),
      description: newColPrompt.trim() || `Generate ${newColLabel.trim()} for this product.`,
      type: newColType,
    });
    setNewColLabel("");
    setNewColPrompt("");
    setNewColType("text");
    setShowAddColumn(false);
  }, [newColLabel, newColPrompt, newColType, addCustomEnrichmentColumn]);

  if (!sidebarOpen) {
    return (
      <div className="w-12 border-r bg-muted/30 flex flex-col items-center py-3 gap-3 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setSidebarOpen(true)}
        >
          <PanelLeft className="h-4 w-4" />
        </Button>
        <Separator className="w-6" />
        <div className="flex flex-col items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <Database className="h-4 w-4 text-muted-foreground" />
          <Settings2 className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-[320px] border-r bg-card flex flex-col shrink-0 h-full min-h-0 overflow-hidden">
      {/* Header with Tab Toggle */}
      <div className="border-b bg-muted/30 shrink-0">
        <div className="p-3 flex items-center justify-between">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 mr-1"
            onClick={() => router.back()}
            title="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          {isViewer ? (
            <div className="flex items-center gap-1.5 flex-1 mr-2 px-2 py-1.5 rounded-lg bg-muted/60 border border-border/50">
              <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-[11px] font-semibold text-muted-foreground">View Only</span>
            </div>
          ) : isPlp ? (
            // PLP has nothing for Functions to act on, so there's no tab to switch.
            <div className="flex flex-1 items-center gap-1.5 px-2 py-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-[11px] font-semibold">AI Enrichment</span>
            </div>
          ) : (
          <div className="flex items-center bg-muted rounded-lg p-0.5 flex-1 mr-2">
            <button
              onClick={() => setSidebarTab("ai")}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all ${
                sidebarTab === "ai"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              AI
            </button>
            <button
              onClick={() => setSidebarTab("functions")}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all ${
                sidebarTab === "functions"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Zap className="h-3.5 w-3.5" />
              Functions
            </button>
          </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => setSidebarOpen(false)}
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Viewer locked view — Export only */}
      {isViewer && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
            <Lock className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold">View Only Access</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              You can view and export data, but cannot run AI enrichment or use functions.
            </p>
          </div>
        </div>
      )}

      {/* Functions Tab */}
      {!isViewer && sidebarTab === "functions" && <FunctionsPanel />}

      {/* AI Tab */}
      {!isViewer && sidebarTab === "ai" && (
      <div className="flex-1 overflow-y-auto overscroll-contain custom-scrollbar min-h-0">
        <div className="p-4 space-y-5">
          {/* Selection Info */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              <span className="text-xs font-medium text-muted-foreground">
                {selectedRows.length} of {sheetRows.length} rows selected
              </span>
            </div>
            <Badge
              variant="secondary"
              className="text-[10px] font-mono px-1.5 py-0"
            >
              {enrichableRows.length} to enrich
            </Badge>
          </div>

          {/* Saved settings — applies to everything below */}
          <div className="flex items-center gap-1.5">
            <select
              value={selectedPresetId}
              onChange={(e) => handleSelectPreset(e.target.value)}
              disabled={isEnriching}
              className="h-7 flex-1 min-w-0 rounded-md border border-border/60 bg-background px-2 text-[10px] font-medium focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:opacity-50"
            >
              <option value="">Default settings</option>
              {kindPresets.length === 0 ? (
                <option value="" disabled>
                  No saved settings yet
                </option>
              ) : (
                kindPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))
              )}
            </select>
            <button
              onClick={handleSavePreset}
              disabled={isEnriching || enabledColumns.length === 0}
              title="Save the current configuration as a reusable setting"
              className="h-7 shrink-0 rounded-md border border-border/60 px-2 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              Save
            </button>
          </div>

          <Separator />

          {/* AI Enrichment Columns */}
          <div>
            <div className="flex items-center justify-between w-full group">
              <div
                className="flex items-center gap-2 cursor-pointer"
                onClick={() => setEnrichSectionOpen(!enrichSectionOpen)}
              >
                {enrichSectionOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-xs font-semibold">AI Output Columns</span>
              </div>
              <div className="flex items-center bg-muted rounded-lg p-0.5">
                <button
                  onClick={() => setEnrichOutputTab("new")}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold transition-all ${
                    enrichOutputTab === "new"
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Sparkles className="h-2.5 w-2.5" />
                  New
                </button>
                <button
                  onClick={() => setEnrichOutputTab("existing")}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold transition-all ${
                    enrichOutputTab === "existing"
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <FileEdit className="h-2.5 w-2.5" />
                  Existing
                </button>
              </div>
            </div>

            {enrichSectionOpen && enrichOutputTab === "existing" && (
              <div className="mt-3 pl-6 space-y-2">
                <p className="text-[10px] text-muted-foreground leading-tight">
                  Select existing columns for AI to fill. Results overwrite the original cell values.
                </p>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50" />
                  <input
                    type="text"
                    placeholder="Search columns..."
                    value={existingSearch}
                    onChange={(e) => setExistingSearch(e.target.value)}
                    className="w-full h-7 pl-7 pr-2 text-[10px] rounded-md border bg-background/80 focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/40"
                  />
                </div>
                <div className="space-y-1 max-h-64 overflow-y-auto custom-scrollbar">
                  {originalColumns
                    .filter((col) => !existingSearch || col.toLowerCase().includes(existingSearch.toLowerCase()) || col.replace("__EMPTY_", "Col ").replace("__EMPTY", "Col").toLowerCase().includes(existingSearch.toLowerCase()))
                    .map((col) => {
                      const isSelected = existingColumnsToEnrich.includes(col);
                      const displayName = col.replace("__EMPTY_", "Col ").replace("__EMPTY", "Col");
                      const isExpanded = expandedExistingCols.has(col);
                      const savedInstruction = existingColumnInstructions[col] || "";
                      const draft = existingColDrafts[col] ?? savedInstruction;
                      const hasCustomInstruction = savedInstruction.trim().length > 0;

                      const toggleExpand = (e: React.MouseEvent) => {
                        e.stopPropagation();
                        setExpandedExistingCols((prev) => {
                          const next = new Set(prev);
                          if (next.has(col)) {
                            next.delete(col);
                          } else {
                            next.add(col);
                            setExistingColDrafts((d) => ({ ...d, [col]: existingColumnInstructions[col] || "" }));
                          }
                          return next;
                        });
                      };

                      return (
                        <div key={col} className={`rounded-md border transition-all ${
                          isSelected ? "border-primary/20 bg-primary/5" : "border-transparent"
                        }`}>
                          <div
                            className={`flex items-center gap-2 px-2.5 py-1.5 cursor-pointer text-xs ${
                              isSelected ? "text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-md"
                            }`}
                            onClick={() => toggleExistingColumnEnrich(col)}
                          >
                            <div className={`h-3 w-3 rounded-sm border-2 flex items-center justify-center transition-all shrink-0 ${
                              isSelected ? "bg-primary border-primary" : "border-muted-foreground/40"
                            }`}>
                              {isSelected && <CheckCircle2 className="h-2 w-2 text-white" />}
                            </div>
                            <span className="truncate font-medium flex-1">{displayName}</span>
                            {hasCustomInstruction && (
                              <span className="h-1.5 w-1.5 rounded-full bg-primary/70 shrink-0" title="Has custom instruction" />
                            )}
                            <button
                              onClick={toggleExpand}
                              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
                            >
                              {isExpanded
                                ? <ChevronDown className="h-3 w-3" />
                                : <ChevronRight className="h-3 w-3" />
                              }
                            </button>
                          </div>

                          {isExpanded && (
                            <div className="px-2.5 pb-2 space-y-1.5" onClick={(e) => e.stopPropagation()}>
                              <textarea
                                rows={3}
                                placeholder={`Custom instruction for "${displayName}" (optional)…`}
                                value={draft}
                                onChange={(e) => setExistingColDrafts((d) => ({ ...d, [col]: e.target.value }))}
                                className="w-full text-[10px] rounded-md border bg-background px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/40 leading-relaxed"
                              />
                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={() => {
                                    setExistingColumnInstruction(col, draft.trim());
                                    setExpandedExistingCols((prev) => { const n = new Set(prev); n.delete(col); return n; });
                                  }}
                                  className="flex-1 h-6 text-[10px] font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                                >
                                  Save
                                </button>
                                {savedInstruction && (
                                  <button
                                    onClick={() => {
                                      setExistingColumnInstruction(col, "");
                                      setExistingColDrafts((d) => ({ ...d, [col]: "" }));
                                    }}
                                    className="h-6 px-2 text-[10px] rounded-md border text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors"
                                  >
                                    Clear
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
                {existingColumnsToEnrich.length > 0 && (
                  <button
                    onClick={clearExistingColumnEnrich}
                    className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
                  >
                    Clear all ({existingColumnsToEnrich.length} selected)
                  </button>
                )}
              </div>
            )}

            {enrichSectionOpen && enrichOutputTab === "new" && (
              <div className="mt-2.5 space-y-0.5 pl-6">
                {enrichmentColumns.map((col) => {
                  const isExpanded = expandedColumns.has(col.id);
                  const toggleExpand = (e: React.MouseEvent) => {
                    e.stopPropagation();
                    setExpandedColumns((prev) => {
                      const next = new Set(prev);
                      if (next.has(col.id)) next.delete(col.id);
                      else next.add(col.id);
                      return next;
                    });
                  };
                  // Any free-text column can carry tone/length, so PLP columns
                  // get the same controls as the product ones.
                  const hasToneControls = col.type === "text";
                  const hasSettings =
                    col.type === "imageUrls" ||
                    col.type === "sourceUrls" ||
                    col.type === "categories" ||
                    col.type === "faq" ||
                    col.type === "internalLinks" ||
                    col.type === "keywords" ||
                    hasToneControls ||
                    col.isCustom;

                  return (
                    <div
                      key={col.id}
                      className={`rounded-md border transition-colors ${
                        col.enabled
                          ? "border-primary/15 bg-primary/[0.04]"
                          : "border-transparent hover:bg-muted/60"
                      } ${isExpanded ? "border-primary/20 bg-primary/[0.04]" : ""}`}
                    >
                      <div className="flex h-8 items-center gap-2 px-2">
                        <button
                          type="button"
                          className="shrink-0"
                          onClick={() => toggleEnrichmentColumn(col.id)}
                          aria-label={col.enabled ? `Disable ${col.label}` : `Enable ${col.label}`}
                        >
                          {col.enabled ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                          ) : (
                            <div className="h-3.5 w-3.5 rounded-full border-[1.5px] border-muted-foreground/35" />
                          )}
                        </button>
                        <button
                          type="button"
                          className="min-w-0 flex-1 truncate text-left text-[11px] font-medium leading-none"
                          onClick={() => toggleEnrichmentColumn(col.id)}
                        >
                          <span
                            className={
                              col.enabled ? "text-foreground" : "text-muted-foreground"
                            }
                          >
                            {col.label}
                          </span>
                        </button>
                        <div className="flex shrink-0 items-center gap-0.5">
                          {col.isCustom && (
                            <>
                              <span className="rounded px-1 py-px text-[8px] font-medium uppercase tracking-wide text-muted-foreground/80">
                                Custom
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeCustomEnrichmentColumn(col.id);
                                }}
                                className="rounded p-0.5 text-muted-foreground/40 transition-colors hover:text-destructive"
                                aria-label={`Remove ${col.label}`}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </>
                          )}
                          {hasSettings && (
                            <button
                              type="button"
                              onClick={toggleExpand}
                              className="rounded p-0.5 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
                              aria-label={isExpanded ? "Collapse settings" : "Open settings"}
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" />
                              )}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Expandable Settings Panel */}
                      {isExpanded && hasSettings && (
                        <div
                          className="space-y-2.5 border-t border-border/50 px-2 pb-2.5 pt-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {/* Writing Tone & length — any free-text column */}
                          {hasToneControls && (
                            <>
                              <div className="space-y-1">
                                <label className="text-[10px] font-medium text-muted-foreground">
                                  Writing Tone
                                </label>
                                <select
                                  value={col.writingTone ?? "professional"}
                                  onChange={(e) =>
                                    updateEnrichmentColumnConfig(col.id, {
                                      writingTone: e.target.value as WritingTone,
                                    })
                                  }
                                  disabled={isEnriching}
                                  className="w-full h-7 px-2 text-[10px] rounded-md border bg-background/80 focus:outline-none focus:ring-1 focus:ring-primary/50 cursor-pointer disabled:opacity-50"
                                >
                                  {TONE_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                      {opt.label} — {opt.description}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-medium text-muted-foreground">
                                  Content Length
                                </label>
                                <div className="flex gap-1">
                                  {([
                                    { value: "short" as ContentLength, label: "Short", desc: "50-100" },
                                    { value: "medium" as ContentLength, label: "Medium", desc: "150-300" },
                                    { value: "long" as ContentLength, label: "Long", desc: "300-500" },
                                  ]).map((opt) => {
                                    const isSelected = (col.contentLength ?? "medium") === opt.value;
                                    return (
                                      <button
                                        key={opt.value}
                                        onClick={() =>
                                          updateEnrichmentColumnConfig(col.id, {
                                            contentLength: opt.value,
                                          })
                                        }
                                        disabled={isEnriching}
                                        className={`flex-1 text-center py-1 px-1 rounded-md border transition-all disabled:opacity-50 ${
                                          isSelected
                                            ? "bg-primary/10 border-primary/30 shadow-sm"
                                            : "border-border/50 hover:border-border hover:bg-muted/50"
                                        }`}
                                      >
                                        <span className={`text-[9px] font-medium block ${isSelected ? "text-primary" : "text-muted-foreground"}`}>
                                          {opt.label}
                                        </span>
                                        <span className="text-[7px] text-muted-foreground/60 block">{opt.desc}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            </>
                          )}

                          {/* Image Count — only for imageUrls */}
                          {col.type === "imageUrls" && (
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <label className="text-[10px] font-medium text-muted-foreground">
                                  Number of images
                                </label>
                                <span className="text-[10px] font-mono font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded min-w-[20px] text-center">
                                  {col.imageCount ?? 3}
                                </span>
                              </div>
                              <input
                                type="range"
                                min={1}
                                max={10}
                                value={col.imageCount ?? 3}
                                onChange={(e) =>
                                  updateEnrichmentColumnConfig(col.id, {
                                    imageCount: parseInt(e.target.value),
                                  })
                                }
                                disabled={isEnriching}
                                className="w-full h-1.5 accent-primary disabled:opacity-50"
                              />
                              <div className="flex justify-between text-[8px] text-muted-foreground/50">
                                <span>1</span>
                                <span>5</span>
                                <span>10</span>
                              </div>
                            </div>
                          )}

                          {/* Source Count — only for sourceUrls */}
                          {col.type === "sourceUrls" && (
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <label className="text-[10px] font-medium text-muted-foreground">
                                  Number of sources
                                </label>
                                <span className="text-[10px] font-mono font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded min-w-[20px] text-center">
                                  {col.sourceCount ?? 3}
                                </span>
                              </div>
                              <input
                                type="range"
                                min={1}
                                max={10}
                                value={col.sourceCount ?? 3}
                                onChange={(e) =>
                                  updateEnrichmentColumnConfig(col.id, {
                                    sourceCount: parseInt(e.target.value),
                                  })
                                }
                                disabled={isEnriching}
                                className="w-full h-1.5 accent-primary disabled:opacity-50"
                              />
                              <div className="flex justify-between text-[8px] text-muted-foreground/50">
                                <span>1</span>
                                <span>5</span>
                                <span>10</span>
                              </div>
                            </div>
                          )}

                          {/* Max Categories — only for categories */}
                          {col.type === "categories" && (
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <label className="text-[10px] font-medium text-muted-foreground">
                                  Max categories
                                </label>
                                <span className="text-[10px] font-mono font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded min-w-[20px] text-center">
                                  {col.maxCategories ?? 3}
                                </span>
                              </div>
                              <input
                                type="range"
                                min={1}
                                max={5}
                                value={col.maxCategories ?? 3}
                                onChange={(e) =>
                                  updateEnrichmentColumnConfig(col.id, {
                                    maxCategories: parseInt(e.target.value),
                                  })
                                }
                                disabled={isEnriching}
                                className="w-full h-1.5 accent-primary disabled:opacity-50"
                              />
                              <div className="flex justify-between text-[8px] text-muted-foreground/50">
                                <span>1</span>
                                <span>3</span>
                                <span>5</span>
                              </div>
                            </div>
                          )}

                          {/* Item count — faq / keywords / internal links */}
                          {(col.type === "faq" ||
                            col.type === "keywords" ||
                            col.type === "internalLinks") && (
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <label className="text-[10px] font-medium text-muted-foreground">
                                  {col.type === "faq"
                                    ? "Number of questions"
                                    : col.type === "keywords"
                                      ? "Number of keywords"
                                      : "Number of links"}
                                </label>
                                <span className="text-[10px] font-mono font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded min-w-[20px] text-center">
                                  {col.itemCount ?? (col.type === "faq" ? 4 : 5)}
                                </span>
                              </div>
                              <input
                                type="range"
                                min={1}
                                max={10}
                                value={col.itemCount ?? (col.type === "faq" ? 4 : 5)}
                                onChange={(e) =>
                                  updateEnrichmentColumnConfig(col.id, {
                                    itemCount: parseInt(e.target.value),
                                  })
                                }
                                disabled={isEnriching}
                                className="w-full h-1.5 accent-primary disabled:opacity-50"
                              />
                              <div className="flex justify-between text-[8px] text-muted-foreground/50">
                                <span>1</span>
                                <span>5</span>
                                <span>10</span>
                              </div>
                            </div>
                          )}

                          {/* Character budget — SEO fields with a hard limit */}
                          {col.type === "text" && col.maxChars != null && (
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <label className="text-[10px] font-medium text-muted-foreground">
                                  Character limit
                                </label>
                                <span className="text-[10px] font-mono font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded min-w-[20px] text-center">
                                  {col.maxChars}
                                </span>
                              </div>
                              <input
                                type="number"
                                min={10}
                                max={2000}
                                value={col.maxChars}
                                onChange={(e) =>
                                  updateEnrichmentColumnConfig(col.id, {
                                    maxChars: Math.max(
                                      10,
                                      Math.min(2000, parseInt(e.target.value) || 10)
                                    ),
                                  })
                                }
                                disabled={isEnriching}
                                className="w-full h-7 px-2 text-[10px] rounded-md border bg-background/80 focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
                              />
                            </div>
                          )}

                          {/* Custom Instruction — for all expandable columns */}
                          <div className="space-y-1">
                            <label className="text-[10px] font-medium text-muted-foreground">
                              Custom instruction
                            </label>
                            <input
                              type="text"
                              value={col.customInstruction ?? ""}
                              onChange={(e) =>
                                updateEnrichmentColumnConfig(col.id, {
                                  customInstruction: e.target.value,
                                })
                              }
                              disabled={isEnriching}
                              placeholder="Add specific instructions for this column..."
                              className="w-full text-[10px] px-2 py-1.5 rounded-md border bg-background/80 focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/40 disabled:opacity-50"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Add Custom Column */}
                {!showAddColumn ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-1.5 h-8 w-full gap-1 border-dashed text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    onClick={() => setShowAddColumn(true)}
                  >
                    <Plus className="h-3 w-3" />
                    Add custom column
                  </Button>
                ) : (
                  <div className="mt-2 p-3 rounded-lg border border-primary/30 bg-primary/5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-primary">New Column</span>
                      <button
                        onClick={() => setShowAddColumn(false)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <input
                      autoFocus
                      placeholder="Column name (e.g. Target Audience)"
                      value={newColLabel}
                      onChange={(e) => setNewColLabel(e.target.value)}
                      className="w-full h-8 px-2.5 text-xs rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
                    />
                    <textarea
                      placeholder="AI instruction (e.g. Identify the target audience for this product)"
                      value={newColPrompt}
                      onChange={(e) => setNewColPrompt(e.target.value)}
                      rows={2}
                      className="w-full px-2.5 py-1.5 text-xs rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none"
                    />
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground">Output type:</span>
                      <button
                        onClick={() => setNewColType("text")}
                        className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                          newColType === "text"
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border hover:border-primary/50"
                        }`}
                      >
                        Text
                      </button>
                      <button
                        onClick={() => setNewColType("list")}
                        className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                          newColType === "list"
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border hover:border-primary/50"
                        }`}
                      >
                        List
                      </button>
                    </div>
                    <div className="flex gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1 text-xs h-7"
                        onClick={() => setShowAddColumn(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1 text-xs h-7"
                        disabled={!newColLabel.trim()}
                        onClick={handleAddCustomColumn}
                      >
                        Add Column
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <Separator />

          {/* Source Columns (sent to AI) */}
          <div>
            <div className="flex items-center justify-between w-full group">
              <div
                className="flex items-center gap-2 cursor-pointer"
                onClick={() => setSourceSectionOpen(!sourceSectionOpen)}
              >
                {sourceSectionOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <Database className="h-4 w-4 text-blue-500" />
                <span className="text-xs font-semibold">Source Columns</span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-[10px] h-5 px-1.5"
                  onClick={() => setAllSourceColumns(true)}
                >
                  All
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-[10px] h-5 px-1.5"
                  onClick={() => setAllSourceColumns(false)}
                >
                  None
                </Button>
              </div>
            </div>

            {sourceSectionOpen && (
              <div className="mt-3 space-y-1 pl-6">
                <p className="text-[10px] text-muted-foreground mb-2 leading-tight">
                  Choose which columns are sent to the AI agent for context.
                  AI Generated columns appear only for the selected product(s)
                  that already have values.
                </p>
                {originalColumns.map((col) => {
                  const isSource = sourceColumns.includes(col);
                  const displayName = col
                    .replace("__EMPTY_", "Col ")
                    .replace("__EMPTY", "Col");
                  return (
                    <label
                      key={col}
                      className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md cursor-pointer transition-all text-xs ${
                        isSource
                          ? "bg-blue-50 dark:bg-blue-950/20 text-foreground"
                          : "hover:bg-muted/50 text-muted-foreground"
                      }`}
                      onClick={() => toggleSourceColumn(col)}
                    >
                      <div
                        className={`h-3 w-3 rounded-sm border-2 flex items-center justify-center transition-all shrink-0 ${
                          isSource
                            ? "bg-blue-500 border-blue-500"
                            : "border-muted-foreground/40"
                        }`}
                      >
                        {isSource && (
                          <CheckCircle2 className="h-2 w-2 text-white" />
                        )}
                      </div>
                      <span className="truncate font-medium">
                        {displayName}
                      </span>
                    </label>
                  );
                })}

                {/* AI-Generated Columns (enriched columns that have data) */}
                {enrichedColumnsWithData.length > 0 && (
                  <>
                    <div className="flex items-center gap-1.5 mt-3 mb-1">
                      <Sparkles className="h-3 w-3 text-primary/60" />
                      <span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider">
                        AI Generated
                      </span>
                    </div>
                    {enrichedColumnsWithData.map((col) => {
                      const isSource = sourceColumns.includes(col.id);
                      return (
                        <label
                          key={`enriched-${col.id}`}
                          className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md cursor-pointer transition-all text-xs ${
                            isSource
                              ? "bg-purple-50 dark:bg-purple-950/20 text-foreground"
                              : "hover:bg-muted/50 text-muted-foreground"
                          }`}
                          onClick={() => toggleSourceColumn(col.id)}
                        >
                          <div
                            className={`h-3 w-3 rounded-sm border-2 flex items-center justify-center transition-all shrink-0 ${
                              isSource
                                ? "bg-purple-500 border-purple-500"
                                : "border-muted-foreground/40"
                            }`}
                          >
                            {isSource && (
                              <CheckCircle2 className="h-2 w-2 text-white" />
                            )}
                          </div>
                          <span className="truncate font-medium">
                            {col.label}
                          </span>
                          <Sparkles className="h-2.5 w-2.5 text-primary/50 shrink-0" />
                        </label>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </div>

          <Separator />

          {/* Settings */}
          <div>
            <div className="flex items-center justify-between w-full group">
              <div
                className="flex items-center gap-2 cursor-pointer"
                onClick={() => setSettingsSectionOpen(!settingsSectionOpen)}
              >
                {settingsSectionOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <Settings2 className="h-4 w-4 text-amber-500" />
                <span className="text-xs font-semibold">Settings</span>
              </div>
              <Badge variant="secondary" className="text-[9px] px-1.5 py-0 font-mono">
                {enrichmentSettings.outputLanguage === "custom"
                  ? enrichmentSettings.customLanguage || "Custom"
                  : enrichmentSettings.outputLanguage}
              </Badge>
            </div>

            {settingsSectionOpen && (
              <div className="mt-3 space-y-4 pl-2">
                {/* Output Language */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Output Language
                  </label>
                  <select
                    value={enrichmentSettings.outputLanguage}
                    onChange={(e) => updateSettings({ outputLanguage: e.target.value as OutputLanguage })}
                    disabled={isEnriching}
                    className="w-full h-8 px-2.5 text-xs rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50 cursor-pointer disabled:opacity-50"
                  >
                    {LANGUAGE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.flag} {opt.label}
                      </option>
                    ))}
                  </select>
                  {enrichmentSettings.outputLanguage === "custom" && (
                    <input
                      placeholder="Type language name (e.g. Korean, Hindi...)"
                      value={enrichmentSettings.customLanguage}
                      onChange={(e) => updateSettings({ customLanguage: e.target.value })}
                      disabled={isEnriching}
                      className="w-full h-8 px-2.5 text-xs rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
                    />
                  )}
                </div>

                {/* Enrichment Model */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Enrichment Model
                  </label>
                  <div className="space-y-1">
                    {MODEL_OPTIONS.map((opt) => {
                      const isSelected = enrichmentSettings.enrichmentModel === opt.value;
                      return (
                        <div
                          key={opt.value}
                          onClick={() => !isEnriching && updateSettings({ enrichmentModel: opt.value as EnrichmentModel })}
                          className={`w-full text-left p-2 rounded-lg border transition-all duration-200 cursor-pointer ${
                            isSelected
                              ? "bg-amber-500/10 border-amber-500/30 shadow-sm"
                              : "bg-muted/30 border-transparent hover:border-border/40 hover:bg-muted/60"
                          } ${isEnriching ? "opacity-50 pointer-events-none" : ""}`}
                        >
                          <div className="flex items-center gap-2">
                            <div className={`h-3 w-3 rounded-full border-2 flex items-center justify-center shrink-0 ${
                              isSelected ? "border-amber-500 bg-amber-500" : "border-muted-foreground/40"
                            }`}>
                              {isSelected && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                            </div>
                            <span className={`text-xs font-semibold ${isSelected ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                              {opt.icon} {opt.label}
                            </span>
                          </div>
                          <p className="text-[10px] text-muted-foreground/70 mt-0.5 pl-5">
                            {opt.description}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>
            )}
          </div>

          <Separator />

          {/* Progress & Status */}
          {isEnriching && (
            <div className="space-y-3 bg-primary/5 p-3 rounded-lg border border-primary/10">
              <div className="flex items-center justify-between text-sm">
                <span className="text-foreground flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  <span className="font-medium text-xs">Enriching...</span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-muted-foreground bg-background px-2 py-0.5 rounded">
                    {completedEnrich} / {totalToEnrich}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={handleStopEnrich}
                  >
                    <X className="h-3 w-3 mr-1" />
                    Stop
                  </Button>
                </div>
              </div>
              <Progress value={enrichProgress} className="h-1.5" />
              <p className="text-[9px] text-muted-foreground/60">
                {Math.round(enrichProgress)}% complete · {totalToEnrich - completedEnrich} remaining
              </p>
            </div>
          )}

          {!isEnriching && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                {doneCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800 text-[10px] gap-1"
                  >
                    <CheckCircle2 className="h-3 w-3" />
                    {doneCount} enriched
                  </Badge>
                )}
                {errorCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800 text-[10px] gap-1"
                  >
                    <AlertCircle className="h-3 w-3" />
                    {errorCount} errors
                  </Badge>
                )}
                </div>
              </div>

              {errorCount > 0 && lastError && (
                <div className="text-[10px] text-destructive/80 bg-destructive/5 p-2.5 rounded-md border border-destructive/20 break-words leading-relaxed">
                  <span className="font-semibold block mb-0.5">Last Error:</span>
                  {lastError}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      )}

      {/* Action Buttons - Fixed at bottom */}
      {isViewer ? (
        <div className="p-4 border-t bg-muted/20 shrink-0">
          <ExportDialog />
        </div>
      ) : sidebarTab === "ai" && (
      <div className="p-4 border-t bg-muted/20 space-y-2 shrink-0">
        {!isEnriching && (
          <Button
            onClick={handleEnrich}
            disabled={
              (enrichOutputTab === "new" ? enabledColumns.length === 0 : existingColumnsToEnrich.length === 0) ||
              enrichableRows.length === 0 ||
              sourceColumns.length === 0
            }
            className="w-full gap-2 font-medium h-10 shadow-sm"
            size="sm"
          >
            <Zap className="h-4 w-4" />
            Enrich {enrichableRows.length} Row
            {enrichableRows.length !== 1 ? "s" : ""}
          </Button>
        )}

        {/* Retry Failed */}
        {!isEnriching && failedCount > 0 && (
          <Button
            variant="outline"
            onClick={handleRetryFailed}
            className="w-full gap-2 text-amber-600 border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/20"
            size="sm"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Retry {failedCount} Failed Row{failedCount !== 1 ? "s" : ""}
          </Button>
        )}

        {/* Export button */}
        <ExportDialog />
      </div>
      )}

      <AlertDialog open={!!pendingPreset} onOpenChange={(open) => !open && setPendingPreset(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply &quot;{pendingPreset?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              This replaces your current AI column configuration. Enriched cells
              are kept — columns you turn off keep their data and it reappears if
              you re-enable them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingPreset(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmApplyPreset();
              }}
            >
              Apply
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={saveDialogOpen}
        onOpenChange={(open) => {
          if (savingPreset) return;
          setSaveDialogOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save setting</DialogTitle>
            <DialogDescription>
              Name this AI column configuration so you can reuse it on later
              projects of the same type.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="save-preset-name" className="text-xs">
              Setting name
            </Label>
            <Input
              id="save-preset-name"
              autoFocus
              value={savePresetName}
              onChange={(e) => setSavePresetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void confirmSavePreset();
                }
              }}
              placeholder="e.g. PLP SEO defaults"
              disabled={savingPreset}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={savingPreset}
              onClick={() => setSaveDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={savingPreset || !savePresetName.trim()}
              onClick={() => void confirmSavePreset()}
            >
              {savingPreset ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
