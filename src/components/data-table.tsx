"use client";

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnResizeMode,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Clock,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Sparkles,
  Search,
  X,
  Eye,
  Trash2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Plus,
  EyeOff,
  Filter,
  Columns3,
  RotateCcw,
  GripVertical,
} from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSheetStore } from "@/store/sheet-store";
import type { ProductRow } from "@/types";

// --- Status Icon ---
function StatusCell({ status, errorMessage }: { status: ProductRow["status"]; errorMessage?: string }) {
  const icons = {
    pending: <Clock className="h-3.5 w-3.5 text-muted-foreground/60" />,
    processing: <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />,
    done: <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />,
    error: <AlertCircle className="h-3.5 w-3.5 text-destructive" />,
  };
  const labels = {
    pending: "Pending",
    processing: "Processing...",
    done: "Complete",
    error: errorMessage || "Error",
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center justify-center">{icons[status]}</div>
      </TooltipTrigger>
      <TooltipContent side="right" className={status === "error" ? "max-w-xs text-destructive" : ""}>
        {labels[status]}
      </TooltipContent>
    </Tooltip>
  );
}

// --- Editable Cell ---
function EditableCell({
  value,
  rowId,
  column,
  isEditable,
}: {
  value: string;
  rowId: string;
  column: string;
  isEditable: boolean;
}) {
  const { updateCellValue } = useSheetStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const handleDoubleClick = useCallback(() => {
    if (!isEditable) return;
    setDraft(value);
    setEditing(true);
  }, [isEditable, value]);

  const handleBlur = useCallback(() => {
    setEditing(false);
    if (draft !== value) {
      updateCellValue(rowId, column, draft);
    }
  }, [draft, value, rowId, column, updateCellValue]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        (e.target as HTMLInputElement).blur();
      }
      if (e.key === "Escape") {
        setDraft(value);
        setEditing(false);
      }
    },
    [value]
  );

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className="w-full bg-background border border-primary/40 rounded px-1.5 py-0.5 text-xs outline-none focus:ring-1 focus:ring-primary/50"
      />
    );
  }

  if (!value || value.trim() === "") {
    return (
      <span
        className={`text-muted-foreground/30 text-xs block w-full min-h-[20px] ${isEditable ? "cursor-text" : "cursor-default"}`}
        onDoubleClick={handleDoubleClick}
      >
        —
      </span>
    );
  }

  // Detect base64 image data URL
  if (value.startsWith("data:image/")) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <img
            src={value}
            alt="Product"
            className="h-10 w-10 object-contain rounded border border-border/40 bg-white"
          />
        </TooltipTrigger>
        <TooltipContent side="right" className="p-1">
          <img
            src={value}
            alt="Product"
            className="max-h-48 max-w-48 object-contain rounded"
          />
        </TooltipContent>
      </Tooltip>
    );
  }

  const str = String(value);
  return (
    <div
      onDoubleClick={handleDoubleClick}
      className={`text-xs leading-relaxed break-words whitespace-pre-wrap w-full ${isEditable ? "cursor-text" : "cursor-default"}`}
    >
      {str}
    </div>
  );
}

