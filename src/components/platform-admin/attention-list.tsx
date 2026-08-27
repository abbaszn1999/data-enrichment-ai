import Link from "next/link";
import type { AdminAttentionItem } from "@/lib/platform-admin/types";

const KIND_LABEL: Record<AdminAttentionItem["kind"], string> = {
  past_due: "Billing",
  failed_job: "Jobs",
  low_credits: "Credits",
  low_wallet: "Wallet",
  integration_error: "Store",
};

export function AttentionList({ items }: { items: AdminAttentionItem[] }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold">Needs attention</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing needs attention.</p>
      ) : (
        <ul className="divide-y">
          {items.slice(0, 8).map((item) => (
            <li key={item.id}>
              <Link href={item.href} className="flex items-start justify-between gap-3 py-2.5 hover:opacity-80">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{item.detail}</p>
                </div>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {KIND_LABEL[item.kind]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
