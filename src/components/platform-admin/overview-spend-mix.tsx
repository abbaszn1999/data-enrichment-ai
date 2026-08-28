import { OverviewCard, OverviewPanelHeader } from "@/components/platform-admin/overview-card";
import type { AdminSpendSlice } from "@/lib/platform-admin/types";
import { cn } from "@/lib/utils";

const TONES = [
  "bg-[#400095] dark:bg-[#F76D01]",
  "bg-[#6B358D] dark:bg-[#F76D01]/70",
  "bg-[#8B5A9E] dark:bg-[#F76D01]/50",
  "bg-[#A1A1AA] dark:bg-zinc-500",
  "bg-[#C4C4C8] dark:bg-zinc-600",
  "bg-muted-foreground/30 dark:bg-zinc-700",
];

export function OverviewSpendMix({
  title,
  unit,
  slices,
  formatValue,
}: {
  title: string;
  unit: string;
  slices: AdminSpendSlice[];
  formatValue: (value: number) => string;
}) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const shown = slices.slice(0, 6);

  return (
    <OverviewCard>
      <OverviewPanelHeader title={title} hint={unit} />
      <div className="p-4">
        {shown.length === 0 || total === 0 ? (
          <p className="text-sm text-muted-foreground">No spend in this range.</p>
        ) : (
          <>
            <div className="mb-4 flex h-2 overflow-hidden rounded-full bg-muted">
              {shown.map((slice, index) => (
                <span
                  key={slice.key}
                  className={cn("h-full", TONES[index] ?? TONES[TONES.length - 1])}
                  style={{ width: `${(slice.value / total) * 100}%` }}
                />
              ))}
            </div>
            <ul className="divide-y">
              {shown.map((slice, index) => (
                <li key={slice.key} className="flex items-center justify-between gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={cn("size-1.5 shrink-0 rounded-full", TONES[index] ?? TONES[TONES.length - 1])} />
                    <span className="truncate">{slice.label}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3 tabular-nums">
                    <span className="text-xs text-muted-foreground">
                      {((slice.value / total) * 100).toFixed(0)}%
                    </span>
                    <span className="min-w-[4.5rem] text-right font-medium">{formatValue(slice.value)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </OverviewCard>
  );
}
