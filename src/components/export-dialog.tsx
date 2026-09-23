"use client";

import { useMemo, useState } from "react";
import { Download, FolderTree } from "lucide-react";
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
import {
  buildProductGroupIndex,
  partitionRowsForExport,
} from "@/lib/catalog/product-groups";
import { buildCatalogExport, type ExportColumn } from "@/lib/catalog/export-file";
import {
  ExportWizard,
  type ExportColumnOption,
  type ExportRequest,
  type ExportScope,
  type ExportScopeOption,
} from "@/components/sheet/export-wizard";
import type { ProductRow } from "@/types";

function hasEnrichedValue(row: ProductRow, columnId: string): boolean {
  const value = row.enrichedData?.[columnId];
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== "";
}

function columnKey(column: ExportColumn): string {
  return `${column.source}:${column.key}`;
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
    selectedRowIds,
    activeSheet,
  } = useSheetStore();

  const [open, setOpen] = useState(false);
  const [confirmWriteBack, setConfirmWriteBack] = useState(false);
  const [writingBack, setWritingBack] = useState(false);

  const isPlp = sessionKind === "plp";
  const sectionNames = isPlp
    ? { existing: "Existing pages", new: "New pages" }
    : { existing: "Existing", new: "New" };
  const totalRows = rows.length;
  const baseName = (fileName || "export").replace(/\.[^/.]+$/, "");

  const partition = useMemo(
    () => partitionRowsForExport(rows, productGroupColumn),
    [rows, productGroupColumn]
  );
  const sheetRows = activeSheet === "existing" ? partition.existing : partition.new;

  // Grid selection holds product (primary) rows; export their variants too.
  const selectedRows = useMemo(() => {
    if (selectedRowIds.size === 0) return [];
    const index = buildProductGroupIndex(rows, productGroupColumn);
    const ids = new Set<string>();
    for (const id of selectedRowIds) {
      const members = index.enabled ? index.memberIdsByPrimary.get(id) : undefined;
      for (const member of members ?? [id]) ids.add(member);
    }
    return rows.filter((row) => ids.has(row.id));
  }, [rows, selectedRowIds, productGroupColumn]);

  const rowsFor = (scope: ExportScope) =>
    scope === "selected" ? selectedRows : scope === "sheet" ? sheetRows : rows;

  const scopes: ExportScopeOption[] = [
    {
      id: "selected",
      title: "Selected rows",
      description:
        selectedRows.length === 0
          ? "Select rows in the table to use this option"
          : "Only the rows you checked in the table",
      count: selectedRows.length,
    },
    {
      id: "sheet",
      title: `${activeSheet === "existing" ? sectionNames.existing : sectionNames.new} sheet`,
      description: "Every row in the sheet you are viewing",
      count: sheetRows.length,
    },
    {
      id: "all",
      title: "Whole file",
      description: `Existing and New together (${partition.existing.length} + ${partition.new.length})`,
      count: totalRows,
    },
  ];

  const columnsFor = (scope: ExportScope): ExportColumn[] => {
    const scopeRows = rowsFor(scope);
    return [
      ...originalColumns.map((name): ExportColumn => ({ key: name, label: name, source: "original" })),
      ...enrichmentColumns
        .filter((col) => col.enabled || scopeRows.some((row) => hasEnrichedValue(row, col.id)))
        .map((col): ExportColumn => ({ key: col.id, label: col.label, source: "enriched" })),
    ];
  };

  const getColumns = (scope: ExportScope): ExportColumnOption[] =>
    columnsFor(scope).map((column) => ({
      key: columnKey(column),
      label: column.label,
      tag: column.source === "enriched" ? "AI" : undefined,
    }));

  const handleExport = async ({ scope, format, columnKeys, onProgress, signal }: ExportRequest) => {
    const exportRows = rowsFor(scope);
    const picked = new Set(columnKeys);
    const columns = columnsFor(scope).filter((column) => picked.has(columnKey(column)));
    const split = partitionRowsForExport(exportRows, productGroupColumn);
    const blob = await buildCatalogExport({
      format,
      sections: [
        { name: sectionNames.existing, rows: split.existing },
        { name: sectionNames.new, rows: split.new },
      ],
      columns,
      isCancelled: () => signal.aborted,
      onProgress: ({ done, total, phase }) =>
        onProgress(
          phase === "packaging"
            ? { label: "Packaging the file…", percent: 100 }
            : {
                label: `Writing rows ${done.toLocaleString()} of ${total.toLocaleString()}`,
                percent: total > 0 ? (done / total) * 100 : 100,
              }
        ),
    });
    const suffix = scope === "selected" ? "selected" : scope === "sheet" ? activeSheet : "export";
    return {
      blob,
      filename: `${baseName}_${suffix}.${format}`,
      rows: exportRows.length,
      columns: columns.length,
    };
  };

  const writeBackCount = isPlp ? countRowsWithPlpContent(rows) : 0;

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
      const writeBack = await applyPlpWriteBack({
        workspaceId,
        sessionId: projectId,
        rows,
        sourceColumn:
          session?.supplier_match_column ||
          guessPlpSourceColumn(originalColumns),
        masterColumn: session?.master_match_column || "name",
      });
      if (writeBack.updated === 0) {
        toast.error("Nothing was written", {
          description:
            writeBack.unmatched > 0
              ? `${writeBack.unmatched} rows did not match any category in your store.`
              : "No PLP content found on these rows.",
        });
      } else {
        toast.success(`${writeBack.updated} categories updated`, {
          description: [
            writeBack.unmatched > 0 ? `${writeBack.unmatched} unmatched` : null,
            writeBack.skipped > 0 ? `${writeBack.skipped} without content` : null,
          ]
            .filter(Boolean)
            .join(" · ") || undefined,
        });
      }
      setConfirmWriteBack(false);
      setOpen(false);
    } catch (err) {
      toast.error("Write-back failed", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setWritingBack(false);
    }
  };

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        disabled={isEnriching || totalRows === 0}
        variant="outline"
        className="w-full gap-2 font-medium h-9"
        size="sm"
      >
        <Download className="h-4 w-4" />
        Export ({totalRows} rows)
      </Button>

      <ExportWizard
        open={open}
        onOpenChange={setOpen}
        scopes={scopes}
        defaultScope={selectedRows.length > 0 ? "selected" : "all"}
        getColumns={getColumns}
        onExport={handleExport}
        formatExtras={
          isPlp ? (
            <div className="space-y-2 border-t pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Or write back
              </p>
              <button
                type="button"
                onClick={() => setConfirmWriteBack(true)}
                disabled={writeBackCount === 0}
                className="flex w-full items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-left transition-colors hover:bg-primary/10 disabled:opacity-50"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15">
                  <FolderTree className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <div className="text-xs font-semibold">Apply to my categories</div>
                  <div className="text-[11px] text-muted-foreground">
                    {writeBackCount === 0
                      ? "No enriched pages yet"
                      : `Write SEO content into ${writeBackCount} category pages`}
                  </div>
                </div>
              </button>
            </div>
          ) : undefined
        }
      />

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
    </>
  );
}
