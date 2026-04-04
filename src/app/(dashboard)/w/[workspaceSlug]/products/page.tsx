"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Package,
  Search,
  Upload,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Trash2,
  X,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useWorkspaceContext } from "../layout";
import { useRole } from "@/hooks/use-role";
import { loadProductsJson, saveProductsJson, type MasterProductJson } from "@/lib/storage-helpers";

const PAGE_SIZES = [25, 50, 100];

export default function ProductsPage() {
  const params = useParams();
  const slug = params.workspaceSlug as string;
  const { workspace, role } = useWorkspaceContext();
  const permissions = useRole(role);

  const [allProducts, setAllProducts] = useState<MasterProductJson[]>([]);
  const [products, setProducts] = useState<MasterProductJson[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deletingAll, setDeletingAll] = useState(false);

  // Dynamically extract ALL unique column names from products data
  const dataColumns = useMemo(() => {
    const colSet = new Set<string>();
    for (const p of allProducts) {
      if (p.data) {
        for (const key of Object.keys(p.data)) {
          colSet.add(key);
        }
      }
    }
    return Array.from(colSet);
  }, [allProducts]);

  const totalColSpan = dataColumns.length + (permissions.canEdit ? 1 : 0);

  // Load all products + categories from Storage once
  const loadAll = async () => {
    if (!workspace) return;
    setLoading(true);
    try {
      const prods = await loadProductsJson(workspace.id);
      setAllProducts(prods);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [workspace]);

  // Client-side filter + paginate
  useEffect(() => {
    let filtered = [...allProducts];
    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter((p) =>
        p.sku.toLowerCase().includes(s) ||
        Object.values(p.data || {}).some((v) => String(v).toLowerCase().includes(s))
      );
    }
    setTotal(filtered.length);
    const start = (page - 1) * pageSize;
    setProducts(filtered.slice(start, start + pageSize));
  }, [allProducts, search, page, pageSize]);

  const totalPages = Math.ceil(total / pageSize);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === products.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(products.map((p) => p.sku)));
    }
  };

  const handleDeleteAll = async () => {
    if (!workspace || deleteConfirmText !== "delete") return;
    setDeletingAll(true);
    try {
      await saveProductsJson(workspace.id, []);
      setAllProducts([]);
      setShowDeleteAll(false);
      setDeleteConfirmText("");
      setSelected(new Set());
      setPage(1);
    } catch (err: any) {
      alert(err?.message || "Failed to delete all products");
    } finally {
      setDeletingAll(false);
    }
  };

  const handleBulkDelete = async () => {
    if (!workspace || !confirm(`Delete ${selected.size} products? This cannot be undone.`)) return;
    try {
      const remaining = allProducts.filter((p) => !selected.has(p.sku));
      await saveProductsJson(workspace.id, remaining);
      setAllProducts(remaining);
      setSelected(new Set());
    } catch (err: any) {
      alert(err?.message || "Failed to delete");
    }
  };

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Package className="h-5 w-5" /> Products
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {total} product{total !== 1 && "s"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {permissions.canAdmin && total > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
              onClick={() => setShowDeleteAll(true)}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete All
            </Button>
          )}
          {permissions.canUpload && (
            <Link href={`/w/${slug}/products/upload`}>
              <Button size="sm" className="gap-1.5 text-xs">
                <Upload className="h-3.5 w-3.5" /> Upload Products
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
          <Input
            placeholder="Search across all columns..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9 h-9 text-xs"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      {/* Bulk Actions */}
      {selected.size > 0 && permissions.canEdit && (
        <div className="flex items-center gap-3 p-2 rounded-lg bg-muted/50 border">
          <span className="text-xs font-medium">{selected.size} selected</span>
          <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 text-destructive" onClick={handleBulkDelete}>
            <Trash2 className="h-3 w-3" /> Delete
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {/* Table */}
      <Card>
        <div className="overflow-x-auto max-h-[calc(100vh-280px)]">
          <table className="w-max min-w-full">
            <thead className="sticky top-0 z-20">
              <tr className="border-b bg-muted/80 backdrop-blur-sm">
                {permissions.canEdit && (
                  <th className="w-10 px-3 py-3 sticky left-0 bg-muted/80 z-30">
                    <input
                      type="checkbox"
                      checked={products.length > 0 && selected.size === products.length}
                      onChange={toggleSelectAll}
                      className="rounded"
                    />
                  </th>
                )}
                {dataColumns.map((col) => (
                  <th
                    key={col}
                    className="text-left px-4 py-3 text-[10px] font-semibold text-muted-foreground uppercase whitespace-nowrap min-w-[140px]"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={totalColSpan} className="text-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mx-auto" />
                  </td>
                </tr>
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={totalColSpan} className="text-center py-12">
                    <Package className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">No products found</p>
                  </td>
                </tr>
              ) : (
                products.map((p, idx) => (
                  <tr key={`${p.sku}-${idx}`} className="border-b last:border-0 hover:bg-muted/20">
                    {permissions.canEdit && (
                      <td className="w-10 px-3 py-3 sticky left-0 bg-background z-10">
                        <input
                          type="checkbox"
                          checked={selected.has(p.sku)}
                          onChange={() => toggleSelect(p.sku)}
                          className="rounded"
                        />
                      </td>
                    )}
                    {dataColumns.map((col) => (
                      <td key={col} className="px-4 py-3 text-xs whitespace-nowrap max-w-[250px] truncate">
                        {p.data?.[col] ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                className="h-7 px-1.5 text-xs rounded border bg-background"
              >
                {PAGE_SIZES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <span className="ml-2">
                {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)} of {total}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="text-xs px-2">{page} / {totalPages || 1}</span>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </Card>
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
                <h3 className="font-semibold text-sm">Delete all products</h3>
                <p className="text-xs text-muted-foreground">This action is permanent and cannot be undone</p>
              </div>
            </div>

            <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3 space-y-1">
              <p className="text-xs text-destructive font-medium">Warning</p>
              <p className="text-xs text-muted-foreground">
                You are about to permanently delete <strong className="text-foreground">{total} product{total !== 1 && "s"}</strong> from this workspace. All product data, including SKUs, prices, and metadata will be lost forever.
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
                {deletingAll ? "Deleting..." : "Delete All Products"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
