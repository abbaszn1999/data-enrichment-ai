"use client";

/**
 * Excel-style column filter: a funnel icon that opens a search box, Select
 * all / Clear, and a checkbox list of that column's values with counts.
 * Shared by Catalog Intelligence, Product Gallery and the Visualizer.
 */
import { useMemo, useState } from "react";
import { Filter, Search, X } from "lucide-react";
import type { FilterValueOption } from "@/lib/sheet/column-filters";

export function ColumnFilterButton({
  options,
  active,
  onApply,
  className,
}: {
  options: FilterValueOption[];
  /** Currently-applied values for this column; empty/undefined = no filter. */
  active: Set<string> | undefined;
  onApply: (values: Set<string>) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<Set<string>>(() => new Set(active ?? []));
  const isFiltered = !!active && active.size > 0;

  const filteredOptions = useMemo(
    () => (search.trim() ? options.filter((o) => o.label.toLowerCase().includes(search.trim().toLowerCase())) : options),
    [options, search]
  );

  const openPanel = () => {
    setPending(new Set(active ?? []));
    setSearch("");
    setOpen(true);
  };

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
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border bg-popover p-2 text-left shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
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
                <button onClick={() => setSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground">
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
                  Apply
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
