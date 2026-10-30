"use client";

import { Tags, Wallet, Gavel, ListX } from "lucide-react";
import { BIDDING } from "@/lib/google-ads/constants";
import { money } from "@/lib/google-ads/metrics";
import { useGoogleAds } from "@/lib/google-ads/store";
import type { CampaignBudget } from "@/lib/google-ads/types";
import { GaTable, type GaColumn } from "../ga-table";
import { Card, Pill, ViewHeader } from "../ga-ui";
import { useGa } from "../use-ga";

export function LibraryView() {
  const { data, currency } = useGa();
  const openDialog = useGoogleAds((s) => s.openDialog);
  const setView = useGoogleAds((s) => s.setView);
  const live = data.campaigns.filter((c) => c.status !== "REMOVED");
  const totalDaily = data.budgets.filter((b) => live.some((c) => c.budgetId === b.id && c.status === "ENABLED")).reduce((s, b) => s + b.amount, 0);

  const budgetCols: GaColumn<CampaignBudget>[] = [
    { id: "name", header: "Budget", sortValue: (b) => b.name, render: (b) => <span className="font-semibold">{b.name}</span> },
    { id: "type", header: "Type", render: (b) => <Pill tone={b.shared ? "brand" : "neutral"}>{b.shared ? "Shared" : "Individual"}</Pill> },
    {
      id: "campaigns",
      header: "Campaigns",
      render: (b) => <span className="text-muted-foreground">{live.filter((c) => c.budgetId === b.id).map((c) => c.name).join(", ") || "—"}</span>,
    },
    {
      id: "amount",
      header: "Daily amount",
      align: "right",
      sortValue: (b) => b.amount,
      render: (b) => {
        const c = live.find((x) => x.budgetId === b.id);
        return c ? (
          <button type="button" onClick={() => openDialog({ kind: "budget", campaignId: c.id })} className="font-semibold underline decoration-dotted underline-offset-4">
            {money(b.amount, currency)}
          </button>
        ) : (
          money(b.amount, currency)
        );
      },
      total: <span>{money(totalDaily, currency)}/day enabled</span>,
    },
    { id: "monthly", header: "Monthly (≈30.4×)", align: "right", render: (b) => <span className="text-muted-foreground">{money(b.amount * 30.4, currency)}</span> },
  ];

  const strategies = [...new Set(live.map((c) => c.bidding.type))].map((type) => ({ type, campaigns: live.filter((c) => c.bidding.type === type) }));
  const labels = [...new Set(live.flatMap((c) => c.labels))];

  return (
    <div className="space-y-5">
      <ViewHeader title="Shared library" subtitle="Things reused across campaigns: budgets, bid strategies, negative keyword lists and labels." />

      <section>
        <p className="mb-2 flex items-center gap-2 text-sm font-bold"><Wallet className="h-4 w-4 text-muted-foreground" /> Budgets</p>
        <GaTable rows={data.budgets.filter((b) => live.some((c) => c.budgetId === b.id))} columns={budgetCols} rowKey={(b) => b.id} defaultSort={{ id: "amount", dir: "desc" }} />
      </section>

      <section>
        <p className="mb-2 flex items-center gap-2 text-sm font-bold"><Gavel className="h-4 w-4 text-muted-foreground" /> Bid strategies</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {strategies.map((s) => (
            <Card key={s.type} className="p-3.5">
              <p className="text-xs font-bold">{BIDDING[s.type].label}</p>
              <p className="text-[11px] text-muted-foreground">Optimises for {BIDDING[s.type].focus.toLowerCase()}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {s.campaigns.map((c) => (
                  <Pill key={c.id}>
                    {c.name}
                    {c.bidding.targetCpa ? ` · ${money(c.bidding.targetCpa, currency)}` : ""}
                    {c.bidding.targetRoas ? ` · ${Math.round(c.bidding.targetRoas * 100)}%` : ""}
                  </Pill>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <p className="mb-2 flex items-center gap-2 text-sm font-bold"><ListX className="h-4 w-4 text-muted-foreground" /> Negative keyword lists</p>
        <Card className="p-3.5">
          {data.negativeLists.length ? (
            data.negativeLists.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold">{l.name}</span>
                <span className="text-muted-foreground">{data.negatives.filter((n) => n.parentId === l.id).length} keywords · {l.campaignIds.length} campaigns</span>
                <button type="button" onClick={() => setView("negatives")} className="ml-auto text-[11px] font-semibold text-[#400095] hover:underline dark:text-violet-300">Manage</button>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">No shared lists yet.</p>
          )}
        </Card>
      </section>

      <section>
        <p className="mb-2 flex items-center gap-2 text-sm font-bold"><Tags className="h-4 w-4 text-muted-foreground" /> Labels</p>
        <div className="flex flex-wrap gap-1.5">
          {labels.map((l) => (
            <Pill key={l} tone="brand">{l} · {live.filter((c) => c.labels.includes(l)).length}</Pill>
          ))}
          {!labels.length && <p className="text-xs text-muted-foreground">No labels.</p>}
        </div>
      </section>
    </div>
  );
}
