import type { LucideIcon } from "lucide-react";
import { OverviewCard } from "@/components/platform-admin/overview-card";
import type { AdminKpi } from "@/lib/platform-admin/types";
import { cn } from "@/lib/utils";

export type StatStripItem = AdminKpi & {
  icon: LucideIcon;
  onClick?: () => void;
  active?: boolean;
};

export function OverviewPulseStrip({ items }: { items: StatStripItem[] }) {
  return (
    <OverviewCard accent>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-border">
        {items.map((item) => {
          const Icon = item.icon;
          const body = (
            <>
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg",
                  item.active
                    ? "bg-[#400095]/10 text-[#400095] dark:bg-[#F76D01]/15 dark:text-[#F76D01]"
                    : "bg-muted text-muted-foreground"
                )}
              >
                <Icon className="size-3.5" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {item.label}
                </p>
                <p className="text-lg font-semibold tracking-tight tabular-nums">{item.value}</p>
                {item.hint ? (
                  <p
                    className={cn(
                      "truncate text-xs text-muted-foreground",
                      item.tone === "warn" && "text-amber-600 dark:text-amber-400",
                      item.tone === "danger" && "text-destructive",
                      item.tone === "ok" && "text-emerald-600 dark:text-emerald-400"
                    )}
                  >
                    {item.hint}
                  </p>
                ) : null}
              </div>
            </>
          );
          const className = cn(
            "flex items-center gap-3 border-b px-4 py-3 last:border-b-0 lg:border-b-0",
            item.active && "bg-[#400095]/[0.04] dark:bg-[#F76D01]/[0.07]"
          );
          if (item.onClick) {
            return (
              <button
                key={item.label}
                type="button"
                className={cn(className, "w-full text-left transition-colors hover:bg-muted/50")}
                onClick={item.onClick}
              >
                {body}
              </button>
            );
          }
          return (
            <div key={item.label} className={className}>
              {body}
            </div>
          );
        })}
      </div>
    </OverviewCard>
  );
}
