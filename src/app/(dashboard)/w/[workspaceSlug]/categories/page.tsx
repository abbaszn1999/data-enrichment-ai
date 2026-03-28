"use client";

import { useEffect, useState, useMemo } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useWorkspaceContext } from "../layout";
import { useRole } from "@/hooks/use-role";
import { loadCategoriesJson, saveCategoriesJson, type CategoryJson } from "@/lib/storage-helpers";

import { parseExcelFile } from "@/lib/excel";

// Alias for compatibility with existing tree builder
type Category = CategoryJson & { parent_id?: string | null; description?: string; sort_order?: number; attributes?: any[] };
import { FileSpreadsheet, CheckCircle2, ArrowRight } from "lucide-react";

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

  // Upload sheet state
  const [showUpload, setShowUpload] = useState(false);
  const [uploadStep, setUploadStep] = useState<1 | 2 | 3 | 4>(1);
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

  // Save all categories back to Storage
  const saveAll = async (cats: Category[]) => {
    if (!workspace) return;
    const jsons: CategoryJson[] = cats.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description,
      parentId: c.parent_id || null,
      sortOrder: c.sort_order,
      attributes: c.attributes,
    }));
    await saveCategoriesJson(workspace.id, jsons);
    setCategories(cats);
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
      await saveAll(updated);
      setShowForm(false);
    } catch (err: any) {
      setFormError(err?.message || "Failed to save");
    } finally {
      setFormLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!workspace || !confirm("Delete this category? Products in it will become uncategorized.")) return;
    try {
      const updated = categories.filter((c) => c.id !== id);
      await saveAll(updated);
      if (selected === id) setSelected(null);
    } catch (err: any) {
      alert(err?.message || "Failed to delete");
    }
  };

  function renderNode(node: TreeNode, depth = 0) {
    const isExpanded = expanded.has(node.id);
    const isSelected = selected === node.id;
    const hasChildren = node.children.length > 0;
    const highlight = search && node.name.toLowerCase().includes(search.toLowerCase());

    return (
      <div key={node.id}>
        <button
          onClick={() => {
            setSelected(node.id);
            if (hasChildren) toggleExpand(node.id);
          }}
          className={`w-full flex items-center gap-2 px-3 py-2 text-xs rounded-lg transition-colors ${
            isSelected ? "bg-primary/10 text-primary" : "hover:bg-muted"
          }`}
          style={{ paddingLeft: `${12 + depth * 20}px` }}
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
        // Auto-detect columns
        for (const col of columns) {
          const l = col.toLowerCase();
          if (l === "name" || l.includes("category") || l.includes("nom")) setNameColumn(col);
          else if (l.includes("desc")) setDescColumn(col);
          else if (l.includes("parent")) setParentColumn(col);
        }
        if (!nameColumn && columns.length > 0) setNameColumn(columns[0]);
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
      // Build categories from rows
      const newCats: Category[] = [];
      let skipped = 0;
      const existingNames = new Set(categories.map((c) => c.name.toLowerCase()));

      for (const row of parsedSheet.rows) {
        const name = (row[nameColumn] || "").trim();
        if (!name) { skipped++; continue; }
        if (existingNames.has(name.toLowerCase())) { skipped++; continue; }
        existingNames.add(name.toLowerCase());

        const slug = name.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").slice(0, 48);
        const desc = descColumn ? (row[descColumn] || "").trim() : "";
        newCats.push({ id: crypto.randomUUID(), name, slug, description: desc || undefined, parentId: null, parent_id: null });
      }
      setUploadProgress(60);

      // Save merged categories to Storage
      const merged = [...categories, ...newCats];
      await saveAll(merged);
      setUploadProgress(100);

      setUploadResult({ imported: newCats.length, skipped });
      setUploadStep(4);
    } catch (err: any) {
      alert(err?.message || "Import failed");
    } finally {
      setUploading(false);
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
          <Card className="p-2 min-h-[300px]">
            {filteredTree.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2">
                <FolderTree className="h-8 w-8 text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground">
                  {search ? "No categories match your search" : "No categories yet"}
                </p>
              </div>
            ) : (
              filteredTree.map((node) => renderNode(node))
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
                    <p className="text-[10px] text-muted-foreground mt-1">.xlsx, .xls, .csv — must have a &quot;name&quot; column</p>
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

                  {/* Column mapping */}
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label className="text-[10px] font-medium text-muted-foreground uppercase">Name Column *</Label>
                      <select value={nameColumn} onChange={(e) => setNameColumn(e.target.value)} className="w-full h-8 px-2.5 text-xs rounded border bg-background mt-1">
                        {parsedSheet.columns.map((col) => <option key={col} value={col}>{col}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label className="text-[10px] font-medium text-muted-foreground uppercase">Description Column</Label>
                      <select value={descColumn} onChange={(e) => setDescColumn(e.target.value)} className="w-full h-8 px-2.5 text-xs rounded border bg-background mt-1">
                        <option value="">— None —</option>
                        {parsedSheet.columns.map((col) => <option key={col} value={col}>{col}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label className="text-[10px] font-medium text-muted-foreground uppercase">Parent Column</Label>
                      <select value={parentColumn} onChange={(e) => setParentColumn(e.target.value)} className="w-full h-8 px-2.5 text-xs rounded border bg-background mt-1">
                        <option value="">— None —</option>
                        {parsedSheet.columns.map((col) => <option key={col} value={col}>{col}</option>)}
                      </select>
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
                  <div className="p-4 rounded-lg bg-muted/30 border space-y-2 text-xs">
                    <div className="flex justify-between"><span className="text-muted-foreground">File</span><span className="font-medium">{uploadFile?.name}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Total rows</span><span className="font-medium">{parsedSheet.rows.length}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Name column</span><span className="font-medium">{nameColumn}</span></div>
                    {descColumn && <div className="flex justify-between"><span className="text-muted-foreground">Description column</span><span className="font-medium">{descColumn}</span></div>}
                    <div className="flex justify-between"><span className="text-muted-foreground">Existing categories</span><span className="font-medium">{categories.length}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Duplicates will be</span><span className="font-medium text-amber-600">Skipped</span></div>
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
    </div>
  );
}
