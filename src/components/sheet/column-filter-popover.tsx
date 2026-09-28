"use client";

/**
 * Excel-style column filter: a funnel icon that opens a search box, Select
 * all / Clear, and a checkbox list of that column's values with counts.
 * Shared by Catalog Intelligence, Product Gallery and the Visualizer.
 *
 * Rendered through a portal into document.body: every column header this
 * lives inside clips its own content with overflow-hidden/truncate (so long
 * names don't spill into neighboring columns), which would otherwise clip
 * this dropdown down to a sliver of its search box. A portal + fixed
 * positioning from the trigger's own screen position sidesteps that
 * entirely, the same way a native <select> or a Radix popover would.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, Filter, Search, X } from "lucide-react";
import type { FilterValueOption } from "@/lib/sheet/column-filters";

const POPOVER_WIDTH = 240;
const VIEWPORT_MARGIN = 8;

export function ColumnFilterButton({
  options,
  active,
  onApply,
  className,
  sortDirection,
  onSort,
}: {
  options: FilterValueOption[];
  /** Currently-applied values for this column; empty/undefined = no filter. */
  active: Set<string> | undefined;
  onApply: (values: Set<string>) => void;
  className?: string;
  /** Current sort applied to this column, if the sheet is sorted by it. */
  sortDirection?: "asc" | "desc" | false;
  /** Omit to hide the Sort A→Z / Z→A rows (e.g. a sheet with no sorting). */
  onSort?: (direction: "asc" | "desc") => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<Set<string>>(() => new Set(active ?? []));
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const isFiltered = !!active && active.size > 0;

  const filteredOptions = useMemo(
    () => (search.trim() ? options.filter((o) => o.label.toLowerCase().includes(search.trim().toLowerCase())) : options),
    [options, search]
  );

  const openPanel = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const left = Math.min(
        Math.max(VIEWPORT_MARGIN, rect.left),
        window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN
      );
      setPosition({ top: rect.bottom + 4, left });
    }
    setPending(new Set(active ?? []));
    setSearch("");
    setOpen(true);
  };

  // Closing on any scroll (capture phase, so it also catches the sheet's own
  // internal scroll container) avoids the popover drifting away from its
  // trigger once fixed-positioned coordinates go stale.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const toggleValue = (value: string) => {
    setPending((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  return (
    <div className={`relative ${className ?? ""}`} onClick={(e) => e.stopPropagation()}>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (open) setOpen(false);
          else openPanel();
        }}
        title="Filter this column"
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded transition-colors ${
          isFiltered
            ? "text-primary"
            : "text-muted-foreground/0 group-hover/dragcol:text-muted-foreground/50 hover:!text-primary"
        }`}
      >
        <Filter className={`h-3 w-3 ${isFiltered ? "fill-current" : ""}`} />
      </button>
      {open &&
        position &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[100]" onClick={() => setOpen(false)} />
            <div
              style={{ top: position.top, left: position.left, width: POPOVER_WIDTH }}
              className="fixed z-[101] rounded-lg border bg-popover p-2 text-left shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              {onSort && (
                <div className="mb-1.5 space-y-0.5 border-b pb-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      onSort("asc");
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] hover:bg-muted/50 ${
                      sortDirection === "asc" ? "font-semibold text-primary" : ""
                    }`}
                  >
                    <ArrowUp className="h-3 w-3" />
                    Sort A to Z
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onSort("desc");
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] hover:bg-muted/50 ${
                      sortDirection === "desc" ? "font-semibold text-primary" : ""
                    }`}
                  >
                    <ArrowDown className="h-3 w-3" />
                    Sort Z to A
                  </button>
                </div>
              )}
              <div className="relative mb-1.5">
                <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/50" />
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search values"
                  className="h-6 w-full rounded-md border bg-background/80 pl-6 pr-6 text-[10px] focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
              <div className="mb-1 flex items-center gap-2 px-0.5 text-[10px]">
                <button
                  className="font-medium text-primary hover:underline"
                  onClick={() => setPending(new Set(filteredOptions.map((o) => o.value)))}
                >
                  Select all
                </button>
                <span className="text-muted-foreground/40">·</span>
                <button className="font-medium text-primary hover:underline" onClick={() => setPending(new Set())}>
                  Clear
                </button>
                <span className="ml-auto text-muted-foreground/60">
                  {pending.size}/{options.length}
                </span>
              </div>
              <div className="max-h-48 space-y-0.5 overflow-y-auto custom-scrollbar">
                {filteredOptions.length === 0 && (
                  <div className="px-1 py-2 text-center text-[10px] text-muted-foreground/60">No values</div>
                )}
                {filteredOptions.map((option) => (
                  <label
                    key={option.value}
                    className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px] hover:bg-muted/50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={pending.has(option.value)}
                      onChange={() => toggleValue(option.value)}
                      className="h-3 w-3 rounded accent-primary"
                    />
                    <span className="flex-1 truncate">{option.label}</span>
                    <span className="text-muted-foreground/50 tabular-nums">{option.count}</span>
                  </label>
                ))}
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-1 border-t pt-1.5">
                <button
                  className="text-[10px] text-muted-foreground hover:text-destructive disabled:opacity-30"
                  disabled={!isFiltered}
                  onClick={() => {
                    onApply(new Set());
                    setOpen(false);
                  }}
                >
                  Clear filter
                </button>
                <div className="flex gap-1">
                  <button
                    className="h-6 rounded px-2 text-[10px] text-muted-foreground hover:bg-muted"
                    onClick={() => setOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="h-6 rounded bg-primary px-2 text-[10px] font-medium text-primary-foreground hover:bg-primary/90"
                    onClick={() => {
                      onApply(pending);
                      setOpen(false);
                    }}
                  >
                    OK
                  </button>
                </div>
              </div>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
