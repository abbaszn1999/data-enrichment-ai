"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, FileText, FileJson, FolderTree, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { getImportSession } from "@/lib/supabase";
import { guessPlpSourceColumn } from "@/lib/import-matching";
import { applyPlpWriteBack, countRowsWithPlpContent } from "@/lib/plp-writeback";
import { useSheetStore } from "@/store/sheet-store";
import { exportToExcelTwoSheets } from "@/lib/excel";
import { enrichedValueToJson, enrichedValueToText } from "@/lib/export-values";
import type { ProductRow } from "@/types";
import { partitionRowsForExport } from "@/lib/catalog/product-groups";

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
    (c) => c.enabled ||
      rows.some((r) => {
        const val = r.enrichedData?.[c.id];
        if (Array.isArray(val)) return val.length > 0;
        return val !== undefined && val !== null && val !== "";
      })
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
        const text = enrichedValueToText(row.enrichedData[col.id], col.id);
        return `"${text.replace(/"/g, '""')}"`;
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
    (c) => c.enabled ||
      rows.some((r) => {
        const val = r.enrichedData?.[c.id];
        if (Array.isArray(val)) return val.length > 0;
        return val !== undefined && val !== null && val !== "";
      })
  );
  return rows.map((row) => {
    const obj: Record<string, any> = {};
    for (const col of originalColumns) {
      const v = row.originalData[col] || "";
      obj[col] = v.startsWith("data:image/") ? "[image]" : v;
    }
    for (const col of visibleEnrichment) {
      obj[col.label] = enrichedValueToJson(row.enrichedData[col.id], col.id);
    }
    return obj;
  });
}

export function ExportDialog() {
  const {
    rows,
    originalColumns,
    enrichmentColumns,
    fileName,
    isEnriching,
    sessionKind,
    workspaceId,
    projectId,
    productGroupColumn,
  } = useSheetStore();

  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmWriteBack, setConfirmWriteBack] = useState(false);
  const [writingBack, setWritingBack] = useState(false);

  const { existing: existingRows, new: newRows } = partitionRowsForExport(
    rows,
    productGroupColumn
  );
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

  const writeBackCount = sessionKind === "plp" ? countRowsWithPlpContent(rows) : 0;

  const handleWriteBack = async () => {
    if (!workspaceId || !projectId) {
      toast.error("Session not loaded", {
        description: "Reload the workspace and try again.",
      });
      return;
    }
    setWritingBack(true);
    try {
      const session = await getImportSession(projectId);
      const result = await applyPlpWriteBack({
        workspaceId,
        sessionId: projectId,
        rows,
        sourceColumn:
          session?.supplier_match_column ||
          guessPlpSourceColumn(originalColumns),
        masterColumn: session?.master_match_column || "name",
      });
      if (result.updated === 0) {
        toast.error("Nothing was written", {
          description:
            result.unmatched > 0
              ? `${result.unmatched} rows did not match any category in your store.`
              : "No PLP content found on these rows.",
        });
      } else {
        toast.success(`${result.updated} categories updated`, {
          description: [
            result.unmatched > 0 ? `${result.unmatched} unmatched` : null,
            result.skipped > 0 ? `${result.skipped} without content` : null,
          ]
            .filter(Boolean)
            .join(" · ") || undefined,
        });
      }
      setConfirmWriteBack(false);
      setOpen(false);
    } catch (err: any) {
      toast.error("Write-back failed", { description: err?.message });
    } finally {
      setWritingBack(false);
    }
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

              {sessionKind === "plp" && (
                <button
                  onClick={() => setConfirmWriteBack(true)}
                  disabled={exporting || writeBackCount === 0}
                  className="w-full flex items-center gap-3 p-2.5 rounded-lg border border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors text-left disabled:opacity-50"
                >
                  <div className="h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                    <FolderTree className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold">Apply to my categories</div>
                    <div className="text-[10px] text-muted-foreground">
                      {writeBackCount === 0
                        ? "No enriched pages yet"
                        : `Write SEO content into ${writeBackCount} category pages`}
                    </div>
                  </div>
                </button>
              )}
            </div>
          </div>
        </>
      )}

      <AlertDialog open={confirmWriteBack} onOpenChange={setConfirmWriteBack}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply to my categories?</AlertDialogTitle>
            <AlertDialogDescription>
              SEO content from {writeBackCount} enriched{" "}
              {writeBackCount === 1 ? "page" : "pages"} will be written into your
              store categories. Rows that match no existing category are skipped,
              and fields left empty keep their current value.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={writingBack}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleWriteBack();
              }}
              disabled={writingBack}
            >
              {writingBack ? "Writing..." : "Apply"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
