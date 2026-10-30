"use client";

import { useMemo, useState } from "react";
import { Bot, Pause, Play, Plus, Trash2 } from "lucide-react";
import { runAgentTurn } from "@/lib/google-ads/agent-runner";
import { cn } from "@/lib/utils";
import { LIMITS } from "@/lib/google-ads/constants";
import { adGroupBase, assetGroupBase, derive, formatMetric, money } from "@/lib/google-ads/metrics";
import { useGoogleAds } from "@/lib/google-ads/store";
import type { AdGroup, AssetGroup, EntityStatus } from "@/lib/google-ads/types";
import { metricColumns } from "../ga-columns";
import { BulkButton, GaTable, type GaColumn } from "../ga-table";
import { ACCENT_BTN, AdStrengthMeter, Card, ImageTile, Pill, Segmented, StatusMenu, ViewHeader } from "../ga-ui";
import { useGa } from "../use-ga";
import { STATUS_FILTERS, SearchBox, filterByStatus, type StatusFilter } from "./campaigns";

const AG_TYPE: Record<AdGroup["type"], string> = {
  SEARCH_STANDARD: "Search",
  DISPLAY_STANDARD: "Display",
  SHOPPING_PRODUCT_ADS: "Shopping",
  VIDEO: "Video",
  DEMAND_GEN: "Demand Gen",
};

export function AdGroupsView() {
  const { campaign } = useGa();
  if (campaign?.type === "PERFORMANCE_MAX") return <AssetGroupsView />;
  return <AdGroupsTable />;
}

