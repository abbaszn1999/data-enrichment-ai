"use client";

import { X } from "lucide-react";
import { FilterMenu, type FilterOption } from "@/components/platform-admin/filter-menu";
import { SearchInput } from "@/components/platform-admin/search-input";
import { Button } from "@/components/ui/button";

export type ToolbarFilter = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: FilterOption[];
  allValue?: string;
};

export function DataToolbar({
  search,
  onSearch,
  searchPlaceholder = "Search",
  filters = [],
  resultCount,
  totalCount,
  noun,
}: {
  search?: string;
  onSearch?: (value: string) => void;
  searchPlaceholder?: string;
  filters?: ToolbarFilter[];
  resultCount: number;
  totalCount: number;
  noun: string;
}) {
  const active = filters.filter((filter) => filter.value !== (filter.allValue ?? "all"));
  const hasQuery = Boolean(search?.trim());
  const hasActive = active.length > 0 || hasQuery;

  const clearAll = () => {
    onSearch?.("");
    for (const filter of filters) {
      filter.onChange(filter.allValue ?? "all");
    }
  };

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {onSearch ? (
          <SearchInput value={search ?? ""} onChange={onSearch} placeholder={searchPlaceholder} />
        ) : null}
        {filters.map((filter) => (
          <FilterMenu
            key={filter.id}
            label={filter.label}
            value={filter.value}
            onChange={filter.onChange}
            options={filter.options}
            allValue={filter.allValue}
          />
        ))}
        <p className="ml-auto text-xs tabular-nums text-muted-foreground">
          {resultCount === totalCount
            ? `${totalCount} ${pluralize(totalCount, noun)}`
            : `${resultCount} of ${totalCount} ${pluralize(totalCount, noun)}`}
        </p>
      </div>
      {hasActive ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {hasQuery ? (
            <ActiveChip label={`Search: ${search!.trim()}`} onRemove={() => onSearch?.("")} />
          ) : null}
          {active.map((filter) => {
            const selected = filter.options.find((option) => option.value === filter.value);
            return (
              <ActiveChip
                key={filter.id}
                label={`${filter.label}: ${selected?.label ?? filter.value}`}
                onRemove={() => filter.onChange(filter.allValue ?? "all")}
              />
            );
          })}
          <Button type="button" variant="ghost" size="xs" className="h-6 px-2 text-xs" onClick={clearAll}>
            Clear all
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ActiveChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex h-6 max-w-full items-center gap-1 rounded-full border bg-muted/50 px-2 text-[11px] text-foreground">
      <span className="truncate">{label}</span>
      <button
        type="button"
        aria-label={`Remove ${label}`}
        className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
        onClick={onRemove}
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

function pluralize(count: number, noun: string) {
  if (count === 1 && noun.endsWith("s")) return noun.slice(0, -1);
  return noun;
}
