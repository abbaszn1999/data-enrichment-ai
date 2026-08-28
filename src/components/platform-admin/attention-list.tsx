import Link from "next/link";
import { AlertTriangle, ChevronRight, Coins, CreditCard, Store, Wallet } from "lucide-react";
import { OverviewCard } from "@/components/platform-admin/overview-card";
import type { AdminAttentionItem } from "@/lib/platform-admin/types";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<AdminAttentionItem["kind"], string> = {
  past_due: "Billing",
  failed_job: "Jobs",
  low_credits: "Credits",
  low_wallet: "Wallet",
  integration_error: "Store",
};

const KIND_ICON = {
  past_due: CreditCard,
  failed_job: AlertTriangle,
  low_credits: Coins,
  low_wallet: Wallet,
  integration_error: Store,
} as const;

const KIND_TONE: Record<AdminAttentionItem["kind"], string> = {
  past_due: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  failed_job: "border-destructive/20 bg-destructive/10 text-destructive",
  low_credits:
    "border-[#6B358D]/20 bg-[#400095]/10 text-[#6B358D] dark:border-[#F76D01]/25 dark:bg-[#F76D01]/10 dark:text-[#F76D01]",
  low_wallet:
    "border-[#6B358D]/20 bg-[#400095]/10 text-[#6B358D] dark:border-[#F76D01]/25 dark:bg-[#F76D01]/10 dark:text-[#F76D01]",
  integration_error: "border-destructive/20 bg-destructive/10 text-destructive",
};

export function AttentionList({ items }: { items: AdminAttentionItem[] }) {
  return (
    <OverviewCard>
      <div className="flex items-center justify-between gap-3 border-b bg-muted/50 px-4 py-2.5 dark:bg-muted/25">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Needs attention</h2>
        <span className="text-xs tabular-nums text-muted-foreground">
          {items.length === 0 ? "Clear" : `${items.length} open`}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing needs attention.</p>
      ) : (
        <ul>
          {items.map((item) => {
            const Icon = KIND_ICON[item.kind];
            return (
              <li key={item.id} className="border-b last:border-b-0">
                <Link
                  href={item.href}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#400095]/10 text-[#400095] ring-1 ring-[#400095]/10 dark:bg-[#F76D01]/15 dark:text-[#F76D01] dark:ring-[#F76D01]/20">
                    <Icon className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{item.title}</p>
                      <span
                        className={cn(
                          "hidden shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium sm:inline-flex",
                          KIND_TONE[item.kind]
                        )}
                      >
                        {KIND_LABEL[item.kind]}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.detail}</p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </OverviewCard>
  );
}
