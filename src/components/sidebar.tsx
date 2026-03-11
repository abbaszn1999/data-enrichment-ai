"use client";

import { useCallback, useState, useRef } from "react";
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
  Download,
  Trash2,
  PanelLeftClose,
  PanelLeft,
  Plus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useSheetStore } from "@/store/sheet-store";
import { ExportButton } from "@/components/export-button";
import type { EnrichmentEvent, OutputLanguage, EnrichmentModel, ThinkingLevelOption, WritingTone, ContentLength } from "@/types";
import { LANGUAGE_OPTIONS, MODEL_OPTIONS, TONE_OPTIONS } from "@/types";
import type { GeminiSettings } from "@/lib/gemini";

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
  const {
    rows,
    fileName,
    originalColumns,
    sourceColumns,
    enrichmentColumns,
    enrichmentSettings,
    selectedRowIds,
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
    clearFile,
    sidebarOpen,
    setSidebarOpen,
    updateSettings,
  } = useSheetStore();

  const abortControllerRef = useRef<AbortController | null>(null);

  const [lastError, setLastError] = useState<string | null>(null);
  const [enrichSectionOpen, setEnrichSectionOpen] = useState(true);
  const [sourceSectionOpen, setSourceSectionOpen] = useState(true);
  const [settingsSectionOpen, setSettingsSectionOpen] = useState(false);
  const [showAddColumn, setShowAddColumn] = useState(false);
  const [newColLabel, setNewColLabel] = useState("");
  const [newColType, setNewColType] = useState<"text" | "list">("text");
  const [newColPrompt, setNewColPrompt] = useState("");

  const enabledColumns = enrichmentColumns
    .filter((col) => col.enabled)
    .map((col) => col.id);

  const selectedRows = rows.filter((r) => selectedRowIds.has(r.id));
  const enrichableRows = selectedRows.filter(
    (r) => r.status === "pending" || r.status === "error"
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
        maxRetries: enrichmentSettings.maxRetries,
        promptSettings: {
          outputLanguage: resolvedLanguage,
          writingTone: enrichmentSettings.writingTone,
          customTone: enrichmentSettings.customTone,
          contentLength: enrichmentSettings.contentLength,
        },
      };

      const response = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          rows: enrichableRows.map((r) => {
            const filteredData: Record<string, string> = {};
            for (const col of sourceColumns) {
              if (r.originalData[col] !== undefined) {
                filteredData[col] = r.originalData[col];
              }
            }
            return {
              id: r.id,
              rowIndex: r.rowIndex,
              originalData: filteredData,
            };
          }),
          enabledColumns,
          enrichmentColumns: enrichmentColumns.filter((c) => c.enabled),
          settings: geminiSettings,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `API error: ${response.status} - ${await response.text()}`
        );
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const dataLine = line.trim();
          if (!dataLine.startsWith("data: ")) continue;

          try {
            const event: EnrichmentEvent = JSON.parse(dataLine.slice(6));

            switch (event.type) {
              case "progress":
                setRowStatus(event.rowId, "processing");
                break;
              case "row_complete":
                if (event.data) {
                  setRowEnrichedData(event.rowId, event.data);
                }
                setEnrichProgress(event.completedRows, event.totalRows);
                break;
              case "row_error":
                setRowStatus(event.rowId, "error", event.error);
                setEnrichProgress(event.completedRows, event.totalRows);
                incrementError();
                if (event.error) setLastError(event.error);
                break;
              case "done":
                setIsEnriching(false);
                {
                  const doneNow = enrichableRows.filter((r) => r.status !== "error").length;
                  toast.success(`Enrichment complete`, {
                    description: `${event.completedRows} rows processed`,
                  });
                }
                break;
            }
          } catch {
            // Skip malformed events
          }
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        // User stopped enrichment — already handled by handleStopEnrich
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
    setIsEnriching,
    setPaused,
    setEnrichProgress,
    setRowStatus,
    setRowEnrichedData,
    incrementError,
  ]);

  const doneCount = rows.filter((r) => r.status === "done").length;
  const failedCount = rows.filter((r) => r.status === "error").length;
  const allDone = doneCount === rows.length && rows.length > 0;

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

  const handleExportCSV = useCallback(() => {
    const enabledEnrichment = enrichmentColumns.filter((c) => c.enabled);
    const headers = [...originalColumns, ...enabledEnrichment.map((c) => c.label)];
    const csvRows = [headers.join(",")];
    for (const row of rows) {
      const vals = [
        ...originalColumns.map((col) => {
          const v = row.originalData[col] || "";
          return v.startsWith("data:image/") ? "[image]" : `"${v.replace(/"/g, '""')}"`;
        }),
        ...enabledEnrichment.map((col) => {
          const v = row.enrichedData[col.id];
          if (!v) return '""';
          if (Array.isArray(v)) return `"${(v as any[]).map((i: any) => typeof i === "object" ? i.title : i).join("; ").replace(/"/g, '""')}"`;
          return `"${String(v).replace(/"/g, '""')}"`;
        }),
      ];
      csvRows.push(vals.join(","));
    }
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    downloadBlob(blob, (fileName || "export").replace(/\.[^/.]+$/, "") + ".csv");
    toast.success("CSV exported", { description: `${rows.length} rows exported` });
  }, [rows, originalColumns, enrichmentColumns, fileName]);

  const handleExportJSON = useCallback(() => {
    const enabledEnrichment = enrichmentColumns.filter((c) => c.enabled);
    const data = rows.map((row) => {
      const obj: Record<string, any> = {};
      for (const col of originalColumns) {
        const v = row.originalData[col] || "";
        obj[col] = v.startsWith("data:image/") ? "[image]" : v;
      }
      for (const col of enabledEnrichment) {
        obj[col.label] = row.enrichedData[col.id] ?? "";
      }
      return obj;
    });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    downloadBlob(blob, (fileName || "export").replace(/\.[^/.]+$/, "") + ".json");
    toast.success("JSON exported", { description: `${rows.length} rows exported` });
  }, [rows, originalColumns, enrichmentColumns, fileName]);

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
    <div className="w-[320px] border-r bg-card flex flex-col shrink-0 h-full">
      {/* Header */}
      <div className="p-4 border-b flex items-center justify-between bg-muted/30">
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">Configuration</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setSidebarOpen(false)}
        >
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="p-4 space-y-5">
          {/* Selection Info */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              <span className="text-xs font-medium text-muted-foreground">
                {selectedRowIds.size} of {rows.length} rows selected
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
                {enrichmentColumns.map((col) => (
                  <div
                    key={col.id}
                    className={`w-full text-left p-2.5 rounded-lg border transition-all duration-200 group relative overflow-hidden ${
                      col.enabled
                        ? "bg-primary/5 border-primary/20 shadow-sm"
                        : "bg-muted/50 border-transparent hover:border-border/40 hover:bg-muted"
                    }`}
                  >
                    <div className="flex items-start gap-3">
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
                      {col.isCustom && (
                        <div className="flex items-center gap-1 shrink-0">
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
                        </div>
                      )}
                    </div>

                    {/* Image URLs column config */}
                    {col.id === "imageUrls" && col.enabled && (
                      <div
                        className="mt-2.5 pt-2.5 border-t border-primary/10 space-y-2.5"
                        onClick={(e) => e.stopPropagation()}
                      >
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
                            placeholder="e.g. Find HD images on white background"
                            className="w-full text-[10px] px-2 py-1.5 rounded-md border bg-background/80 focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/40 disabled:opacity-50"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}

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

                {/* Writing Tone */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Writing Tone
                  </label>
                  <select
                    value={enrichmentSettings.writingTone}
                    onChange={(e) => updateSettings({ writingTone: e.target.value as WritingTone })}
                    disabled={isEnriching}
                    className="w-full h-8 px-2.5 text-xs rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50 cursor-pointer disabled:opacity-50"
                  >
                    {TONE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label} — {opt.description}
                      </option>
                    ))}
                  </select>
                  {enrichmentSettings.writingTone === "custom" && (
                    <textarea
                      placeholder="Describe your desired writing style..."
                      value={enrichmentSettings.customTone}
                      onChange={(e) => updateSettings({ customTone: e.target.value })}
                      disabled={isEnriching}
                      rows={2}
                      className="w-full px-2.5 py-1.5 text-xs rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none disabled:opacity-50"
                    />
                  )}
                </div>

                {/* Content Length */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Content Length
                  </label>
                  <div className="flex gap-1">
                    {([
                      { value: "short" as ContentLength, label: "Short", desc: "50-100 words" },
                      { value: "medium" as ContentLength, label: "Medium", desc: "150-300 words" },
                      { value: "long" as ContentLength, label: "Long", desc: "300-500 words" },
                    ]).map((opt) => {
                      const isSelected = enrichmentSettings.contentLength === opt.value;
                      return (
                        <button
                          key={opt.value}
                          onClick={() => updateSettings({ contentLength: opt.value })}
                          disabled={isEnriching}
                          className={`flex-1 text-center py-1.5 px-1 rounded-md border transition-all disabled:opacity-50 ${
                            isSelected
                              ? "bg-amber-500/15 border-amber-500/30 shadow-sm"
                              : "border-border/50 hover:border-border hover:bg-muted/50"
                          }`}
                        >
                          <span className={`text-[10px] font-medium block ${isSelected ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                            {opt.label}
                          </span>
                          <span className="text-[8px] text-muted-foreground/60 block">{opt.desc}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Max Retries */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Max Retries on Failure
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={1}
                      max={5}
                      step={1}
                      value={enrichmentSettings.maxRetries}
                      onChange={(e) => updateSettings({ maxRetries: parseInt(e.target.value) })}
                      disabled={isEnriching}
                      className="flex-1 h-1.5 accent-amber-500 disabled:opacity-50"
                    />
                    <span className="text-xs font-mono font-semibold text-muted-foreground bg-muted/50 px-2 py-0.5 rounded min-w-[28px] text-center">
                      {enrichmentSettings.maxRetries}
                    </span>
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

      {/* Action Buttons - Fixed at bottom */}
      <div className="p-4 border-t bg-muted/20 space-y-2">
        {!isEnriching && !allDone && (
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

        {allDone && (
          <Button
            variant="outline"
            onClick={resetEnrichState}
            className="w-full gap-2"
            size="sm"
          >
            <RotateCcw className="h-4 w-4" />
            Re-enrich All
          </Button>
        )}

        {/* Export buttons */}
        <div className="flex gap-1.5">
          <ExportButton />
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            disabled={isEnriching || doneCount === 0}
            className="gap-1 text-xs flex-1"
            title="Export as CSV"
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportJSON}
            disabled={isEnriching || doneCount === 0}
            className="gap-1 text-xs flex-1"
            title="Export as JSON"
          >
            <Download className="h-3.5 w-3.5" />
            JSON
          </Button>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={clearFile}
          disabled={isEnriching}
          className="w-full text-muted-foreground hover:text-destructive gap-1 text-xs"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear All
        </Button>
      </div>
    </div>
  );
}
