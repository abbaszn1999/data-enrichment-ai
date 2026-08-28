import { cn } from "@/lib/utils";
import type { AdminKpi } from "@/lib/platform-admin/types";

export function KpiCard({ label, value, hint, tone = "default", compact }: AdminKpi & { compact?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card shadow-sm",
        compact ? "px-3 py-2.5" : "p-4",
        "dark:border-white/8 dark:bg-[#0d0d10]/90"
      )}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("font-semibold tracking-tight tabular-nums", compact ? "mt-1 text-lg" : "mt-1.5 text-2xl")}>
        {value}
      </p>
      {hint ? (
        <p
          className={cn(
            "mt-1 text-xs text-muted-foreground",
            tone === "warn" && "text-amber-600 dark:text-amber-400",
            tone === "danger" && "text-destructive",
            tone === "ok" && "text-emerald-600 dark:text-emerald-400"
          )}
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}
