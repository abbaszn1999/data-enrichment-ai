"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import {
  FolderTree,
  Plus,
  Search,
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  Trash2,
  Pencil,
  Loader2,
  Package,
  X,
  Upload,
  Download,
  BarChart3,
  AlertCircle,
  AlertTriangle,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useWorkspaceContext } from "../layout";
import { useRole } from "@/hooks/use-role";
import { loadCategoriesJson, saveCategoriesJson, saveCategoriesRawJson, type CategoryJson } from "@/lib/storage-helpers";

import { parseExcelFile } from "@/lib/excel";
import { CMS_CATEGORY_COLUMNS } from "@/types";

// Alias for compatibility with existing tree builder
type Category = CategoryJson & { parent_id?: string | null; description?: string; sort_order?: number; attributes?: any[] };
import { FileSpreadsheet, CheckCircle2, ArrowRight, GripVertical } from "lucide-react";

interface TreeNode extends Category {
  children: TreeNode[];
  productCount: number;
}

function buildTree(categories: Category[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  categories.forEach((c) => {
    map.set(c.id, { ...c, children: [], productCount: 0 });
  });

  categories.forEach((c) => {
    const node = map.get(c.id)!;
    if (c.parent_id && map.has(c.parent_id)) {
      map.get(c.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
}

function getMaxDepth(nodes: TreeNode[], depth = 1): number {
  let max = depth;
  for (const n of nodes) {
    if (n.children.length > 0) {
      max = Math.max(max, getMaxDepth(n.children, depth + 1));
    }
  }
  return max;
}

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").slice(0, 48);
}

export default function CategoriesPage() {
  const { workspace, role } = useWorkspaceContext();
  const permissions = useRole(role);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formParent, setFormParent] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState("");

  // Delete All state
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deletingAll, setDeletingAll] = useState(false);

  // Dirty / Save state
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saving, setSaving] = useState(false);

  // Drag & Drop state
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null); // null = root zone

  // Upload sheet state
  const [showUpload, setShowUpload] = useState(false);
  const [uploadStep, setUploadStep] = useState<1 | 2 | 3 | 4>(1);
  const [uploadMode, setUploadMode] = useState<"replace" | "merge">("merge");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [parsedSheet, setParsedSheet] = useState<{ columns: string[]; rows: any[] } | null>(null);
  const [previewRows, setPreviewRows] = useState<Record<string, string>[]>([]);
  const [nameColumn, setNameColumn] = useState("");
  const [descColumn, setDescColumn] = useState("");
  const [parentColumn, setParentColumn] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState<{ imported: number; skipped: number } | null>(null);

  // Helper to convert CategoryJson to Category (with parent_id alias)
  const toCategory = (c: CategoryJson): Category => ({ ...c, parent_id: c.parentId });

  useEffect(() => {
    if (!workspace) return;
    loadCategoriesJson(workspace.id)
      .then((cats) => setCategories(cats.map(toCategory)))
      .finally(() => setLoading(false));
  }, [workspace]);

  // Update local categories state (marks dirty, does NOT persist to storage)
  const updateCategories = (cats: Category[]) => {
    setCategories(cats);
    setHasUnsavedChanges(true);
  };

  // Build raw rows from current categories (for categories-raw.json / AI reference)
  const buildRawRows = (cats: Category[]): Record<string, string>[] => {
    return cats.map((c) => {
      const row: Record<string, string> = {};
      row["category_id"] = c.originalId || c.id;
      row["category_name"] = c.name;
      row["parent_id"] = c.parent_id
        ? (cats.find((p) => p.id === c.parent_id)?.originalId || c.parent_id)
        : "0";
      if (c.description) row["description"] = c.description;
      return row;
    });
  };

  // Persist to Supabase Storage (both categories.json + categories-raw.json)
  const persistToStorage = async (cats?: Category[]) => {
    if (!workspace) return;
    setSaving(true);
    try {
      const toSave = cats ?? categories;
      const jsons: CategoryJson[] = toSave.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        description: c.description,
        parentId: c.parent_id || null,
        originalId: (c as any).originalId || null,
        sortOrder: c.sort_order,
        attributes: c.attributes,
      }));
      await saveCategoriesJson(workspace.id, jsons);
      await saveCategoriesRawJson(workspace.id, buildRawRows(toSave));
      setHasUnsavedChanges(false);
    } catch (err: any) {
      alert(err?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  // Legacy saveAll — used by import which persists immediately
  const saveAll = async (cats: Category[]) => {
    setCategories(cats);
    await persistToStorage(cats);
  };

  const tree = useMemo(() => buildTree(categories), [categories]);
  const maxDepth = useMemo(() => getMaxDepth(tree), [tree]);
  const rootCount = tree.length;

  const filteredTree = useMemo(() => {
    if (!search) return tree;
    const s = search.toLowerCase();
    function filterNodes(nodes: TreeNode[]): TreeNode[] {
      return nodes
        .map((n) => ({
          ...n,
          children: filterNodes(n.children),
        }))
        .filter((n) => n.name.toLowerCase().includes(s) || n.children.length > 0);
    }
    return filterNodes(tree);
  }, [tree, search]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openForm = (parentId?: string, edit?: Category) => {
    setFormError("");
    if (edit) {
      setEditId(edit.id);
      setFormName(edit.name);
      setFormParent(edit.parent_id || "");
      setFormDesc(edit.description || "");
    } else {
      setEditId(null);
      setFormName("");
      setFormParent(parentId || "");
      setFormDesc("");
    }
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!workspace || !formName.trim()) {
      setFormError("Name is required");
      return;
    }
    setFormLoading(true);
    setFormError("");
    try {
      let updated: Category[];
      if (editId) {
        updated = categories.map((c) =>
          c.id === editId
            ? { ...c, name: formName.trim(), slug: slugify(formName), description: formDesc.trim(), parent_id: formParent || null }
            : c
        );
      } else {
        const newCat: Category = {
          id: crypto.randomUUID(),
          name: formName.trim(),
          slug: slugify(formName),
          description: formDesc.trim(),
          parent_id: formParent || null,
          parentId: formParent || null,
        };
        updated = [...categories, newCat];
      }
      updateCategories(updated);
      setShowForm(false);
    } catch (err: any) {
      setFormError(err?.message || "Failed to save");
    } finally {
      setFormLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!workspace || !confirm("Delete this category? Products in it will become uncategorized.")) return;
    // Also delete children recursively
    const toDelete = new Set<string>();
    const collectChildren = (parentId: string) => {
      toDelete.add(parentId);
      categories.filter((c) => c.parent_id === parentId).forEach((c) => collectChildren(c.id));
    };
    collectChildren(id);
    const updated = categories.filter((c) => !toDelete.has(c.id));
    updateCategories(updated);
    if (selected && toDelete.has(selected)) setSelected(null);
  };

  // ── Drag & Drop helpers ──
  // Check if `targetId` is a descendant of `parentId` (prevents circular refs)
  const isDescendant = useCallback((parentId: string, targetId: string): boolean => {
    const children = categories.filter((c) => c.parent_id === parentId);
    for (const child of children) {
      if (child.id === targetId) return true;
      if (isDescendant(child.id, targetId)) return true;
    }
    return false;
  }, [categories]);

  const handleDragStart = useCallback((e: React.DragEvent, nodeId: string) => {
    setDragId(nodeId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", nodeId);
    // Make drag image slightly transparent
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "0.5";
    }
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    setDragId(null);
    setDropTargetId(null);
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "1";
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, targetId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragId || dragId === targetId) return;
    // Prevent dropping onto itself or its descendants
    if (targetId && (dragId === targetId || isDescendant(dragId, targetId))) {
      e.dataTransfer.dropEffect = "none";
      return;
    }
    e.dataTransfer.dropEffect = "move";
    setDropTargetId(targetId);
  }, [dragId, isDescendant]);

  const handleDrop = useCallback((e: React.DragEvent, newParentId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragId) return;

    // Prevent dropping onto itself or its descendants
    if (newParentId && (dragId === newParentId || isDescendant(dragId, newParentId))) return;

    // Find current category
    const cat = categories.find((c) => c.id === dragId);
    if (!cat) return;

    // Skip if parent didn't change
    if ((cat.parent_id || null) === newParentId) {
      setDragId(null);
      setDropTargetId(null);
      return;
    }

    // Move: only change parent_id — ID stays the same, children follow automatically
    const updated = categories.map((c) =>
      c.id === dragId
        ? { ...c, parent_id: newParentId, parentId: newParentId }
        : c
    );
    updateCategories(updated);

    // Auto-expand the new parent so user sees the result
    if (newParentId) {
      setExpanded((prev) => new Set([...prev, newParentId]));
    }

    setDragId(null);
    setDropTargetId(null);
  }, [dragId, categories, isDescendant, updateCategories]);

  function renderNode(node: TreeNode, depth = 0) {
    const isExpanded = expanded.has(node.id);
    const isSelected = selected === node.id;
    const hasChildren = node.children.length > 0;
    const highlight = search && node.name.toLowerCase().includes(search.toLowerCase());
    const isDragged = dragId === node.id;
    const isDropTarget = dropTargetId === node.id;
    const canDrop = dragId && dragId !== node.id && !isDescendant(dragId, node.id);

    return (
      <div key={node.id}>
        <div
          draggable={permissions.canAdmin}
          onDragStart={(e) => handleDragStart(e, node.id)}
          onDragEnd={handleDragEnd}
          onDragOver={(e) => handleDragOver(e, node.id)}
          onDragLeave={() => { if (dropTargetId === node.id) setDropTargetId(null); }}
          onDrop={(e) => handleDrop(e, node.id)}
          className={`flex items-center gap-0.5 rounded-lg transition-all ${
            isDragged ? "opacity-40" : ""
          } ${isDropTarget && canDrop ? "ring-2 ring-primary bg-primary/5" : ""}`}
        >
          {/* Drag handle */}
          {permissions.canAdmin && (
            <div className="shrink-0 cursor-grab active:cursor-grabbing px-0.5 text-muted-foreground/30 hover:text-muted-foreground/60">
              <GripVertical className="h-3 w-3" />
            </div>
          )}
          <button
            onClick={() => {
              setSelected(node.id);
              if (hasChildren) toggleExpand(node.id);
            }}
            className={`flex-1 flex items-center gap-2 px-2 py-2 text-xs rounded-lg transition-colors ${
              isSelected ? "bg-primary/10 text-primary" : "hover:bg-muted"
            }`}
            style={{ paddingLeft: `${4 + depth * 20}px` }}
          >
            {hasChildren ? (
              isExpanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />
            ) : (
              <span className="w-3" />
            )}
            {isExpanded ? (
              <FolderOpen className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            ) : (
              <Folder className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            )}
            <span className={`flex-1 text-left truncate ${highlight ? "bg-yellow-100 dark:bg-yellow-900/30 px-1 rounded" : ""}`}>
              {node.name}
            </span>
            <Badge variant="secondary" className="text-[8px] px-1 py-0">
              {node.productCount}
            </Badge>
          </button>
        </div>
        {isExpanded && hasChildren && (
          <div>
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  // Upload sheet handlers
  const handleSheetSelect = async (selectedFile: File) => {
    setUploadFile(selectedFile);
    try {
      const buffer = await selectedFile.arrayBuffer();
      const parsed = await parseExcelFile(buffer);
      if (parsed && parsed.rows.length > 0) {
        const columns = parsed.columns;
        const rows = parsed.rows;
        const preview = rows.slice(0, 5).map((r) => {
          const obj: Record<string, string> = {};
          for (const col of columns) obj[col] = r.originalData[col] ?? "";
          return obj;
        });
        setParsedSheet({ columns, rows: rows.map((r) => r.originalData) });
        setPreviewRows(preview);
        // Auto-detect columns based on workspace CMS type
        const cmsKey = workspace?.cms_type || "custom";
        const cmsConfig = CMS_CATEGORY_COLUMNS[cmsKey] ?? CMS_CATEGORY_COLUMNS["custom"];
        const findCol = (candidates: string[]) =>
          candidates.find((c) => columns.some((col) => col.toLowerCase() === c.toLowerCase())) ??
          candidates.find((c) => columns.some((col) => col.toLowerCase().includes(c.toLowerCase())));
        const detectedName = findCol(cmsConfig.nameColumns);
        const detectedParent = findCol(cmsConfig.parentColumns);
        const detectedDesc = findCol(cmsConfig.descColumns);
        if (detectedName) setNameColumn(detectedName);
        else if (columns.length > 0) setNameColumn(columns[0]);
        if (detectedParent) setParentColumn(detectedParent);
        if (detectedDesc) setDescColumn(detectedDesc);
        setUploadStep(2);
      }
    } catch (err) {
      console.error("Parse error:", err);
      alert("Failed to parse file. Please check the format.");
    }
  };

  const handleSheetImport = async () => {
    if (!workspace || !parsedSheet || !uploadFile || !nameColumn) return;
    setUploading(true);
    setUploadProgress(0);
    try {
      const cmsKey = workspace?.cms_type || "custom";
      const cmsConfig = CMS_CATEGORY_COLUMNS[cmsKey] ?? CMS_CATEGORY_COLUMNS["custom"];
      const idColumn = cmsConfig.idColumns.find((c) => parsedSheet.columns.includes(c)) ?? "";

      // Build incoming categories from sheet rows
      const incomingCats: Category[] = [];
      let skipped = 0;
      const rowIdToNewId = new Map<string, string>(); // originalId → newUUID
      const seenNames = new Set<string>();

      for (const row of parsedSheet.rows) {
        const name = (row[nameColumn] || "").trim();
        if (!name) { skipped++; continue; }
        if (seenNames.has(name.toLowerCase())) { skipped++; continue; }
        seenNames.add(name.toLowerCase());

        const newId = crypto.randomUUID();
        const rawOriginalId = idColumn && row[idColumn] ? row[idColumn].trim() : null;
        if (rawOriginalId) rowIdToNewId.set(rawOriginalId, newId);

        const slug = name.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").slice(0, 48);
        const desc = descColumn ? (row[descColumn] || "").trim() : "";
        incomingCats.push({ id: newId, name, slug, description: desc || undefined, parentId: null, parent_id: null, originalId: rawOriginalId, _rawParent: parentColumn ? (row[parentColumn] || "").trim() : "" } as any);
      }

      // Resolve parent_id references within incoming
      for (const cat of incomingCats) {
        const rawParent = (cat as any)._rawParent as string;
        delete (cat as any)._rawParent;
        if (!rawParent || rawParent === "0" || rawParent === "") continue;
        const resolvedId = rowIdToNewId.get(rawParent)
          ?? incomingCats.find((c) => c.name.toLowerCase() === rawParent.toLowerCase())?.id
          ?? null;
        if (resolvedId) { cat.parent_id = resolvedId; (cat as any).parentId = resolvedId; }
      }
      setUploadProgress(40);

      let finalCats: Category[];
      let importedCount: number;

      if (uploadMode === "replace") {
        // Replace: discard all existing, use only incoming
        finalCats = incomingCats;
        importedCount = incomingCats.length;
      } else {
        // Merge: match by name (case-insensitive)
        // - Existing categories matched by name → keep existing ID, update fields from new sheet
        // - New categories not in existing → add them
        // - Existing categories not in sheet → keep them untouched
        const existingByName = new Map<string, Category>();
        for (const c of categories) existingByName.set(c.name.toLowerCase(), c);

        const merged: Category[] = [];
        const usedExistingIds = new Set<string>();
        let updatedCount = 0;

        for (const incoming of incomingCats) {
          const existing = existingByName.get(incoming.name.toLowerCase());
          if (existing) {
            // Match found — keep existing ID, update description & originalId from sheet
            usedExistingIds.add(existing.id);
            // Re-map parent from incoming's new ID → existing parent ID
            let parentId = existing.parent_id;
            if (incoming.parent_id) {
              // Find the parent in incoming, see if it matched an existing
              const parentIncoming = incomingCats.find((c) => c.id === incoming.parent_id);
              if (parentIncoming) {
                const parentExisting = existingByName.get(parentIncoming.name.toLowerCase());
                parentId = parentExisting?.id || incoming.parent_id;
              }
            }
            merged.push({
              ...existing,
              description: incoming.description || existing.description,
              originalId: incoming.originalId || (existing as any).originalId,
              parent_id: parentId,
              parentId: parentId,
            } as Category);
            updatedCount++;
          } else {
            // New category — resolve parent against existing
            let parentId = incoming.parent_id;
            if (parentId) {
              const parentIncoming = incomingCats.find((c) => c.id === parentId);
              if (parentIncoming) {
                const parentExisting = existingByName.get(parentIncoming.name.toLowerCase());
                if (parentExisting) parentId = parentExisting.id;
              }
            }
            merged.push({ ...incoming, parent_id: parentId, parentId: parentId } as Category);
          }
        }

        // Add existing categories that were NOT in the sheet (untouched)
        for (const c of categories) {
          if (!usedExistingIds.has(c.id) && !merged.some((m) => m.id === c.id)) {
            merged.push(c);
          }
        }

        finalCats = merged;
        importedCount = incomingCats.length - updatedCount;
        skipped += updatedCount; // updated ones count as "updated" not "new"
      }
      setUploadProgress(70);

      // Persist everything
      await saveCategoriesRawJson(workspace.id, parsedSheet.rows);
      await saveAll(finalCats);
      setUploadProgress(100);

      setUploadResult({ imported: importedCount, skipped });
      setUploadStep(4);
    } catch (err: any) {
      alert(err?.message || "Import failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteAll = async () => {
    if (!workspace || deleteConfirmText !== "delete") return;
    setDeletingAll(true);
    try {
      await saveCategoriesJson(workspace.id, []);
      await saveCategoriesRawJson(workspace.id, []);
      setCategories([]);
      setSelected(null);
      setExpanded(new Set());
      setShowDeleteAll(false);
      setDeleteConfirmText("");
      setHasUnsavedChanges(false);
    } catch (err: any) {
      alert(err?.message || "Failed to delete all categories");
    } finally {
      setDeletingAll(false);
    }
  };

  const resetUpload = () => {
    setShowUpload(false);
    setUploadStep(1);
    setUploadFile(null);
    setParsedSheet(null);
    setPreviewRows([]);
    setNameColumn("");
    setDescColumn("");
    setParentColumn("");
    setUploadResult(null);
    setUploadProgress(0);
    setUploadMode("merge");
  };

  const selectedCat = categories.find((c) => c.id === selected);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <FolderTree className="h-5 w-5" /> Categories
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {categories.length} categories
          </p>
        </div>
        <div className="flex items-center gap-2">
          {permissions.canAdmin && categories.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
              onClick={() => setShowDeleteAll(true)}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete All
            </Button>
          )}
          {permissions.canAdmin && hasUnsavedChanges && (
            <Button
              size="sm"
              variant="outline"
              className={`gap-1.5 text-xs ${hasUnsavedChanges ? "border-green-500 text-green-600 hover:bg-green-50 dark:hover:bg-green-950/20 animate-pulse" : ""}`}
              onClick={() => persistToStorage()}
              disabled={saving}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {saving ? "Saving..." : "Save"}
            </Button>
          )}
          {permissions.canAdmin && (
            <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => setShowUpload(true)}>
              <Upload className="h-3.5 w-3.5" /> Upload Sheet
            </Button>
          )}
          {permissions.canAdmin && (
            <Button size="sm" className="gap-1.5 text-xs" onClick={() => openForm()}>
              <Plus className="h-3.5 w-3.5" /> Add Category
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <Card className="p-3 flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <BarChart3 className="h-4 w-4 text-primary" />
          </div>
          <div>
            <div className="text-lg font-bold">{categories.length}</div>
            <div className="text-[10px] text-muted-foreground">Total</div>
          </div>
        </Card>
        <Card className="p-3 flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center">
            <Folder className="h-4 w-4 text-amber-600" />
          </div>
          <div>
            <div className="text-lg font-bold">{rootCount}</div>
            <div className="text-[10px] text-muted-foreground">Root</div>
          </div>
        </Card>
        <Card className="p-3 flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-green-50 dark:bg-green-950/30 flex items-center justify-center">
            <Package className="h-4 w-4 text-green-600" />
          </div>
          <div>
            <div className="text-lg font-bold">0</div>
            <div className="text-[10px] text-muted-foreground">With Products</div>
          </div>
        </Card>
        <Card className="p-3 flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center">
            <FolderTree className="h-4 w-4 text-blue-600" />
          </div>
          <div>
            <div className="text-lg font-bold">{maxDepth}</div>
            <div className="text-[10px] text-muted-foreground">Max Depth</div>
          </div>
        </Card>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
        <Input
          placeholder="Search categories..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-9 text-xs"
        />
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
            <X className="h-3 w-3 text-muted-foreground" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Tree */}
        <div className="lg:col-span-2">
          <Card
            className={`p-2 min-h-[300px] transition-all ${
              dragId && dropTargetId === "__root__" ? "ring-2 ring-primary/50 bg-primary/5" : ""
            }`}
            onDragOver={(e) => {
              // Only trigger root drop when dragging over empty space (not over a node)
              if (!dragId) return;
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = "move";
              setDropTargetId("__root__");
            }}
            onDragLeave={(e) => {
              // Only reset if leaving the card entirely
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              if (dropTargetId === "__root__") setDropTargetId(null);
            }}
            onDrop={(e) => handleDrop(e, null)}
          >
            {filteredTree.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2">
                <FolderTree className="h-8 w-8 text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground">
                  {search ? "No categories match your search" : "No categories yet"}
                </p>
              </div>
            ) : (
              <>
                {filteredTree.map((node) => renderNode(node))}
                {/* Root drop zone hint — visible only while dragging */}
                {dragId && (
                  <div
                    className={`mt-1 py-2 text-center text-[10px] rounded-lg border-2 border-dashed transition-all ${
                      dropTargetId === "__root__"
                        ? "border-primary text-primary bg-primary/5"
                        : "border-muted-foreground/20 text-muted-foreground/40"
                    }`}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropTargetId("__root__"); }}
                    onDrop={(e) => handleDrop(e, null)}
                  >
                    Drop here to move to root level
                  </div>
                )}
              </>
            )}
          </Card>
        </div>

        {/* Detail Panel */}
        <div>
          {selectedCat ? (
            <Card className="p-4 space-y-3">
              <h3 className="text-sm font-semibold">{selectedCat.name}</h3>
              {selectedCat.description && (
                <p className="text-xs text-muted-foreground">{selectedCat.description}</p>
              )}
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Slug</span>
                  <span className="font-mono">{selectedCat.slug}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Products</span>
                  <span>0</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subcategories</span>
                  <span>{categories.filter((c) => c.parent_id === selectedCat.id).length}</span>
                </div>
              </div>
              {permissions.canAdmin && (
                <div className="flex gap-2 pt-2">
                  <Button size="sm" variant="outline" className="flex-1 text-xs gap-1" onClick={() => openForm(undefined, selectedCat)}>
                    <Pencil className="h-3 w-3" /> Edit
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs text-destructive gap-1" onClick={() => handleDelete(selectedCat.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </Card>
          ) : (
            <Card className="p-6 flex flex-col items-center gap-2 text-center">
              <Folder className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">Select a category to view details</p>
            </Card>
          )}
        </div>
      </div>

      {/* Add/Edit Form Dialog */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <Card className="w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold">{editId ? "Edit Category" : "Add Category"}</h3>
            {formError && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-destructive/10 text-destructive text-xs">
                <AlertCircle className="h-3.5 w-3.5" /> {formError}
              </div>
            )}
            <div className="space-y-2">
              <Label className="text-xs">Name</Label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} className="h-9" autoFocus />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Parent Category</Label>
              <select
                value={formParent}
                onChange={(e) => setFormParent(e.target.value)}
                className="w-full h-9 px-2.5 text-xs rounded-md border bg-background"
              >
                <option value="">None (root)</option>
                {categories.filter((c) => c.id !== editId).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Description <span className="text-muted-foreground">(optional)</span></Label>
              <textarea
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 text-xs rounded-md border bg-background resize-none"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setShowForm(false)} className="text-xs">Cancel</Button>
              <Button size="sm" onClick={handleSave} disabled={formLoading} className="text-xs gap-1">
                {formLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                {editId ? "Save" : "Create"}
              </Button>
            </div>
          </Card>
        </div>
      )}
      {/* Upload Sheet Dialog */}
      {showUpload && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={resetUpload}>
          <Card className="w-full max-w-2xl p-0 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b bg-muted/30">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Upload className="h-4 w-4" /> Upload Categories Sheet
              </h3>
              <button onClick={resetUpload}>
                <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
              </button>
            </div>

            {/* Steps indicator */}
            <div className="flex items-center gap-2 px-5 py-3 border-b">
              {["Upload", "Preview", "Import"].map((s, i) => (
                <div key={s} className="flex items-center gap-2">
                  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium ${
                    uploadStep > i + 1 ? "bg-green-100 dark:bg-green-900/30 text-green-700" :
                    uploadStep === i + 1 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                  }`}>
                    {uploadStep > i + 1 ? <CheckCircle2 className="h-3 w-3" /> : <span>{i + 1}</span>}
                    <span>{s}</span>
                  </div>
                  {i < 2 && <div className={`w-6 h-0.5 ${uploadStep > i + 1 ? "bg-green-400" : "bg-muted"}`} />}
                </div>
              ))}
            </div>

            <div className="p-5">
              {/* Step 1: Upload */}
              {uploadStep === 1 && (
                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) handleSheetSelect(f); }}
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = ".xlsx,.xls,.csv";
                    input.onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) handleSheetSelect(f); };
                    input.click();
                  }}
                  className={`flex flex-col items-center justify-center gap-4 p-12 border-2 border-dashed rounded-xl cursor-pointer transition-all ${
                    isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50"
                  }`}
                >
                  <Upload className="h-10 w-10 text-muted-foreground" />
                  <div className="text-center">
                    <p className="text-sm font-medium">Drag & drop or click to browse</p>
                    <p className="text-[10px] text-muted-foreground mt-1">.xlsx, .xls, .csv — {CMS_CATEGORY_COLUMNS[workspace?.cms_type || "custom"]?.hint}</p>
                  </div>
                </div>
              )}

              {/* Step 2: Preview */}
              {uploadStep === 2 && parsedSheet && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <FileSpreadsheet className="h-5 w-5 text-green-600" />
                    <div>
                      <div className="text-sm font-medium">{uploadFile?.name}</div>
                      <div className="text-[10px] text-muted-foreground">{parsedSheet.rows.length} rows · {parsedSheet.columns.length} columns</div>
                    </div>
                  </div>

                  {/* Preview table */}
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-[10px]">
                      <thead>
                        <tr className="bg-muted/50 border-b">
                          {parsedSheet.columns.map((col) => (
                            <th key={col} className={`text-left px-3 py-2 font-semibold whitespace-nowrap ${col === nameColumn ? "bg-primary/10" : ""}`}>{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row, i) => (
                          <tr key={i} className="border-b">
                            {parsedSheet.columns.map((col) => (
                              <td key={col} className={`px-3 py-1.5 whitespace-nowrap max-w-[200px] truncate ${col === nameColumn ? "font-medium" : ""}`}>{row[col]}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex justify-between">
                    <Button variant="outline" size="sm" className="text-xs" onClick={() => setUploadStep(1)}>Back</Button>
                    <Button size="sm" className="gap-1.5 text-xs" onClick={() => setUploadStep(3)} disabled={!nameColumn}>
                      Continue <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 3: Import */}
              {uploadStep === 3 && parsedSheet && (
                <div className="space-y-4">
                  {/* Import Mode Selector */}
                  {categories.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold">Import Mode</Label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => setUploadMode("merge")}
                          className={`p-3 rounded-lg border text-left transition-all ${
                            uploadMode === "merge"
                              ? "border-primary bg-primary/5 ring-1 ring-primary"
                              : "border-muted hover:border-primary/50"
                          }`}
                        >
                          <div className="text-xs font-semibold mb-0.5">Merge</div>
                          <div className="text-[10px] text-muted-foreground leading-relaxed">
                            Match by name, update existing, add new. Keeps manually added categories.
                          </div>
                        </button>
                        <button
                          onClick={() => setUploadMode("replace")}
                          className={`p-3 rounded-lg border text-left transition-all ${
                            uploadMode === "replace"
                              ? "border-destructive bg-destructive/5 ring-1 ring-destructive"
                              : "border-muted hover:border-destructive/50"
                          }`}
                        >
                          <div className="text-xs font-semibold mb-0.5 text-destructive">Replace All</div>
                          <div className="text-[10px] text-muted-foreground leading-relaxed">
                            Delete all existing categories and replace with the uploaded sheet.
                          </div>
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="p-4 rounded-lg bg-muted/30 border space-y-2 text-xs">
                    <div className="flex justify-between"><span className="text-muted-foreground">File</span><span className="font-medium">{uploadFile?.name}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Total rows</span><span className="font-medium">{parsedSheet.rows.length}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Name column</span><span className="font-medium">{nameColumn}</span></div>
                    {descColumn && <div className="flex justify-between"><span className="text-muted-foreground">Description column</span><span className="font-medium">{descColumn}</span></div>}
                    <div className="flex justify-between"><span className="text-muted-foreground">Existing categories</span><span className="font-medium">{categories.length}</span></div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Mode</span>
                      <span className={`font-medium ${uploadMode === "replace" ? "text-destructive" : "text-primary"}`}>
                        {uploadMode === "replace" ? "Replace All" : "Smart Merge"}
                      </span>
                    </div>
                    {uploadMode === "merge" && (
                      <div className="flex justify-between"><span className="text-muted-foreground">Name matches will be</span><span className="font-medium text-amber-600">Updated</span></div>
                    )}
                  </div>

                  {uploading && (
                    <div className="space-y-2">
                      <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
                      </div>
                      <p className="text-[10px] text-muted-foreground text-center">Importing... {uploadProgress}%</p>
                    </div>
                  )}

                  <div className="flex justify-between">
                    <Button variant="outline" size="sm" className="text-xs" onClick={() => setUploadStep(2)} disabled={uploading}>Back</Button>
                    <Button size="sm" className="gap-1.5 text-xs" onClick={handleSheetImport} disabled={uploading}>
                      {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                      {uploading ? "Importing..." : "Start Import"}
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 4: Result */}
              {uploadStep === 4 && uploadResult && (
                <div className="text-center space-y-4 py-4">
                  <div className="flex justify-center">
                    <div className="h-14 w-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                      <CheckCircle2 className="h-7 w-7 text-green-600" />
                    </div>
                  </div>
                  <h3 className="text-sm font-bold">Import Complete!</h3>
                  <div className="grid grid-cols-2 gap-4 max-w-xs mx-auto">
                    <div>
                      <div className="text-2xl font-bold text-green-600">{uploadResult.imported}</div>
                      <div className="text-[10px] text-muted-foreground">Imported</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-amber-600">{uploadResult.skipped}</div>
                      <div className="text-[10px] text-muted-foreground">Skipped</div>
                    </div>
                  </div>
                  <Button size="sm" className="text-xs" onClick={resetUpload}>Done</Button>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Delete All Confirmation Dialog */}
      {showDeleteAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => { setShowDeleteAll(false); setDeleteConfirmText(""); }}
          />
          <div className="relative bg-background border rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Delete all categories</h3>
                <p className="text-xs text-muted-foreground">This action is permanent and cannot be undone</p>
              </div>
            </div>

            <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3 space-y-1">
              <p className="text-xs text-destructive font-medium">Warning</p>
              <p className="text-xs text-muted-foreground">
                You are about to permanently delete <strong className="text-foreground">{categories.length} categor{categories.length !== 1 ? "ies" : "y"}</strong> from this workspace. All category data and hierarchy will be lost forever.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium">
                Type <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-destructive">delete</span> to confirm
              </label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value.toLowerCase())}
                placeholder="Type 'delete' here..."
                className="w-full h-9 px-3 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-destructive/50"
                autoFocus
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Button
                variant="ghost"
                size="sm"
                className="flex-1 h-9 text-xs"
                onClick={() => { setShowDeleteAll(false); setDeleteConfirmText(""); }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="flex-1 h-9 text-xs bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                disabled={deleteConfirmText !== "delete" || deletingAll}
                onClick={handleDeleteAll}
              >
                {deletingAll ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                )}
                {deletingAll ? "Deleting..." : "Delete All Categories"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
