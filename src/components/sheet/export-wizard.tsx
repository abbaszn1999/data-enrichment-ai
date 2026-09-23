"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Columns3,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  Layers,
  ListChecks,
  Loader2,
  MousePointerClick,
  Search,
  Sheet,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";

export type ExportScope = "selected" | "sheet" | "all";
export type ExportFormat = "xlsx" | "csv" | "json";

export type ExportScopeOption = {
  id: ExportScope;
  title: string;
  description: string;
  count: number;
  disabled?: boolean;
};

export type ExportColumnOption = {
  key: string;
  label: string;
  /** Small tag shown in the column picker, e.g. "AI" or "Image". */
  tag?: string;
};

export type ExportProgressUpdate = {
  label: string;
  /** 0–100, or null while the step has no measurable progress. */
  percent: number | null;
};

export type ExportRequest = {
  scope: ExportScope;
  format: ExportFormat;
  /** Keys of the chosen columns, in sheet order. */
  columnKeys: string[];
  onProgress: (update: ExportProgressUpdate) => void;
  signal: AbortSignal;
};

export type ExportResult = { blob: Blob; filename: string; rows: number; columns: number };

const WIZARD_STEPS = [
  { id: "rows", label: "Rows" },
  { id: "format", label: "Format" },
  { id: "columns", label: "Columns" },
] as const;

type Step = (typeof WIZARD_STEPS)[number]["id"] | "exporting" | "done";

const FORMATS: {
  id: ExportFormat;
  label: string;
  description: string;
  icon: typeof FileSpreadsheet;
  tone: string;
}[] = [
  {
    id: "xlsx",
    label: "Excel (.xlsx)",
    description: "Formatted workbook, ready for Excel or Google Sheets",
    icon: FileSpreadsheet,
    tone: "bg-green-100 text-green-600 dark:bg-green-950/30 dark:text-green-400",
  },
  {
    id: "csv",
    label: "CSV (.csv)",
    description: "Plain table for any spreadsheet or import tool",
    icon: FileText,
    tone: "bg-blue-100 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400",
  },
  {
    id: "json",
    label: "JSON (.json)",
    description: "Structured data for developers and integrations",
    icon: FileJson,
    tone: "bg-amber-100 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400",
  },
];

const SCOPE_ICONS: Record<ExportScope, { icon: typeof Sheet; tone: string }> = {
  selected: { icon: MousePointerClick, tone: "bg-primary/10 text-primary" },
  sheet: { icon: Sheet, tone: "bg-sky-100 text-sky-600 dark:bg-sky-950/30 dark:text-sky-400" },
  all: { icon: Layers, tone: "bg-violet-100 text-violet-600 dark:bg-violet-950/30 dark:text-violet-400" },
};

export function formatLabel(format: ExportFormat): string {
  return FORMATS.find((f) => f.id === format)?.label.split(" ")[0] ?? format;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function isCancellation(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "ExportCancelledError")
  );
}

