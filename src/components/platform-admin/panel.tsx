import type { ReactNode } from "react";
import { OverviewCard, OverviewPanelHeader } from "@/components/platform-admin/overview-card";

export function DetailGrid({
  items,
  nested,
}: {
  items: { label: string; value: ReactNode }[];
  nested?: boolean;
}) {
  const body = (
    <dl className="grid sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="border-b px-5 py-4 last:border-b-0">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{item.label}</dt>
          <dd className="mt-1.5 text-sm font-medium">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
  if (nested) return body;
  return <OverviewCard accent>{body}</OverviewCard>;
}

export function Panel({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <OverviewCard>
      <OverviewPanelHeader title={title} action={actions} />
      <div className="p-4">{children}</div>
    </OverviewCard>
  );
}