// --- Source URLs Cell ---
function SourceUrlsCell({ sources }: { sources: { title: string; uri: string }[] }) {
  const [open, setOpen] = useState(false);
  const preview = sources.slice(0, 3);
  const remaining = sources.length - 3;

  return (
    <>
      <div className="flex flex-col gap-0.5">
        {preview.map((source, i) => (
          <a
            key={i}
            href={source.uri}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-blue-500 hover:underline flex items-center gap-1 truncate"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">{source.title || "Source"}</span>
          </a>
        ))}
        {remaining > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); setOpen(true); }}
            className="text-[10px] text-primary hover:underline text-left cursor-pointer"
          >
            +{remaining} more
          </button>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[70vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <ExternalLink className="h-4 w-4" />
              All Sources ({sources.length})
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 mt-2">
            {sources.map((source, i) => (
              <a
                key={i}
                href={source.uri}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-2 text-sm text-blue-500 hover:underline p-2 rounded-md hover:bg-muted/50 transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span className="break-all leading-snug">{source.title || source.uri}</span>
              </a>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// --- Image URLs Cell ---
function ImageUrlsCell({ images }: { images: { imageUrl: string; pageUrl: string; title: string }[] }) {
  const [open, setOpen] = useState(false);

  if (!images || images.length === 0) {
    return <span className="text-muted-foreground/30 text-xs">—</span>;
  }

  return (
    <>
      <div className="flex gap-1.5 flex-wrap">
        {images.slice(0, 3).map((img, i) => (
          <a
            key={i}
            href={img.imageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block shrink-0 group/img"
            onClick={(e) => e.stopPropagation()}
            title={img.title || "Product image"}
          >
            <img
              src={img.imageUrl}
              alt={img.title || "Product"}
              className="h-10 w-10 object-cover rounded border border-border/40 bg-white group-hover/img:ring-2 group-hover/img:ring-primary/40 transition-all"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </a>
        ))}
        {images.length > 3 && (
          <button
            onClick={(e) => { e.stopPropagation(); setOpen(true); }}
            className="h-10 w-10 rounded border border-dashed border-border/40 flex items-center justify-center text-[10px] text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
          >
            +{images.length - 3}
          </button>
        )}
      </div>

      {images.length <= 3 && (
        <div className="mt-1 flex flex-col gap-0.5">
          {images.map((img, i) => (
            <a
              key={i}
              href={img.imageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[9px] text-blue-500/70 hover:text-blue-500 hover:underline truncate block"
              onClick={(e) => e.stopPropagation()}
            >
              {img.title || img.imageUrl.split("/").pop()?.slice(0, 40) || "Image"}
            </a>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              All Images ({images.length})
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 mt-2">
            {images.map((img, i) => (
              <a
                key={i}
                href={img.imageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-lg border overflow-hidden hover:ring-2 hover:ring-primary/40 transition-all group/card"
              >
                <img
                  src={img.imageUrl}
                  alt={img.title || "Product"}
                  className="w-full h-40 object-contain bg-white p-2"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = "";
                    (e.target as HTMLImageElement).alt = "Failed to load";
                  }}
                />
                <div className="p-2 bg-muted/30 border-t">
                  <p className="text-[11px] font-medium truncate">{img.title || "Product image"}</p>
                  <p className="text-[9px] text-blue-500/70 truncate mt-0.5">{img.imageUrl}</p>
                </div>
              </a>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// --- Editable Enriched Cell ---
function EditableEnrichedCell({
  value,
  rowId,
  enrichKey,
  isEditable,
}: {
  value: unknown;
  rowId: string;
  enrichKey: string;
  isEditable: boolean;
}) {
  const { updateEnrichedCellValue } = useSheetStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftArray, setDraftArray] = useState<string[]>([]);

  const startEditString = useCallback(() => {
    if (!isEditable) return;
    setDraft(String(value || ""));
    setEditing(true);
  }, [isEditable, value]);

  const startEditArray = useCallback(() => {
    if (!isEditable) return;
    setDraftArray([...(value as string[])]);
    setEditing(true);
  }, [isEditable, value]);

  const commitString = useCallback(() => {
    setEditing(false);
    if (draft !== String(value || "")) {
      updateEnrichedCellValue(rowId, enrichKey as any, draft);
    }
  }, [draft, value, rowId, enrichKey, updateEnrichedCellValue]);

  const commitArray = useCallback(() => {
    setEditing(false);
    const cleaned = draftArray.filter((s) => s.trim() !== "");
    updateEnrichedCellValue(rowId, enrichKey as any, cleaned);
  }, [draftArray, rowId, enrichKey, updateEnrichedCellValue]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        setEditing(false);
      }
    },
    []
  );

  // Empty
  if (value === undefined || value === null || value === "") {
    return (
      <div
        onDoubleClick={startEditString}
        className={`text-muted-foreground/30 text-xs ${isEditable ? "cursor-text hover:text-muted-foreground/50 transition-colors" : ""}`}
      >
        {isEditable ? "Double-click to add" : "—"}
      </div>
    );
  }

  // Array types
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <div
          onDoubleClick={startEditArray}
          className={`text-muted-foreground/30 text-xs ${isEditable ? "cursor-text hover:text-muted-foreground/50" : ""}`}
        >
          {isEditable ? "Double-click to add" : "—"}
        </div>
      );
    }

    // Image URLs - show as thumbnails with links
    if (value[0] && typeof value[0] === "object" && "imageUrl" in value[0]) {
      const images = value as { imageUrl: string; pageUrl: string; title: string }[];
      return <ImageUrlsCell images={images} />;
    }

    // Source URLs - show as links with dialog for all sources
    if (value[0] && typeof value[0] === "object" && "uri" in value[0]) {
      const sources = value as { title: string; uri: string }[];
      return <SourceUrlsCell sources={sources} />;
    }

    // Editable string array (features, keywords, bullets)
    if (editing) {
      return (
        <div className="space-y-1 w-full" onKeyDown={handleKeyDown}>
          {draftArray.map((item, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                autoFocus={i === 0}
                value={item}
                onChange={(e) => {
                  const next = [...draftArray];
                  next[i] = e.target.value;
                  setDraftArray(next);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const next = [...draftArray];
                    next.splice(i + 1, 0, "");
                    setDraftArray(next);
                    setTimeout(() => {
                      const inputs = (e.target as HTMLElement).parentElement?.parentElement?.querySelectorAll("input");
                      inputs?.[i + 1]?.focus();
                    }, 0);
                  }
                  if (e.key === "Backspace" && item === "" && draftArray.length > 1) {
                    e.preventDefault();
                    const next = draftArray.filter((_, idx) => idx !== i);
                    setDraftArray(next);
                  }
                }}
                className="flex-1 min-w-0 bg-background border border-primary/30 rounded px-1.5 py-0.5 text-[11px] outline-none focus:ring-1 focus:ring-primary/50"
              />
              <button
                onClick={() => setDraftArray(draftArray.filter((_, idx) => idx !== i))}
                className="text-muted-foreground/40 hover:text-destructive shrink-0"
                tabIndex={-1}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <div className="flex gap-1 pt-0.5">
            <button
              onClick={() => setDraftArray([...draftArray, ""])}
              className="text-[10px] text-primary/70 hover:text-primary transition-colors"
            >
              + Add item
            </button>
            <div className="flex-1" />
            <button
              onClick={() => setEditing(false)}
              className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded"
            >
              Cancel
            </button>
            <button
              onClick={commitArray}
              className="text-[10px] bg-primary text-primary-foreground px-2 py-0.5 rounded hover:bg-primary/90 transition-colors font-medium"
            >
              Save
            </button>
          </div>
        </div>
      );
    }

    return (
      <div
        onDoubleClick={startEditArray}
        className={`flex flex-col gap-0.5 group ${isEditable ? "cursor-text" : ""}`}
      >
        {(value as string[]).slice(0, 4).map((item, i) => (
          <div key={i} className="flex items-start gap-1">
            <span className="text-[9px] mt-0.5 opacity-40 shrink-0">•</span>
            <span className="text-[11px] leading-snug break-words whitespace-pre-wrap">{item}</span>
          </div>
        ))}
        {value.length > 4 && (
          <span className="text-[10px] text-muted-foreground mt-0.5">+{value.length - 4} more</span>
        )}
        {isEditable && (
          <span className="text-[9px] text-primary/0 group-hover:text-primary/50 transition-colors mt-0.5">
            Double-click to edit
          </span>
        )}
      </div>
    );
  }

  // String types (title, description, category)
  const str = String(value);

  if (editing) {
    return (
      <div className="w-full" onKeyDown={handleKeyDown}>
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={Math.min(6, Math.max(2, Math.ceil(str.length / 40)))}
          className="w-full bg-background border border-primary/30 rounded px-1.5 py-1 text-[11px] leading-snug outline-none focus:ring-1 focus:ring-primary/50 resize-y min-h-[2rem]"
        />
        <div className="flex justify-end gap-1 mt-1">
          <button
            onClick={() => setEditing(false)}
            className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded"
          >
            Cancel
          </button>
          <button
            onClick={commitString}
            className="text-[10px] bg-primary text-primary-foreground px-2 py-0.5 rounded hover:bg-primary/90 transition-colors font-medium"
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  if (str.length > 80) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            onDoubleClick={startEditString}
            className={`text-[11px] leading-snug break-words whitespace-pre-wrap w-full group ${isEditable ? "cursor-text" : "cursor-default"}`}
          >
            {str}
            {isEditable && (
              <span className="text-[9px] text-primary/0 group-hover:text-primary/50 transition-colors block mt-0.5">
                Double-click to edit
              </span>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-md whitespace-pre-wrap text-xs p-3 leading-relaxed z-50">
          {str}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div
      onDoubleClick={startEditString}
      className={`text-[11px] leading-snug break-words whitespace-pre-wrap w-full group ${isEditable ? "cursor-text" : ""}`}
    >
      {str}
      {isEditable && (
        <span className="text-[9px] text-primary/0 group-hover:text-primary/50 transition-colors block mt-0.5">
          Double-click to edit
        </span>
      )}
    </div>
  );
}

// --- Row Preview Panel ---
function RowPreviewPanel({
  row,
  originalColumns,
  enrichmentColumns,
  onClose,
}: {
  row: ProductRow;
  originalColumns: string[];
  enrichmentColumns: { id: string; label: string; enabled: boolean }[];
  onClose: () => void;
}) {
  return (
    <div className="w-[380px] border-l bg-card flex flex-col shrink-0 h-full animate-in slide-in-from-right-5 duration-200">
      <div className="p-4 border-b flex items-center justify-between bg-muted/30">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">Row #{row.rowIndex + 1}</span>
          <StatusCell status={row.status} errorMessage={row.errorMessage} />
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
        {/* Original Data */}
        <div>
          <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Original Data</h3>
          <div className="space-y-2">
            {originalColumns.map((col) => {
              const val = row.originalData[col] || "";
              const isImage = val.startsWith("data:image/");
              return (
                <div key={col} className="border rounded-lg p-2.5 bg-muted/20">
                  <div className="text-[10px] font-semibold text-muted-foreground mb-1">{col}</div>
                  {isImage ? (
                    <img src={val} alt={col} className="h-16 w-16 object-contain rounded border bg-white" />
                  ) : (
                    <div className="text-xs leading-relaxed break-words">{val || <span className="text-muted-foreground/40">—</span>}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {/* Enriched Data */}
        {Object.keys(row.enrichedData).length > 0 && (
          <div>
            <h3 className="text-[11px] font-semibold text-primary uppercase tracking-wider mb-2 flex items-center gap-1">
              <Sparkles className="h-3 w-3" /> Enriched Data
            </h3>
            <div className="space-y-2">
              {enrichmentColumns.filter((c) => c.enabled).map((col) => {
                const val = row.enrichedData[col.id];
                if (val === undefined || val === null) return null;
                let display: React.ReactNode;
                if (Array.isArray(val)) {
                  if (val.length > 0 && typeof val[0] === "object" && "uri" in val[0]) {
                    display = (val as { title: string; uri: string }[]).map((s, i) => (
                      <a key={i} href={s.uri} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-500 hover:underline flex items-center gap-1">
                        <ExternalLink className="h-2.5 w-2.5 shrink-0" />{s.title}
                      </a>
                    ));
                  } else {
                    display = (val as string[]).map((item, i) => (
                      <div key={i} className="text-xs">• {item}</div>
                    ));
                  }
                } else {
                  display = <div className="text-xs leading-relaxed break-words">{String(val)}</div>;
                }
                return (
                  <div key={col.id} className="border rounded-lg p-2.5 bg-primary/5 border-primary/20">
                    <div className="text-[10px] font-semibold text-primary mb-1">{col.label}</div>
                    {display}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Editable Column Header ---
function EditableColumnHeader({
  colName,
  displayName,
  onRename,
  onContextMenu,
}: {
  colName: string;
  displayName: string;
  onRename: (oldName: string, newName: string) => void;
  onContextMenu: (e: React.MouseEvent, colName: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayName);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setDraft(displayName);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== displayName) {
      onRename(colName, trimmed);
    }
    setEditing(false);
  };

  const cancel = () => {
    setDraft(displayName);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") cancel();
          e.stopPropagation();
        }}
        className="w-full text-[11px] font-semibold bg-primary/10 border border-primary/40 rounded px-1 outline-none focus:ring-1 focus:ring-primary/50"
        style={{ minWidth: 60 }}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <span
      className="text-[11px] font-semibold text-muted-foreground truncate block cursor-context-menu select-none group"
      onDoubleClick={startEdit}
      onContextMenu={(e) => onContextMenu(e, colName)}
      title="Double-click to rename · Right-click for options"
    >
      {displayName}
      <span className="opacity-0 group-hover:opacity-40 ml-1 text-[9px]">✎</span>
    </span>
  );
}

// --- Status Filter Type ---
type StatusFilter = "all" | "pending" | "processing" | "done" | "error";

// --- Context Menu Types ---
type ContextMenuState =
  | { type: "column"; x: number; y: number; colName: string }
  | { type: "row"; x: number; y: number; rowId: string }
  | null;

// --- Column Visibility Popover ---
function ColumnVisibilityPanel({
  originalColumns,
  columnVisibility,
  toggleColumnVisibility,
}: {
  originalColumns: string[];
  columnVisibility: Record<string, boolean>;
  toggleColumnVisibility: (colName: string) => void;
}) {
  return (
    <div className="space-y-1 max-h-[300px] overflow-y-auto custom-scrollbar">
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 pb-1">
        Toggle Columns
      </div>
      {originalColumns.map((col) => {
        const visible = columnVisibility[col] !== false;
        const displayName = col.replace("__EMPTY_", "Col ").replace("__EMPTY", "Col");
        return (
          <label
            key={col}
            className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-xs transition-colors ${
              visible ? "text-foreground hover:bg-muted/50" : "text-muted-foreground/50 hover:bg-muted/30"
            }`}
          >
            <input
              type="checkbox"
              checked={visible}
              onChange={() => toggleColumnVisibility(col)}
              className="h-3 w-3 rounded accent-primary"
            />
            <span className="truncate">{displayName}</span>
          </label>
        );
      })}
    </div>
  );
}

// --- Main DataTable ---
export function DataTable() {
  const {
    rows,
    originalColumns,
    enrichmentColumns,
    columnVisibility,
    selectedRowIds,
    isEnriching,
    toggleRowSelection,
    selectAllRows,
    deselectAllRows,
    deleteSelectedRows,
    selectByStatus,
    invertSelection,
    addRow,
    deleteColumn,
    renameColumn,
    toggleColumnVisibility,
    setRowStatus,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useSheetStore();

  const [globalFilter, setGlobalFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [previewRowId, setPreviewRowId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [showColumnVisibility, setShowColumnVisibility] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const columnResizeMode: ColumnResizeMode = "onChange";

  const allSelected = rows.length > 0 && selectedRowIds.size === rows.length;
  const someSelected = selectedRowIds.size > 0 && selectedRowIds.size < rows.length;
  const anySelected = selectedRowIds.size > 0;

  // Pre-filter rows by status
  const statusFilteredRows = useMemo(() => {
    if (statusFilter === "all") return rows;
    return rows.filter((r) => r.status === statusFilter);
  }, [rows, statusFilter]);

  // Status counts
  const statusCounts = useMemo(() => {
    const counts = { all: rows.length, pending: 0, processing: 0, done: 0, error: 0 };
    for (const r of rows) {
      counts[r.status]++;
    }
    return counts;
  }, [rows]);

  const handleDeleteRows = () => {
    if (allSelected) {
      setShowDeleteConfirm(true);
    } else {
      deleteSelectedRows();
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isInput = document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA";
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "a" && !isInput) {
        e.preventDefault();
        allSelected ? deselectAllRows() : selectAllRows();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey && !isInput) {
        e.preventDefault();
        undo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey)) && !isInput) {
        e.preventDefault();
        redo();
      }
      if (e.key === "Delete" && !isInput && anySelected && !isEnriching) {
        e.preventDefault();
        handleDeleteRows();
      }
      if (e.key === "Escape") {
        setPreviewRowId(null);
        setContextMenu(null);
        setShowColumnVisibility(false);
        if (!isInput) setGlobalFilter("");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [allSelected, anySelected, isEnriching, selectAllRows, deselectAllRows, undo, redo]);

  const previewRow = previewRowId ? rows.find((r) => r.id === previewRowId) : null;

  // Global filter function
  const globalFilterFn = useCallback(
    (row: any, _columnId: string, filterValue: string) => {
      if (!filterValue) return true;
      const search = filterValue.toLowerCase();
      const original = row.original as ProductRow;
      for (const val of Object.values(original.originalData)) {
        if (val && !val.startsWith("data:image/") && val.toLowerCase().includes(search)) return true;
      }
      for (const val of Object.values(original.enrichedData)) {
        if (typeof val === "string" && val.toLowerCase().includes(search)) return true;
        if (Array.isArray(val)) {
          for (const item of val) {
            if (typeof item === "string" && item.toLowerCase().includes(search)) return true;
            if (typeof item === "object" && item && "title" in item && (item as any).title?.toLowerCase().includes(search)) return true;
          }
        }
      }
      return false;
    },
    []
  );

  // Visible original columns (filtered by visibility)
  const visibleOriginalColumns = useMemo(
    () => originalColumns.filter((col) => columnVisibility[col] !== false),
    [originalColumns, columnVisibility]
  );

  const columns = useMemo<ColumnDef<ProductRow>[]>(() => {
    const cols: ColumnDef<ProductRow>[] = [];

    // Checkbox + Status column (pinned)
    cols.push({
      id: "select",
      header: () => (
        <div className="flex items-center justify-center">
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected;
            }}
            onChange={() => (allSelected ? deselectAllRows() : selectAllRows())}
            className="h-3.5 w-3.5 rounded border-muted-foreground/40 accent-primary cursor-pointer"
          />
        </div>
      ),
      cell: ({ row }) => (
        <div className="flex items-center gap-2 justify-center">
          <input
            type="checkbox"
            checked={selectedRowIds.has(row.original.id)}
            onChange={() => toggleRowSelection(row.original.id)}
            disabled={row.original.status === "processing"}
            className="h-3.5 w-3.5 rounded border-muted-foreground/40 accent-primary cursor-pointer disabled:opacity-40"
          />
          <StatusCell
            status={row.original.status}
            errorMessage={row.original.errorMessage}
          />
        </div>
      ),
      size: 65,
      minSize: 65,
      maxSize: 65,
      enableSorting: false,
      enableResizing: false,
    });

    // Row number (pinned)
    cols.push({
      id: "rowNum",
      header: () => (
        <span className="text-[10px] font-medium text-muted-foreground/60 font-mono">#</span>
      ),
      cell: ({ row }) => (
        <span className="text-[10px] text-muted-foreground/50 font-mono">
          {row.original.rowIndex + 1}
        </span>
      ),
      size: 40,
      minSize: 40,
      maxSize: 40,
      enableSorting: false,
      enableResizing: false,
    });

    // Original columns - editable, sortable, resizable
    for (const colName of visibleOriginalColumns) {
      const displayName = colName
        .replace("__EMPTY_", "Col ")
        .replace("__EMPTY", "Col");

      cols.push({
        id: `orig_${colName}`,
        accessorFn: (row) => row.originalData[colName] || "",
        header: ({ column }) => (
          <div className="flex items-center gap-1 w-full group/header">
            <div
              className="flex items-center gap-1 flex-1 min-w-0 cursor-pointer select-none"
              onClick={column.getToggleSortingHandler()}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ type: "column", x: e.clientX, y: e.clientY, colName });
              }}
            >
              <EditableColumnHeader
                colName={colName}
                displayName={displayName}
                onRename={renameColumn}
                onContextMenu={(e, name) => {
                  e.preventDefault();
                  setContextMenu({ type: "column", x: e.clientX, y: e.clientY, colName: name });
                }}
              />
              {column.getIsSorted() === "asc" && <ArrowUp className="h-3 w-3 text-primary shrink-0" />}
              {column.getIsSorted() === "desc" && <ArrowDown className="h-3 w-3 text-primary shrink-0" />}
              {!column.getIsSorted() && (
                <ArrowUpDown className="h-3 w-3 text-muted-foreground/30 shrink-0 opacity-0 group-hover/header:opacity-100 transition-opacity" />
              )}
            </div>
          </div>
        ),
        cell: ({ row }) => {
          const canEdit =
            !isEnriching ||
            row.original.status === "done" ||
            row.original.status === "pending";
          return (
            <EditableCell
              value={row.original.originalData[colName] || ""}
              rowId={row.original.id}
              column={colName}
              isEditable={canEdit}
            />
          );
        },
        size: colName.toLowerCase().includes("description")
          ? 280
          : colName.toUpperCase() === "PICTURE" || colName.toUpperCase() === "IMAGE" || colName.toUpperCase() === "PHOTO"
            ? 70
            : 160,
        minSize: 60,
        maxSize: 800,
        enableSorting: true,
        enableResizing: true,
      });
    }

    // Enriched columns - sortable, resizable
    const enabledEnrichment = enrichmentColumns.filter((col) => col.enabled);
    for (const enrichCol of enabledEnrichment) {
      cols.push({
        id: `enrich_${enrichCol.id}`,
        accessorFn: (row) => {
          const val = row.enrichedData[enrichCol.id];
          if (typeof val === "string") return val;
          if (Array.isArray(val)) return val.length.toString();
          return "";
        },
        header: ({ column }) => (
          <div
            className="flex items-center gap-1.5 cursor-pointer select-none group/header"
            onClick={column.getToggleSortingHandler()}
          >
            <Sparkles className="h-3 w-3 text-primary shrink-0" />
            <span className="text-[11px] font-semibold truncate text-primary">
              {enrichCol.label}
            </span>
            {column.getIsSorted() === "asc" && <ArrowUp className="h-3 w-3 text-primary shrink-0" />}
            {column.getIsSorted() === "desc" && <ArrowDown className="h-3 w-3 text-primary shrink-0" />}
            {!column.getIsSorted() && (
              <ArrowUpDown className="h-3 w-3 text-primary/30 shrink-0 opacity-0 group-hover/header:opacity-100 transition-opacity" />
            )}
          </div>
        ),
        cell: ({ row }) => {
          if (row.original.status === "processing") {
            return (
              <div className="py-1 space-y-1.5 w-full">
                <div className="h-1.5 w-3/4 bg-primary/10 animate-pulse rounded-full" />
                <div className="h-1.5 w-1/2 bg-primary/10 animate-pulse rounded-full" />
                <div className="h-1.5 w-5/6 bg-primary/10 animate-pulse rounded-full" />
              </div>
            );
          }
          const canEditEnriched = !isEnriching || row.original.status === "done";
          return (
            <EditableEnrichedCell
              value={row.original.enrichedData[enrichCol.id]}
              rowId={row.original.id}
              enrichKey={enrichCol.id}
              isEditable={canEditEnriched}
            />
          );
        },
        size:
          enrichCol.id === "marketingDescription" ||
          enrichCol.id === "marketplaceBullets"
            ? 320
            : 200,
        minSize: 80,
        maxSize: 800,
        enableSorting: true,
        enableResizing: true,
      });
    }

    return cols;
  }, [
    visibleOriginalColumns,
    enrichmentColumns,
    isEnriching,
    selectedRowIds,
    allSelected,
    someSelected,
    toggleRowSelection,
    selectAllRows,
    deselectAllRows,
    renameColumn,
  ]);

  const table = useReactTable({
    data: statusFilteredRows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    globalFilterFn,
    columnResizeMode,
    state: {
      globalFilter,
      sorting,
    },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    enableColumnResizing: true,
  });

  // Virtual scrolling with dynamic row heights
  const { rows: tableRows } = table.getRowModel();
  const columnSizingState = table.getState().columnSizing;
  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 44,
    overscan: 20,
    measureElement:
      typeof window !== "undefined" && navigator.userAgent.indexOf("Firefox") === -1
        ? (element) => element?.getBoundingClientRect().height
        : undefined,
  });

  // Re-measure all rows when column sizes change
  useEffect(() => {
    rowVirtualizer.measure();
  }, [columnSizingState, rowVirtualizer]);

  if (rows.length === 0) return null;

  const filteredCount = table.getFilteredRowModel().rows.length;
  const totalTableWidth = table.getCenterTotalSize();

  return (
    <div className="flex-1 flex min-w-0 h-full overflow-hidden">
      {/* Main table area */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Table toolbar */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/30 shrink-0 gap-2">
          <div className="flex items-center gap-2">
            {/* Status filter tabs */}
            <div className="flex items-center bg-muted/60 rounded-md p-0.5 gap-0.5">
              {(["all", "pending", "done", "error"] as StatusFilter[]).map((st) => {
                const count = statusCounts[st];
                const isActive = statusFilter === st;
                const colorMap: Record<StatusFilter, string> = {
                  all: isActive ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  pending: isActive ? "bg-background text-amber-600 shadow-sm" : "text-muted-foreground hover:text-amber-600",
                  processing: isActive ? "bg-background text-blue-600 shadow-sm" : "text-muted-foreground hover:text-blue-600",
                  done: isActive ? "bg-background text-green-600 shadow-sm" : "text-muted-foreground hover:text-green-600",
                  error: isActive ? "bg-background text-red-600 shadow-sm" : "text-muted-foreground hover:text-red-600",
                };
                if (st !== "all" && count === 0) return null;
                return (
                  <button
                    key={st}
                    onClick={() => setStatusFilter(st)}
                    className={`text-[10px] font-medium px-2 py-1 rounded transition-all capitalize ${colorMap[st]}`}
                  >
                    {st} {count > 0 && <span className="font-mono ml-0.5">({count})</span>}
                  </button>
                );
              })}
            </div>

            {/* Row count */}
            <span className="text-[10px] text-muted-foreground font-mono">
              {globalFilter ? `${filteredCount}/` : ""}{statusFilteredRows.length} rows
            </span>

            {/* Selection info */}
            {anySelected && (
              <>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1">
                  {selectedRowIds.size} selected
                </Badge>
                {!isEnriching && (
                  <button
                    onClick={handleDeleteRows}
                    className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded text-destructive border border-destructive/30 hover:bg-destructive/10 transition-colors font-medium"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                    Delete
                  </button>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {/* Add Row */}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] gap-1 text-muted-foreground hover:text-primary"
              onClick={addRow}
              disabled={isEnriching}
              title="Add empty row"
            >
              <Plus className="h-3 w-3" />
              Row
            </Button>

            {/* Column visibility toggle */}
            <div className="relative">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px] gap-1 text-muted-foreground hover:text-primary"
                onClick={() => setShowColumnVisibility(!showColumnVisibility)}
                title="Toggle column visibility"
              >
                <Columns3 className="h-3 w-3" />
                Columns
              </Button>
              {showColumnVisibility && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowColumnVisibility(false)} />
                  <div className="absolute right-0 top-full mt-1 z-50 w-56 rounded-lg border bg-popover shadow-lg p-2">
                    <ColumnVisibilityPanel
                      originalColumns={originalColumns}
                      columnVisibility={columnVisibility}
                      toggleColumnVisibility={toggleColumnVisibility}
                    />
                  </div>
                </>
              )}
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search (Ctrl+F)"
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                className="h-6 w-44 pl-7 pr-6 text-[10px] rounded-md border bg-background/80 focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/40"
              />
              {globalFilter && (
                <button
                  onClick={() => setGlobalFilter("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Virtualized Table content */}
        <div
          ref={tableContainerRef}
          className="flex-1 overflow-auto custom-scrollbar"
        >
          <div style={{ minWidth: totalTableWidth }}>
            {/* Sticky Header */}
            <div className="sticky top-0 z-10 bg-muted/90 backdrop-blur-md border-b border-border/40">
              {table.getHeaderGroups().map((headerGroup) => (
                <div key={headerGroup.id} className="flex">
                  {headerGroup.headers.map((header) => (
                    <div
                      key={header.id}
                      className="h-9 px-3 flex items-center border-r last:border-r-0 border-border/40 overflow-hidden relative"
                      style={{
                        width: header.getSize(),
                        minWidth: header.getSize(),
                      }}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                      {/* Column resize handle */}
                      {header.column.getCanResize() && (
                        <div
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          className={`absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none hover:bg-primary/50 transition-colors ${
                            header.column.getIsResizing() ? "bg-primary/60" : "bg-transparent"
                          }`}
                        />
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* Virtualized Rows */}
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const row = tableRows[virtualRow.index];
                if (!row) return null;
                const isSelected = selectedRowIds.has(row.original.id);
                const status = row.original.status;
                const isPreviewing = previewRowId === row.original.id;

                return (
                  <div
                    key={row.id}
                    data-index={virtualRow.index}
                    ref={(node) => rowVirtualizer.measureElement(node)}
                    className={`
                      flex border-b border-border/20 text-[12px] absolute w-full
                      ${isSelected ? "bg-primary/[0.03]" : ""}
                      ${status === "processing" ? "bg-amber-50/40 dark:bg-amber-950/10" : ""}
                      ${status === "done" ? "bg-green-50/30 dark:bg-green-950/10" : ""}
                      ${status === "error" ? "bg-red-50/30 dark:bg-red-950/10" : ""}
                      ${!isSelected && status === "pending" ? "opacity-60" : ""}
                      ${isPreviewing ? "ring-1 ring-primary/40 bg-primary/5" : ""}
                      hover:bg-muted/40 transition-colors
                    `}
                    style={{
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ type: "row", x: e.clientX, y: e.clientY, rowId: row.original.id });
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <div
                        key={cell.id}
                        className="px-3 py-2 border-r last:border-r-0 border-border/20 flex-shrink-0 overflow-x-hidden"
                        style={{
                          width: cell.column.getSize(),
                          minWidth: cell.column.getSize(),
                        }}
                        onClick={() => {
                          if (cell.column.id === "rowNum") {
                            setPreviewRowId(previewRowId === row.original.id ? null : row.original.id);
                          }
                        }}
                      >
                        {cell.column.id === "rowNum" ? (
                          <span className="text-[10px] text-muted-foreground/50 font-mono cursor-pointer hover:text-primary transition-colors">
                            {row.original.rowIndex + 1}
                          </span>
                        ) : (
                          flexRender(cell.column.columnDef.cell, cell.getContext())
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Status bar */}
        <div className="flex items-center justify-between px-3 py-1 border-t bg-muted/20 shrink-0">
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span>{rows.length.toLocaleString()} total rows</span>
            {statusCounts.done > 0 && <span className="text-green-600">{statusCounts.done} enriched</span>}
            {statusCounts.error > 0 && <span className="text-red-600">{statusCounts.error} errors</span>}
            {statusCounts.processing > 0 && <span className="text-amber-600">{statusCounts.processing} processing</span>}
          </div>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span>{visibleOriginalColumns.length}/{originalColumns.length} columns visible</span>
            <span className="opacity-50">Double-click to edit · Click # to preview · Right-click for options</span>
          </div>
        </div>
      </div>

      {/* Row Preview Panel */}
      {previewRow && (
        <RowPreviewPanel
          row={previewRow}
          originalColumns={originalColumns}
          enrichmentColumns={enrichmentColumns}
          onClose={() => setPreviewRowId(null)}
        />
      )}

      {/* Delete All Confirmation */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-destructive" />
              Delete {allSelected ? "All" : selectedRowIds.size} Rows?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {allSelected
                ? <>You are about to delete all <strong>{rows.length} rows</strong>. This action can be undone with Ctrl+Z.</>
                : <>You are about to delete <strong>{selectedRowIds.size} selected rows</strong>. This action can be undone with Ctrl+Z.</>
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowDeleteConfirm(false)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              onClick={() => { deleteSelectedRows(); setShowDeleteConfirm(false); }}
            >
              Delete {allSelected ? "All" : selectedRowIds.size}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Enhanced Context Menu */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
          />
          <div
            className="fixed z-50 min-w-[180px] rounded-lg border bg-popover shadow-lg py-1 text-sm animate-in fade-in-0 zoom-in-95 duration-100"
            style={{ top: contextMenu.y, left: contextMenu.x }}
          >
            {contextMenu.type === "column" && (
              <>
                <div className="px-3 py-1.5 text-[10px] text-muted-foreground font-semibold border-b mb-1 truncate max-w-[220px] uppercase tracking-wider">
                  {contextMenu.colName.replace("__EMPTY_", "Col ").replace("__EMPTY", "Col")}
                </div>
                <button
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted transition-colors text-xs"
                  onClick={() => {
                    const col = table.getColumn(`orig_${contextMenu.colName}`);
                    col?.toggleSorting(false);
                    setContextMenu(null);
                  }}
                >
                  <ArrowUp className="h-3.5 w-3.5 text-muted-foreground" />
                  Sort A → Z
                </button>
                <button
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted transition-colors text-xs"
                  onClick={() => {
                    const col = table.getColumn(`orig_${contextMenu.colName}`);
                    col?.toggleSorting(true);
                    setContextMenu(null);
                  }}
                >
                  <ArrowDown className="h-3.5 w-3.5 text-muted-foreground" />
                  Sort Z → A
                </button>
                {sorting.length > 0 && (
                  <button
                    className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted transition-colors text-xs"
                    onClick={() => { setSorting([]); setContextMenu(null); }}
                  >
                    <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
                    Clear Sort
                  </button>
                )}
                <div className="border-t my-1" />
                <button
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted transition-colors text-xs"
                  onClick={() => { toggleColumnVisibility(contextMenu.colName); setContextMenu(null); }}
                >
                  <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                  Hide Column
                </button>
                <div className="border-t my-1" />
                <button
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-destructive hover:bg-destructive/10 transition-colors text-xs"
                  onClick={() => { deleteColumn(contextMenu.colName); setContextMenu(null); }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete Column
                </button>
              </>
            )}

            {contextMenu.type === "row" && (() => {
              const ctxRow = rows.find((r) => r.id === contextMenu.rowId);
              if (!ctxRow) return null;
              return (
                <>
                  <div className="px-3 py-1.5 text-[10px] text-muted-foreground font-semibold border-b mb-1 uppercase tracking-wider">
                    Row #{ctxRow.rowIndex + 1}
                  </div>
                  <button
                    className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted transition-colors text-xs"
                    onClick={() => {
                      setPreviewRowId(contextMenu.rowId);
                      setContextMenu(null);
                    }}
                  >
                    <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                    Preview Row
                  </button>
                  {!selectedRowIds.has(contextMenu.rowId) && (
                    <button
                      className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted transition-colors text-xs"
                      onClick={() => {
                        toggleRowSelection(contextMenu.rowId);
                        setContextMenu(null);
                      }}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
                      Select Row
                    </button>
                  )}
                  {(ctxRow.status === "done" || ctxRow.status === "error") && (
                    <button
                      className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted transition-colors text-xs"
                      onClick={() => {
                        setRowStatus(contextMenu.rowId, "pending");
                        setContextMenu(null);
                      }}
                    >
                      <RotateCcw className="h-3.5 w-3.5 text-amber-500" />
                      Reset to Pending
                    </button>
                  )}
                  <div className="border-t my-1" />
                  <button
                    className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted transition-colors text-xs text-muted-foreground"
                    onClick={() => {
                      selectByStatus("pending");
                      setContextMenu(null);
                    }}
                  >
                    <Filter className="h-3.5 w-3.5" />
                    Select All Pending
                  </button>
                  <button
                    className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted transition-colors text-xs text-muted-foreground"
                    onClick={() => {
                      selectByStatus("error");
                      setContextMenu(null);
                    }}
                  >
                    <Filter className="h-3.5 w-3.5" />
                    Select All Errors
                  </button>
                  <button
                    className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted transition-colors text-xs text-muted-foreground"
                    onClick={() => {
                      invertSelection();
                      setContextMenu(null);
                    }}
                  >
                    <ArrowUpDown className="h-3.5 w-3.5" />
                    Invert Selection
                  </button>
                  {!isEnriching && selectedRowIds.has(contextMenu.rowId) && (
                    <>
                      <div className="border-t my-1" />
                      <button
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-destructive hover:bg-destructive/10 transition-colors text-xs"
                        onClick={() => {
                          deleteSelectedRows();
                          setContextMenu(null);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete Selected ({selectedRowIds.size})
                      </button>
                    </>
                  )}
                </>
              );
            })()}
          </div>
        </>
      )}
    </div>
  );
}
