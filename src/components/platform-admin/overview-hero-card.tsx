import type { LucideIcon } from "lucide-react";
import { Coins, DollarSign, Wallet } from "lucide-react";
import { DeltaBadge, OverviewCard } from "@/components/platform-admin/overview-card";

const ICONS: Record<string, LucideIcon> = {
  MRR: DollarSign,
  "Credits spent": Coins,
  "Wallet spent": Wallet,
};

export function OverviewHeroBand({
  items,
}: {
  items: { label: string; value: string; hint?: string; delta?: number | null }[];
}) {
  return (
    <OverviewCard accent>
      <div className="grid lg:grid-cols-3 lg:divide-x lg:divide-border">
        {items.map((item) => {
          const Icon = ICONS[item.label] ?? DollarSign;
          return (
            <div key={item.label} className="border-b px-5 py-5 last:border-b-0 lg:border-b-0">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 items-center justify-center rounded-full bg-[#400095]/10 text-[#400095] ring-1 ring-[#400095]/10 dark:bg-[#F76D01]/15 dark:text-[#F76D01] dark:ring-[#F76D01]/20">
                    <Icon className="size-3.5" />
                  </span>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {item.label}
                  </p>
                </div>
                <DeltaBadge percent={item.delta ?? null} />
              </div>
              <p className="mt-4 text-3xl font-semibold tracking-tight tabular-nums sm:text-[2.15rem]">
                {item.value}
              </p>
              {item.hint ? <p className="mt-1.5 text-xs text-muted-foreground">{item.hint}</p> : null}
            </div>
          );
        })}
      </div>
    </OverviewCard>
  );
}
