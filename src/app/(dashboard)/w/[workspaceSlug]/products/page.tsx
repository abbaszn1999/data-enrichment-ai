"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
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
  Columns3,
  Database,
  FileSpreadsheet,
  Sparkles,
  ArrowRight,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspaceContext } from "../workspace-context";
import { PageLoader } from "@/components/brand/page-loader";
import { useRole } from "@/hooks/use-role";
import { loadProductsJson, saveProductsJson, type MasterProductJson } from "@/lib/storage-helpers";

const PAGE_SIZES = [10, 20, 50, 100];

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
  const [pageSize, setPageSize] = useState(10);
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

  const totalColSpan = Math.max(1, dataColumns.length + (permissions.canEdit ? 1 : 0));

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
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const safePage = Math.min(page, pages);
    if (safePage !== page) {
      setPage(safePage);
      return;
    }
    const start = (safePage - 1) * pageSize;
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
    <div className="autommerce-dashboard min-h-full bg-background [font-family:var(--brand-font)]">
      {/* Branded catalog masthead */}
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
                  <Package className="h-4 w-4" />
                </span>
                <span className="text-[9px] font-black uppercase tracking-[0.24em] text-[#400095] dark:text-[#F76D01]">
                  Catalog system
                </span>
              </div>
              <h1 className="text-3xl font-black tracking-[-0.035em] sm:text-4xl">
                Product intelligence,
                <span className="block bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095] bg-clip-text pb-1 text-transparent">
                  all in one view.
                </span>
              </h1>
              <p className="mt-2 max-w-xl text-xs leading-relaxed text-muted-foreground">
                The master catalog shared by every Autommerce agent. Search any field, inspect your
                enrichment output, and keep the data clean.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {permissions.canAdmin && total > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 gap-1.5 rounded-xl border-destructive/25 bg-background/70 px-3 text-[10px] text-destructive backdrop-blur hover:bg-destructive/10"
                  onClick={() => setShowDeleteAll(true)}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete all
                </Button>
              )}
              {permissions.canUpload && (
                <Link href={`/w/${slug}/products/upload`}>
                  <Button
                    size="sm"
                    className="h-9 gap-2 rounded-xl bg-[#400095] px-4 text-[10px] text-white shadow-[0_8px_24px_rgba(64,0,149,.2)] hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
                  >
                    <Upload className="h-3.5 w-3.5" /> Upload products
                    <ArrowRight className="h-3 w-3" />
                  </Button>
                </Link>
              )}
            </div>
          </motion.div>

          {/* Catalog pulse — real values, no invented health score. */}
          <div className="mt-7 grid max-w-2xl grid-cols-3 overflow-hidden rounded-2xl border border-border/60 bg-background/70 shadow-sm backdrop-blur">
            {[
              { label: "Products", value: allProducts.length, icon: Database },
              { label: "Data fields", value: dataColumns.length, icon: Columns3 },
              { label: "Pages", value: Math.max(totalPages, 1), icon: FileSpreadsheet },
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
          className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card p-3 shadow-sm sm:flex-row sm:items-center"
        >
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B358D] dark:text-[#C8A8D2]" />
            <Input
              placeholder="Search every field — SKU, title, brand, category…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="h-10 rounded-xl border-transparent bg-muted/60 pl-10 pr-10 text-xs shadow-none focus-visible:border-[#6B358D]/35 focus-visible:ring-[#6B358D]/10"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-background"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 px-2 sm:justify-end">
            <span className="text-[10px] text-muted-foreground">
              Showing <strong className="text-foreground">{total}</strong> result{total !== 1 && "s"}
            </span>
            {search && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#400095]/10 px-2 py-1 text-[9px] font-bold text-[#400095] dark:bg-[#F76D01]/10 dark:text-[#F76D01]">
                <Sparkles className="h-2.5 w-2.5" /> Filter active
              </span>
            )}
          </div>
        </motion.div>

        {/* Floating selection command */}
        <AnimatePresence>
          {selected.size > 0 && permissions.canEdit && (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#6B358D]/20 bg-[#400095]/[0.06] p-3"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#400095] text-white dark:bg-[#F76D01]">
                <Check className="h-3.5 w-3.5" />
              </span>
              <span className="text-xs font-bold">{selected.size} selected</span>
              <span className="h-4 w-px bg-border" />
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 rounded-lg border-destructive/25 text-[10px] text-destructive"
                onClick={handleBulkDelete}
              >
                <Trash2 className="h-3 w-3" /> Delete
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[10px]"
                onClick={() => setSelected(new Set())}
              >
                Clear selection
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Data surface */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.16 }}
          className="relative overflow-hidden rounded-[24px] border border-border/60 bg-card shadow-[0_15px_50px_rgba(15,23,42,.05)]"
        >
          <div className="h-1 bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095]" />
          <div className="max-h-[calc(100vh-330px)] overflow-auto custom-scrollbar">
            <table className="w-max min-w-full border-separate border-spacing-0">
              <thead className="sticky top-0 z-20">
                <tr className="bg-card/95 backdrop-blur-xl">
                  {permissions.canEdit && (
                    <th className="sticky left-0 z-30 w-12 border-b border-r border-border/60 bg-card/95 px-4 py-3.5">
                      <input
                        type="checkbox"
                        checked={products.length > 0 && selected.size === products.length}
                        onChange={toggleSelectAll}
                        className="h-3.5 w-3.5 rounded accent-[#400095] dark:accent-[#F76D01]"
                      />
                    </th>
                  )}
                  {dataColumns.map((col) => (
                    <th
                      key={col}
                      className="min-w-[155px] border-b border-border/60 px-4 py-3.5 text-left text-[9px] font-black uppercase tracking-[.16em] text-muted-foreground"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={totalColSpan} className="py-16">
                      <PageLoader size="sm" label="Loading catalog…" className="min-h-0 bg-transparent" />
                    </td>
                  </tr>
                ) : products.length === 0 ? (
                  <tr>
                    <td colSpan={totalColSpan} className="py-20 text-center">
                      <div className="mx-auto flex max-w-sm flex-col items-center">
                        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#F76D01]/15 to-[#400095]/15">
                          <Package className="h-7 w-7 text-[#6B358D]" />
                        </span>
                        <h3 className="mt-4 text-sm font-black">
                          {search ? "Nothing matches this search" : "Your catalog is ready for its first product"}
                        </h3>
                        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                          {search
                            ? "Try another SKU, title, brand or value."
                            : "Upload a file to create the catalog shared by your Autommerce agents."}
                        </p>
                        {permissions.canUpload && !search && (
                          <Link href={`/w/${slug}/products/upload`} className="mt-4">
                            <Button size="sm" className="h-8 gap-1.5 rounded-lg bg-[#400095] text-[10px] text-white dark:bg-[#F76D01]">
                              <Upload className="h-3 w-3" /> Upload products
                            </Button>
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  products.map((p, idx) => {
                    const isSelected = selected.has(p.sku);
                    return (
                      <motion.tr
                        key={`${p.sku}-${idx}`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: Math.min(idx * 0.018, 0.18) }}
                        className={`group ${isSelected ? "bg-[#400095]/[0.045] dark:bg-[#F76D01]/[0.05]" : "hover:bg-muted/30"}`}
                      >
                        {permissions.canEdit && (
                          <td className={`sticky left-0 z-10 w-12 border-b border-r border-border/50 px-4 py-3.5 ${isSelected ? "bg-[#F7F2FC] dark:bg-[#2a201d]" : "bg-card group-hover:bg-muted/30"}`}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(p.sku)}
                              className="h-3.5 w-3.5 rounded accent-[#400095] dark:accent-[#F76D01]"
                            />
                          </td>
                        )}
                        {dataColumns.map((col) => (
                          <td
                            key={col}
                            title={String(p.data?.[col] ?? "")}
                            className="max-w-[280px] truncate border-b border-border/50 px-4 py-3.5 text-[11px] whitespace-nowrap text-foreground/85"
                          >
                            {p.data?.[col] ?? <span className="text-muted-foreground/40">—</span>}
                          </td>
                        ))}
                      </motion.tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {total > 0 && (
            <div className="flex flex-col gap-3 border-t border-border/60 bg-muted/[0.18] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span>Rows</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="h-7 rounded-lg border border-border/60 bg-background px-2 text-[10px] font-bold outline-none"
                >
                  {PAGE_SIZES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <span className="ml-1 tabular-nums">
                  {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 w-8 rounded-lg p-0"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="min-w-20 text-center text-[10px] font-bold tabular-nums">
                  Page {page} of {totalPages || 1}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 w-8 rounded-lg p-0"
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </motion.section>
      </main>
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
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}
