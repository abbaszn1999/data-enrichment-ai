"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
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
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useWorkspaceContext } from "../workspace-context";
import { PageLoader } from "@/components/brand/page-loader";
import { useRole } from "@/hooks/use-role";
import { loadCategoriesJson, type CategoryJson } from "@/lib/storage-helpers";

import { parseExcelFile } from "@/lib/excel";
import {
  UploadLimitError,
  assertRowCount,
  assertSpreadsheetFile,
} from "@/lib/upload-limits";
import { CMS_CATEGORY_COLUMNS } from "@/types";

// Alias for compatibility with existing tree builder
type Category = CategoryJson & { parent_id?: string | null; description?: string; sort_order?: number; attributes?: any[] };
import { FileSpreadsheet, CheckCircle2, ArrowRight, GripVertical } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  buildAncestorSets,
  buildCountedTree,
  categoryPathKey,
  collectExpandableIds,
  flattenExpanded,
  isDescendantOf,
  rollupProductCounts,
  type CategoryRef,
} from "@/lib/categories/tree";

interface TreeNode extends Category {
  children: TreeNode[];
  productCount: number;
  directCount: number;
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
  const [taxonomyRevision, setTaxonomyRevision] = useState(0);
  const [productCounts, setProductCounts] = useState<Record<string, number>>({});
  const treeScrollRef = useRef<HTMLDivElement>(null);

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
    Promise.all([
      loadCategoriesJson(workspace.id),
      fetch(`/api/categories?workspaceId=${workspace.id}`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/categories/counts?workspaceId=${workspace.id}`).then((r) => r.json()).catch(() => ({})),
    ])
      .then(([cats, meta, counts]) => {
        setCategories(cats.map(toCategory));
        if (typeof meta?.revision === "number") setTaxonomyRevision(meta.revision);
        if (counts?.counts && typeof counts.counts === "object") {
          setProductCounts(counts.counts as Record<string, number>);
        }
      })
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
      const res = await fetch("/api/categories", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          categories: jsons,
          rawRows: buildRawRows(toSave),
          expectedRevision: taxonomyRevision,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        revision?: number;
        currentRevision?: number;
      };
      if (res.status === 409) {
        alert(payload.error || "Someone else changed this taxonomy. Reload and try again.");
        return;
      }
      if (!res.ok) throw new Error(payload.error || "Failed to save");
      if (typeof payload.revision === "number") setTaxonomyRevision(payload.revision);
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

  const categoryRefs: CategoryRef[] = useMemo(
    () =>
      categories.map((c) => ({
        id: c.id,
        name: c.name,
        parentId: c.parent_id ?? null,
      })),
    [categories]
  );
  const ancestorSets = useMemo(() => buildAncestorSets(categoryRefs), [categoryRefs]);
  const counted = useMemo(
    () => rollupProductCounts(categoryRefs, productCounts),
    [categoryRefs, productCounts]
  );
  const tree = useMemo(
    () => buildCountedTree(categories.map((c) => ({
      ...c,
      parentId: c.parent_id ?? null,
    })), counted) as TreeNode[],
    [categories, counted]
  );
  const maxDepth = useMemo(() => {
    const walk = (nodes: TreeNode[], depth: number): number => {
      let max = depth;
      for (const node of nodes) {
        if (node.children.length) max = Math.max(max, walk(node.children, depth + 1));
      }
      return max;
    };
    return walk(tree, 1);
  }, [tree]);
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
  const isDescendant = useCallback(
    (parentId: string, targetId: string): boolean =>
      isDescendantOf(parentId, targetId, ancestorSets),
    [ancestorSets]
  );

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
    const isExpanded = expandSet.has(node.id);
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
        {isExpanded && hasChildren ? (
          <div>{/* children rendered by the virtual list */}</div>
        ) : null}
      </div>
    );
  }

  const expandSet = useMemo(() => {
    if (search) return collectExpandableIds(filteredTree);
    return expanded;
  }, [search, filteredTree, expanded]);
  const flatRows = useMemo(
    () => flattenExpanded(filteredTree, expandSet),
    [filteredTree, expandSet]
  );
  const rowVirtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => treeScrollRef.current,
    estimateSize: () => 36,
    overscan: 16,
  });

  // Upload sheet handlers
  const handleSheetSelect = async (selectedFile: File) => {
    try {
      assertSpreadsheetFile(selectedFile, "categories");
    } catch (err) {
      alert(err instanceof UploadLimitError ? err.message : "Invalid file");
      return;
    }
    setUploadFile(selectedFile);
    try {
      const buffer = await selectedFile.arrayBuffer();
      const parsed = await parseExcelFile(buffer);
      if (parsed && parsed.rows.length > 0) {
        assertRowCount(parsed.rows.length, "categories");
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
      alert(err instanceof Error ? err.message : "Failed to parse file. Please check the format.");
      setUploadFile(null);
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
      const rowIdToNewId = new Map<string, string>();
      const seenPaths = new Set<string>();
      const pending: Array<Category & { _rawParent: string }> = [];

      for (const row of parsedSheet.rows) {
        const name = (row[nameColumn] || "").trim();
        if (!name) { skipped++; continue; }

        const newId = crypto.randomUUID();
        const rawOriginalId = idColumn && row[idColumn] ? row[idColumn].trim() : null;
        if (rawOriginalId) rowIdToNewId.set(rawOriginalId, newId);

        const slug = name.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").slice(0, 48);
        const desc = descColumn ? (row[descColumn] || "").trim() : "";
        pending.push({
          id: newId,
          name,
          slug,
          description: desc || undefined,
          parentId: null,
          parent_id: null,
          originalId: rawOriginalId,
          _rawParent: parentColumn ? (row[parentColumn] || "").trim() : "",
        } as Category & { _rawParent: string });
      }

      for (const cat of pending) {
        const rawParent = cat._rawParent;
        delete (cat as { _rawParent?: string })._rawParent;
        if (!rawParent || rawParent === "0" || rawParent === "") {
          incomingCats.push(cat);
          continue;
        }
        const resolvedId = rowIdToNewId.get(rawParent)
          ?? pending.find((c) => c.name.toLowerCase() === rawParent.toLowerCase())?.id
          ?? null;
        if (resolvedId) { cat.parent_id = resolvedId; cat.parentId = resolvedId; }
        incomingCats.push(cat);
      }

      const incomingById = new Map(incomingCats.map((c) => [c.id, c]));
      const uniqueIncoming: Category[] = [];
      for (const cat of incomingCats) {
        const key = categoryPathKey(
          { id: cat.id, name: cat.name, parentId: cat.parent_id ?? null },
          incomingById as Map<string, CategoryRef>
        );
        if (seenPaths.has(key)) { skipped++; continue; }
        seenPaths.add(key);
        uniqueIncoming.push(cat);
      }
      incomingCats.length = 0;
      incomingCats.push(...uniqueIncoming);
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
        const existingByPath = new Map<string, Category>();
        const existingById = new Map(categories.map((c) => [c.id, c]));
        const categoryPathKey = (cat: Category, byId: Map<string, Category>) => {
          const names: string[] = [];
          let current: Category | undefined = cat;
          const seen = new Set<string>();
          while (current && !seen.has(current.id)) {
            seen.add(current.id);
            names.unshift(current.name);
            current = current.parent_id ? byId.get(current.parent_id) : undefined;
          }
          return names.join("\0").toLowerCase();
        };
        for (const c of categories) existingByPath.set(categoryPathKey(c, existingById), c);
        const incomingById = new Map(incomingCats.map((c) => [c.id, c]));

        const merged: Category[] = [];
        const usedExistingIds = new Set<string>();
        let updatedCount = 0;

        for (const incoming of incomingCats) {
          const existing = existingByPath.get(categoryPathKey(incoming, incomingById));
          if (existing) {
            // Match found — keep existing ID, update description & originalId from sheet
            usedExistingIds.add(existing.id);
            // Re-map parent from incoming's new ID → existing parent ID
            let parentId = existing.parent_id;
            if (incoming.parent_id) {
              const parentIncoming = incomingById.get(incoming.parent_id);
              if (parentIncoming) {
                const parentExisting = existingByPath.get(
                  categoryPathKey(parentIncoming, incomingById)
                );
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
              const parentIncoming = incomingById.get(parentId);
              if (parentIncoming) {
                const parentExisting = existingByPath.get(
                  categoryPathKey(parentIncoming, incomingById)
                );
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
      await persistToStorage([]);
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
    return <PageLoader />;
  }

  return (
    <div className="autommerce-dashboard min-h-full bg-background [font-family:var(--brand-font)]">
      {/* Branded taxonomy masthead */}
      <section className="relative overflow-hidden border-b border-border/60 bg-gradient-to-br from-[#400095]/[0.08] via-background to-[#F76D01]/[0.08]">
        <div className="absolute -left-20 -top-28 h-64 w-64 rounded-full bg-[#400095]/10 blur-3xl" />
        <div className="absolute -right-16 -bottom-28 h-64 w-64 rounded-full bg-[#F76D01]/10 blur-3xl" />
        <div className="relative mx-auto max-w-[1500px] px-5 py-7 sm:px-7 lg:px-10">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between"
          >
            <div>
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#400095] text-white shadow-[0_8px_25px_rgba(64,0,149,.22)] dark:bg-[#F76D01]">
                  <FolderTree className="h-4 w-4" />
                </span>
                <span className="text-[9px] font-black uppercase tracking-[0.24em] text-[#400095] dark:text-[#F76D01]">
                  Taxonomy system
                </span>
              </div>
              <h1 className="text-3xl font-black tracking-[-0.035em] sm:text-4xl">
                Category intelligence,
                <span className="block bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095] bg-clip-text pb-1 text-transparent">
                  organized for every agent.
                </span>
              </h1>
              <p className="mt-2 max-w-xl text-xs leading-relaxed text-muted-foreground">
                The shared category tree every Autommerce agent reads from. Build it by hand, drag
                to reorganize, or upload a sheet to bootstrap it in seconds.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {permissions.canAdmin && categories.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 gap-1.5 rounded-xl border-destructive/25 bg-background/70 px-3 text-[10px] text-destructive backdrop-blur hover:bg-destructive/10"
                  onClick={() => setShowDeleteAll(true)}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete all
                </Button>
              )}
              {permissions.canAdmin && hasUnsavedChanges && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 gap-1.5 rounded-xl border-emerald-500/50 bg-background/70 px-3 text-[10px] text-emerald-600 backdrop-blur animate-pulse hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
                  onClick={() => persistToStorage()}
                  disabled={saving}
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  {saving ? "Saving..." : "Save"}
                </Button>
              )}
              {permissions.canAdmin && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 gap-1.5 rounded-xl border-border/60 bg-background/70 px-3 text-[10px] backdrop-blur"
                  onClick={() => setShowUpload(true)}
                >
                  <Upload className="h-3.5 w-3.5" /> Upload sheet
                </Button>
              )}
              {permissions.canAdmin && (
                <Button
                  size="sm"
                  className="h-9 gap-2 rounded-xl bg-[#400095] px-4 text-[10px] text-white shadow-[0_8px_24px_rgba(64,0,149,.2)] hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
                  onClick={() => openForm()}
                >
                  <Plus className="h-3.5 w-3.5" /> New category
                </Button>
              )}
            </div>
          </motion.div>

          {/* Taxonomy pulse — real values, no invented health score. */}
          <div className="mt-7 grid max-w-2xl grid-cols-2 overflow-hidden rounded-2xl border border-border/60 bg-background/70 shadow-sm backdrop-blur sm:grid-cols-4">
            {[
              { label: "Categories", value: categories.length, icon: FolderTree },
              { label: "Root", value: rootCount, icon: FolderOpen },
              { label: "With products", value: 0, icon: Package },
              { label: "Max depth", value: maxDepth, icon: BarChart3 },
            ].map((metric, index) => (
              <motion.div
                key={metric.label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + index * 0.08 }}
                className="flex items-center gap-3 border-r border-border/60 px-4 py-3.5 last:border-r-0"
              >
                <metric.icon className="h-4 w-4 shrink-0 text-[#6B358D] dark:text-[#C8A8D2]" />
                <span>
                  <span className="block text-lg font-black tabular-nums leading-none">
                    {metric.value}
                  </span>
                  <span className="mt-1 block text-[8px] font-bold uppercase tracking-[.16em] text-muted-foreground">
                    {metric.label}
                  </span>
                </span>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-[1500px] space-y-4 p-5 sm:p-7 lg:p-10">
        {/* Search command bar */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <h2 className="text-sm font-black">Category tree</h2>
            <p className="text-[10px] text-muted-foreground">
              Search, expand, drag to reorganize, and manage categories in one place.
            </p>
          </div>
          <div className="relative min-w-[240px] sm:w-72">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B358D] dark:text-[#C8A8D2]" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search categories…"
              className="h-10 rounded-xl border-transparent bg-muted/60 pl-10 pr-10 text-xs shadow-none focus-visible:border-[#6B358D]/35 focus-visible:ring-[#6B358D]/10"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-background"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </motion.div>

        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.16 }}
          className="relative overflow-hidden rounded-[24px] border border-border/60 bg-card shadow-[0_15px_50px_rgba(15,23,42,.05)]"
        >
          <div className="h-1 bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095]" />
          <div className="grid grid-cols-1 gap-0 lg:grid-cols-3">
            <div className="border-b p-3 lg:col-span-2 lg:border-b-0 lg:border-r">
              <div
                ref={treeScrollRef}
                className={`h-[min(70vh,720px)] overflow-auto rounded-xl transition-all ${
                  dragId && dropTargetId === "__root__"
                    ? "ring-2 ring-[#400095]/40 bg-[#400095]/5 dark:ring-[#F76D01]/40 dark:bg-[#F76D01]/5"
                    : ""
                }`}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "move";
                  setDropTargetId("__root__");
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                  if (dropTargetId === "__root__") setDropTargetId(null);
                }}
                onDrop={(e) => handleDrop(e, null)}
              >
                {filteredTree.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
                    <span className="mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#F76D01]/15 to-[#400095]/15">
                      <FolderTree className="h-6 w-6 text-[#6B358D]" />
                    </span>
                    <p className="text-sm font-black">
                      {search
                        ? "No categories match your search"
                        : "No categories yet"}
                    </p>
                    <p className="max-w-sm text-[11px] leading-relaxed text-muted-foreground">
                      {search
                        ? "Try a different search term."
                        : "Add a category or upload a sheet to build your tree."}
                    </p>
                    {!search && permissions.canAdmin && (
                      <Button
                        size="sm"
                        className="mt-3 gap-1.5 rounded-xl bg-[#400095] text-[10px] text-white dark:bg-[#F76D01]"
                        onClick={() => openForm()}
                      >
                        <Plus className="h-3.5 w-3.5" /> New category
                      </Button>
                    )}
                  </div>
                ) : (
                  <>
                    <div
                      className="relative w-full"
                      style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
                    >
                      {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                        const item = flatRows[virtualRow.index];
                        if (!item) return null;
                        return (
                          <div
                            key={item.node.id}
                            className="absolute left-0 top-0 w-full"
                            style={{
                              height: `${virtualRow.size}px`,
                              transform: `translateY(${virtualRow.start}px)`,
                            }}
                          >
                            {renderNode(item.node, item.depth)}
                          </div>
                        );
                      })}
                    </div>
                    {dragId && (
                      <div
                        className={`mt-1 rounded-lg border-2 border-dashed py-2 text-center text-[10px] transition-all ${
                          dropTargetId === "__root__"
                            ? "border-[#400095] bg-[#400095]/5 text-[#400095] dark:border-[#F76D01] dark:bg-[#F76D01]/5 dark:text-[#F76D01]"
                            : "border-muted-foreground/20 text-muted-foreground/40"
                        }`}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDropTargetId("__root__");
                        }}
                        onDrop={(e) => handleDrop(e, null)}
                      >
                        Drop here to move to root level
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="p-4">
              <AnimatePresence mode="wait">
                {selectedCat ? (
                  <motion.div
                    key={selectedCat.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="space-y-3 rounded-2xl border border-border/60 bg-background p-4"
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#F76D01]/15 to-[#400095]/15">
                        <Layers className="h-4 w-4 text-[#6B358D] dark:text-[#C8A8D2]" />
                      </span>
                      <h3 className="text-sm font-black break-words">
                        {selectedCat.name}
                      </h3>
                    </div>
                    {selectedCat.description && (
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {selectedCat.description}
                      </p>
                    )}
                    <div className="space-y-2 rounded-xl bg-muted/30 p-3 text-xs">
                      <div className="flex justify-between gap-3">
                        <span className="text-muted-foreground">Slug</span>
                        <span className="truncate font-mono">{selectedCat.slug}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-muted-foreground">Products</span>
                        <span className="font-bold">
                          {counted.get(selectedCat.id)?.rollup ?? 0}
                        </span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-muted-foreground">Subcategories</span>
                        <span className="font-bold">
                          {
                            categories.filter((c) => c.parent_id === selectedCat.id)
                              .length
                          }
                        </span>
                      </div>
                    </div>
                    {permissions.canAdmin && (
                      <div className="flex gap-2 pt-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 gap-1 rounded-lg text-xs"
                          onClick={() => openForm(undefined, selectedCat)}
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 rounded-lg text-xs text-destructive"
                          onClick={() => handleDelete(selectedCat.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </motion.div>
                ) : (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border/60 px-4 py-12 text-center"
                  >
                    <Folder className="h-8 w-8 text-muted-foreground/30" />
                    <p className="text-xs text-muted-foreground">
                      Select a category to view details
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.section>
      </main>

      {/* Add/Edit Form Dialog */}
      <AnimatePresence>
      {showForm && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-[#170710]/70 backdrop-blur-md z-50 flex items-center justify-center p-4"
          onClick={() => setShowForm(false)}
        >
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 340, damping: 26 }}
            className="w-full max-w-md overflow-hidden rounded-[24px] border bg-background shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-1 bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095]" />
            <div className="space-y-4 p-5">
            <h3 className="text-sm font-black">{editId ? "Edit Category" : "Add Category"}</h3>
            {formError && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-destructive/10 text-destructive text-xs">
                <AlertCircle className="h-3.5 w-3.5" /> {formError}
              </div>
            )}
            <div className="space-y-2">
              <Label className="text-xs">Name</Label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} className="h-9 rounded-xl" autoFocus />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Parent Category</Label>
              <select
                value={formParent}
                onChange={(e) => setFormParent(e.target.value)}
                className="w-full h-9 px-2.5 text-xs rounded-xl border bg-background"
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
                className="w-full px-3 py-2 text-xs rounded-xl border bg-background resize-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)} className="text-xs">Cancel</Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={formLoading}
                className="gap-1 rounded-xl bg-[#400095] text-xs text-white hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
              >
                {formLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                {editId ? "Save" : "Create"}
              </Button>
            </div>
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>
      {/* Upload Sheet Dialog */}
      <AnimatePresence>
      {showUpload && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-[#170710]/70 backdrop-blur-md z-50 flex items-center justify-center p-4"
          onClick={resetUpload}
        >
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 340, damping: 26 }}
            className="w-full max-w-2xl overflow-hidden rounded-[24px] border bg-background shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-1 bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095]" />
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b bg-muted/30">
              <h3 className="text-sm font-black flex items-center gap-2">
                <Upload className="h-4 w-4 text-[#6B358D] dark:text-[#C8A8D2]" /> Upload Categories Sheet
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
                    uploadStep === i + 1 ? "bg-[#400095] text-white dark:bg-[#F76D01]" : "bg-muted text-muted-foreground"
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
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* Delete All Confirmation Dialog */}
      <AnimatePresence>
      {showDeleteAll && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center"
        >
          <motion.div
            className="fixed inset-0 bg-[#170710]/70 backdrop-blur-md"
            onClick={() => { setShowDeleteAll(false); setDeleteConfirmText(""); }}
          />
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 340, damping: 26 }}
            className="relative mx-4 w-full max-w-md overflow-hidden rounded-[24px] border bg-background shadow-2xl"
          >
            <div className="h-1 bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095]" />
            <div className="space-y-4 p-6">
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
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}