function AdGroupsTable() {
  const { data, range, currency, campaign } = useGa();
  const setScope = useGoogleAds((s) => s.setScope);
  const openDialog = useGoogleAds((s) => s.openDialog);
  const applyDirect = useGoogleAds((s) => s.applyDirect);
  const [filter, setFilter] = useState<StatusFilter>("ACTIVE");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const base = data.adGroups.filter((g) => (!campaign || g.campaignId === campaign.id) && data.campaigns.find((c) => c.id === g.campaignId)?.status !== "REMOVED");
  const rows = filterByStatus(base, filter).filter((g) => g.name.toLowerCase().includes(query.toLowerCase()));
  const metrics = useMemo(() => new Map(data.adGroups.map((g) => [g.id, derive(adGroupBase(data, g.id, range))])), [data, range]);
  const totals = derive(
    rows.reduce(
      (s, g) => {
        const m = metrics.get(g.id)!;
        return { impressions: s.impressions + m.impressions, clicks: s.clicks + m.clicks, cost: s.cost + m.cost, conversions: s.conversions + m.conversions, conversionsValue: s.conversionsValue + m.conversionsValue };
      },
      { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionsValue: 0 }
    )
  );

  const setStatus = (ids: string[], status: EntityStatus) => {
    applyDirect(`${status === "ENABLED" ? "Enable" : status === "PAUSED" ? "Pause" : "Remove"} ${ids.length} ad group${ids.length > 1 ? "s" : ""}`, [{ kind: "status.set", entity: "AD_GROUP", ids, status }]);
    setSelected(new Set());
  };

  const columns: GaColumn<AdGroup>[] = [
    { id: "status", header: "", width: "w-8", render: (g) => <StatusMenu status={g.status} onChange={(s) => setStatus([g.id], s)} /> },
    {
      id: "name",
      header: "Ad group",
      sticky: true,
      sortValue: (g) => g.name,
      render: (g) => (
        <button type="button" onClick={() => setScope({ campaignId: g.campaignId, adGroupId: g.id }, g.type === "SEARCH_STANDARD" ? "keywords" : "ads")} className="max-w-56 truncate text-left font-semibold text-[#400095] hover:underline dark:text-violet-300">
          {g.name}
        </button>
      ),
      total: <span>Total: {rows.length} ad groups</span>,
    },
    ...(!campaign
      ? [
          {
            id: "campaign",
            header: "Campaign",
            sortValue: (g: AdGroup) => data.campaigns.find((c) => c.id === g.campaignId)?.name ?? "",
            render: (g: AdGroup) => <span className="block max-w-48 truncate text-muted-foreground">{data.campaigns.find((c) => c.id === g.campaignId)?.name}</span>,
          },
        ]
      : []),
    { id: "type", header: "Type", render: (g) => <span className="text-muted-foreground">{AG_TYPE[g.type]}</span> },
    {
      id: "bid",
      header: "Default max. CPC",
      align: "right",
      render: (g) => (g.defaultCpcBid ? money(g.defaultCpcBid, currency) : <span className="text-muted-foreground">Auto</span>),
    },
    {
      id: "content",
      header: "Keywords / ads",
      align: "right",
      render: (g) => {
        const k = data.keywords.filter((x) => x.adGroupId === g.id && x.status !== "REMOVED").length;
        const a = data.ads.filter((x) => x.adGroupId === g.id && x.status !== "REMOVED").length;
        return (
          <span className="whitespace-nowrap text-muted-foreground">
            {g.type === "SEARCH_STANDARD" ? `${k} kw · ` : ""}
            {a} ad{a === 1 ? "" : "s"}
          </span>
        );
      },
    },
    ...metricColumns<AdGroup>((g) => metrics.get(g.id)!, currency, { totals }),
  ];

  const assetGroups = !campaign ? data.assetGroups.filter((g) => g.status !== "REMOVED") : [];

  return (
    <div className="space-y-6">
      <div>
        <ViewHeader
          title="Ad groups"
          subtitle={campaign ? `In ${campaign.name}` : "Ad groups across all campaigns"}
          actions={
            <>
              <SearchBox value={query} onChange={setQuery} placeholder="Find an ad group" />
              <button type="button" onClick={() => openDialog({ kind: "adGroup", campaignId: campaign?.id })} className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold", ACCENT_BTN)}>
                <Plus className="h-3.5 w-3.5" /> Ad group
              </button>
            </>
          }
        >
          <Segmented value={filter} onChange={setFilter} options={STATUS_FILTERS} size="xs" />
        </ViewHeader>
        <GaTable
          rows={rows}
          columns={columns}
          rowKey={(g) => g.id}
          exportName="ad-groups"
          selectable
          selected={selected}
          onSelectedChange={setSelected}
          defaultSort={{ id: "cost", dir: "desc" }}
          bulkActions={(ids) => (
            <>
              <BulkButton onClick={() => setStatus(ids, "ENABLED")}><Play className="h-3 w-3" /> Enable</BulkButton>
              <BulkButton onClick={() => setStatus(ids, "PAUSED")}><Pause className="h-3 w-3" /> Pause</BulkButton>
              <BulkButton tone="danger" onClick={() => setStatus(ids, "REMOVED")}><Trash2 className="h-3 w-3" /> Remove</BulkButton>
            </>
          )}
          empty={campaign?.type === "SHOPPING" ? "Shopping ad groups appear here." : "No ad groups yet."}
        />
      </div>
      {assetGroups.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-bold">Asset groups <span className="font-normal text-muted-foreground">· Performance Max</span></p>
          <AssetGroupCards groups={assetGroups} />
        </div>
      )}
    </div>
  );
}

function AssetGroupsView() {
  const { data, campaign } = useGa();
  const groups = data.assetGroups.filter((g) => g.campaignId === campaign?.id && g.status !== "REMOVED");
  return (
    <div>
      <ViewHeader title="Asset groups" subtitle="Performance Max uses asset groups instead of ad groups. Google mixes these assets into ads for every channel." />
      <AssetGroupCards groups={groups} />
    </div>
  );
}

