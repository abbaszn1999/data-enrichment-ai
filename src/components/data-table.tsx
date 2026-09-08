"use client";

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getPaginationRowModel,
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
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ImageIcon,
  Maximize2,
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
import { TableSelectHeader } from "@/components/table-select-header";
import { useSheetStore } from "@/store/sheet-store";
import { useWorkspaceStore } from "@/store/workspace-store";
import type { ProductRow } from "@/types";
import { FileSpreadsheet, Package, Cloud, CloudOff } from "lucide-react";
import {
  buildProductGroupIndex,
  visibleCatalogRows,
} from "@/lib/catalog/product-groups";

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

function extractUrls(value: string): string[] {
  const matches = value.match(/(?:https?:\/\/|data:image\/)[^\s"'<>]+/gi) ?? [];
  return Array.from(
    new Set(matches.map((url) => url.replace(/[),.;\]]+$/g, "")))
  );
}

function hasImageColumnHint(column: string): boolean {
  return /\b(img|image|images|photo|photos|picture|thumbnail|media)\b/i.test(
    column.replace(/[_-]+/g, " ")
  );
}

function isProbablyImageUrl(url: string): boolean {
  if (url.startsWith("data:image/")) return true;
  try {
    const parsed = new URL(url);
    const decodedPath = decodeURIComponent(parsed.pathname).toLowerCase();
    const decodedUrl = decodeURIComponent(url).toLowerCase();
    return (
      /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)(?:$|[?#])/i.test(decodedUrl) ||
      /\/storage\/v1\/object\/(public|sign)\//i.test(decodedPath) && /image|img|photo|picture|thumbnail/i.test(decodedPath)
    );
  } catch {
    return false;
  }
}

function getImagePreviewUrls(value: string, column: string): string[] {
  const urls = extractUrls(value);
  if (urls.length === 0) return [];
  const likely = urls.filter(isProbablyImageUrl);
  if (likely.length > 0) return likely;
  return hasImageColumnHint(column) ? urls : [];
}

function SmartImageThumb({ url, alt }: { url: string; alt: string }) {
  const [src, setSrc] = useState(url);
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="h-10 min-w-16 max-w-28 px-2 rounded border border-border/40 flex items-center justify-center text-[10px] text-blue-500 hover:underline bg-muted/20"
        onClick={(e) => e.stopPropagation()}
      >
        Image link
      </a>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="block shrink-0 group/img"
          onClick={(e) => e.stopPropagation()}
        >
          <img
            src={src}
            data-original-url={url}
            alt={alt}
            className="h-10 w-10 object-cover rounded border border-border/40 bg-white group-hover/img:ring-2 group-hover/img:ring-primary/40 transition-all"
            onError={() => {
              if (src !== proxyImgSrc(url)) {
                setSrc(proxyImgSrc(url));
              } else {
                setFailed(true);
              }
            }}
          />
        </a>
      </TooltipTrigger>
      <TooltipContent side="right" className="p-1">
        <img
          src={src}
          alt={alt}
          className="max-h-64 max-w-64 object-contain rounded bg-white"
        />
      </TooltipContent>
    </Tooltip>
  );
}

