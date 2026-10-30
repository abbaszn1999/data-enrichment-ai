"use client";

import { useState } from "react";
import { AlertTriangle, Bot, FileText, PenLine, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { adBase, derive, formatMetric } from "@/lib/google-ads/metrics";
import { runAgentTurn } from "@/lib/google-ads/agent-runner";
import { useGoogleAds } from "@/lib/google-ads/store";
import type { Ad } from "@/lib/google-ads/types";
import { SearchAdPreview } from "../ga-ad-preview";
import { ACCENT_BTN, AdStrengthMeter, Card, EmptyState, ImageTile, PolicyPill, Segmented, StatusMenu, ViewHeader } from "../ga-ui";
import { scopedAdGroupIds, useGa } from "../use-ga";
import { STATUS_FILTERS, filterByStatus, type StatusFilter } from "./campaigns";

const AD_TYPE_LABEL: Record<Ad["type"], string> = {
  RESPONSIVE_SEARCH_AD: "Responsive search ad",
  RESPONSIVE_DISPLAY_AD: "Responsive display ad",
  VIDEO_AD: "Video ad",
  DEMAND_GEN_AD: "Demand Gen ad",
  SHOPPING_PRODUCT_AD: "Product shopping ad",
};

export function AdsView() {
  const { data, scope, campaign, adGroup } = useGa();
  const openDialog = useGoogleAds((s) => s.openDialog);
  const [filter, setFilter] = useState<StatusFilter>("ACTIVE");
  const [policy, setPolicy] = useState<"ALL" | "ISSUES">("ALL");
  const ids = new Set(scopedAdGroupIds(data, scope));
  const ads = filterByStatus(data.ads.filter((a) => ids.has(a.adGroupId)), filter).filter(
    (a) => policy === "ALL" || a.policy === "DISAPPROVED" || a.policy === "APPROVED_LIMITED" || a.adStrength === "POOR"
  );
  const issues = data.ads.filter((a) => ids.has(a.adGroupId) && a.status !== "REMOVED" && (a.policy === "DISAPPROVED" || a.policy === "APPROVED_LIMITED" || a.adStrength === "POOR")).length;

  return (
    <div>
      <ViewHeader
        title="Ads"
        subtitle={adGroup ? `In ${adGroup.name}` : campaign ? `In ${campaign.name}` : "Ads across all campaigns"}
        actions={
          <>
            <button type="button" onClick={() => runAgentTurn("Write better ads for my weakest ad group")} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 px-3 text-xs font-semibold hover:bg-muted">
              <Bot className="h-3.5 w-3.5" /> Write ads with agent
            </button>
            <button type="button" onClick={() => openDialog({ kind: "ad", adGroupId: scope.adGroupId })} className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold", ACCENT_BTN)}>
              <Plus className="h-3.5 w-3.5" /> Ad
            </button>
          </>
        }
      >
        <div className="flex flex-wrap gap-2">
          <Segmented value={filter} onChange={setFilter} options={STATUS_FILTERS} size="xs" />
          <Segmented
            value={policy}
            onChange={setPolicy}
            size="xs"
            options={[
              { value: "ALL", label: "All ads" },
              { value: "ISSUES", label: "Needs attention", count: issues },
            ]}
          />
        </div>
      </ViewHeader>
      {ads.length === 0 ? (
        <EmptyState icon={FileText} title="No ads here" body="Create a responsive search ad, or ask the agent to write one from your catalog." />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {ads.map((ad) => (
            <AdCard key={ad.id} ad={ad} />
          ))}
        </div>
      )}
    </div>
  );
}

function AdCard({ ad }: { ad: Ad }) {
  const { data, range, currency } = useGa();
  const applyDirect = useGoogleAds((s) => s.applyDirect);
  const openDialog = useGoogleAds((s) => s.openDialog);
  const group = data.adGroups.find((g) => g.id === ad.adGroupId);
  const campaign = data.campaigns.find((c) => c.id === group?.campaignId);
  const m = derive(adBase(data, ad.id, range));
  const sitelinks = data.assets.filter((a) => a.type === "SITELINK" && a.status === "ENABLED" && (a.level === "ACCOUNT" || a.parentId === campaign?.id));
  const callouts = data.assets.filter((a) => a.type === "CALLOUT" && a.status === "ENABLED" && (a.level === "ACCOUNT" || a.parentId === campaign?.id));

  return (
    <Card className={cn("flex flex-col p-4", ad.status === "REMOVED" && "opacity-50")}>
      <div className="mb-3 flex items-start gap-2">
        <StatusMenu
          status={ad.status}
          onChange={(s) => applyDirect(`${s === "ENABLED" ? "Enable" : s === "PAUSED" ? "Pause" : "Remove"} ad in ${group?.name}`, [{ kind: "status.set", entity: "AD", ids: [ad.id], status: s }])}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">{AD_TYPE_LABEL[ad.type]}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {campaign?.name} › {group?.name}
          </p>
        </div>
        <PolicyPill policy={ad.policy} />
      </div>

      {ad.type === "RESPONSIVE_SEARCH_AD" ? (
        <SearchAdPreview headlines={ad.headlines} descriptions={ad.descriptions} finalUrl={ad.finalUrl} path1={ad.path1} path2={ad.path2} sitelinks={sitelinks} callouts={callouts} compact />
      ) : (
        <div className="grid grid-cols-[96px_1fr] gap-3 rounded-xl border border-border/60 p-3">
          <ImageTile label={ad.headlines[0]?.text ?? "image"} />
          <div className="min-w-0">
            <p className="text-sm font-semibold">{ad.headlines[0]?.text}</p>
            {ad.longHeadline && <p className="text-xs text-muted-foreground">{ad.longHeadline}</p>}
            <p className="mt-1 text-xs">{ad.descriptions[0]?.text}</p>
            <p className="mt-1 text-[10px] font-semibold text-muted-foreground">{ad.businessName}</p>
          </div>
        </div>
      )}

      {ad.policyTopics && ad.policyTopics.length > 0 && (
        <div className={cn("mt-3 space-y-1 rounded-lg p-2.5 text-[11px]", ad.policy === "DISAPPROVED" ? "bg-red-500/10" : "bg-amber-500/10")}>
          {ad.policyTopics.map((p) => (
            <p key={p.topic} className="flex gap-1.5">
              <AlertTriangle className={cn("mt-0.5 h-3 w-3 shrink-0", ad.policy === "DISAPPROVED" ? "text-red-600" : "text-amber-600")} />
              <span>
                <span className="font-semibold">{p.topic}:</span> {p.detail}
              </span>
            </p>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px]">
        <AdStrengthMeter strength={ad.adStrength} />
        <span className="text-muted-foreground">
          {ad.headlines.length} headlines · {ad.descriptions.length} descriptions
        </span>
        <span className="ml-auto flex gap-1">
          {ad.type === "RESPONSIVE_SEARCH_AD" && (
            <button type="button" onClick={() => openDialog({ kind: "ad", adGroupId: ad.adGroupId, adId: ad.id })} className="inline-flex items-center gap-1 rounded-md border border-border/70 px-2 py-1 font-medium hover:bg-muted">
              <PenLine className="h-3 w-3" /> Edit
            </button>
          )}
          {(ad.policy === "DISAPPROVED" || ad.adStrength === "POOR") && (
            <button
              type="button"
              onClick={() => runAgentTurn(ad.policy === "DISAPPROVED" ? "Fix my disapproved ads" : "Write better ads for my weakest ad group")}
              className="inline-flex items-center gap-1 rounded-md bg-[#400095]/10 px-2 py-1 font-semibold text-[#400095] hover:bg-[#400095]/15 dark:bg-violet-500/15 dark:text-violet-300"
            >
              <Bot className="h-3 w-3" /> Fix with agent
            </button>
          )}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-5 gap-2 border-t border-border/60 pt-3 text-[11px]">
        {(["impressions", "clicks", "ctr", "conversions", "cpa"] as const).map((k) => (
          <div key={k}>
            <p className="text-muted-foreground">{k === "impressions" ? "Impr." : k === "clicks" ? "Clicks" : k === "ctr" ? "CTR" : k === "conversions" ? "Conv." : "Cost/conv."}</p>
            <p className="font-semibold tabular-nums">{m[k] ? formatMetric(k, m[k], currency) : "—"}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
