"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Loader2,
  Lock,
  Minus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MOCK_NICHES,
  countProductsForCollections,
  formatProductCount,
  sumProductsForCollections,
  type MarketResearchProject,
  type MockNiche,
} from "./mock-data";
import { cn } from "@/lib/utils";

type StageSelectPanelProps = {
  project: MarketResearchProject;
  preparing?: boolean;
  onChangeSelection: (collectionIds: string[]) => void;
  /** Stage 1 result carried into this stage (receipt line). */
  lockedNicheCount?: number;
  showNext?: boolean;
  nextLabel?: string;
  nextDisabled?: boolean;
  onNext?: () => void;
  readOnly?: boolean;
};

/** Stage 2 — interactive catalog scope from Stage 1 niches. */
export function StageSelectPanel({
  project,
  preparing = false,
  onChangeSelection,
  lockedNicheCount,
  showNext = false,
  nextLabel = "Next",
  nextDisabled = false,
  onNext,
  readOnly = false,
}: StageSelectPanelProps) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const selected = useMemo(
    () => new Set(project.highlightedCollectionIds),
    [project.highlightedCollectionIds]
  );

  const visibleNiches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return MOCK_NICHES;
    return MOCK_NICHES.map((niche) => ({
      ...niche,
      collections: niche.name.toLowerCase().includes(q)
        ? niche.collections
        : niche.collections.filter((c) => c.name.toLowerCase().includes(q)),
    })).filter((niche) => niche.collections.length > 0);
  }, [query]);

  const selectedLabels = useMemo(
    () =>
      MOCK_NICHES.flatMap((niche) =>
        niche.collections
          .filter((c) => selected.has(c.id))
          .map((c) => ({ id: c.id, niche: niche.name, name: c.name }))
      ),
    [selected]
  );
  const selectedProducts = countProductsForCollections(
    project.highlightedCollectionIds
  );
  const summedProducts = sumProductsForCollections(
    project.highlightedCollectionIds
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

  const toggleCollection = (id: string) => {
    if (readOnly) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChangeSelection(Array.from(next));
  };

  const nicheState = (niche: MockNiche) => {
    const ids = niche.collections.map((c) => c.id);
    const on = ids.filter((id) => selected.has(id)).length;
    if (on === 0) return "none" as const;
    if (on === ids.length) return "all" as const;
    return "some" as const;
  };

  const toggleNiche = (niche: MockNiche) => {
    if (readOnly) return;
    const ids = niche.collections.map((c) => c.id);
    const next = new Set(selected);
    const allOn = ids.every((id) => next.has(id));
    if (allOn) ids.forEach((id) => next.delete(id));
    else ids.forEach((id) => next.add(id));
    onChangeSelection(Array.from(next));
  };

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
              return (
                <div
                  key={niche.id}
                  className="rounded-xl border border-border/70 bg-card overflow-hidden"
                >
                  <div className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => toggleNiche(niche)}
                      disabled={readOnly}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-default"
                      aria-label={
                        readOnly
                          ? `${niche.name} collections`
                          : `Select all collections in ${niche.name}`
                      }
                      aria-pressed={state === "all"}
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                          state === "all"
                            ? "border-primary bg-primary text-primary-foreground"
                            : state === "some"
                              ? "border-primary bg-primary/15 text-primary"
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
                      <span className="text-sm font-semibold truncate">
                        {niche.name}
                      </span>
                    </button>
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                      {formatProductCount(niche.productCount)} products
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
                  {isCollapsed ? null : (
                    <ul className="divide-y divide-border/50">
                      {niche.collections.map((collection) => {
                        const isOn = selected.has(collection.id);
                        return (
                          <li key={collection.id}>
                            <button
                              type="button"
                              onClick={() => toggleCollection(collection.id)}
                              disabled={readOnly}
                              aria-pressed={isOn}
                              className={cn(
                                "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
                                readOnly
                                  ? "cursor-default"
                                  : "hover:bg-muted/40",
                                isOn && "bg-primary/5"
                              )}
                            >
                              <span
                                className={cn(
                                  "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                                  isOn
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-muted-foreground/40 bg-background"
                                )}
                                aria-hidden
                              >
                                {isOn ? <Check className="h-3 w-3" /> : null}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-2">
                                  <span className="text-sm truncate">
                                    {collection.name}
                                  </span>
                                  {collection.coversNiche ? (
                                    <span className="shrink-0 rounded-full border border-border/70 px-1.5 text-[9px] text-muted-foreground">
                                      Covers niche
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
                                  {collection.lastSyncedLabel
                                    ? ` · ${collection.lastSyncedLabel}`
                                    : ""}
                                </span>
                              </span>
                              <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                                {formatProductCount(collection.productCount)}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })
          )}
        </div>
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
                    onClick={() => toggleCollection(item.id)}
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
    </div>
  );
}
