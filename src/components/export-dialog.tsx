"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, FileText, FileJson, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSheetStore } from "@/store/sheet-store";
import { exportToExcelTwoSheets } from "@/lib/excel";
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

function buildCSV(
  rows: ProductRow[],
  originalColumns: string[],
  enrichmentColumns: { id: string; label: string; enabled: boolean }[],
): string {
  const visibleEnrichment = enrichmentColumns.filter(
    (c) => {
      // Exclude sourceUrls from export
      if (c.id === "sourceUrls") return false;
      return c.enabled ||
        rows.some((r) => {
          const val = r.enrichedData?.[c.id];
          if (Array.isArray(val)) return val.length > 0;
          return val !== undefined && val !== null && val !== "";
        });
    }
  );
  const headers = [...originalColumns, ...visibleEnrichment.map((c) => c.label)];
  const csvRows = [headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(",")];
  for (const row of rows) {
    const vals = [
      ...originalColumns.map((col) => {
        const v = row.originalData[col] || "";
        return v.startsWith("data:image/") ? '"[image]"' : `"${v.replace(/"/g, '""')}"`;
      }),
      ...visibleEnrichment.map((col) => {
        const v = row.enrichedData[col.id];
        if (!v) return '""';
        if (Array.isArray(v)) {
          if (col.id === "imageUrls") {
            // Export only the first image URL
            const first = v[0];
            const url = typeof first === "object" && first !== null ? (first.imageUrl || "") : String(first || "");
            return `"${url.replace(/"/g, '""')}"`;
          }
          return `"${(v as any[])
            .map((i: any) => (typeof i === "object" ? i.imageUrl || i.uri || i.title || JSON.stringify(i) : i))
            .join("; ")
            .replace(/"/g, '""')}"`;
        }
        return `"${String(v).replace(/"/g, '""')}"`;
      }),
    ];
    csvRows.push(vals.join(","));
  }
  return csvRows.join("\n");
}

function buildJSON(
  rows: ProductRow[],
  originalColumns: string[],
  enrichmentColumns: { id: string; label: string; enabled: boolean }[],
): any[] {
  const visibleEnrichment = enrichmentColumns.filter(
    (c) => {
      if (c.id === "sourceUrls") return false;
      return c.enabled ||
        rows.some((r) => {
          const val = r.enrichedData?.[c.id];
          if (Array.isArray(val)) return val.length > 0;
          return val !== undefined && val !== null && val !== "";
        });
    }
  );
  return rows.map((row) => {
    const obj: Record<string, any> = {};
    for (const col of originalColumns) {
      const v = row.originalData[col] || "";
      obj[col] = v.startsWith("data:image/") ? "[image]" : v;
    }
    for (const col of visibleEnrichment) {
      const v = row.enrichedData[col.id];
      if (col.id === "imageUrls" && Array.isArray(v)) {
        // Export only the first image URL
        const first = v[0];
        obj[col.label] = typeof first === "object" && first !== null ? (first.imageUrl || "") : String(first || "");
      } else {
        obj[col.label] = v ?? "";
      }
    }
    return obj;
  });
}

export function ExportDialog() {
  const { rows, originalColumns, enrichmentColumns, fileName, isEnriching } =
    useSheetStore();

  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const existingRows = rows.filter((r) => r.matchType === "existing");
  const newRows = rows.filter((r) => r.matchType !== "existing");
  const totalRows = rows.length;

  const baseName = (fileName || "export").replace(/\.[^/.]+$/, "");

  const handleExportXLSX = async () => {
    setExporting(true);
    try {
      const blob = await exportToExcelTwoSheets(
        existingRows,
        newRows,
        originalColumns,
        enrichmentColumns,
      );
      downloadBlob(blob, `${baseName}_export.xlsx`);
      toast.success("Excel exported", {
        description: `${existingRows.length} existing + ${newRows.length} new rows in 2 sheets`,
      });
      setOpen(false);
    } catch (err: any) {
      toast.error("Export failed", { description: err?.message });
    } finally {
      setExporting(false);
    }
  };

  const handleExportCSV = () => {
    const parts: string[] = [];
    if (existingRows.length > 0) {
      parts.push("--- Existing ---\n" + buildCSV(existingRows, originalColumns, enrichmentColumns));
    }
    if (newRows.length > 0) {
      parts.push("--- New ---\n" + buildCSV(newRows, originalColumns, enrichmentColumns));
    }
    const blob = new Blob([parts.join("\n\n")], { type: "text/csv;charset=utf-8;" });
    downloadBlob(blob, `${baseName}_export.csv`);
    toast.success("CSV exported", {
      description: `${existingRows.length} existing + ${newRows.length} new rows`,
    });
    setOpen(false);
  };

  const handleExportJSON = () => {
    const data = {
      existing: buildJSON(existingRows, originalColumns, enrichmentColumns),
      new: buildJSON(newRows, originalColumns, enrichmentColumns),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    downloadBlob(blob, `${baseName}_export.json`);
    toast.success("JSON exported", {
      description: `${existingRows.length} existing + ${newRows.length} new rows`,
    });
    setOpen(false);
  };

  return (
    <div className="relative">
      <Button
        onClick={() => setOpen(!open)}
        disabled={isEnriching || totalRows === 0}
        variant="outline"
        className="w-full gap-2 font-medium h-9"
        size="sm"
      >
        <Download className="h-4 w-4" />
        Export ({totalRows} rows)
      </Button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          {/* Popup */}
          <div className="absolute bottom-full left-0 right-0 mb-2 z-50 bg-popover border rounded-xl shadow-xl p-4 space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
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
              {existingRows.length} existing + {newRows.length} new rows will be exported as two sheets/sections.
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
                  <div className="text-[10px] text-muted-foreground">Two sheets: Existing & New</div>
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
                  <div className="text-[10px] text-muted-foreground">Both sections in one file</div>
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
                  <div className="text-[10px] text-muted-foreground">Structured with existing & new keys</div>
                </div>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
