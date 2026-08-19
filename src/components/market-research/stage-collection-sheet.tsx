"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  ExternalLink,
  Filter,
  Layers,
  Loader2,
  Lock,
  Package,
  Search,
  ShieldCheck,
  Sparkles,
  Store,
  Tag,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatUsd } from "./mock-data";
import {
  USD_PER_COLLECTION,
  type MarketResearchProduct,
  type ProposedCollection,
} from "./workspace-data";
import { cn } from "@/lib/utils";
import { FuturisticAiLoader } from "./futuristic-ai-loader";

export function StageCollectionSheet({
  collections,
  products = [],
  loading,
  selectedIds,
  onChangeSelected,
  paid,
  onStart,
  onPushToStore,
  walletBalance = null,
  walletHref,
  pushing = false,
}: {
  collections: ProposedCollection[];
  products?: MarketResearchProduct[];
  loading: boolean;
  selectedIds: string[];
  onChangeSelected: (ids: string[]) => void;
  paid: boolean;
  onStart: () => void;
  onPushToStore?: (selectedIds: string[]) => Promise<void> | void;
  walletBalance?: number | null;
  walletHref?: string;
  pushing?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<"collections" | "products">("collections");
  const [activeModalCollection, setActiveModalCollection] = useState<ProposedCollection | null>(null);
  const [activeModalProduct, setActiveModalProduct] = useState<{
    product: MarketResearchProduct;
    type: "candidates" | "assigned";
  } | null>(null);
  const [confirmPushOpen, setConfirmPushOpen] = useState(false);

  // Collections sheet filters
  const [searchQuery, setSearchQuery] = useState("");
  const [minVolume, setMinVolume] = useState(0);
  const [maxKd, setMaxKd] = useState(100);
  const [minProducts, setMinProducts] = useState(0);

  // Products sheet filters
  const [productSearch, setProductSearch] = useState("");

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  // Product map by ID for fast lookup
  const productMap = useMemo(() => {
    const map = new Map<string, MarketResearchProduct>();
    for (const p of products) {
      map.set(p.id, p);
    }
    return map;
  }, [products]);

  // Reverse index: productId -> list of matching ProposedCollection (AI Curated / Assigned)
  const collectionsByProductId = useMemo(() => {
    const map = new Map<
      string,
      Array<{ collection: ProposedCollection; score: number; rationale?: string }>
    >();
    for (const col of collections) {
      const matchMap = new Map<string, { score: number; rationale?: string }>();
      if (Array.isArray(col.productMatches)) {
        for (const m of col.productMatches) {
          matchMap.set(m.productId, { score: m.score, rationale: m.rationale });
        }
      }
      const pids = col.matchedProductIds ?? Array.from(matchMap.keys());
      for (const pid of pids) {
        const list = map.get(pid) ?? [];
        const item = matchMap.get(pid);
        list.push({
          collection: col,
          score: item?.score ?? 0.85,
          rationale: item?.rationale,
        });
        map.set(pid, list);
      }
    }
    return map;
  }, [collections]);

  // Reverse index for ALL Semantic Candidates (Vector Cosine Embedding Matches):
  // productId -> list of { collection: ProposedCollection; score: number }
  const semanticCandidatesByProductId = useMemo(() => {
    const map = new Map<
      string,
      Array<{ collection: ProposedCollection; score: number }>
    >();
    for (const col of collections) {
      const candidateList =
        Array.isArray(col.candidateMatches) && col.candidateMatches.length > 0
          ? col.candidateMatches
          : (col.productMatches ?? []);
      for (const cand of candidateList) {
        const list = map.get(cand.productId) ?? [];
        list.push({
          collection: col,
          score: cand.score,
        });
        map.set(cand.productId, list);
      }
    }
    // Sort each product's candidate collections by similarity score descending
    for (const list of map.values()) {
      list.sort((a, b) => b.score - a.score);
    }
    return map;
  }, [collections]);

  const visibleCollections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return collections.filter((row) => {
      if (row.volume < minVolume) return false;
      if (row.difficulty > maxKd) return false;
      if (row.productCount < minProducts) return false;
      if (q) {
        const matchName = row.name.toLowerCase().includes(q);
        const matchHead = row.headKeyword.toLowerCase().includes(q);
        const matchNiche = row.parentNiche.toLowerCase().includes(q);
        if (!matchName && !matchHead && !matchNiche) return false;
      }
      return true;
    });
  }, [collections, minVolume, maxKd, minProducts, searchQuery]);

  const visibleProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => {
      const matchTitle = (p.title || "").toLowerCase().includes(q);
      const matchVendor = (p.vendor || "").toLowerCase().includes(q);
      const matchTags = (p.tags || []).some((t) => t.toLowerCase().includes(q));
      const matchedCols = (collectionsByProductId.get(p.id) ?? []).some((c) =>
        c.collection.name.toLowerCase().includes(q)
      );
      const matchedCandidates = (semanticCandidatesByProductId.get(p.id) ?? []).some((c) =>
        c.collection.name.toLowerCase().includes(q)
      );
      return matchTitle || matchVendor || matchTags || matchedCols || matchedCandidates;
    });
  }, [products, productSearch, collectionsByProductId, semanticCandidatesByProductId]);

  const toggleSelect = (id: string) => {
    if (paid) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChangeSelected([...next]);
  };

  const toggleSelectAll = () => {
    if (paid) return;
    if (selected.size === visibleCollections.length && visibleCollections.length > 0) {
      onChangeSelected([]);
    } else {
      onChangeSelected(visibleCollections.map((c) => c.id));
    }
  };

  // Products matching the opened modal collection
  const modalMatchingProducts = useMemo(() => {
    if (!activeModalCollection) return [];
    const matchMap = new Map<string, { score: number; rationale?: string }>();
    if (Array.isArray(activeModalCollection.productMatches)) {
      for (const m of activeModalCollection.productMatches) {
        matchMap.set(m.productId, { score: m.score, rationale: m.rationale });
      }
    }

    const matchedIds =
      activeModalCollection.matchedProductIds ?? Array.from(matchMap.keys());
    const result: Array<{
      product: MarketResearchProduct;
      score: number;
      rationale?: string;
    }> = [];

    for (const pid of matchedIds) {
      const p = productMap.get(pid);
      if (p) {
        const item = matchMap.get(pid);
        result.push({
          product: p,
          score: item?.score ?? 0.85,
          rationale: item?.rationale,
        });
      }
    }

    result.sort((a, b) => b.score - a.score);
    return result;
  }, [activeModalCollection, productMap]);

  // Collections matching the opened modal product (either candidates or assigned)
  const modalProductCollections = useMemo(() => {
    if (!activeModalProduct) return [];
    if (activeModalProduct.type === "assigned") {
      return collectionsByProductId.get(activeModalProduct.product.id) ?? [];
    }
    return (semanticCandidatesByProductId.get(activeModalProduct.product.id) ?? []).map(
      (item) => ({
        ...item,
        rationale: undefined,
      })
    );
  }, [activeModalProduct, collectionsByProductId, semanticCandidatesByProductId]);

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm font-medium">Clustering and semantic product matching…</p>
        <p className="max-w-sm text-center text-[11px] text-muted-foreground">
          Gemini 3.7 Flash is clustering category keywords and calculating cosine
          similarity with your catalog products.
        </p>
      </div>
    );
  }

  if (pushing) {
    return (
      <FuturisticAiLoader
        title="Pushing Collections to Storefront…"
        subtitle={`Deploying ${selected.size} verified category collections to your store catalog and linking matched products.`}
        durationMs={3200}
      />
    );
  }

  const selectedCollectionsList = visibleCollections.filter((c) => selected.has(c.id));
  const pushTotalCost = selected.size * USD_PER_COLLECTION;
  const canAffordPush = walletBalance == null || walletBalance >= pushTotalCost;
  const remainingWalletBalance =
    walletBalance != null ? walletBalance - pushTotalCost : null;

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col gap-3">
      {/* Top Bar Header & Dual-Sheet Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold tracking-tight">
              Collection Discovery & Taxonomy
            </h2>
            <Badge
              variant="outline"
              className="bg-primary/10 text-primary border-primary/25 text-[10px] font-medium"
            >
              Stage 5
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {collections.length} commercial collection opportunities discovered ·{" "}
            {products.length} products analyzed. Matching is free.
          </p>
        </div>

        {/* Dual-Sheet View Switcher */}
        <div className="flex items-center rounded-xl border border-border/70 bg-card p-1 shadow-xs">
          <Button
            size="sm"
            variant={activeTab === "collections" ? "default" : "ghost"}
            onClick={() => setActiveTab("collections")}
            className={cn(
              "h-7 text-xs font-medium gap-1.5 px-3 rounded-lg transition-all",
              activeTab === "collections"
                ? "shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Layers className="h-3.5 w-3.5" />
            Collections Sheet ({collections.length})
          </Button>
          <Button
            size="sm"
            variant={activeTab === "products" ? "default" : "ghost"}
            onClick={() => setActiveTab("products")}
            className={cn(
              "h-7 text-xs font-medium gap-1.5 px-3 rounded-lg transition-all",
              activeTab === "products"
                ? "shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Package className="h-3.5 w-3.5" />
            Products Sheet ({products.length})
          </Button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: COLLECTIONS SHEET                                                  */}
      {/* ========================================================================= */}
      {activeTab === "collections" && (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-card px-3 py-2 shrink-0">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Filter collections by name or keyword…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              Min volume
              <Input
                type="number"
                min={0}
                value={minVolume}
                onChange={(e) => setMinVolume(Number(e.target.value) || 0)}
                className="h-8 w-[90px] text-xs"
              />
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              Max KD
              <Input
                type="number"
                min={0}
                max={100}
                value={maxKd}
                onChange={(e) => setMaxKd(Number(e.target.value) || 0)}
                className="h-8 w-[72px] text-xs"
              />
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              Min products
              <Input
                type="number"
                min={0}
                value={minProducts}
                onChange={(e) => setMinProducts(Number(e.target.value) || 0)}
                className="h-8 w-[72px] text-xs"
              />
            </label>
          </div>

          {/* Collections Table */}
          <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border/70 bg-card shadow-xs">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-b border-border/70">
                  <TableHead className="w-12 px-3">
                    <button
                      type="button"
                      onClick={toggleSelectAll}
                      disabled={paid}
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded border transition-colors",
                        paid ? "cursor-not-allowed opacity-75" : "",
                        selected.size > 0 && selected.size === visibleCollections.length
                          ? "border-primary bg-primary text-primary-foreground"
                          : selected.size > 0
                          ? "border-primary bg-primary/40 text-primary-foreground"
                          : "border-border hover:border-primary/60"
                      )}
                    >
                      {selected.size > 0 ? (
                        <Check className="h-3 w-3 stroke-[3]" />
                      ) : null}
                    </button>
                  </TableHead>
                  <TableHead className="text-xs font-semibold py-3 px-4">Collection Title</TableHead>
                  <TableHead className="text-xs font-semibold text-right py-3 px-4 w-32">Search Volume</TableHead>
                  <TableHead className="text-xs font-semibold text-right py-3 px-4 w-28">KD</TableHead>
                  <TableHead className="text-xs font-semibold text-center py-3 px-4 w-40">Matched Products</TableHead>
                  <TableHead className="text-xs font-semibold text-center py-3 px-4 w-28">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleCollections.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-36 text-center text-xs text-muted-foreground">
                      No collections match the current filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  visibleCollections.map((row) => {
                    const on = selected.has(row.id);
                    return (
                      <TableRow
                        key={row.id}
                        className={cn(
                          paid
                            ? "cursor-default border-b border-border/40"
                            : "cursor-pointer transition-colors border-b border-border/40",
                          on ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/40"
                        )}
                        onClick={() => {
                          if (!paid) toggleSelect(row.id);
                        }}
                      >
                        <TableCell className="px-3 py-3.5" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => toggleSelect(row.id)}
                            disabled={paid}
                            className={cn(
                              "flex h-4 w-4 items-center justify-center rounded border transition-colors",
                              paid ? "cursor-not-allowed opacity-75" : "",
                              on
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border hover:border-primary/60"
                            )}
                          >
                            {on ? <Check className="h-3 w-3 stroke-[3]" /> : null}
                          </button>
                        </TableCell>
                        <TableCell className="py-3.5 px-4">
                          <div className="flex items-center gap-2">
                            <Sparkles className="h-4 w-4 text-primary shrink-0" />
                            <span className="text-sm font-semibold text-foreground">{row.name}</span>
                          </div>
                          <div className="text-[11px] font-normal text-muted-foreground mt-0.5 pl-6">
                            {row.parentNiche}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm tabular-nums text-right font-semibold py-3.5 px-4 text-foreground">
                          {row.volume.toLocaleString("en-US")}
                        </TableCell>
                        <TableCell className="text-xs tabular-nums text-right py-3.5 px-4">
                          <span
                            className={cn(
                              "inline-block px-2 py-0.5 rounded-md text-[11px] font-semibold",
                              row.difficulty < 30
                                ? "text-emerald-700 bg-emerald-500/15 dark:text-emerald-400 border border-emerald-500/20"
                                : row.difficulty < 60
                                ? "text-amber-700 bg-amber-500/15 dark:text-amber-400 border border-amber-500/20"
                                : "text-rose-700 bg-rose-500/15 dark:text-rose-400 border border-rose-500/20"
                            )}
                          >
                            {row.difficulty}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-center py-3.5 px-4" onClick={(e) => e.stopPropagation()}>
                          {/* Interactive Clickable Product Cell */}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setActiveModalCollection(row)}
                            className="h-7 gap-1.5 px-3 text-xs font-medium border-primary/30 bg-primary/5 hover:bg-primary/15 text-primary transition-all shadow-2xs rounded-lg"
                          >
                            <Package className="h-3.5 w-3.5 shrink-0" />
                            <span>{row.productCount} Products</span>
                          </Button>
                        </TableCell>
                        <TableCell className="text-center py-3.5 px-4">
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[11px] font-semibold px-2.5 py-0.5 rounded-md",
                              paid
                                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                                : "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30"
                            )}
                          >
                            {paid ? "Pushed" : "New"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: PRODUCTS SHEET (العكس تماماً)                                        */}
      {/* ========================================================================= */}
      {activeTab === "products" && (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {/* Product Filters */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-card px-3 py-2 shrink-0">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search products by title, vendor, tags or assigned collection…"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {visibleProducts.length}
              </span>{" "}
              of {products.length} products displayed
            </div>
          </div>

          {/* Products Table */}
          <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border/70 bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-14 text-xs">Image</TableHead>
                  <TableHead className="text-xs">Product Details</TableHead>
                  <TableHead className="text-xs text-right">Price</TableHead>
                  <TableHead className="text-xs min-w-[240px]">
                    Semantic Candidates (Embedding)
                  </TableHead>
                  <TableHead className="text-xs text-right min-w-[240px]">
                    Assigned Collections (New)
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleProducts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-32 text-center text-xs text-muted-foreground">
                      No products found matching your search.
                    </TableCell>
                  </TableRow>
                ) : (
                  visibleProducts.map((prod) => {
                    const candidates = semanticCandidatesByProductId.get(prod.id) ?? [];
                    const assigned = collectionsByProductId.get(prod.id) ?? [];

                    const displayCandidates = candidates.slice(0, 2);
                    const remainingCandidates = candidates.length - 2;

                    const displayAssigned = assigned.slice(0, 2);
                    const remainingAssigned = assigned.length - 2;

                    return (
                      <TableRow key={prod.id} className="hover:bg-muted/40">
                        {/* Thumbnail */}
                        <TableCell className="py-2.5">
                          <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-border/70 bg-muted/40 flex items-center justify-center">
                            {prod.primaryImage ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={prod.primaryImage}
                                alt={prod.title}
                                className="h-full w-full object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <Package className="h-5 w-5 text-muted-foreground/40" />
                            )}
                          </div>
                        </TableCell>

                        {/* Title & Details */}
                        <TableCell className="py-2.5 max-w-xs">
                          <div className="text-xs font-semibold text-foreground line-clamp-1">
                            {prod.title}
                          </div>
                          {prod.shortDescription ? (
                            <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                              {prod.shortDescription}
                            </p>
                          ) : null}
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            {prod.vendor ? (
                              <span className="text-[10px] text-muted-foreground font-medium">
                                {prod.vendor}
                              </span>
                            ) : null}
                            {prod.attributes?.slice(0, 2).map((attr) => (
                              <span
                                key={attr.name}
                                className="inline-flex items-center text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground"
                              >
                                {attr.name}: {attr.value}
                              </span>
                            ))}
                          </div>
                        </TableCell>

                        {/* Price */}
                        <TableCell className="text-xs text-right tabular-nums font-semibold">
                          <div>{prod.price?.priceFormatted || "$0.00"}</div>
                          {prod.price?.compareAtPrice ? (
                            <span className="text-[10px] line-through text-muted-foreground font-normal">
                              ${prod.price.compareAtPrice.toFixed(2)}
                            </span>
                          ) : null}
                        </TableCell>

                        {/* Semantic Candidates (Embedding / Vector Cosine Matches) */}
                        <TableCell className="py-2.5">
                          {candidates.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-1.5 max-w-sm">
                              {displayCandidates.map(({ collection: col, score }) => (
                                <Badge
                                  key={col.id}
                                  variant="outline"
                                  className="h-auto min-h-5 gap-1 px-2 py-0.5 text-[10px] font-medium bg-teal-500/10 text-teal-800 dark:text-teal-300 border-teal-500/25 flex-wrap"
                                >
                                  <Sparkles className="h-2.5 w-2.5 text-teal-600 dark:text-teal-400 shrink-0" />
                                  <span>{col.name}</span>
                                  <span className="text-[9px] font-semibold opacity-80">
                                    {Math.round(score * 100)}%
                                  </span>
                                </Badge>
                              ))}
                              {remainingCandidates > 0 ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setActiveModalProduct({
                                      product: prod,
                                      type: "candidates",
                                    })
                                  }
                                  className="inline-flex items-center gap-1 rounded-md border border-teal-500/30 bg-teal-500/15 hover:bg-teal-500/25 px-1.5 py-0.5 text-[10px] font-semibold text-teal-800 dark:text-teal-200 transition-colors cursor-pointer shadow-2xs"
                                >
                                  <span>+{remainingCandidates} more</span>
                                </button>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-[11px] text-muted-foreground italic">
                              No candidates
                            </span>
                          )}
                        </TableCell>

                        {/* Assigned Proposed Collections (New / AI Curated) - Far Right */}
                        <TableCell className="py-2.5 text-right">
                          {assigned.length > 0 ? (
                            <div className="flex flex-wrap items-center justify-end gap-1.5 max-w-sm ml-auto">
                              {displayAssigned.map(({ collection: col, score, rationale }) => (
                                <Badge
                                  key={col.id}
                                  variant="outline"
                                  title={rationale || col.name}
                                  className="h-auto min-h-5 gap-1 px-2 py-0.5 text-[10px] font-medium bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-500/25 flex-wrap"
                                >
                                  <Sparkles className="h-2.5 w-2.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                  <span>{col.name}</span>
                                  <span className="text-[9px] font-semibold opacity-80">
                                    {Math.round(score * 100)}%
                                  </span>
                                </Badge>
                              ))}
                              {remainingAssigned > 0 ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setActiveModalProduct({
                                      product: prod,
                                      type: "assigned",
                                    })
                                  }
                                  className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/15 hover:bg-emerald-500/25 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 dark:text-emerald-200 transition-colors cursor-pointer shadow-2xs"
                                >
                                  <span>+{remainingAssigned} more</span>
                                </button>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-[11px] text-muted-foreground italic">
                              No collection match
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* BOTTOM ACTION BAR                                                         */}
      {/* ========================================================================= */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card px-4 py-3 shrink-0 shadow-xs">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <div>
            <strong className="font-semibold text-foreground">
              {selected.size}
            </strong>{" "}
            of {collections.length} collections selected
          </div>
          {paid ? (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Pushed to Store</span>
              </span>
            </>
          ) : selected.size > 0 ? (
            <>
              <span>·</span>
              <span className="font-medium text-foreground">
                ${USD_PER_COLLECTION.toFixed(2)} / collection
              </span>
              <span>·</span>
              <span className="font-bold text-primary">
                Total: {formatUsd(pushTotalCost)}
              </span>
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => setConfirmPushOpen(true)}
            disabled={selected.size === 0 || pushing || paid}
            className={cn(
              "h-8 gap-1.5 px-4 text-xs font-semibold shadow-xs transition-all",
              paid
                ? "bg-muted text-muted-foreground cursor-not-allowed border border-border/70 hover:bg-muted"
                : "bg-primary hover:bg-primary/90 text-primary-foreground"
            )}
          >
            {paid ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                <span>Pushed to Store</span>
              </>
            ) : (
              <>
                <Store className="h-3.5 w-3.5" />
                <span>Push to Store</span>
                <span className="opacity-90 font-mono">
                  ({formatUsd(pushTotalCost)})
                </span>
                <ArrowRight className="h-3.5 w-3.5 ml-0.5" />
              </>
            )}
          </Button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* MODAL POP-UP: CONFIRM STORE PUSH & WALLET DEDUCTION                      */}
      {/* ========================================================================= */}
      <Dialog open={confirmPushOpen} onOpenChange={setConfirmPushOpen}>
        <DialogContent className="max-w-lg p-0 overflow-hidden">
          <DialogHeader className="p-5 border-b border-border/70 bg-muted/20">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Store className="h-4 w-4" />
              </div>
              <DialogTitle className="text-base font-semibold">
                Confirm Storefront Push
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-muted-foreground mt-1">
              Deploy {selected.size} verified category collections to your store catalog.
              The amount is deducted directly from your workspace wallet.
            </DialogDescription>
          </DialogHeader>

          <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
            {/* Selected Collections Preview List */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                <span>Selected Collections ({selected.size})</span>
                <span>$5.00 each</span>
              </div>
              <div className="max-h-40 overflow-y-auto rounded-xl border border-border/70 bg-card p-2 space-y-1.5">
                {selectedCollectionsList.map((col) => (
                  <div
                    key={col.id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-muted/30 px-2.5 py-1 text-xs"
                  >
                    <span className="font-medium text-foreground truncate">
                      {col.name}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-muted-foreground">
                        {col.productCount} products
                      </span>
                      <Badge variant="outline" className="text-[10px] font-mono py-0">
                        $5.00
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Pricing & Wallet Calculation Card */}
            <div className="rounded-xl border border-border/70 bg-muted/30 p-3.5 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Current Wallet Balance</span>
                <span className="font-semibold text-foreground tabular-nums">
                  {walletBalance == null ? "—" : formatUsd(walletBalance)}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-border/50 pt-1.5">
                <span className="text-muted-foreground">
                  Total Push Cost ({selected.size} × $5.00)
                </span>
                <span className="font-bold text-destructive tabular-nums">
                  -{formatUsd(pushTotalCost)}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-border/50 pt-1.5">
                <span className="font-medium text-foreground">
                  Estimated Remaining Balance
                </span>
                <span className="font-bold text-primary tabular-nums">
                  {remainingWalletBalance != null
                    ? formatUsd(remainingWalletBalance)
                    : "—"}
                </span>
              </div>
            </div>

            {/* Insufficient Funds Warning Alert */}
            {!canAffordPush && walletBalance != null ? (
              <div className="flex flex-col gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>Not enough wallet balance</span>
                </div>
                <p className="text-[11px] leading-relaxed opacity-90">
                  You need {formatUsd(pushTotalCost)}, but your wallet currently has{" "}
                  {formatUsd(walletBalance)}. Please top up your wallet or select fewer collections.
                </p>
                {walletHref ? (
                  <div className="pt-1">
                    <Link href={walletHref} target="_blank">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/15"
                      >
                        <Wallet className="h-3.5 w-3.5" />
                        <span>Top Up Wallet</span>
                        <ExternalLink className="h-3 w-3" />
                      </Button>
                    </Link>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <DialogFooter className="p-4 border-t border-border/70 bg-muted/20 flex flex-row items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmPushOpen(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={selected.size === 0 || !canAffordPush}
              onClick={() => {
                setConfirmPushOpen(false);
                if (onPushToStore) {
                  onPushToStore(Array.from(selected));
                } else {
                  onStart();
                }
              }}
              className="text-xs font-semibold gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground shadow-xs"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Confirm & Push ({formatUsd(pushTotalCost)})</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ========================================================================= */}
      {/* MODAL POP-UP: PRODUCTS FOR ACTIVE COLLECTION                             */}
      {/* ========================================================================= */}
      <Dialog
        open={Boolean(activeModalCollection)}
        onOpenChange={(open) => {
          if (!open) setActiveModalCollection(null);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
          <DialogHeader className="p-4 border-b border-border/70 bg-muted/20 shrink-0">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <DialogTitle className="text-base font-semibold">
                {activeModalCollection?.name}
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
              <span>
                Head keyword:{" "}
                <code className="text-foreground font-mono bg-muted px-1.5 py-0.5 rounded">
                  {activeModalCollection?.headKeyword}
                </code>
              </span>
              <span>·</span>
              <span>
                Volume:{" "}
                <strong className="text-foreground">
                  {activeModalCollection?.volume.toLocaleString("en-US")}
                </strong>
              </span>
              <span>·</span>
              <span>
                Matched Products:{" "}
                <strong className="text-primary font-semibold">
                  {modalMatchingProducts.length}
                </strong>
              </span>
            </DialogDescription>
          </DialogHeader>

          {/* Modal Products List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
            {modalMatchingProducts.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                No matched products for this collection.
              </div>
            ) : (
              modalMatchingProducts.map(({ product: p, score, rationale }) => (
                <div
                  key={p.id}
                  className="flex items-start gap-3 rounded-xl border border-border/70 bg-card p-3 hover:border-primary/40 transition-colors shadow-xs"
                >
                  {/* Image */}
                  <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border/70 bg-muted/40 flex items-center justify-center">
                    {p.primaryImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.primaryImage}
                        alt={p.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Package className="h-6 w-6 text-muted-foreground/40" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="text-xs font-semibold text-foreground line-clamp-1">
                          {p.title}
                        </h4>
                        {p.shortDescription ? (
                          <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                            {p.shortDescription}
                          </p>
                        ) : null}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs font-bold text-foreground">
                          {p.price?.priceFormatted || "$0.00"}
                        </div>
                        <Badge
                          variant="outline"
                          className="mt-1 text-[9px] font-semibold bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/30"
                        >
                          {Math.round(score * 100)}% Match
                        </Badge>
                      </div>
                    </div>

                    {/* AI Validation Rationale */}
                    {rationale ? (
                      <div className="mt-1.5 flex items-center gap-1.5 rounded-md bg-primary/5 px-2 py-1 text-[10px] text-primary/90 border border-primary/15">
                        <Sparkles className="h-3 w-3 shrink-0 text-primary" />
                        <span className="line-clamp-1">{rationale}</span>
                      </div>
                    ) : null}

                    {/* Attributes */}
                    {p.attributes && p.attributes.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {p.attributes.map((attr) => (
                          <span
                            key={attr.name}
                            className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground font-medium"
                          >
                            {attr.name}: {attr.value}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ========================================================================= */}
      {/* MODAL POP-UP: COLLECTIONS FOR ACTIVE PRODUCT                             */}
      {/* ========================================================================= */}
      <Dialog
        open={Boolean(activeModalProduct)}
        onOpenChange={(open) => {
          if (!open) setActiveModalProduct(null);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
          <DialogHeader className="p-4 border-b border-border/70 bg-muted/20 shrink-0">
            <div className="flex items-center gap-3">
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border/70 bg-muted/40 flex items-center justify-center">
                {activeModalProduct?.product.primaryImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={activeModalProduct.product.primaryImage}
                    alt={activeModalProduct.product.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Package className="h-6 w-6 text-muted-foreground/40" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle className="text-sm font-semibold truncate max-w-md">
                    {activeModalProduct?.product.title}
                  </DialogTitle>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] font-semibold shrink-0",
                      activeModalProduct?.type === "assigned"
                        ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/30"
                        : "bg-teal-500/15 text-teal-800 dark:text-teal-300 border-teal-500/30"
                    )}
                  >
                    {activeModalProduct?.type === "assigned"
                      ? "AI Assigned Collections"
                      : "Semantic Candidates (Embedding)"}
                  </Badge>
                </div>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-2">
                  <span>
                    Price:{" "}
                    <strong className="text-foreground">
                      {activeModalProduct?.product.price?.priceFormatted || "$0.00"}
                    </strong>
                  </span>
                  <span>·</span>
                  <span>
                    Total Collections:{" "}
                    <strong className="text-primary font-semibold">
                      {modalProductCollections.length}
                    </strong>
                  </span>
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {/* Modal Collections List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
            {modalProductCollections.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                No matching collections for this product.
              </div>
            ) : (
              modalProductCollections.map(({ collection: col, score, rationale }) => (
                <div
                  key={col.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-border/70 bg-card p-3.5 hover:border-primary/40 transition-colors shadow-xs"
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs font-semibold text-foreground">
                        {col.name}
                      </h4>
                      <Badge
                        variant="outline"
                        className="text-[9px] font-medium bg-muted text-muted-foreground"
                      >
                        {col.parentNiche}
                      </Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-2">
                      <span>
                        Head Keyword:{" "}
                        <code className="text-foreground font-mono bg-muted px-1.5 py-0.5 rounded text-[10px]">
                          {col.headKeyword}
                        </code>
                      </span>
                      <span>·</span>
                      <span>
                        Search Volume:{" "}
                        <strong className="text-foreground">
                          {col.volume.toLocaleString("en-US")}
                        </strong>
                      </span>
                    </div>

                    {rationale ? (
                      <div className="mt-1.5 flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-800 dark:text-emerald-300 border border-emerald-500/20">
                        <Sparkles className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        <span className="line-clamp-2">{rationale}</span>
                      </div>
                    ) : null}
                  </div>

                  <div className="text-right shrink-0">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] font-semibold px-2 py-0.5",
                        activeModalProduct?.type === "assigned"
                          ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/30"
                          : "bg-teal-500/15 text-teal-800 dark:text-teal-300 border-teal-500/30"
                      )}
                    >
                      {Math.round(score * 100)}% Match
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
