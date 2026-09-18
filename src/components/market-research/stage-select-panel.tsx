"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  Loader2,
  Lock,
  Minus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  countProductsForCollections,
  formatProductCount,
  sumProductsForCollections,
  type MarketResearchProject,
  type MockCollection,
  type MockExcludedItem,
  type MockNiche,
  type MockSubcategory,
} from "./mock-data";
import { cn } from "@/lib/utils";

/** Default minimum SKUs recommended to dominate a niche or PLP in catalog
 *  scope — overridable per project via the `skuFloor`/`onChangeSkuFloor`
 *  persistent setting below. */
const MIN_SCOPE_SKUS = 100;

const EXCLUSION_LABEL: Record<MockExcludedItem["reason"], string> = {
  promotional: "Promotional",
  "attribute-only": "Attribute-only",
  duplicate: "Duplicate",
  empty: "Empty",
  unresolved: "Unresolved",
};

function belowSkuFloor(count: number, floor: number) {
  return count < floor;
}

function SkuFloorTooltip({
  count,
  floor,
  children,
}: {
  count: number;
  floor: number;
  children: ReactNode;
}) {
  if (!belowSkuFloor(count, floor)) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" className="max-w-[240px] text-balance">
        Does not have enough SKUs — fewer than {floor} products.
      </TooltipContent>
    </Tooltip>
  );
}

type StageSelectPanelProps = {
  project: MarketResearchProject;
  niches?: MockNiche[];
  /** Non-taxonomic PLPs the Stage 1 agent excluded — shown as a read-only,
   *  collapsed footer; never selectable, never counted. */
  excludedItems?: MockExcludedItem[];
  preparing?: boolean;
  onChangeSelection: (collectionIds: string[]) => void;
  /** Stage 1 result carried into this stage (receipt line). */
  lockedNicheCount?: number;
  showNext?: boolean;
  nextLabel?: string;
  nextDisabled?: boolean;
  onNext?: () => void;
  readOnly?: boolean;
  /**
   * Minimum SKUs a category/subcategory/PLP needs to be selectable —
   * a persistent per-project setting (default 100). Falls back to local
   * state when no `onChangeSkuFloor` is given (e.g. mock/demo usage).
   */
  skuFloor?: number;
  onChangeSkuFloor?: (value: number) => void;
};

