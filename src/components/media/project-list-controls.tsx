"use client";

import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const PROJECTS_PAGE_SIZE = 9;

export type ProjectDateFilter = "all" | "7d" | "30d" | "90d" | "year";
export type ProjectSortOption =
  | "updated_desc"
  | "updated_asc"
  | "created_desc"
  | "name_asc";

export type ProjectStatusOption = {
  value: string;
  label: string;
};

const DATE_OPTIONS: { value: ProjectDateFilter; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "year", label: "This year" },
];

const SORT_OPTIONS: { value: ProjectSortOption; label: string }[] = [
  { value: "updated_desc", label: "Newest updated" },
  { value: "updated_asc", label: "Oldest updated" },
  { value: "created_desc", label: "Newest created" },
  { value: "name_asc", label: "Name A–Z" },
];

export function matchesProjectDateFilter(
  iso: string | null | undefined,
  filter: ProjectDateFilter
): boolean {
  if (filter === "all") return true;
  if (!iso) return false;
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return false;
  const now = Date.now();
  if (filter === "year") {
    return new Date(ts).getFullYear() === new Date(now).getFullYear();
  }
  const days = filter === "7d" ? 7 : filter === "30d" ? 30 : 90;
  return now - ts <= days * 24 * 60 * 60 * 1000;
}

export function sortProjectsByOption<
  T extends {
    name: string;
    created_at: string;
    updated_at?: string | null;
  },
>(items: T[], sort: ProjectSortOption): T[] {
  const list = [...items];
  list.sort((a, b) => {
    if (sort === "name_asc") {
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    }
    const aCreated = new Date(a.created_at).getTime();
    const bCreated = new Date(b.created_at).getTime();
    if (sort === "created_desc") return bCreated - aCreated;
    const aUpdated = new Date(a.updated_at || a.created_at).getTime();
    const bUpdated = new Date(b.updated_at || b.created_at).getTime();
    return sort === "updated_asc" ? aUpdated - bUpdated : bUpdated - aUpdated;
  });
  return list;
}

export function paginateProjects<T>(
  items: T[],
  page: number,
  pageSize = PROJECTS_PAGE_SIZE
): { pageItems: T[]; totalPages: number; safePage: number } {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    pageItems: items.slice(start, start + pageSize),
    totalPages,
    safePage,
  };
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 min-w-[8.5rem] rounded-md border bg-background px-2.5 text-xs outline-none focus:ring-1 focus:ring-ring"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ProjectListToolbar({
  title,
  description,
  search,
  onSearchChange,
  status,
  onStatusChange,
  statusOptions,
  dateFilter,
  onDateFilterChange,
  sort,
  onSortChange,
}: {
  title: string;
  description: string;
  search: string;
  onSearchChange: (value: string) => void;
  status: string;
  onStatusChange: (value: string) => void;
  statusOptions: ProjectStatusOption[];
  dateFilter: ProjectDateFilter;
  onDateFilterChange: (value: ProjectDateFilter) => void;
  sort: ProjectSortOption;
  onSortChange: (value: ProjectSortOption) => void;
}) {
  const hasActiveFilters =
    status !== "all" || dateFilter !== "all" || sort !== "updated_desc";

  return (
    <div className="space-y-3 border-b bg-muted/20 p-4">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-[11px] text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="relative w-full lg:max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search projects..."
            className="h-8 bg-background pl-8 pr-8 text-xs"
          />
          {search ? (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <FilterSelect
            label="Status"
            value={status}
            onChange={onStatusChange}
            options={statusOptions}
          />
          <FilterSelect
            label="Updated"
            value={dateFilter}
            onChange={(value) =>
              onDateFilterChange(value as ProjectDateFilter)
            }
            options={DATE_OPTIONS}
          />
          <FilterSelect
            label="Sort"
            value={sort}
            onChange={(value) => onSortChange(value as ProjectSortOption)}
            options={SORT_OPTIONS}
          />
          {hasActiveFilters ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-[11px] text-muted-foreground"
              onClick={() => {
                onStatusChange("all");
                onDateFilterChange("all");
                onSortChange("updated_desc");
              }}
            >
              Reset
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ProjectListPagination({
  page,
  totalPages,
  totalItems,
  pageSize = PROJECTS_PAGE_SIZE,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
}) {
  if (totalItems === 0) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);

  return (
    <div className="flex flex-col gap-3 border-t bg-muted/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-[11px] text-muted-foreground">
        Showing{" "}
        <span className="font-medium text-foreground">
          {start}–{end}
        </span>{" "}
        of <span className="font-medium text-foreground">{totalItems}</span>{" "}
        projects
      </p>
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1 px-2.5 text-xs"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Prev
        </Button>
        <div className="flex items-center gap-1">
          {Array.from({ length: totalPages }, (_, index) => index + 1)
            .filter((pageNumber) => {
              if (totalPages <= 7) return true;
              if (pageNumber === 1 || pageNumber === totalPages) return true;
              return Math.abs(pageNumber - page) <= 1;
            })
            .reduce<(number | "ellipsis")[]>((acc, pageNumber, index, arr) => {
              if (index > 0) {
                const prev = arr[index - 1];
                if (pageNumber - prev > 1) acc.push("ellipsis");
              }
              acc.push(pageNumber);
              return acc;
            }, [])
            .map((item, index) =>
              item === "ellipsis" ? (
                <span
                  key={`ellipsis-${index}`}
                  className="px-1 text-[11px] text-muted-foreground"
                >
                  …
                </span>
              ) : (
                <Button
                  key={item}
                  type="button"
                  variant={item === page ? "default" : "outline"}
                  size="sm"
                  className="h-8 w-8 px-0 text-xs"
                  onClick={() => onPageChange(item)}
                >
                  {item}
                </Button>
              )
            )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1 px-2.5 text-xs"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
