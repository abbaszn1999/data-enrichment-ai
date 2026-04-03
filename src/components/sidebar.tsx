"use client";

import { useCallback, useState, useRef } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useSheetStore } from "@/store/sheet-store";
import { useWorkspaceStore } from "@/store/workspace-store";
import { ExportDialog } from "@/components/export-dialog";
import { FunctionsPanel } from "@/components/functions-panel";
import type { OutputLanguage, EnrichmentModel, ThinkingLevelOption, WritingTone, ContentLength, CategoryItem } from "@/types";
import { LANGUAGE_OPTIONS, MODEL_OPTIONS, TONE_OPTIONS } from "@/types";
import type { EnrichmentColumn } from "@/types";
import type { GeminiSettings } from "@/lib/gemini";
import { createClient as createBrowserClient } from "@/lib/supabase-browser";

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
    toggleEnrichmentColumn,
    setAllEnrichmentColumns,
    addCustomEnrichmentColumn,
    removeCustomEnrichmentColumn,
    updateEnrichmentColumnConfig,
    toggleSourceColumn,
    setAllSourceColumns,
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
  } = useSheetStore();

  const abortControllerRef = useRef<AbortController | null>(null);

  const [sidebarTab, setSidebarTab] = useState<"ai" | "functions">("ai");
  const [lastError, setLastError] = useState<string | null>(null);
  const [enrichSectionOpen, setEnrichSectionOpen] = useState(true);
  const [sourceSectionOpen, setSourceSectionOpen] = useState(true);
  const [settingsSectionOpen, setSettingsSectionOpen] = useState(false);
  const [showAddColumn, setShowAddColumn] = useState(false);
  const [newColLabel, setNewColLabel] = useState("");
  const [newColType, setNewColType] = useState<"text" | "list">("text");
  const [newColPrompt, setNewColPrompt] = useState("");
  const [expandedColumns, setExpandedColumns] = useState<Set<string>>(new Set());

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

  // Enriched columns that have data in at least one row (all types including imageUrls/sourceUrls)
  const enrichedColumnsWithData = enrichmentColumns.filter(
    (col) =>
      rows.some((r) => {
        const val = r.enrichedData?.[col.id];
        if (Array.isArray(val)) return val.length > 0;
        return val !== undefined && val !== null && val !== "";
      })
  );

  const handleStopEnrich = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsEnriching(false);
    setPaused(false);
    // Reset processing rows back to pending
    for (const row of rows) {
      if (row.status === "processing") {
        setRowStatus(row.id, "pending");
      }
    }
    toast.info("Enrichment stopped");
  }, [rows, setIsEnriching, setPaused, setRowStatus]);

  const handleEnrich = useCallback(async () => {
    if (enabledColumns.length === 0 || enrichableRows.length === 0) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsEnriching(true);
    setPaused(false);
    setEnrichProgress(0, enrichableRows.length);
    setLastError(null);

    for (const row of enrichableRows) {
      setRowStatus(row.id, "processing");
    }

    try {
      const resolvedLanguage = enrichmentSettings.outputLanguage === "custom"
        ? enrichmentSettings.customLanguage || "English"
        : enrichmentSettings.outputLanguage;

      const geminiSettings: GeminiSettings = {
        enrichmentModel: enrichmentSettings.enrichmentModel,
        thinkingLevel: enrichmentSettings.thinkingLevel,
        outputLanguage: resolvedLanguage,
      };

      // Determine which source columns are enriched (AI-generated) vs original
      const enrichedColIds = new Set(enrichmentColumns.map((c) => c.id));

      // Fetch workspace categories if categories column is enabled
      let workspaceCategories: CategoryItem[] | undefined;
      let categoriesRawRows: Record<string, string>[] | undefined;
      const categoriesEnabled = enabledColumns.includes("categories");
      if (categoriesEnabled && workspace?.id) {
        try {
          const catRes = await fetch(`/api/categories?workspaceId=${workspace.id}`);
          if (catRes.ok) {
            const catData = await catRes.json();
            workspaceCategories = catData.categories;
            categoriesRawRows = catData.rawRows?.length ? catData.rawRows : undefined;
          }
        } catch (err: any) {
          console.warn("[Sidebar] Failed to fetch categories:", err?.message);
        }
      }

      // Get access token + user ID for the Supabase Edge Function
      const supabaseBrowser = createBrowserClient();
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      const enrichHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (session?.access_token) enrichHeaders["Authorization"] = `Bearer ${session.access_token}`;
      const userId = session?.user?.id;

      const commonPayload = {
        enabledColumns,
        enrichmentColumns: enrichmentColumns.filter((c) => c.enabled),
        settings: geminiSettings,
        cmsType: workspace?.cms_type || undefined,
        workspaceCategories,
        categoriesRawRows,
        workspaceId: workspace?.id,
      };

      let completedCount = 0;

      for (const r of enrichableRows) {
        // Check if user stopped enrichment
        if (controller.signal.aborted) break;

        const filteredData: Record<string, string> = {};
        for (const col of sourceColumns) {
          if (enrichedColIds.has(col)) {
            const val = r.enrichedData?.[col];
            if (val !== undefined && val !== null && val !== "") {
              if (Array.isArray(val)) {
                filteredData[col] = val
                  .map((item) =>
                    typeof item === "object" && item !== null
                      ? (item.uri || item.imageUrl || item.pageUrl || item.title || JSON.stringify(item))
                      : String(item)
                  )
                  .join(", ");
              } else {
                filteredData[col] = String(val);
              }
            }
          } else if (r.originalData[col] !== undefined) {
            filteredData[col] = r.originalData[col];
          }
        }

        const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/enrich`, {
          method: "POST",
          headers: enrichHeaders,
          signal: controller.signal,
          body: JSON.stringify({
            row: { id: r.id, rowIndex: r.rowIndex, originalData: filteredData },
            ...commonPayload,
            userId,
          }),
        });

        if (response.status === 402) {
          setIsEnriching(false);
          setLastError("NO_CREDITS");
          toast.error("No credits remaining", {
            description: "Your AI credits have run out. Please upgrade your plan or wait for the monthly reset.",
            duration: 8000,
          });
          return;
        }

        completedCount++;

        if (!response.ok) {
          setRowStatus(r.id, "error", `API error: ${response.status}`);
          setEnrichProgress(completedCount, enrichableRows.length);
          incrementError();
          continue;
        }

        const result = await response.json();

        if (result.status === "done" && result.data) {
          setRowEnrichedData(r.id, result.data);
          setEnrichProgress(completedCount, enrichableRows.length);
          invalidateCredits();
        } else {
          setRowStatus(r.id, "error", result.error || "Unknown error");
          setEnrichProgress(completedCount, enrichableRows.length);
          incrementError();
          if (result.error) setLastError(result.error);
        }
      }

      setIsEnriching(false);
      toast.success("Enrichment complete", {
        description: `${completedCount} rows processed`,
      });
      invalidateCredits();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      console.error("Enrichment failed:", error);
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      setLastError(errMsg);
      toast.error("Enrichment failed", { description: errMsg });
      setIsEnriching(false);
    } finally {
      abortControllerRef.current = null;
    }
  }, [
    enrichableRows,
    enabledColumns,
    enrichmentColumns,
    enrichmentSettings,
    sourceColumns,
    workspace,
    setIsEnriching,
    setPaused,
    setEnrichProgress,
    setRowStatus,
    setRowEnrichedData,
    incrementError,
    invalidateCredits,
  ]);

  const doneCount = rows.filter((r) => r.status === "done").length;
  const failedCount = rows.filter((r) => r.status === "error").length;
  const handleRetryFailed = useCallback(() => {
    const errorRows = rows.filter((r) => r.status === "error");
    for (const row of errorRows) {
      setRowStatus(row.id, "pending");
    }
  }, [rows, setRowStatus]);

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
    <div className="w-[320px] border-r bg-card flex flex-col shrink-0 h-full min-h-0">
      {/* Header with Tab Toggle */}
      <div className="border-b bg-muted/30">
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
      <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
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
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-[10px] h-5 px-1.5"
                  onClick={() => setAllEnrichmentColumns(true)}
                >
                  All
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-[10px] h-5 px-1.5"
                  onClick={() => setAllEnrichmentColumns(false)}
                >
                  None
                </Button>
              </div>
            </div>

            {enrichSectionOpen && (
              <div className="mt-3 space-y-1.5 pl-6">
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
                  const hasSettings = col.type === "imageUrls" || col.type === "sourceUrls" || col.type === "categories" || col.id === "enhancedTitle" || col.id === "marketingDescription" || col.isCustom;

                  return (
                    <div
                      key={col.id}
                      className={`w-full text-left p-2.5 rounded-lg border transition-all duration-200 group relative overflow-hidden ${
                        col.enabled
                          ? "bg-primary/5 border-primary/20 shadow-sm"
                          : "bg-muted/50 border-transparent hover:border-border/40 hover:bg-muted"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <div
                          className="mt-0.5 cursor-pointer shrink-0"
                          onClick={() => toggleEnrichmentColumn(col.id)}
                        >
                          {col.enabled ? (
                            <CheckCircle2 className="h-4 w-4 text-primary" />
                          ) : (
                            <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/40 group-hover:border-muted-foreground/60" />
                          )}
                        </div>
                        <div
                          className="flex flex-col gap-1 min-w-0 flex-1 cursor-pointer"
                          onClick={() => toggleEnrichmentColumn(col.id)}
                        >
                          <span
                            className={`text-sm font-semibold tracking-tight leading-none ${
                              col.enabled ? "text-primary" : "text-muted-foreground"
                            }`}
                          >
                            {col.label}
                          </span>
                          <span className="text-[10px] leading-snug text-muted-foreground/70 line-clamp-2">
                            {col.description}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {col.isCustom && (
                            <>
                              <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[8px] font-medium text-secondary-foreground">
                                Custom
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeCustomEnrichmentColumn(col.id);
                                }}
                                className="text-muted-foreground/40 hover:text-destructive transition-colors"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                          {hasSettings && (
                            <button
                              onClick={toggleExpand}
                              className="p-0.5 rounded hover:bg-muted/80 transition-colors"
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                              )}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Expandable Settings Panel */}
                      {isExpanded && hasSettings && (
                        <div
                          className="mt-2.5 pt-2.5 border-t border-primary/10 space-y-2.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {/* Writing Tone — only for Enhanced Title & Marketing Description */}
                          {(col.id === "enhancedTitle" || col.id === "marketingDescription") && (
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
                    className="w-full mt-2 border-dashed text-muted-foreground hover:text-primary hover:border-primary/50 gap-1"
                    onClick={() => setShowAddColumn(true)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Custom Column
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
                  Choose which columns are sent to the AI agent for context
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

                {/* Thinking Level */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Thinking Level
                  </label>
                  <div className="flex gap-1">
                    {(["none", "low", "medium", "high"] as ThinkingLevelOption[]).map((level) => {
                      const isSelected = enrichmentSettings.thinkingLevel === level;
                      return (
                        <button
                          key={level}
                          onClick={() => updateSettings({ thinkingLevel: level })}
                          disabled={isEnriching}
                          className={`flex-1 text-[10px] py-1.5 px-1 rounded-md border font-medium capitalize transition-all disabled:opacity-50 ${
                            isSelected
                              ? "bg-amber-500/15 border-amber-500/30 text-amber-600 dark:text-amber-400 shadow-sm"
                              : "border-border/50 text-muted-foreground hover:border-border hover:bg-muted/50"
                          }`}
                        >
                          {level}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[9px] text-muted-foreground/60 leading-tight">
                    Higher = better quality but slower and more expensive
                  </p>
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

          {!isEnriching && (doneCount > 0 || errorCount > 0) && (
            <div className="space-y-2">
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
        <div className="p-4 border-t bg-muted/20">
          <ExportDialog />
        </div>
      ) : sidebarTab === "ai" && (
      <div className="p-4 border-t bg-muted/20 space-y-2">
        {!isEnriching && (
          <Button
            onClick={handleEnrich}
            disabled={
              enabledColumns.length === 0 ||
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
    </div>
  );
}