/** Stage 2 — interactive catalog scope from Stage 1 niches. */
export function StageSelectPanel({
  project,
  niches,
  excludedItems,
  preparing = false,
  onChangeSelection,
  lockedNicheCount,
  showNext = false,
  nextLabel = "Next",
  nextDisabled = false,
  onNext,
  readOnly = false,
  skuFloor: skuFloorProp,
  onChangeSkuFloor,
}: StageSelectPanelProps) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [hintOpen, setHintOpen] = useState(false);
  const [excludedOpen, setExcludedOpen] = useState(false);
  // Uncontrolled fallback for callers that don't pass a persisted skuFloor.
  const [localSkuFloor, setLocalSkuFloor] = useState(MIN_SCOPE_SKUS);
  const skuFloor = skuFloorProp ?? localSkuFloor;
  const setSkuFloor = onChangeSkuFloor ?? setLocalSkuFloor;
  const activeNiches = useMemo(
    () => (Array.isArray(niches) ? niches : []),
    [niches]
  );
  const selected = useMemo(
    () => new Set(project.highlightedCollectionIds),
    [project.highlightedCollectionIds]
  );

  const visibleNiches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return activeNiches;
    return activeNiches
      .map((niche) => ({
        ...niche,
        collections: niche.name.toLowerCase().includes(q)
          ? niche.collections
          : niche.collections.filter((c) => c.name.toLowerCase().includes(q)),
      }))
      .filter((niche) => niche.collections.length > 0);
  }, [query, activeNiches]);

  /**
   * Accurate niche total = sum of every belonging PLP page's product count,
   * computed from the full (unfiltered) collection list — not the search-
   * narrowed list, and not a possibly stale `niche.productCount` value.
   */
  const nicheProductTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const niche of activeNiches) {
      const total = niche.collections.reduce(
        (sum, c) => sum + c.productCount,
        0
      );
      map.set(niche.id, total);
    }
    return map;
  }, [activeNiches]);

  const selectedLabels = useMemo(
    () =>
      activeNiches.flatMap((niche) =>
        niche.collections
          .filter((c) => selected.has(c.id))
          .map((c) => ({ id: c.id, niche: niche.name, name: c.name }))
      ),
    [selected, activeNiches]
  );
  const selectedProducts = countProductsForCollections(
    project.highlightedCollectionIds,
    activeNiches
  );
  const summedProducts = sumProductsForCollections(
    project.highlightedCollectionIds,
    activeNiches
  );
  const hasOverlap = summedProducts > selectedProducts;

  if (preparing) {
    return (
      <div className="flex h-full min-h-[320px] flex-col items-center justify-center px-4 py-10">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <div className="space-y-1">
            <h2 className="text-base font-semibold tracking-tight">
              Building catalog scope
            </h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              The agent is expanding the Stage 1 niches into collections on your
              store. Follow the conversation on the left — details appear here
              when ready.
            </p>
          </div>
        </div>
      </div>
    );
  }

  /** Selecting a thin PLP (< skuFloor) is blocked entirely — not clickable. */
  const toggleCollection = (id: string, productCount: number) => {
    if (readOnly || belowSkuFloor(productCount, skuFloor)) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChangeSelection(Array.from(next));
  };

  /** Chip "×" / "Clear all" always works, even for a legacy thin selection. */
  const removeCollection = (id: string) => {
    if (readOnly) return;
    const next = new Set(selected);
    next.delete(id);
    onChangeSelection(Array.from(next));
  };

  const nicheState = (niche: MockNiche) => {
    const ids = niche.collections.map((c) => c.id);
    const on = ids.filter((id) => selected.has(id)).length;
    if (on === 0) return "none" as const;
    if (on === ids.length) return "all" as const;
    return "some" as const;
  };

  /** Selecting a thin niche (< skuFloor across all its PLPs) is blocked entirely. */
  const toggleNiche = (niche: MockNiche, totalProductCount: number) => {
    if (readOnly || belowSkuFloor(totalProductCount, skuFloor)) return;
    const ids = niche.collections.map((c) => c.id);
    const next = new Set(selected);
    const allOn = ids.every((id) => next.has(id));
    if (allOn) ids.forEach((id) => next.delete(id));
    else ids.forEach((id) => next.add(id));
    onChangeSelection(Array.from(next));
  };

  /** Selecting a thin subcategory (< skuFloor across its own PLPs) is
   *  blocked entirely — same rule as a niche/category, one level deeper. */
  const toggleSubcategory = (ids: string[], totalProductCount: number) => {
    if (readOnly || belowSkuFloor(totalProductCount, skuFloor)) return;
    const next = new Set(selected);
    const allOn = ids.every((id) => next.has(id));
    if (allOn) ids.forEach((id) => next.delete(id));
    else ids.forEach((id) => next.add(id));
    onChangeSelection(Array.from(next));
  };

  /** One selectable PLP row — shared by the flat and nested (subcategory) layouts. */
  function renderCollectionRow(collection: MockCollection) {
    const isOn = selected.has(collection.id);
    const plpThin = belowSkuFloor(collection.productCount, skuFloor);
    return (
      <li key={collection.id}>
        <button
          type="button"
          onClick={() => toggleCollection(collection.id, collection.productCount)}
          disabled={readOnly || plpThin}
          aria-pressed={isOn}
          aria-label={
            plpThin ? `${collection.name} does not have enough SKUs to select` : undefined
          }
          className={cn(
            "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
            readOnly || plpThin ? "cursor-not-allowed" : "hover:bg-muted/40",
            plpThin && "bg-amber-500/[0.06] opacity-80",
            isOn && !plpThin && "bg-primary/5",
            isOn && plpThin && "bg-amber-500/10"
          )}
        >
          <SkuFloorTooltip count={collection.productCount} floor={skuFloor}>
            <span
              tabIndex={0}
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded border outline-none",
                plpThin &&
                  "ring-2 ring-amber-500/50 ring-offset-1 ring-offset-background",
                isOn
                  ? "border-primary bg-primary text-primary-foreground"
                  : plpThin
                    ? "border-amber-500 bg-amber-500/15"
                    : "border-muted-foreground/40 bg-background"
              )}
              aria-hidden
            >
              {isOn ? <Check className="h-3 w-3" /> : null}
            </span>
          </SkuFloorTooltip>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="text-sm truncate">{collection.name}</span>
              {collection.coversNiche ? (
                <span className="shrink-0 rounded-full border border-border/70 px-1.5 text-[9px] text-muted-foreground">
                  Covers niche
                </span>
              ) : null}
              {collection.kind === "brand" ? (
                <span className="shrink-0 rounded-full border border-border/70 px-1.5 text-[9px] text-muted-foreground">
                  Brand
                </span>
              ) : null}
            </span>
            {collection.description ? (
              <span className="block text-[11px] text-muted-foreground truncate">
                {collection.description}
              </span>
            ) : null}
            <span className="block text-[10px] text-muted-foreground/80 truncate">
              {collection.plpPath}
              {collection.lastSyncedLabel ? ` · ${collection.lastSyncedLabel}` : ""}
            </span>
          </span>
          <span
            className={cn(
              "text-xs tabular-nums shrink-0",
              plpThin ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground"
            )}
          >
            {formatProductCount(collection.productCount)}
          </span>
        </button>
      </li>
    );
  }

  /** One subcategory row — a checkbox rollup over its own PLPs, using the
   *  deduplicated `productCount` the taxonomy engine already computed. */
  function renderSubcategoryRow(niche: MockNiche, sub: MockSubcategory) {
    const subIds = sub.collections.map((c) => c.id);
    const on = subIds.filter((id) => selected.has(id)).length;
    const subState = on === 0 ? "none" : on === subIds.length ? "all" : "some";
    const subThin = belowSkuFloor(sub.productCount, skuFloor);
    const collapseKey = `${niche.id}::${sub.id}`;
    const subCollapsed = Boolean(collapsed[collapseKey]) && !query;

    return (
      <div key={sub.id} className="border-t border-border/40 first:border-t-0">
        <div
          className={cn(
            "flex items-center gap-2 px-3 py-2 pl-6",
            subThin ? "bg-amber-500/[0.05]" : "bg-muted/10"
          )}
        >
          <button
            type="button"
            onClick={() => toggleSubcategory(subIds, sub.productCount)}
            disabled={readOnly || subThin}
            className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-not-allowed disabled:opacity-70"
            aria-label={
              readOnly
                ? `${sub.name} collections`
                : subThin
                  ? `${sub.name} does not have enough SKUs to select`
                  : `Select all collections in ${sub.name}`
            }
            aria-pressed={subState === "all"}
          >
            <SkuFloorTooltip count={sub.productCount} floor={skuFloor}>
              <span
                tabIndex={0}
                className={cn(
                  "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border outline-none",
                  subThin &&
                    "ring-2 ring-amber-500/50 ring-offset-1 ring-offset-background",
                  subState === "all"
                    ? "border-primary bg-primary text-primary-foreground"
                    : subState === "some"
                      ? "border-primary bg-primary/15 text-primary"
                      : subThin
                        ? "border-amber-500 bg-amber-500/15"
                        : "border-muted-foreground/40 bg-background"
                )}
                aria-hidden
              >
                {subState === "all" ? (
                  <Check className="h-2.5 w-2.5" />
                ) : subState === "some" ? (
                  <Minus className="h-2.5 w-2.5" />
                ) : null}
              </span>
            </SkuFloorTooltip>
            <span className="text-xs font-medium truncate">{sub.name}</span>
          </button>
          <span
            className={cn(
              "text-[11px] tabular-nums shrink-0",
              subThin ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground"
            )}
          >
            {formatProductCount(sub.productCount)} products
          </span>
          <button
            type="button"
            onClick={() =>
              setCollapsed((prev) => ({ ...prev, [collapseKey]: !prev[collapseKey] }))
            }
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background/70 hover:text-foreground"
            aria-label={subCollapsed ? `Expand ${sub.name}` : `Collapse ${sub.name}`}
            aria-expanded={!subCollapsed}
          >
            <ChevronDown
              className={cn("h-3.5 w-3.5 transition-transform", subCollapsed && "-rotate-90")}
            />
          </button>
        </div>
        {subCollapsed ? null : (
          <ul className="divide-y divide-border/40 pl-4">
            {sub.collections.map((collection) => renderCollectionRow(collection))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 min-h-0 space-y-4 overflow-y-auto pb-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-semibold tracking-tight">
              Catalog scope
            </h2>
            <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              <Lock className="h-2.5 w-2.5" />
              {lockedNicheCount
                ? `Locked: ${lockedNicheCount} parent niche${lockedNicheCount === 1 ? "" : "s"}`
                : "From Stage 1 niches"}
            </span>

            <button
              type="button"
              onClick={() => setHintOpen(true)}
              className="relative inline-flex items-center gap-1.5 rounded-full border border-amber-500/50 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold text-amber-700 transition-colors hover:bg-amber-500/15 dark:text-amber-400"
              aria-label="Read the recommendation on how to pick what to dominate before selecting"
            >
              <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500/60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
              </span>
              <Lightbulb className="h-3 w-3" />
              Check this before you select
            </button>

            {/* Persistent per-project merchant setting — minimum SKUs a
                category/subcategory/PLP needs to be selectable below. */}
            {readOnly ? null : (
              <div className="ml-auto flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-2.5 py-1">
                <label className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                  Min SKUs to select
                  <input
                    type="number"
                    min={0}
                    step={10}
                    value={skuFloor}
                    onChange={(e) =>
                      setSkuFloor(Math.max(0, Number(e.target.value) || 0))
                    }
                    className="h-5 w-16 rounded border border-border/60 bg-background px-1.5 text-[10px] tabular-nums outline-none focus:border-primary"
                    aria-label="Minimum SKUs required to select a category, subcategory, or collection"
                  />
                </label>
                {skuFloor !== MIN_SCOPE_SKUS ? (
                  <button
                    type="button"
                    onClick={() => setSkuFloor(MIN_SCOPE_SKUS)}
                    className="text-[10px] font-medium text-primary underline"
                  >
                    reset
                  </button>
                ) : null}
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground max-w-2xl leading-relaxed">
            {readOnly
              ? "Locked after extract — this is the catalog scope that was used."
              : "Choose the collections to analyze as the source catalog — one, several, or a whole niche. You’re picking what to study next, not what to dominate."}
          </p>
          {readOnly ? null : (
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search collections…"
            className="h-8 max-w-[240px] text-xs"
            aria-label="Search collections"
          />
          )}
        </div>

        <div className="space-y-3">
          {visibleNiches.length === 0 ? (
            <p className="rounded-xl border border-border/70 bg-card px-4 py-6 text-center text-xs text-muted-foreground">
              No collections match “{query}”.
            </p>
          ) : (
            visibleNiches.map((niche) => {
              const state = nicheState(niche);
              const isCollapsed = Boolean(collapsed[niche.id]) && !query;
              const nicheTotal = nicheProductTotals.get(niche.id) ?? niche.productCount;
              const nicheThin = belowSkuFloor(nicheTotal, skuFloor);
              return (
                <div
                  key={niche.id}
                  className={cn(
                    "rounded-xl border bg-card overflow-hidden",
                    nicheThin ? "border-amber-500/40" : "border-border/70"
                  )}
                >
                  <div
                    className={cn(
                      "flex items-center gap-2 border-b px-3 py-2.5",
                      nicheThin
                        ? "border-amber-500/25 bg-amber-500/[0.08]"
                        : "border-border/60 bg-muted/30"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggleNiche(niche, nicheTotal)}
                      disabled={readOnly || nicheThin}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-not-allowed disabled:opacity-70"
                      aria-label={
                        readOnly
                          ? `${niche.name} collections`
                          : nicheThin
                            ? `${niche.name} does not have enough SKUs to select`
                            : `Select all collections in ${niche.name}`
                      }
                      aria-pressed={state === "all"}
                    >
                      <SkuFloorTooltip count={nicheTotal} floor={skuFloor}>
                        <span
                          tabIndex={0}
                          className={cn(
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded border outline-none",
                            nicheThin &&
                              "ring-2 ring-amber-500/50 ring-offset-1 ring-offset-background",
                            state === "all"
                              ? "border-primary bg-primary text-primary-foreground"
                              : state === "some"
                                ? "border-primary bg-primary/15 text-primary"
                                : nicheThin
                                  ? "border-amber-500 bg-amber-500/15"
                                  : "border-muted-foreground/40 bg-background"
                          )}
                          aria-hidden
                        >
                          {state === "all" ? (
                            <Check className="h-3 w-3" />
                          ) : state === "some" ? (
                            <Minus className="h-3 w-3" />
                          ) : null}
                        </span>
                      </SkuFloorTooltip>
                      <span className="text-sm font-semibold truncate">
                        {niche.name}
                      </span>
                    </button>
                    <span
                      className={cn(
                        "text-xs tabular-nums shrink-0",
                        nicheThin
                          ? "font-medium text-amber-700 dark:text-amber-400"
                          : "text-muted-foreground"
                      )}
                    >
                      {formatProductCount(nicheTotal)} products
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsed((prev) => ({
                          ...prev,
                          [niche.id]: !prev[niche.id],
                        }))
                      }
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background/70 hover:text-foreground"
                      aria-label={
                        isCollapsed
                          ? `Expand ${niche.name}`
                          : `Collapse ${niche.name}`
                      }
                      aria-expanded={!isCollapsed}
                    >
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 transition-transform",
                          isCollapsed && "-rotate-90"
                        )}
                      />
                    </button>
                  </div>
                  {isCollapsed ? null : niche.subcategories && niche.subcategories.length > 0 ? (
                    <div className="divide-y divide-border/50">
                      {niche.subcategories.map((sub) => renderSubcategoryRow(niche, sub))}
                    </div>
                  ) : (
                    <ul className="divide-y divide-border/50">
                      {niche.collections.map((collection) => renderCollectionRow(collection))}
                    </ul>
                  )}
                </div>
              );
            })
          )}
        </div>

        {excludedItems && excludedItems.length > 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 px-4 py-3">
            <button
              type="button"
              onClick={() => setExcludedOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-2 text-left"
              aria-expanded={excludedOpen}
            >
              <span className="text-xs font-medium text-muted-foreground">
                {excludedItems.length} PLP{excludedItems.length === 1 ? "" : "s"} excluded — not
                real product categories
              </span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                  !excludedOpen && "-rotate-90"
                )}
              />
            </button>
            {excludedOpen ? (
              <ul className="mt-2 space-y-1">
                {excludedItems.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground"
                  >
                    <span className="truncate">{item.name}</span>
                    <span className="shrink-0 rounded-full border border-border/60 px-1.5 py-0.5 text-[10px]">
                      {EXCLUSION_LABEL[item.reason]}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-border/70 bg-background/95 pt-3 mt-1 space-y-3">
        <div className="rounded-2xl border border-border/70 bg-muted/30 px-4 py-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium tracking-tight">
              {selectedLabels.length === 0
                ? "No collections selected"
                : `${selectedLabels.length} collection${selectedLabels.length === 1 ? "" : "s"} selected`}
            </p>
            {selectedLabels.length > 0 ? (
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {formatProductCount(selectedProducts)} unique products in scope
              </span>
            ) : null}
          </div>
          {hasOverlap ? (
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              These collections overlap — {formatProductCount(summedProducts)}{" "}
              product slots across them, but{" "}
              {formatProductCount(selectedProducts)} unique products. We count
              each product once.
            </p>
          ) : null}
          {selectedLabels.length === 0 ? (
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Select at least one collection before generating seed variations.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {selectedLabels.map((item) => (
                <span
                  key={item.id}
                  className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-2 py-0.5 text-[10px] font-medium"
                >
                  {item.name}
                  {readOnly ? null : (
                  <button
                    type="button"
                    onClick={() => removeCollection(item.id)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={`Remove ${item.name} from scope`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                  )}
                </span>
              ))}
              {readOnly ? null : (
              <button
                type="button"
                onClick={() => onChangeSelection([])}
                className="rounded-full px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground"
              >
                Clear all
              </button>
              )}
            </div>
          )}
        </div>

        {showNext && onNext && !readOnly ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium tracking-tight">
                Ready for broad seed variations?
              </p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Next opens Stage 3. The agent builds one broad-seed family per
                selected collection — no narrow styles or long-tails yet.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              className="gap-2 shrink-0 self-stretch sm:self-auto"
              disabled={nextDisabled || selectedLabels.length === 0}
              onClick={onNext}
            >
              {nextLabel}
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : null}
      </div>

      <Dialog open={hintOpen} onOpenChange={setHintOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              What does &ldquo;dominating a niche&rdquo; mean?
            </DialogTitle>
            <DialogDescription>
              Dominating means putting all your effort behind one specific,
              narrow niche until you own it in search — not spreading thin
              across many broad ones at once.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-sm">
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3.5 py-3">
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                Our recommendation
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Don&apos;t select a whole category at once. A category can mix
                several different search intents together — pick a single
                subcategory instead. It&apos;s narrower, so it&apos;s faster
                to rank for and easier to fully own than the broad category it
                lives in.
              </p>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold tracking-tight">
                Example
              </p>
              <div className="space-y-1.5 rounded-xl border border-border/70 bg-card px-3.5 py-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="rounded-full border border-border/70 px-2 py-0.5">
                    Eyewear
                  </span>
                  <span className="text-[10px]">category — several intents mixed</span>
                </div>
                <div className="flex items-center gap-1.5 pl-4 text-xs">
                  <ChevronRight className="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span className="rounded-full border border-amber-500/50 bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-700 dark:text-amber-400">
                    Women&apos;s Sunglasses
                  </span>
                  <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                    Best pick
                  </span>
                </div>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                If &ldquo;Women&apos;s Sunglasses&rdquo; has enough SKUs on its
                own, it&apos;s the strongest choice — it&apos;s a single,
                clear search intent. Select the subcategory, take every broad
                term generated for it in the next stage, and build your
                collections around it, instead of spreading the same effort
                across the whole Eyewear category.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
