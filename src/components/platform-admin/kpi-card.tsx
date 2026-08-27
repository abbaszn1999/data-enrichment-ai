import { cn } from "@/lib/utils";
import type { AdminKpi } from "@/lib/platform-admin/types";

export function KpiCard({ label, value, hint, tone = "default" }: AdminKpi) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight">{value}</p>
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