function ChoiceCard({
  selected,
  disabled,
  onClick,
  icon: Icon,
  iconTone,
  title,
  description,
  meta,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: typeof FileSpreadsheet;
  iconTone: string;
  title: string;
  description: string;
  meta?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        selected ? "border-primary/50 bg-primary/5 ring-1 ring-primary/30" : "hover:bg-muted/50"
      }`}
    >
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconTone}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold">{title}</div>
        <div className="text-[11px] text-muted-foreground">{description}</div>
      </div>
      {meta && (
        <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
          {meta}
        </span>
      )}
      <span
        className={`h-4 w-4 shrink-0 rounded-full border-2 ${
          selected ? "border-primary bg-primary shadow-[inset_0_0_0_2px_white]" : "border-muted-foreground/30"
        }`}
      />
    </button>
  );
}

/**
 * Guided export shared by every sheet: rows → format → columns → progress.
 * Each tool supplies its own scopes, columns and `onExport` implementation.
 */
export function ExportWizard({
  open,
  onOpenChange,
  scopes,
  defaultScope,
  getColumns,
  onExport,
  formatExtras,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scopes: ExportScopeOption[];
  defaultScope: ExportScope;
  /** Columns available for the chosen row scope, in sheet order. */
  getColumns: (scope: ExportScope) => ExportColumnOption[];
  onExport: (request: ExportRequest) => Promise<ExportResult>;
  /** Extra actions rendered under the formats (e.g. write-back). */
  formatExtras?: ReactNode;
}) {
  const [step, setStep] = useState<Step>("rows");
  const [scope, setScope] = useState<ExportScope>(defaultScope);
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [columnMode, setColumnMode] = useState<"all" | "custom">("all");
  const [pickedColumns, setPickedColumns] = useState<Set<string>>(new Set());
  const [columnSearch, setColumnSearch] = useState("");
  const [progress, setProgress] = useState<ExportProgressUpdate>({ label: "", percent: 0 });
  const [result, setResult] = useState<ExportResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [lastOpen, setLastOpen] = useState(open);

  // Each time the wizard opens, start fresh at the rows step.
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setStep("rows");
      setScope(defaultScope);
      setColumnMode("all");
      setColumnSearch("");
      setResult(null);
    }
  }

  const scopeOption = scopes.find((s) => s.id === scope) ?? scopes[0];
  const rowCount = scopeOption?.count ?? 0;
  const availableColumns = open ? getColumns(scope) : [];
  const exportColumns =
    columnMode === "all"
      ? availableColumns
      : availableColumns.filter((column) => pickedColumns.has(column.key));
  const visibleColumnList = availableColumns.filter((column) =>
    column.label.toLowerCase().includes(columnSearch.trim().toLowerCase())
  );

  const isBusy = step === "exporting";
  const stepIndex = WIZARD_STEPS.findIndex((s) => s.id === step);

  const startExport = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ label: "Preparing export…", percent: null });
    setStep("exporting");
    try {
      const exported = await onExport({
        scope,
        format,
        columnKeys: exportColumns.map((c) => c.key),
        onProgress: setProgress,
        signal: controller.signal,
      });
      downloadBlob(exported.blob, exported.filename);
      setResult(exported);
      setStep("done");
      toast.success(`${formatLabel(format)} exported`, {
        description: `${exported.rows.toLocaleString()} rows · ${exported.columns} columns`,
      });
    } catch (error) {
      if (isCancellation(error)) {
        toast.message("Export cancelled");
      } else {
        toast.error("Export failed", {
          description: error instanceof Error ? error.message : undefined,
        });
      }
      setStep("columns");
    } finally {
      abortRef.current = null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !isBusy && onOpenChange(next)}>
      <DialogContent
        className="sm:max-w-lg"
        onInteractOutside={(e) => isBusy && e.preventDefault()}
        onEscapeKeyDown={(e) => isBusy && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-base">Export data</DialogTitle>
          <DialogDescription className="text-xs">
            {step === "rows" && "Which rows do you want to export?"}
            {step === "format" && "Choose the file format."}
            {step === "columns" && "Choose the columns to include."}
            {step === "exporting" && "Building your file. Keep this window open."}
            {step === "done" && "Your file has been downloaded."}
          </DialogDescription>
        </DialogHeader>

        {stepIndex >= 0 && (
          <ol className="flex items-center gap-2">
            {WIZARD_STEPS.map((s, i) => (
              <li key={s.id} className="flex flex-1 items-center gap-2">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                    i < stepIndex
                      ? "bg-primary text-primary-foreground"
                      : i === stepIndex
                        ? "bg-primary/15 text-primary ring-1 ring-primary/40"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {i < stepIndex ? <CheckCircle2 className="h-3 w-3" /> : i + 1}
                </span>
                <span className={`text-[11px] font-medium ${i === stepIndex ? "text-foreground" : "text-muted-foreground"}`}>
                  {s.label}
                </span>
                {i < WIZARD_STEPS.length - 1 && <span className="h-px flex-1 bg-border" />}
              </li>
            ))}
          </ol>
        )}

        {step === "rows" && (
          <div className="space-y-2">
            {scopes.map((option) => (
              <ChoiceCard
                key={option.id}
                selected={scope === option.id}
                disabled={option.disabled || option.count === 0}
                onClick={() => setScope(option.id)}
                icon={SCOPE_ICONS[option.id].icon}
                iconTone={SCOPE_ICONS[option.id].tone}
                title={option.title}
                description={option.description}
                meta={option.count.toLocaleString()}
              />
            ))}
          </div>
        )}

        {step === "format" && (
          <div className="space-y-2">
            {FORMATS.map((f) => (
              <ChoiceCard
                key={f.id}
                selected={format === f.id}
                onClick={() => setFormat(f.id)}
                icon={f.icon}
                iconTone={f.tone}
                title={f.label}
                description={f.description}
              />
            ))}
            {formatExtras}
          </div>
        )}

        {step === "columns" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <ChoiceCard
                selected={columnMode === "all"}
                onClick={() => setColumnMode("all")}
                icon={Columns3}
                iconTone="bg-muted text-foreground"
                title="All columns"
                description={`${availableColumns.length} columns`}
              />
              <ChoiceCard
                selected={columnMode === "custom"}
                onClick={() => {
                  if (columnMode !== "custom" && pickedColumns.size === 0) {
                    setPickedColumns(new Set(availableColumns.map((c) => c.key)));
                  }
                  setColumnMode("custom");
                }}
                icon={ListChecks}
                iconTone="bg-muted text-foreground"
                title="Choose"
                description={
                  columnMode === "custom" ? `${exportColumns.length} selected` : "Pick specific columns"
                }
              />
            </div>

            {columnMode === "custom" && (
              <div className="rounded-lg border">
                <div className="flex items-center gap-2 border-b p-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/60" />
                    <input
                      value={columnSearch}
                      onChange={(e) => setColumnSearch(e.target.value)}
                      placeholder="Search columns…"
                      className="h-7 w-full rounded-md border bg-background pl-7 pr-2 text-xs outline-none focus:ring-1 focus:ring-primary/50"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setPickedColumns(new Set(availableColumns.map((c) => c.key)))}
                    className="text-[11px] font-medium text-primary hover:underline"
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setPickedColumns(new Set())}
                    className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
                  >
                    None
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto p-1">
                  {visibleColumnList.length === 0 && (
                    <p className="py-6 text-center text-xs text-muted-foreground">No columns match.</p>
                  )}
                  {visibleColumnList.map((column) => (
                    <label
                      key={column.key}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted/50"
                    >
                      <input
                        type="checkbox"
                        checked={pickedColumns.has(column.key)}
                        onChange={() =>
                          setPickedColumns((current) => {
                            const next = new Set(current);
                            if (next.has(column.key)) next.delete(column.key);
                            else next.add(column.key);
                            return next;
                          })
                        }
                        className="h-3.5 w-3.5 accent-primary"
                      />
                      <span className="min-w-0 flex-1 truncate">{column.label}</span>
                      {column.tag && (
                        <span className="flex shrink-0 items-center gap-0.5 text-[9px] font-medium uppercase tracking-wide text-primary/70">
                          {column.tag === "AI" && <Sparkles className="h-2.5 w-2.5" />}
                          {column.tag}
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-lg bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
              <span className="font-semibold text-foreground">{rowCount.toLocaleString()}</span> rows ·{" "}
              <span className="font-semibold text-foreground">{exportColumns.length}</span> columns ·{" "}
              {FORMATS.find((f) => f.id === format)?.label}
            </div>
          </div>
        )}

        {step === "exporting" && (
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  Exporting {rowCount.toLocaleString()} rows to {formatLabel(format)}
                </p>
                <p className="text-xs text-muted-foreground">{progress.label}</p>
              </div>
            </div>
            {progress.percent === null ? (
              <div className="relative h-2 overflow-hidden rounded-full bg-primary/15">
                <div className="absolute inset-y-0 w-1/3 animate-[export-indeterminate_1.2s_ease-in-out_infinite] rounded-full bg-primary" />
                <style>{`@keyframes export-indeterminate { 0% { left: -33%; } 100% { left: 100%; } }`}</style>
              </div>
            ) : (
              <>
                <Progress value={progress.percent} className="h-2" />
                <p className="text-right font-mono text-[10px] text-muted-foreground">
                  {Math.round(progress.percent)}%
                </p>
              </>
            )}
          </div>
        )}

        {step === "done" && result && (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-950/30">
              <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <p className="text-sm font-semibold">Export ready</p>
            <p className="max-w-full truncate font-mono text-xs text-muted-foreground">{result.filename}</p>
            <p className="text-[11px] text-muted-foreground">
              {result.rows.toLocaleString()} rows · {result.columns} columns
            </p>
          </div>
        )}

        <DialogFooter className="flex-row items-center sm:justify-between">
          {step === "format" || step === "columns" ? (
            <Button
              variant="ghost"
              size="sm"
              className="mr-auto gap-1"
              onClick={() => setStep(step === "columns" ? "format" : "rows")}
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
          ) : (
            <span className="mr-auto" />
          )}
          {step === "rows" && (
            <Button size="sm" onClick={() => setStep("format")} disabled={rowCount === 0}>
              Next
            </Button>
          )}
          {step === "format" && (
            <Button size="sm" onClick={() => setStep("columns")}>
              Next
            </Button>
          )}
          {step === "columns" && (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => void startExport()}
              disabled={exportColumns.length === 0 || rowCount === 0}
            >
              <Download className="h-3.5 w-3.5" />
              Export {rowCount.toLocaleString()} rows
            </Button>
          )}
          {step === "exporting" && (
            <Button variant="outline" size="sm" onClick={() => abortRef.current?.abort()}>
              Cancel
            </Button>
          )}
          {step === "done" && result && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => downloadBlob(result.blob, result.filename)}
              >
                <Download className="h-3.5 w-3.5" /> Download again
              </Button>
              <Button size="sm" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Downloads a server-built export, reporting "server is building" then
 * byte-level download progress, and honouring cancellation. Large exports come
 * back as a signed storage link (no response-size limit), which is followed here.
 */
export async function fetchExportFile(
  input: string,
  init: RequestInit & { signal: AbortSignal },
  onProgress: (update: ExportProgressUpdate) => void
): Promise<Blob> {
  onProgress({ label: "Building the file on the server…", percent: null });
  let res = await fetch(input, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Export failed (${res.status})`);
  }
  let type = res.headers.get("Content-Type") || "application/octet-stream";
  if (type.startsWith("application/json")) {
    const link = (await res.clone().json().catch(() => null)) as {
      downloadUrl?: string;
      contentType?: string;
    } | null;
    if (link?.downloadUrl) {
      onProgress({ label: "Starting download…", percent: 0 });
      res = await fetch(link.downloadUrl, { signal: init.signal });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      type = link.contentType || res.headers.get("Content-Type") || type;
    }
  }
  const total = Number(res.headers.get("Content-Length")) || 0;
  if (!res.body) return new Blob([await res.arrayBuffer()], { type });
  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress({
      label:
        total > 0
          ? `Downloading… ${formatBytes(received)} of ${formatBytes(total)}`
          : `Downloading… ${formatBytes(received)}`,
      percent: total > 0 ? Math.min(100, (received / total) * 100) : null,
    });
  }
  onProgress({ label: "Finishing…", percent: 100 });
  return new Blob(chunks, { type });
}
