import type { ReactNode } from "react";

export function LiveBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-5 items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 text-[11px] font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
      {children}
    </span>
  );
}

export function PageTitle({
  label,
  badge,
}: {
  label: string;
  badge?: ReactNode;
}) {
  if (!badge) return <>{label}</>;
  return (
    <span className="inline-flex items-center gap-2.5">
      {label}
      {badge}
    </span>
  );
}

export function TableToolbar({
  label = "Directory",
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</h2>
      {children}
    </div>
  );
}

export function AdminListLayout({ children }: { children: ReactNode }) {
  return <div className="space-y-5">{children}</div>;
}

export function exclusiveFilter(isActive: boolean, clear: () => void, apply: () => void) {
  clear();
  if (!isActive) apply();
}