function AssetGroupCards({ groups }: { groups: AssetGroup[] }) {
  const { data, range, currency } = useGa();
  const applyDirect = useGoogleAds((s) => s.applyDirect);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {groups.map((g) => {
        const m = derive(assetGroupBase(data, g.id, range));
        const coverage = [
          { label: "Headlines", have: g.headlines.length, need: LIMITS.pmaxHeadlinesMax },
          { label: "Long headlines", have: g.longHeadlines.length, need: LIMITS.pmaxLongHeadlinesMax },
          { label: "Descriptions", have: g.descriptions.length, need: LIMITS.pmaxDescriptionsMax },
          { label: "Images", have: g.imageUrls.length, need: 20 },
          { label: "Logos", have: g.logoUrls.length, need: 5 },
          { label: "Videos", have: g.videoUrls.length, need: 5 },
        ];
        return (
          <Card key={g.id} className="p-4">
            <div className="flex items-start gap-2">
              <StatusMenu status={g.status} onChange={(s) => applyDirect(`${s === "PAUSED" ? "Pause" : s === "ENABLED" ? "Enable" : "Remove"} asset group ${g.name}`, [{ kind: "status.set", entity: "ASSET_GROUP", ids: [g.id], status: s }])} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{g.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {data.campaigns.find((c) => c.id === g.campaignId)?.name} · {g.finalUrl.replace(/^https?:\/\//, "")}
                </p>
              </div>
              <AdStrengthMeter strength={g.adStrength} />
            </div>
            <div className="mt-3 grid grid-cols-4 gap-1.5">
              {g.imageUrls.slice(0, 3).map((u, i) => (
                <ImageTile key={u} label={u} ratio={i === 0 ? "landscape" : "square"} className={i === 0 ? "col-span-2 aspect-auto h-full" : ""} />
              ))}
              {g.logoUrls[0] && <ImageTile label="logo" />}
            </div>
            <div className="mt-3 space-y-1.5">
              {coverage.map((c) => (
                <div key={c.label} className="flex items-center gap-2 text-[11px]">
                  <span className="w-24 text-muted-foreground">{c.label}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <span className={cn("block h-full rounded-full", c.have / c.need >= 0.6 ? "bg-emerald-500" : c.have ? "bg-amber-500" : "bg-red-400")} style={{ width: `${Math.min(100, (c.have / c.need) * 100)}%` }} />
                  </span>
                  <span className="w-10 text-right tabular-nums text-muted-foreground">{c.have}/{c.need}</span>
                </div>
              ))}
            </div>
            {g.assetPerformance && g.assetPerformance.length > 0 && (
              <div className="mt-3 rounded-xl border border-border/60 p-2.5">
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-[11px] font-semibold">Asset performance</p>
                  {g.assetPerformance.some((a) => a.rating === "LOW") && (
                    <button type="button" onClick={() => runAgentTurn("Which Performance Max assets are weak? Replace them")} className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#400095] hover:underline dark:text-violet-300">
                      <Bot className="h-3 w-3" /> Replace low assets
                    </button>
                  )}
                </div>
                <div className="space-y-1">
                  {g.assetPerformance.map((a) => (
                    <div key={a.kind + a.text} className="flex items-center gap-2 text-[11px]">
                      <span className="w-20 shrink-0 text-[10px] uppercase text-muted-foreground">{a.kind.replace("_", " ").toLowerCase()}</span>
                      <span className="min-w-0 flex-1 truncate">{a.text}</span>
                      <Pill tone={a.rating === "BEST" ? "good" : a.rating === "GOOD" ? "info" : a.rating === "LOW" ? "bad" : "neutral"}>{a.rating.toLowerCase()}</Pill>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {g.audienceSignal && <Pill tone="brand">Signal: {g.audienceSignal}</Pill>}
              {g.listingGroups.map((l) => <Pill key={l}>{l}</Pill>)}
              {g.searchThemes.map((t) => <Pill key={t} tone="info">“{t}”</Pill>)}
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 border-t border-border/60 pt-3 text-[11px]">
              {(["cost", "conversions", "conversionsValue", "roas"] as const).map((k) => (
                <div key={k}>
                  <p className="text-muted-foreground">{k === "cost" ? "Cost" : k === "conversions" ? "Conv." : k === "conversionsValue" ? "Value" : "ROAS"}</p>
                  <p className="font-semibold tabular-nums">{formatMetric(k, m[k], currency)}</p>
                </div>
              ))}
            </div>
          </Card>
        );
      })}
      {!groups.length && <p className="text-xs text-muted-foreground">No asset groups.</p>}
    </div>
  );
}
