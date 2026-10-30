"use client";

import { useState } from "react";
import { Ban, Tags, Wallet, Gavel, ListX } from "lucide-react";
import { BIDDING } from "@/lib/google-ads/constants";
import { money } from "@/lib/google-ads/metrics";
import { useGoogleAds } from "@/lib/google-ads/store";
import type { CampaignBudget } from "@/lib/google-ads/types";
import { GaTable, type GaColumn } from "../ga-table";
import { Card, Pill, Segmented, ViewHeader } from "../ga-ui";
import { useGa } from "../use-ga";

type LibraryTab = "budgets" | "strategies" | "negatives" | "placements" | "labels";

export function LibraryView() {
  const [tab, setTab] = useState<LibraryTab>("budgets");
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

  // Portfolio strategies only: a campaign's own strategy is shown in its Settings.
  const portfolios = data.bidStrategies.map((s) => ({ ...s, campaigns: live.filter((c) => c.bidding.portfolioId === s.id) }));

  const placementLists = data.placementLists.map((l) => ({ ...l, campaigns: live.filter((c) => l.campaignIds.includes(c.id)) }));

  // Label definitions, plus any label name already in use that has no definition yet.
  const used = new Set([...live.flatMap((c) => c.labels), ...data.adGroups.flatMap((g) => g.labels ?? []), ...data.ads.flatMap((a) => a.labels ?? []), ...data.keywords.flatMap((k) => k.labels ?? [])]);
  const labelRows = [...data.labelDefs.map((l) => ({ name: l.name, color: l.color })), ...[...used].filter((n) => !data.labelDefs.some((l) => l.name === n)).map((name) => ({ name, color: "#71717A" }))].map((l) => ({
    ...l,
    campaigns: live.filter((c) => c.labels.includes(l.name)).length,
    adGroups: data.adGroups.filter((g) => g.labels?.includes(l.name) && g.status !== "REMOVED").length,
    ads: data.ads.filter((a) => a.labels?.includes(l.name) && a.status !== "REMOVED").length,
    keywords: data.keywords.filter((k) => k.labels?.includes(l.name) && k.status !== "REMOVED").length,
  }));

  const campaignName = (id: string) => data.campaigns.find((c) => c.id === id)?.name ?? id;
  const budgets = data.budgets.filter((b) => live.some((c) => c.budgetId === b.id));

  const TABS: { value: LibraryTab; label: string; count: number }[] = [
    { value: "budgets", label: "Budgets", count: budgets.length },
    { value: "strategies", label: "Bid strategies", count: portfolios.length },
    { value: "negatives", label: "Negative lists", count: data.negativeLists.length },
    { value: "placements", label: "Placement exclusions", count: placementLists.length },
    { value: "labels", label: "Labels", count: labelRows.length },
  ];

  return (
    <div className="space-y-5">
      <ViewHeader title="Shared library" subtitle="Things reused across campaigns: budgets, portfolio bid strategies, exclusion lists and labels.">
        <Segmented value={tab} onChange={setTab} size="xs" options={TABS} />
      </ViewHeader>

      {tab === "budgets" && (
        <section>
          <p className="mb-1 flex items-center gap-2 text-sm font-bold"><Wallet className="h-4 w-4 text-muted-foreground" /> Budgets</p>
          <p className="mb-2 text-[11px] text-muted-foreground">Every budget in the account. A shared budget is spent by several campaigns together; an individual budget belongs to one.</p>
          <GaTable rows={budgets} columns={budgetCols} rowKey={(b) => b.id} defaultSort={{ id: "amount", dir: "desc" }} />
        </section>
      )}

      {tab === "strategies" && (
        <section>
          <p className="mb-1 flex items-center gap-2 text-sm font-bold"><Gavel className="h-4 w-4 text-muted-foreground" /> Bid strategies</p>
          <p className="mb-2 text-[11px] text-muted-foreground">Portfolio strategies: one named strategy used by several campaigns. A campaign&apos;s own strategy is in its Settings.</p>
          {portfolios.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {portfolios.map((s) => (
                <Card key={s.id} className="p-3.5">
                  <p className="text-xs font-bold">{s.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {BIDDING[s.type].label}
                    {s.targetCpa ? ` · target ${money(s.targetCpa, currency)}` : ""}
                    {s.targetRoas ? ` · target ${Math.round(s.targetRoas * 100)}%` : ""}
                    {s.maxCpcLimit ? ` · max. CPC ${money(s.maxCpcLimit, currency)}` : ""}
                  </p>
                  <p className="mt-2 text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">Used by {s.campaigns.length} campaign{s.campaigns.length === 1 ? "" : "s"}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {s.campaigns.map((c) => (
                      <Pill key={c.id}>{c.name}</Pill>
                    ))}
                    {!s.campaigns.length && <span className="text-[11px] text-muted-foreground">No campaign uses it yet.</span>}
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="p-4 text-xs text-muted-foreground">No portfolio strategies in this account.</Card>
          )}
        </section>
      )}

      {tab === "negatives" && (
        <section>
          <p className="mb-2 flex items-center gap-2 text-sm font-bold"><ListX className="h-4 w-4 text-muted-foreground" /> Negative keyword lists</p>
          <Card className="space-y-2 p-3.5">
            {data.negativeLists.length ? (
              data.negativeLists.map((l) => (
                <div key={l.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold">{l.name}</span>
                  <span className="text-muted-foreground">{data.negatives.filter((n) => n.parentId === l.id).length} keywords · {l.campaignIds.length} campaigns</span>
                  <span className="min-w-0 truncate text-[11px] text-muted-foreground">{l.campaignIds.map(campaignName).join(", ")}</span>
                  <button type="button" onClick={() => setView("negatives")} className="ml-auto text-[11px] font-semibold text-[#400095] hover:underline dark:text-violet-300">See keywords</button>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">No shared lists yet.</p>
            )}
          </Card>
        </section>
      )}

      {tab === "placements" && (
        <section>
          <p className="mb-1 flex items-center gap-2 text-sm font-bold"><Ban className="h-4 w-4 text-muted-foreground" /> Placement exclusion lists</p>
          <p className="mb-2 text-[11px] text-muted-foreground">Named lists of sites, apps and channels that are blocked on every campaign they are attached to.</p>
          {placementLists.length ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {placementLists.map((l) => (
                <Card key={l.id} className="p-3.5">
                  <p className="text-xs font-bold">{l.name}</p>
                  <p className="text-[11px] text-muted-foreground">{l.placements.length} placement{l.placements.length === 1 ? "" : "s"} · {l.campaigns.length} campaign{l.campaigns.length === 1 ? "" : "s"}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {l.placements.slice(0, 6).map((p) => (
                      <Pill key={p} tone="bad">{p}</Pill>
                    ))}
                    {l.placements.length > 6 && <span className="text-[11px] text-muted-foreground">+{l.placements.length - 6} more</span>}
                  </div>
                  <p className="mt-2 text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">Attached to</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {l.campaigns.map((c) => (
                      <Pill key={c.id}>{c.name}</Pill>
                    ))}
                    {!l.campaigns.length && <span className="text-[11px] text-muted-foreground">No campaign yet.</span>}
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="p-4 text-xs text-muted-foreground">No placement exclusion lists in this account.</Card>
          )}
        </section>
      )}

      {tab === "labels" && (
        <section>
          <p className="mb-1 flex items-center gap-2 text-sm font-bold"><Tags className="h-4 w-4 text-muted-foreground" /> Labels</p>
          <p className="mb-2 text-[11px] text-muted-foreground">Colour tags that group campaigns, ad groups, ads and keywords for reporting.</p>
          {labelRows.length ? (
            <Card className="divide-y divide-border/50">
              <div className="grid grid-cols-[1fr_repeat(4,72px)] gap-2 px-4 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">
                <span>Label</span>
                <span className="text-right">Campaigns</span>
                <span className="text-right">Ad groups</span>
                <span className="text-right">Ads</span>
                <span className="text-right">Keywords</span>
              </div>
              {labelRows.map((l) => (
                <div key={l.name} className="grid grid-cols-[1fr_repeat(4,72px)] items-center gap-2 px-4 py-2.5 text-xs">
                  <span className="flex min-w-0 items-center gap-2 font-semibold">
                    <span className="h-3 w-3 shrink-0 rounded-full ring-1 ring-black/10" style={{ backgroundColor: l.color }} />
                    <span className="truncate">{l.name}</span>
                  </span>
                  <span className="text-right tabular-nums text-muted-foreground">{l.campaigns}</span>
                  <span className="text-right tabular-nums text-muted-foreground">{l.adGroups}</span>
                  <span className="text-right tabular-nums text-muted-foreground">{l.ads}</span>
                  <span className="text-right tabular-nums text-muted-foreground">{l.keywords}</span>
                </div>
              ))}
            </Card>
          ) : (
            <Card className="p-4 text-xs text-muted-foreground">No labels in this account.</Card>
          )}
        </section>
      )}
    </div>
  );
}
