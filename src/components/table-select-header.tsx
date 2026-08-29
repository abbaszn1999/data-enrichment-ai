"use client";

import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function TableSelectHeader({
  allSelected,
  someSelected,
  pageCount,
  totalCount,
  onTogglePage,
  onSelectPage,
  onSelectAll,
  onClear,
}: {
  allSelected: boolean;
  someSelected: boolean;
  pageCount: number;
  totalCount: number;
  onTogglePage: () => void;
  onSelectPage: () => void;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center justify-center gap-0.5">
      <input
        type="checkbox"
        checked={allSelected}
        ref={(el) => {
          if (el) el.indeterminate = someSelected;
        }}
        onChange={onTogglePage}
        className="h-3.5 w-3.5 rounded border-muted-foreground/40 accent-primary cursor-pointer"
        aria-label="Select this page"
        title="Select this page"
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-5 w-4 items-center justify-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground"
            aria-label="Selection options"
            title="Selection options"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuItem
            className="cursor-pointer text-[11px]"
            onSelect={onSelectAll}
          >
            Select all ({totalCount})
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer text-[11px]"
            onSelect={onSelectPage}
          >
            Select page ({pageCount})
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer text-[11px]"
            onSelect={onClear}
          >
            Clear selection
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
