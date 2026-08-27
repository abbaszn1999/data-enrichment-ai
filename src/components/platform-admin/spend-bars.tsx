import type { AdminSpendSlice } from "@/lib/platform-admin/types";
import { cn } from "@/lib/utils";

export function SpendBars({
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
  const max = Math.max(...slices.map((slice) => slice.value), 1);
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-[11px] text-muted-foreground">{unit}</span>
      </div>
      {slices.length === 0 ? (
        <p className="text-sm text-muted-foreground">No spend in this range.</p>
      ) : (
        <ul className="space-y-3">
          {slices.map((slice) => (
            <li key={slice.key}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span>{slice.label}</span>
                <span className="font-medium tabular-nums">{formatValue(slice.value)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full bg-[#400095] dark:bg-[#F76D01]")}
                  style={{ width: `${Math.max(4, (slice.value / max) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
