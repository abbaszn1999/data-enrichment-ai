"use client";

import { Check, ChevronDown, Clock3, Store } from "lucide-react";
import { CMS_TYPES, cmsTypeLabel } from "@/lib/cms-types";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type CmsTypeSelectProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  emptyLabel?: string;
};

export function CmsTypeSelect({
  value,
  onChange,
  disabled,
  id,
  className,
  emptyLabel,
}: CmsTypeSelectProps) {
  const selected = CMS_TYPES.find((option) => option.value === value);
  const availableOptions = CMS_TYPES.filter((option) => option.available);
  const upcomingOptions = CMS_TYPES.filter((option) => !option.available);

  const triggerLabel =
    selected?.label || (value ? cmsTypeLabel(value) : emptyLabel || "Select platform");
  const selectedIsUpcoming = !!selected && !selected.available;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          id={id}
          type="button"
          disabled={disabled}
          className={cn(
            "flex h-10 w-full items-center justify-between gap-2 rounded-md border bg-background px-3 text-left text-sm outline-none transition-colors",
            "hover:border-[#6B358D]/40 focus-visible:ring-1 focus:ring-ring dark:hover:border-[#F76D01]/50",
            "disabled:cursor-not-allowed disabled:opacity-60",
            className
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Store className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span
              className={cn(
                "truncate font-medium",
                !selected && "text-muted-foreground"
              )}
            >
              {triggerLabel}
            </span>
            {selectedIsUpcoming ? <ComingSoonBadge /> : null}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-64 overflow-hidden rounded-xl p-1.5"
      >
        <DropdownMenuLabel className="px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
          Available now
        </DropdownMenuLabel>
        {availableOptions.map((option) => {
          const isSelected = option.value === value;
          return (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => onChange(option.value)}
              className="cursor-pointer rounded-lg px-2.5 py-2"
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate font-medium">{option.label}</span>
              </span>
              {isSelected ? (
                <Check className="h-3.5 w-3.5 text-[#400095] dark:text-[#F76D01]" />
              ) : null}
            </DropdownMenuItem>
          );
        })}

        <DropdownMenuSeparator className="my-1.5" />

        <DropdownMenuLabel className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
          <Clock3 className="h-3 w-3" />
          Coming soon
        </DropdownMenuLabel>
        {upcomingOptions.map((option) => (
          <DropdownMenuItem
            key={option.value}
            disabled
            className="rounded-lg px-2.5 py-2 opacity-100"
          >
            <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
              <span className="truncate text-muted-foreground">{option.label}</span>
              <ComingSoonBadge />
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ComingSoonBadge() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-amber-700 dark:text-amber-400">
      Coming soon
    </span>
  );
}
