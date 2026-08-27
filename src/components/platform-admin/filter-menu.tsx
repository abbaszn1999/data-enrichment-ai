"use client";

import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type FilterOption = {
  value: string;
  label: string;
  count?: number;
};

export function FilterMenu({
  label,
  value,
  onChange,
  options,
  allValue = "all",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: FilterOption[];
  allValue?: string;
}) {
  const selected = options.find((option) => option.value === value);
  const hasAll = options.some((option) => option.value === allValue);
  const isAccent = hasAll && value !== allValue;
  const showValue = Boolean(selected && (!hasAll || value !== allValue));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${selected?.label ?? value}`}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm transition-colors outline-none",
            "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
            isAccent
              ? "border-[#400095]/25 bg-[#400095]/10 text-[#400095] dark:border-[#F76D01]/40 dark:bg-[#F76D01]/12 dark:text-[#F76D01]"
              : "border-border bg-background text-foreground hover:bg-muted/70"
          )}
        >
          <span className={cn("font-medium", !isAccent && "text-muted-foreground")}>{label}</span>
          {showValue ? (
            <span className="max-w-[9rem] truncate font-medium">{selected?.label}</span>
          ) : null}
          <ChevronDown className="size-3.5 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[12rem]">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value} className="pr-3">
              <span className="flex-1">{option.label}</span>
              {option.count != null ? (
                <span className="ml-3 text-xs tabular-nums text-muted-foreground">{option.count}</span>
              ) : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