function SmartImageUrlCell({
  urls,
  value,
  rowId,
  column,
  isEditable,
}: {
  urls: string[];
  value: string;
  rowId: string;
  column: string;
  isEditable: boolean;
}) {
  const { updateCellValue } = useSheetStore();
  const [open, setOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);

  const startEdit = () => {
    if (!isEditable) return;
    setDraft(urls);
    setEditMode(true);
    setOpen(true);
  };

  const saveEdit = () => {
    const cleaned = draft.map((url) => url.trim()).filter(Boolean);
    const nextValue = cleaned.join("\n");
    updateCellValue(rowId, column, nextValue);
    setEditMode(false);
    setOpen(false);
  };

  return (
    <>
      <div
        onClick={isEditable ? startEdit : undefined}
        className={`w-full group ${isEditable ? "cursor-pointer" : "cursor-default"}`}
      >
        <div className="flex gap-1.5 flex-wrap items-center">
          {urls.slice(0, 3).map((url, i) => (
            <SmartImageThumb key={`${url}-${i}`} url={url} alt={column || "Image"} />
          ))}
          {urls.length > 3 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setOpen(true);
              }}
              className="h-10 w-10 rounded border border-dashed border-border/40 flex items-center justify-center text-[10px] text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
            >
              +{urls.length - 3}
            </button>
          )}
          {isEditable && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                startEdit();
              }}
              className="h-10 w-10 rounded border border-dashed border-border/40 flex items-center justify-center text-[10px] text-primary/0 group-hover:text-primary/50 group-hover:border-primary/30 transition-all"
            >
              Edit
            </button>
          )}
        </div>
        {urls.length === 0 && <span className="sr-only">{value}</span>}
      </div>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditMode(false); }}>
        <DialogContent showCloseButton={false} className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between text-sm">
              <span>{editMode ? "Edit Images" : `All Images (${urls.length})`}</span>
              {isEditable && !editMode && (
                <button
                  onClick={startEdit}
                  className="text-[11px] text-primary hover:underline font-normal"
                >
                  Edit
                </button>
              )}
            </DialogTitle>
          </DialogHeader>
          {editMode ? (
            <div className="flex flex-col gap-2 mt-2">
              {draft.map((url, i) => (
                <div key={i} className="flex items-start gap-2 p-2 rounded-md border bg-muted/20">
                  {url && (
                    <img
                      src={url}
                      alt={`Image ${i + 1}`}
                      className="h-14 w-14 object-contain rounded border bg-white shrink-0"
                      onError={(e) => {
                        const img = e.target as HTMLImageElement;
                        if (!img.src.includes("/api/image-proxy")) {
                          img.src = proxyImgSrc(url);
                        } else {
                          img.style.display = "none";
                        }
                      }}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <input
                      value={url}
                      onChange={(e) => {
                        const next = [...draft];
                        next[i] = e.target.value;
                        setDraft(next);
                      }}
                      placeholder="Image URL"
                      className="w-full text-xs px-2 py-1 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50 font-mono"
                    />
                  </div>
                  <button
                    onClick={() => setDraft(draft.filter((_, idx) => idx !== i))}
                    className="text-muted-foreground/40 hover:text-destructive shrink-0 mt-1"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <button
                onClick={() => setDraft([...draft, ""])}
                className="text-[11px] text-primary/70 hover:text-primary transition-colors text-left"
              >
                + Add image
              </button>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <button onClick={() => { setEditMode(false); setOpen(false); }} className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded">
                  Cancel
                </button>
                <button onClick={saveEdit} className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded hover:bg-primary/90 font-medium">
                  Save
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 mt-2">
              {urls.map((url, i) => (
                <a
                  key={i}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-lg border overflow-hidden hover:ring-2 hover:ring-primary/40 transition-all group/card"
                >
                  <img
                    src={url}
                    data-original-url={url}
                    alt={`Image ${i + 1}`}
                    className="w-full h-40 object-contain bg-white p-2"
                    onError={handleImgError}
                  />
                  <div className="p-2 bg-muted/30 border-t">
                    <p className="text-[11px] font-medium truncate">Image {i + 1}</p>
                  </div>
                </a>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
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
        onClick={handleDoubleClick}
      >
        {isEditable ? "Click to add" : "—"}
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
  const previewUrls = getImagePreviewUrls(str, column);
  if (previewUrls.length > 0) {
    return (
      <SmartImageUrlCell
        urls={previewUrls}
        value={str}
        rowId={rowId}
        column={column}
        isEditable={isEditable}
      />
    );
  }

  return (
    <div
      onClick={handleDoubleClick}
      className={`text-xs leading-relaxed break-words whitespace-pre-wrap w-full ${isEditable ? "cursor-text" : "cursor-default"}`}
    >
      {str}
    </div>
  );
}

// --- Source URLs Cell ---
function SourceUrlsCell({ sources, isEditable, rowId, enrichKey }: { sources: { title: string; uri: string }[]; isEditable: boolean; rowId: string; enrichKey: string }) {
  const { updateEnrichedCellValue } = useSheetStore();
  const [open, setOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<{ title: string; uri: string }[]>([]);
  const preview = sources.slice(0, 3);
  const remaining = sources.length - 3;

  const startEdit = () => {
    setDraft(sources.map((s) => ({ ...s })));
    setEditMode(true);
    setOpen(true);
  };

  const saveEdit = () => {
    const cleaned = draft.filter((s) => s.uri.trim() !== "");
    updateEnrichedCellValue(rowId, enrichKey, cleaned);
    setEditMode(false);
    setOpen(false);
  };

  return (
    <>
      <div className="flex flex-col gap-0.5 group">
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
        {isEditable && (
          <button
            onClick={(e) => { e.stopPropagation(); startEdit(); }}
            className="text-[9px] text-primary/0 group-hover:text-primary/50 transition-colors mt-0.5 text-left"
          >
            Click to edit
          </button>
        )}
      </div>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditMode(false); }}>
        <DialogContent className="max-w-lg max-h-[70vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <ExternalLink className="h-4 w-4" />
                {editMode ? "Edit Sources" : `All Sources (${sources.length})`}
              </span>
              {isEditable && !editMode && (
                <button
                  onClick={startEdit}
                  className="text-[11px] text-primary hover:underline font-normal"
                >
                  Edit
                </button>
              )}
            </DialogTitle>
          </DialogHeader>
          {editMode ? (
            <div className="flex flex-col gap-2 mt-2">
              {draft.map((source, i) => (
                <div key={i} className="flex items-start gap-2 p-2 rounded-md border bg-muted/20">
                  <div className="flex-1 space-y-1 min-w-0">
                    <input
                      value={source.title}
                      onChange={(e) => { const n = [...draft]; n[i] = { ...n[i], title: e.target.value }; setDraft(n); }}
                      placeholder="Title"
                      className="w-full text-xs px-2 py-1 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
                    />
                    <input
                      value={source.uri}
                      onChange={(e) => { const n = [...draft]; n[i] = { ...n[i], uri: e.target.value }; setDraft(n); }}
                      placeholder="URL"
                      className="w-full text-xs px-2 py-1 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50 font-mono"
                    />
                  </div>
                  <button
                    onClick={() => setDraft(draft.filter((_, idx) => idx !== i))}
                    className="text-muted-foreground/40 hover:text-destructive shrink-0 mt-1"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <button
                onClick={() => setDraft([...draft, { title: "", uri: "" }])}
                className="text-[11px] text-primary/70 hover:text-primary transition-colors text-left"
              >
                + Add source
              </button>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <button onClick={() => { setEditMode(false); setOpen(false); }} className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded">
                  Cancel
                </button>
                <button onClick={saveEdit} className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded hover:bg-primary/90 font-medium">
                  Save
                </button>
              </div>
            </div>
          ) : (
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
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// --- Image URLs Cell ---
function proxyImgSrc(url: string): string {
  return `/api/image-proxy?url=${encodeURIComponent(url)}`;
}

function handleImgError(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.target as HTMLImageElement;
  const originalUrl = img.dataset.originalUrl;
  if (originalUrl && !img.src.includes("/api/image-proxy")) {
    img.src = proxyImgSrc(originalUrl);
  } else {
    img.style.display = "none";
  }
}

type EnrichImageItem = { imageUrl: string; pageUrl: string; title: string };

function ImageUrlsCell({
  images,
  isEditable,
  rowId,
  enrichKey,
}: {
  images: EnrichImageItem[];
  isEditable: boolean;
  rowId: string;
  enrichKey: string;
}) {
  const { updateEnrichedCellValue } = useSheetStore();
  const [open, setOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [adding, setAdding] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);

  const list = Array.isArray(images) ? images : [];
  const safeIndex =
    list.length === 0 ? 0 : Math.min(previewIndex, list.length - 1);
  const active = list[safeIndex] ?? null;

  useEffect(() => {
    if (previewIndex !== safeIndex) setPreviewIndex(safeIndex);
  }, [previewIndex, safeIndex]);

  useEffect(() => {
    if (adding) {
      const t = window.setTimeout(() => addInputRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    }
  }, [adding]);

  useEffect(() => {
    if (!open || list.length < 2 || adding) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      const delta = event.key === "ArrowLeft" ? -1 : 1;
      setPreviewIndex(
        (current) => (current + delta + list.length) % list.length
      );
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [adding, list.length, open]);

  const openDialog = (index = 0) => {
    setPreviewIndex(
      list.length === 0 ? 0 : Math.max(0, Math.min(index, list.length - 1))
    );
    setAdding(false);
    setNewUrl("");
    setNewTitle("");
    setOpen(true);
  };

  const closeDialog = () => {
    setOpen(false);
    setAdding(false);
    setNewUrl("");
    setNewTitle("");
  };

  const commitImages = (next: EnrichImageItem[], focusIndex?: number) => {
    updateEnrichedCellValue(rowId, enrichKey, next);
    if (next.length === 0) {
      setPreviewIndex(0);
      return;
    }
    const nextIndex =
      typeof focusIndex === "number"
        ? Math.max(0, Math.min(focusIndex, next.length - 1))
        : Math.min(previewIndex, next.length - 1);
    setPreviewIndex(nextIndex);
  };

  const removeAt = (index: number) => {
    if (!isEditable) return;
    const next = list.filter((_, i) => i !== index);
    // Keep dialog open even when the last image is removed (empty state + add).
    const focus =
      next.length === 0
        ? 0
        : index >= next.length
          ? next.length - 1
          : index;
    commitImages(next, focus);
    setAdding(next.length === 0);
  };

  const startAdd = () => {
    if (!isEditable) return;
    setAdding(true);
    setNewUrl("");
    setNewTitle("");
  };

  const confirmAdd = () => {
    const url = newUrl.trim();
    if (!url) return;
    const item: EnrichImageItem = {
      imageUrl: url,
      pageUrl: "",
      title: newTitle.trim() || "Product image",
    };
    const next = [...list, item];
    commitImages(next, next.length - 1);
    setAdding(false);
    setNewUrl("");
    setNewTitle("");
  };

  return (
    <>
      {list.length === 0 ? (
        <div
          onClick={
            isEditable
              ? (e) => {
                  e.stopPropagation();
                  openDialog(0);
                  setAdding(true);
                }
              : undefined
          }
          className={`text-muted-foreground/30 text-xs ${isEditable ? "cursor-pointer hover:text-muted-foreground/50 transition-colors" : ""}`}
        >
          {isEditable ? "Click to add" : "—"}
        </div>
      ) : (
        <div className="flex items-center gap-1">
          {list.slice(0, 3).map((img, i) => (
            <div
              key={`${img.imageUrl}:${i}`}
              className="group/image relative h-10 w-10 shrink-0"
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openDialog(i);
                }}
                className="block h-full w-full overflow-hidden rounded border border-border/40 bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label={`Preview image ${i + 1}`}
                title={img.title || "Product image"}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.imageUrl}
                  data-original-url={img.imageUrl}
                  alt={img.title || "Product"}
                  className="h-full w-full object-cover transition-transform group-hover/image:scale-105"
                  onError={handleImgError}
                />
              </button>
              {isEditable && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeAt(i);
                  }}
                  className="absolute -right-1.5 -top-1.5 z-10 flex h-[18px] w-[18px] items-center justify-center rounded-full border bg-background text-destructive opacity-0 shadow-sm transition-opacity hover:bg-destructive hover:text-destructive-foreground focus:opacity-100 group-hover/image:opacity-100"
                  aria-label={`Remove image ${i + 1}`}
                  title="Remove image"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          ))}
          {list.length > 3 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openDialog(0);
              }}
              className="flex h-10 items-center gap-1 rounded border bg-muted/30 px-2 text-[10px] font-medium text-muted-foreground hover:border-primary/40 hover:text-foreground"
            >
              <Maximize2 className="h-3 w-3" />
              +{list.length - 3}
            </button>
          )}
        </div>
      )}

      {/* Dialog stays mounted while open — even if list becomes empty after delete */}
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) closeDialog();
          else setOpen(true);
        }}
      >
        <DialogContent className="w-[min(96vw,1120px)] max-w-[min(96vw,1120px)] overflow-hidden p-0 sm:max-w-[min(96vw,1120px)]">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <ImageIcon className="h-4 w-4 text-primary" />
              Product images
            </DialogTitle>
            <p className="text-xs text-muted-foreground">
              {list.length} image{list.length === 1 ? "" : "s"}
              {list.length > 0 ? ` · ${safeIndex + 1} of ${list.length}` : ""}
            </p>
          </DialogHeader>

          <div className="grid min-h-[480px] md:grid-cols-[minmax(0,1fr)_148px]">
            <div className="relative flex min-h-[360px] flex-col items-center justify-center gap-3 bg-muted/20 p-6 md:min-h-[62vh]">
              {adding && !active ? (
                <div className="w-full max-w-md space-y-3 rounded-lg border bg-background p-4 shadow-sm">
                  <p className="text-xs font-medium">Add image URL</p>
                  <input
                    ref={addInputRef}
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") confirmAdd();
                      if (e.key === "Escape") setAdding(false);
                    }}
                    placeholder="https://…"
                    className="w-full rounded border bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                  <input
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") confirmAdd();
                    }}
                    placeholder="Title (optional)"
                    className="w-full rounded border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setAdding(false);
                        setNewUrl("");
                        setNewTitle("");
                      }}
                      className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={confirmAdd}
                      disabled={!newUrl.trim()}
                      className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                    >
                      Add
                    </button>
                  </div>
                </div>
              ) : active ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={active.imageUrl}
                    data-original-url={active.imageUrl}
                    alt={active.title || "Product"}
                    className="max-h-[62vh] max-w-full rounded-lg object-contain shadow-sm"
                    onError={handleImgError}
                  />
                  {list.length > 1 ? (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          setPreviewIndex(
                            (current) =>
                              (current - 1 + list.length) % list.length
                          )
                        }
                        className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border bg-background/90 text-foreground shadow-sm transition-colors hover:bg-background"
                        aria-label="Previous image"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setPreviewIndex(
                            (current) => (current + 1) % list.length
                          )
                        }
                        className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border bg-background/90 text-foreground shadow-sm transition-colors hover:bg-background"
                        aria-label="Next image"
                      >
                        <ChevronRight className="h-5 w-5" />
                      </button>
                    </>
                  ) : null}
                  <div className="flex max-w-full flex-wrap items-center justify-center gap-3">
                    {active.title ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {active.title}
                      </p>
                    ) : null}
                    <a
                      href={active.imageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="h-3 w-3" />
                      Open URL
                    </a>
                    {isEditable && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          removeAt(safeIndex);
                        }}
                        className="inline-flex items-center gap-1 text-[11px] text-destructive/80 hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                        Remove
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-center text-xs text-muted-foreground">
                  <ImageIcon className="mx-auto mb-2 h-8 w-8 opacity-50" />
                  No images yet
                  {isEditable ? (
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={startAdd}
                        className="inline-flex items-center gap-1 rounded border border-dashed px-3 py-1.5 text-[11px] hover:border-primary/40 hover:text-primary"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add image
                      </button>
                    </div>
                  ) : null}
                </div>
              )}

              {adding && active ? (
                <div className="mt-2 w-full max-w-md space-y-2 rounded-lg border bg-background p-3 shadow-sm">
                  <p className="text-[11px] font-medium">Add another image</p>
                  <input
                    ref={addInputRef}
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") confirmAdd();
                      if (e.key === "Escape") setAdding(false);
                    }}
                    placeholder="https://…"
                    className="w-full rounded border bg-background px-2 py-1.5 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setAdding(false);
                        setNewUrl("");
                        setNewTitle("");
                      }}
                      className="rounded px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={confirmAdd}
                      disabled={!newUrl.trim()}
                      className="rounded bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                    >
                      Add
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="border-l p-3">
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                All images
              </p>
              <div className="flex max-h-[62vh] flex-col gap-2 overflow-y-auto pr-1">
                {list.map((img, index) => (
                  <div key={`${img.imageUrl}:rail:${index}`} className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setPreviewIndex(index);
                        setAdding(false);
                      }}
                      className={`aspect-square w-full shrink-0 overflow-hidden rounded-md border-2 ${
                        safeIndex === index
                          ? "border-primary"
                          : "border-transparent"
                      }`}
                      aria-label={`View image ${index + 1}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.imageUrl}
                        data-original-url={img.imageUrl}
                        alt={img.title || `Image ${index + 1}`}
                        className="h-full w-full object-cover"
                        onError={handleImgError}
                      />
                    </button>
                    {isEditable && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          removeAt(index);
                        }}
                        className="absolute right-1 top-1 rounded bg-background/90 p-0.5 text-muted-foreground shadow-sm hover:text-destructive"
                        aria-label={`Remove image ${index + 1}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
                {isEditable && (
                  <button
                    type="button"
                    onClick={startAdd}
                    className="flex aspect-square w-full items-center justify-center rounded-md border border-dashed text-muted-foreground hover:border-primary/40 hover:text-primary"
                    aria-label="Add image"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// --- FAQ Cell (question/answer pairs) ---
function FaqCell({
  items,
  isEditable,
  rowId,
  enrichKey,
}: {
  items: { question: string; answer: string }[];
  isEditable: boolean;
  rowId: string;
  enrichKey: string;
}) {
  const { updateEnrichedCellValue } = useSheetStore();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(items);

  const openDialog = useCallback(() => {
    setDraft(items.map((i) => ({ ...i })));
    setOpen(true);
  }, [items]);

  const commit = useCallback(() => {
    const cleaned = draft.filter(
      (i) => i.question.trim() !== "" && i.answer.trim() !== ""
    );
    updateEnrichedCellValue(rowId, enrichKey as any, cleaned);
    setOpen(false);
  }, [draft, rowId, enrichKey, updateEnrichedCellValue]);

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="flex w-full items-start gap-1 text-left"
        title={`${items.length} question${items.length === 1 ? "" : "s"} — click to view`}
      >
        <span className="shrink-0 rounded bg-primary/10 px-1 text-[9px] font-semibold text-primary">
          {items.length} Q
        </span>
        <span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
          {items[0]?.question || "—"}
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm">
              FAQ ({draft.length} question{draft.length === 1 ? "" : "s"})
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto">
            {draft.map((item, index) => (
              <div key={index} className="space-y-1 rounded-lg border p-2.5">
                <div className="flex items-start gap-2">
                  <textarea
                    value={item.question}
                    readOnly={!isEditable}
                    onChange={(e) => {
                      const next = [...draft];
                      next[index] = { ...next[index], question: e.target.value };
                      setDraft(next);
                    }}
                    rows={1}
                    placeholder="Question"
                    className="flex-1 resize-y rounded border bg-background px-1.5 py-1 text-[11px] font-semibold outline-none focus:ring-1 focus:ring-primary/50"
                  />
                  {isEditable && (
                    <button
                      type="button"
                      onClick={() => setDraft(draft.filter((_, i) => i !== index))}
                      className="mt-1 shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label={`Remove question ${index + 1}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <textarea
                  value={item.answer}
                  readOnly={!isEditable}
                  onChange={(e) => {
                    const next = [...draft];
                    next[index] = { ...next[index], answer: e.target.value };
                    setDraft(next);
                  }}
                  rows={3}
                  placeholder="Answer"
                  className="w-full resize-y rounded border bg-background px-1.5 py-1 text-[11px] leading-snug outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
            ))}
            {draft.length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">
                No questions yet.
              </p>
            )}
          </div>
          {isEditable && (
            <div className="flex items-center justify-between gap-2 border-t pt-3">
              <button
                type="button"
                onClick={() => setDraft([...draft, { question: "", answer: "" }])}
                className="flex items-center gap-1 rounded-md border border-dashed px-2 py-1 text-[10px] text-muted-foreground hover:border-primary/40 hover:text-primary"
              >
                <Plus className="h-3 w-3" /> Add question
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={commit}
                  className="rounded bg-primary px-3 py-1 text-[10px] font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Save
                </button>
              </div>
            </div>
          )}
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
  maxChars,
}: {
  value: unknown;
  rowId: string;
  enrichKey: string;
  isEditable: boolean;
  /** SEO character budget; shows a live counter and an over-budget warning. */
  maxChars?: number;
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

  // Show editing UI first — must come before empty checks
  if (editing && !Array.isArray(value)) {
    return (
      <div className="w-full" onKeyDown={handleKeyDown}>
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={Math.min(6, Math.max(2, Math.ceil(draft.length / 40)))}
          className="w-full bg-background border border-primary/30 rounded px-1.5 py-1 text-[11px] leading-snug outline-none focus:ring-1 focus:ring-primary/50 resize-y min-h-[2rem]"
        />
        <div className="flex items-center justify-end gap-1 mt-1">
          {maxChars != null && (
            <span
              className={`mr-auto font-mono text-[9px] ${
                draft.length > maxChars
                  ? "font-semibold text-destructive"
                  : draft.length > maxChars * 0.9
                    ? "text-amber-600"
                    : "text-muted-foreground/60"
              }`}
              title={`Recommended limit: ${maxChars} characters`}
            >
              {draft.length}/{maxChars}
            </span>
          )}
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

  // Empty
  if (value === undefined || value === null || value === "") {
    return (
      <div
        onClick={startEditString}
        className={`text-muted-foreground/30 text-xs ${isEditable ? "cursor-text hover:text-muted-foreground/50 transition-colors" : ""}`}
      >
        {isEditable ? "Click to add" : "—"}
      </div>
    );
  }

  // Array types
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <div
          onClick={startEditArray}
          className={`text-muted-foreground/30 text-xs ${isEditable ? "cursor-text hover:text-muted-foreground/50" : ""}`}
        >
          {isEditable ? "Click to add" : "—"}
        </div>
      );
    }

    // Image URLs - show as thumbnails with links
    if (value[0] && typeof value[0] === "object" && "imageUrl" in value[0]) {
      const images = value as { imageUrl: string; pageUrl: string; title: string }[];
      return <ImageUrlsCell images={images} isEditable={isEditable} rowId={rowId} enrichKey={enrichKey} />;
    }

    // Source URLs - show as links with dialog for all sources
    if (value[0] && typeof value[0] === "object" && "uri" in value[0]) {
      const sources = value as { title: string; uri: string }[];
      return <SourceUrlsCell sources={sources} isEditable={isEditable} rowId={rowId} enrichKey={enrichKey} />;
    }

    // FAQ - question/answer pairs get their own editor
    if (value[0] && typeof value[0] === "object" && "question" in value[0]) {
      const faq = value as { question: string; answer: string }[];
      return <FaqCell items={faq} isEditable={isEditable} rowId={rowId} enrichKey={enrichKey} />;
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
        onClick={startEditArray}
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
            Click to edit
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

  const overBudget = maxChars != null && str.length > maxChars;
  const budgetBadge = overBudget ? (
    <span
      className="ml-1 inline-block align-middle rounded bg-destructive/10 px-1 font-mono text-[9px] font-semibold text-destructive"
      title={`${str.length} characters — over the ${maxChars} character limit`}
    >
      {str.length}/{maxChars}
    </span>
  ) : null;

  if (str.length > 80) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            onClick={startEditString}
            className={`text-[11px] leading-snug break-words whitespace-pre-wrap w-full group ${isEditable ? "cursor-text" : "cursor-default"}`}
          >
            {str}
            {budgetBadge}
            {isEditable && (
              <span className="text-[9px] text-primary/0 group-hover:text-primary/50 transition-colors block mt-0.5">
                Click to edit
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
      onClick={startEditString}
      className={`text-[11px] leading-snug break-words whitespace-pre-wrap w-full group ${isEditable ? "cursor-text" : ""}`}
    >
      {str}
      {budgetBadge}
      {isEditable && (
        <span className="text-[9px] text-primary/0 group-hover:text-primary/50 transition-colors block mt-0.5">
          Click to edit
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
              {enrichmentColumns.filter((c) => c.enabled || (row.enrichedData?.[c.id] !== undefined && row.enrichedData?.[c.id] !== null && row.enrichedData?.[c.id] !== "")).map((col) => {
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
                  } else if (val.length > 0 && typeof val[0] === "object" && "question" in val[0]) {
                    display = (val as { question: string; answer: string }[]).map((item, i) => (
                      <div key={i} className="mb-1.5 last:mb-0">
                        <div className="text-[11px] font-semibold">{item.question}</div>
                        <div className="text-[11px] text-muted-foreground leading-snug">{item.answer}</div>
                      </div>
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
    selectRowsByIds,
    deleteSelectedRows,
    selectByStatus,
    invertSelection,
    addRow,
    deleteColumn,
    renameColumn,
    reorderColumns,
    toggleColumnVisibility,
    setRowStatus,
    undo,
    redo,
    canUndo,
    canRedo,
    activeSheet,
    setActiveSheet,
    saveStatus,
    enrichingTab,
    enrichingExistingColumns,
    sessionKind,
    productGroupColumn,
  } = useSheetStore();

  const { role } = useWorkspaceStore();
  const isViewer = role === "viewer";

  const isPlp = sessionKind === "plp";

  const sheetLabels = isPlp
    ? { existing: "Existing pages", new: "New pages" }
    : { existing: "Existing", new: "New" };

  const [globalFilter, setGlobalFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [previewRowId, setPreviewRowId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [showColumnVisibility, setShowColumnVisibility] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 50 });
  const searchInputRef = useRef<HTMLInputElement>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const currentPageRowIdsRef = useRef<string[]>([]);
  const [pageRowIds, setPageRowIds] = useState<string[]>([]);
  const columnResizeMode: ColumnResizeMode = "onChange";
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);
  const dragColIdRef = useRef<string | null>(null);

  const groupIndex = useMemo(
    () => buildProductGroupIndex(rows, productGroupColumn),
    [rows, productGroupColumn]
  );

  // Pre-filter rows by active sheet (existing/new), collapsing variant rows
  // when a product group column is set.
  const sheetFilteredRows = useMemo(() => {
    return visibleCatalogRows(rows, {
      groupColumn: productGroupColumn,
      activeSheet,
    });
  }, [rows, activeSheet, productGroupColumn]);

  // Selection state scoped to current sheet only
  const sheetSelectedCount = useMemo(() => {
    return sheetFilteredRows.filter((r) => selectedRowIds.has(r.id)).length;
  }, [sheetFilteredRows, selectedRowIds]);

  const allSelected = sheetFilteredRows.length > 0 && sheetSelectedCount === sheetFilteredRows.length;
  const anySelected = sheetSelectedCount > 0;
  const pageAllSelected =
    pageRowIds.length > 0 && pageRowIds.every((id) => selectedRowIds.has(id));
  const pageSomeSelected =
    !pageAllSelected && pageRowIds.some((id) => selectedRowIds.has(id));

  const togglePageSelection = useCallback(() => {
    if (pageAllSelected) {
      const pageSet = new Set(pageRowIds);
      selectRowsByIds([...selectedRowIds].filter((id) => !pageSet.has(id)));
    } else {
      selectRowsByIds(pageRowIds);
    }
  }, [pageAllSelected, pageRowIds, selectedRowIds, selectRowsByIds]);

  // Count rows per sheet
  const sheetCounts = useMemo(() => {
    return {
      existing: visibleCatalogRows(rows, {
        groupColumn: productGroupColumn,
        activeSheet: "existing",
      }).length,
      new: visibleCatalogRows(rows, {
        groupColumn: productGroupColumn,
        activeSheet: "new",
      }).length,
    };
  }, [rows, productGroupColumn]);

  // Pre-filter rows by status
  const statusFilteredRows = useMemo(() => {
    if (statusFilter === "all") return sheetFilteredRows;
    return sheetFilteredRows.filter((r) => r.status === statusFilter);
  }, [sheetFilteredRows, statusFilter]);

  // Status counts (based on sheet-filtered rows)
  const statusCounts = useMemo(() => {
    const counts = { all: sheetFilteredRows.length, pending: 0, processing: 0, done: 0, error: 0 };
    for (const r of sheetFilteredRows) {
      counts[r.status]++;
    }
    return counts;
  }, [sheetFilteredRows]);

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
        <TableSelectHeader
          allSelected={pageAllSelected}
          someSelected={pageSomeSelected}
          pageCount={pageRowIds.length}
          totalCount={sheetFilteredRows.length}
          onTogglePage={togglePageSelection}
          onSelectPage={() => selectRowsByIds(pageRowIds)}
          onSelectAll={selectAllRows}
          onClear={deselectAllRows}
        />
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
          if (row.original.status === "processing" && enrichingTab === "existing" && enrichingExistingColumns.includes(colName)) {
            return (
              <div className="py-1 space-y-1.5 w-full">
                <div className="h-1.5 w-3/4 bg-primary/10 animate-pulse rounded-full" />
                <div className="h-1.5 w-1/2 bg-primary/10 animate-pulse rounded-full" />
                <div className="h-1.5 w-5/6 bg-primary/10 animate-pulse rounded-full" />
              </div>
            );
          }
          const canEdit =
            !isViewer &&
            (!isEnriching ||
            row.original.status === "done" ||
            row.original.status === "pending");
          const groupSize = groupIndex.sizeByPrimary.get(row.original.id) ?? 1;
          const showGroupBadge =
            groupIndex.enabled &&
            groupIndex.column === colName &&
            groupSize > 1;
          return (
            <div className="flex min-w-0 items-center gap-1.5">
            <EditableCell
              value={row.original.originalData[colName] || ""}
              rowId={row.original.id}
              column={colName}
              isEditable={canEdit}
            />
            {showGroupBadge && (
              <Badge variant="secondary" className="shrink-0 text-[8px] px-1.5 py-0">
                {groupSize} variants
              </Badge>
            )}
            </div>
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

    // Enriched columns - show if enabled OR has data in any row
    const enabledEnrichment = enrichmentColumns.filter(
      (col) => col.enabled || rows.some((r) => {
        const val = r.enrichedData?.[col.id];
        return val !== undefined && val !== null && val !== "";
      })
    );
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
          if (row.original.status === "processing" && enrichCol.enabled && enrichingTab === "new") {
            return (
              <div className="py-1 space-y-1.5 w-full">
                <div className="h-1.5 w-3/4 bg-primary/10 animate-pulse rounded-full" />
                <div className="h-1.5 w-1/2 bg-primary/10 animate-pulse rounded-full" />
                <div className="h-1.5 w-5/6 bg-primary/10 animate-pulse rounded-full" />
              </div>
            );
          }
          const canEditEnriched = !isViewer && row.original.status !== "processing";
          return (
            <EditableEnrichedCell
              value={row.original.enrichedData[enrichCol.id]}
              rowId={row.original.id}
              enrichKey={enrichCol.id}
              isEditable={canEditEnriched}
              maxChars={enrichCol.maxChars}
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
    rows,
    isEnriching,
    selectedRowIds,
    pageRowIds,
    pageAllSelected,
    pageSomeSelected,
    togglePageSelection,
    toggleRowSelection,
    selectAllRows,
    deselectAllRows,
    selectRowsByIds,
    sheetFilteredRows,
    renameColumn,
    activeSheet,
    enrichingTab,
    enrichingExistingColumns,
    groupIndex,
    productGroupColumn,
  ]);

  const table = useReactTable({
    data: statusFilteredRows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    globalFilterFn,
    columnResizeMode,
    state: {
      globalFilter,
      sorting,
      pagination,
    },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    enableColumnResizing: true,
  });

  // Reset to first page when filters change
  useEffect(() => {
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, [globalFilter, statusFilter]);

  // Virtual scrolling with dynamic row heights (within current page)
  const { rows: tableRows } = table.getRowModel();
  useEffect(() => {
    const ids = tableRows.map((r) => r.original.id);
    currentPageRowIdsRef.current = ids;
    setPageRowIds((prev) =>
      prev.length === ids.length && prev.every((id, i) => id === ids[i])
        ? prev
        : ids
    );
  }, [tableRows]);
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

            {/* Sheet toggle tabs — PLP has no "existing" concept, so it never shows this */}
            {!isPlp && (
              <div className="flex items-center border rounded-lg overflow-hidden mx-2">
                <button
                  onClick={() => setActiveSheet("existing")}
                  disabled={sheetCounts.existing === 0}
                  className={`flex items-center gap-1.5 px-3 py-1 text-[10px] font-medium transition-colors ${
                    activeSheet === "existing"
                      ? "bg-primary text-primary-foreground"
                      : sheetCounts.existing === 0
                      ? "bg-background text-muted-foreground/40 cursor-not-allowed"
                      : "bg-background text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  <Package className="h-3 w-3" />
                  {sheetLabels.existing} ({sheetCounts.existing})
                </button>
                <div className="w-px h-5 bg-border" />
                <button
                  onClick={() => setActiveSheet("new")}
                  disabled={sheetCounts.new === 0}
                  className={`flex items-center gap-1.5 px-3 py-1 text-[10px] font-medium transition-colors ${
                    activeSheet === "new"
                      ? "bg-primary text-primary-foreground"
                      : sheetCounts.new === 0
                      ? "bg-background text-muted-foreground/40 cursor-not-allowed"
                      : "bg-background text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  <FileSpreadsheet className="h-3 w-3" />
                  {sheetLabels.new} ({sheetCounts.new})
                </button>
              </div>
            )}

            {/* Row count */}
            <span className="text-[10px] text-muted-foreground font-mono">
              {globalFilter ? `${filteredCount}/` : ""}{statusFilteredRows.length}{" "}
              {productGroupColumn ? "products" : "rows"}
            </span>

            {/* Selection info */}
            {anySelected && (
              <>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1">
                  {sheetSelectedCount} selected
                </Badge>
                {!isEnriching && !isViewer && (
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
            {/* Save Status */}
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground mr-1">
              {saveStatus === "saving" && (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Saving...</span>
                </>
              )}
              {saveStatus === "saved" && (
                <>
                  <Cloud className="h-3 w-3 text-green-500" />
                  <span className="text-green-600 dark:text-green-400">Saved</span>
                </>
              )}
              {saveStatus === "unsaved" && (
                <>
                  <CloudOff className="h-3 w-3 text-amber-500" />
                  <span className="text-amber-600 dark:text-amber-400">Unsaved</span>
                </>
              )}
              {saveStatus === "error" && (
                <>
                  <CloudOff className="h-3 w-3 text-red-500" />
                  <span className="text-red-600 dark:text-red-400">Save failed</span>
                </>
              )}
            </div>

            <div className="w-px h-4 bg-border" />

            {/* Add Row */}
            {!isViewer && (
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
            )}

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
                  {headerGroup.headers.map((header) => {
                const isOrigCol = header.column.id.startsWith("orig_");
                const isDragOver = dragOverColId === header.column.id;
                return (
                  <div
                    key={header.id}
                    className={`h-9 px-3 flex items-center border-r last:border-r-0 relative transition-all group/dragcol ${
                      header.column.id === "select" ? "overflow-visible z-20" : "overflow-hidden"
                    } ${
                      isDragOver && isOrigCol
                        ? "border-l-2 border-l-primary border-border/40 bg-primary/5"
                        : "border-border/40"
                    }`}
                    style={{
                      width: header.getSize(),
                      minWidth: header.getSize(),
                    }}
                    draggable={isOrigCol && !isEnriching}
                    onDragStart={isOrigCol ? (e) => {
                      dragColIdRef.current = header.column.id;
                      e.dataTransfer.effectAllowed = "move";
                    } : undefined}
                    onDragOver={isOrigCol ? (e) => {
                      e.preventDefault();
                      if (dragColIdRef.current && dragColIdRef.current !== header.column.id) {
                        setDragOverColId(header.column.id);
                      }
                    } : undefined}
                    onDragLeave={isOrigCol ? () => setDragOverColId(null) : undefined}
                    onDrop={isOrigCol ? (e) => {
                      e.preventDefault();
                      setDragOverColId(null);
                      if (!dragColIdRef.current || dragColIdRef.current === header.column.id) return;
                      const fromColName = dragColIdRef.current.replace("orig_", "");
                      const toColName = header.column.id.replace("orig_", "");
                      const fromIndex = originalColumns.indexOf(fromColName);
                      const toIndex = originalColumns.indexOf(toColName);
                      if (fromIndex !== -1 && toIndex !== -1) {
                        reorderColumns(fromIndex, toIndex);
                      }
                      dragColIdRef.current = null;
                    } : undefined}
                    onDragEnd={() => {
                      dragColIdRef.current = null;
                      setDragOverColId(null);
                    }}
                  >
                    {isOrigCol && (
                      <GripVertical className="h-3 w-3 text-muted-foreground/20 group-hover/dragcol:text-muted-foreground/60 cursor-grab shrink-0 mr-1 transition-colors" />
                    )}
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
                );
              })}
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

        {/* Pagination Footer */}
        <div className="flex items-center justify-between px-3 py-1.5 border-t bg-muted/20 shrink-0">
          {/* Left: Row info + status counts */}
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span>
              Showing{" "}
              <span className="font-semibold text-foreground">
                {table.getRowModel().rows.length === 0
                  ? 0
                  : pagination.pageIndex * pagination.pageSize + 1}
                –
                {Math.min(
                  (pagination.pageIndex + 1) * pagination.pageSize,
                  table.getFilteredRowModel().rows.length
                )}
              </span>
              {" "}of{" "}
              <span className="font-semibold text-foreground">
                {table.getFilteredRowModel().rows.length.toLocaleString()}
              </span>
              {" "}rows
            </span>
            {statusCounts.done > 0 && <span className="text-green-600">{statusCounts.done} enriched</span>}
            {statusCounts.error > 0 && <span className="text-red-600">{statusCounts.error} errors</span>}
            {statusCounts.processing > 0 && <span className="text-amber-600">{statusCounts.processing} processing</span>}
          </div>

          {/* Center: Page navigation */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => { table.setPageIndex(0); tableContainerRef.current?.scrollTo({ top: 0 }); }}
              disabled={!table.getCanPreviousPage()}
              className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="First page"
            >
              <ChevronsLeft className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => { table.previousPage(); tableContainerRef.current?.scrollTo({ top: 0 }); }}
              disabled={!table.getCanPreviousPage()}
              className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Previous page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>

            {/* Page number buttons */}
            {(() => {
              const currentPage = table.getState().pagination.pageIndex;
              const totalPages = table.getPageCount();
              if (totalPages <= 1) return null;

              const pages: (number | "...")[] = [];
              if (totalPages <= 7) {
                for (let i = 0; i < totalPages; i++) pages.push(i);
              } else {
                pages.push(0);
                if (currentPage > 2) pages.push("...");
                for (let i = Math.max(1, currentPage - 1); i <= Math.min(totalPages - 2, currentPage + 1); i++) {
                  pages.push(i);
                }
                if (currentPage < totalPages - 3) pages.push("...");
                pages.push(totalPages - 1);
              }

              return pages.map((p, idx) =>
                p === "..." ? (
                  <span key={`ellipsis-${idx}`} className="text-[10px] text-muted-foreground/50 px-0.5">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => { table.setPageIndex(p); tableContainerRef.current?.scrollTo({ top: 0 }); }}
                    className={`h-6 min-w-[24px] px-1 flex items-center justify-center rounded text-[10px] font-medium transition-colors ${
                      currentPage === p
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    {(p as number) + 1}
                  </button>
                )
              );
            })()}

            <button
              onClick={() => { table.nextPage(); tableContainerRef.current?.scrollTo({ top: 0 }); }}
              disabled={!table.getCanNextPage()}
              className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Next page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => { table.setPageIndex(table.getPageCount() - 1); tableContainerRef.current?.scrollTo({ top: 0 }); }}
              disabled={!table.getCanNextPage()}
              className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Last page"
            >
              <ChevronsRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Right: Page size selector + column info */}
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <span>Rows per page</span>
              <select
                value={pagination.pageSize}
                onChange={(e) => {
                  setPagination({ pageIndex: 0, pageSize: Number(e.target.value) });
                  tableContainerRef.current?.scrollTo({ top: 0 });
                }}
                className="h-6 rounded border bg-background text-[10px] font-medium px-1 pr-5 outline-none focus:ring-1 focus:ring-primary/50 cursor-pointer appearance-none"
                style={{ backgroundImage: "url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e\")", backgroundPosition: "right 2px center", backgroundRepeat: "no-repeat", backgroundSize: "16px" }}
              >
                {[25, 50, 100, 250, 500].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>
            <span className="opacity-60">{visibleOriginalColumns.length}/{originalColumns.length} cols</span>
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
              Delete {allSelected ? "All" : sheetSelectedCount} Rows?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {allSelected
                ? <>You are about to delete all <strong>{sheetFilteredRows.length} {productGroupColumn ? "products" : "rows"}</strong> in this tab. This action can be undone with Ctrl+Z.</>
                : <>You are about to delete <strong>{sheetSelectedCount} selected rows</strong>. This action can be undone with Ctrl+Z.</>
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowDeleteConfirm(false)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              onClick={() => { deleteSelectedRows(); setShowDeleteConfirm(false); }}
            >
              Delete {allSelected ? "All" : sheetSelectedCount}
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
                {!isViewer && (
                <button
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-destructive hover:bg-destructive/10 transition-colors text-xs"
                  onClick={() => { deleteColumn(contextMenu.colName); setContextMenu(null); }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete Column
                </button>
                )}
              </>
            )}

          </div>
        </>
      )}
    </div>
  );
}
