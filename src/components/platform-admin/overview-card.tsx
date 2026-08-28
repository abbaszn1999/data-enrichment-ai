import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function OverviewCard({
  children,
  className,
  accent,
}: {
  children: ReactNode;
  className?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border bg-card shadow-sm",
        className
      )}
    >
      {accent ? (
        <div className="h-px bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095]" />
      ) : null}
      {children}
    </div>
  );
}

export function OverviewPanelHeader({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b bg-muted/50 px-4 py-2.5 dark:bg-muted/25">
      <div className="min-w-0">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
        {hint ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function DeltaBadge({ percent }: { percent: number | null }) {
  if (percent == null || Number.isNaN(percent)) return null;
  const up = percent >= 0;
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-medium tabular-nums",
        up
          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "border-destructive/20 bg-destructive/10 text-destructive"
      )}
    >
      {up ? "+" : "−"}
      {Math.abs(percent).toFixed(1)}%
    </span>
  );
}
