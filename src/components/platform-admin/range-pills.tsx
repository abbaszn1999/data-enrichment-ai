"use client";

import { RANGE_LABELS } from "@/lib/platform-admin/labels";
import type { AdminOverviewRange } from "@/lib/platform-admin/types";
import { cn } from "@/lib/utils";

const PILLS: { id: AdminOverviewRange; short: string }[] = [
  { id: "7d", short: "7D" },
  { id: "30d", short: "30D" },
  { id: "90d", short: "90D" },
];

export function RangePills({
  value,
  onChange,
}: {
  value: AdminOverviewRange;
  onChange: (value: AdminOverviewRange) => void;
}) {
  return (
    <div className="inline-flex h-8 items-center rounded-lg border bg-background p-0.5">
      {PILLS.map((pill) => {
        const active = value === pill.id;
        return (
          <button
            key={pill.id}
            type="button"
            aria-label={RANGE_LABELS[pill.id]}
            aria-pressed={active}
            className={cn(
              "h-7 rounded-md px-2.5 text-xs font-semibold tracking-wide transition-colors",
              active
                ? "bg-[#400095]/10 text-[#400095] dark:bg-[#F76D01]/12 dark:text-[#F76D01]"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => onChange(pill.id)}
          >
            {pill.short}
          </button>
        );
      })}
    </div>
  );
}
