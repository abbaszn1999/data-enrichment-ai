"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, FileText, FileJson, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { generateCSV, generateXLSX, downloadBlob } from "@/lib/export-generators";

type SyncExportButtonProps = {
  /** Columns of the currently loaded sheet, in display order. */
  columns: string[];
  /** Rows of the currently loaded sheet (flat records). */
  rows: Record<string, any>[];
  /** Current entity ("products" | "collections" | …) — drives the file name. */
  entity?: string | null;
  /** Disable the trigger (e.g. while the agent is streaming/applying). */
  disabled?: boolean;
};

/**
 * Converts a sync cell value to a flat string suitable for spreadsheet/CSV
 * export. Arrays are joined on newlines (pulling a sensible field out of object
 * items), objects are JSON-stringified, and inline data-URI images are masked.
 */
function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        typeof item === "object" && item !== null
          ? (item.imageUrl || item.uri || item.url || item.src || item.title || JSON.stringify(item))
          : String(item ?? "")
      )
      .filter(Boolean)
      .join("\n");
  }
  if (typeof value === "object") return JSON.stringify(value);
  const str = String(value);
  return str.startsWith("data:image/") ? "[image]" : str;
}

/** Build a flat string-keyed dataset honoring the loaded column order. */
function buildRows(columns: string[], rows: Record<string, any>[]): Record<string, string>[] {
  return rows.map((row) => {
    const out: Record<string, string> = {};
    for (const col of columns) out[col] = cellToString(row[col]);
    return out;
  });
}

export function SyncExportButton({ columns, rows, entity, disabled }: SyncExportButtonProps) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const totalRows = rows.length;
  const isEmpty = totalRows === 0 || columns.length === 0;
  const baseName = `${entity || "sync"}_export_${new Date().toISOString().slice(0, 10)}`;

  const handleExportXLSX = async () => {
    setExporting(true);
    try {
      const data = buildRows(columns, rows);
      const buffer = await generateXLSX(data);
      downloadBlob(
        buffer,
        `${baseName}.xlsx`,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      toast.success("Excel exported", { description: `${totalRows} row${totalRows === 1 ? "" : "s"}` });
      setOpen(false);
    } catch (err: any) {
      toast.error("Export failed", { description: err?.message });
    } finally {
      setExporting(false);
    }
  };

  const handleExportCSV = () => {
    try {
      const data = buildRows(columns, rows);
      const csv = generateCSV(data);
      downloadBlob(csv, `${baseName}.csv`, "text/csv;charset=utf-8;");
      toast.success("CSV exported", { description: `${totalRows} row${totalRows === 1 ? "" : "s"}` });
      setOpen(false);
    } catch (err: any) {
      toast.error("Export failed", { description: err?.message });
    }
  };

  const handleExportJSON = () => {
    try {
      const data = buildRows(columns, rows);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${baseName}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("JSON exported", { description: `${totalRows} row${totalRows === 1 ? "" : "s"}` });
      setOpen(false);
    } catch (err: any) {
      toast.error("Export failed", { description: err?.message });
    }
  };

  return (
    <div className="relative">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 px-3 text-[11px] gap-1"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || isEmpty}
        title="Export the currently loaded sheet"
      >
        <Download className="h-3.5 w-3.5" />
        Export
      </Button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          {/* Popup — opens downward since the trigger lives in the top header. */}
          <div className="absolute top-full right-0 mt-2 z-50 w-72 bg-popover border rounded-xl shadow-xl p-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Export Data</h3>
              <button
                onClick={() => setOpen(false)}
                className="h-6 w-6 rounded-md hover:bg-muted flex items-center justify-center"
              >
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>

            <p className="text-[10px] text-muted-foreground">
              {totalRows} {entity === "collections" ? "taxonomy" : entity || "sync"} row{totalRows === 1 ? "" : "s"} from the loaded sheet will be exported.
            </p>

            <div className="space-y-1.5">
              <button
                onClick={handleExportXLSX}
                disabled={exporting}
                className="w-full flex items-center gap-3 p-2.5 rounded-lg border hover:bg-muted/50 transition-colors text-left disabled:opacity-50"
              >
                <div className="h-8 w-8 rounded-lg bg-green-100 dark:bg-green-950/30 flex items-center justify-center shrink-0">
                  <FileSpreadsheet className="h-4 w-4 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <div className="text-xs font-semibold">Excel (.xlsx)</div>
                  <div className="text-[10px] text-muted-foreground">Single sheet with loaded columns</div>
                </div>
              </button>

              <button
                onClick={handleExportCSV}
                disabled={exporting}
                className="w-full flex items-center gap-3 p-2.5 rounded-lg border hover:bg-muted/50 transition-colors text-left disabled:opacity-50"
              >
                <div className="h-8 w-8 rounded-lg bg-blue-100 dark:bg-blue-950/30 flex items-center justify-center shrink-0">
                  <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <div className="text-xs font-semibold">CSV (.csv)</div>
                  <div className="text-[10px] text-muted-foreground">Comma-separated values</div>
                </div>
              </button>

              <button
                onClick={handleExportJSON}
                disabled={exporting}
                className="w-full flex items-center gap-3 p-2.5 rounded-lg border hover:bg-muted/50 transition-colors text-left disabled:opacity-50"
              >
                <div className="h-8 w-8 rounded-lg bg-amber-100 dark:bg-amber-950/30 flex items-center justify-center shrink-0">
                  <FileJson className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <div className="text-xs font-semibold">JSON (.json)</div>
                  <div className="text-[10px] text-muted-foreground">Array of row objects</div>
                </div>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
