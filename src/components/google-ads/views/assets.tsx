"use client";

import { useState } from "react";
import { Image as ImageIcon, Link2, Megaphone, Phone, Quote, Store, Tag, BadgePercent, List, MapPin, ClipboardList, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ASSET_TYPES } from "@/lib/google-ads/constants";
import { useGoogleAds } from "@/lib/google-ads/store";
import type { Asset, AssetType } from "@/lib/google-ads/types";
import { Card, EmptyState, ImageTile, Pill, PolicyPill, Segmented, StatusMenu, ViewHeader } from "../ga-ui";
import { useGa } from "../use-ga";

const ICONS: Record<AssetType, LucideIcon> = {
  SITELINK: Link2,
  CALLOUT: Quote,
  STRUCTURED_SNIPPET: List,
  CALL: Phone,
  IMAGE: ImageIcon,
  PRICE: Tag,
  PROMOTION: BadgePercent,
  LOCATION: MapPin,
  LEAD_FORM: ClipboardList,
  BUSINESS_NAME: Store,
  BUSINESS_LOGO: Megaphone,
};

type Filter = "ALL" | AssetType;

export function AssetsView() {
  const { data, scope, campaign, adGroup } = useGa();
  const applyDirect = useGoogleAds((s) => s.applyDirect);
  const [filter, setFilter] = useState<Filter>("ALL");

  const visible = data.assets.filter((a) => {
    if (a.status === "REMOVED") return false;
    if (a.level === "ACCOUNT") return true;
    if (!scope.campaignId) return true;
    if (a.level === "CAMPAIGN") return a.parentId === scope.campaignId;
    return scope.adGroupId ? a.parentId === scope.adGroupId : data.adGroups.find((g) => g.id === a.parentId)?.campaignId === scope.campaignId;
  });
  const types = [...new Set(visible.map((a) => a.type))];
  const shown = visible.filter((a) => filter === "ALL" || a.type === filter);
  const grouped = types.filter((t) => filter === "ALL" || t === filter).map((t) => ({ type: t, items: shown.filter((a) => a.type === t) }));

  const levelLabel = (a: Asset) =>
    a.level === "ACCOUNT" ? "Account" : a.level === "CAMPAIGN" ? data.campaigns.find((c) => c.id === a.parentId)?.name ?? "Campaign" : data.adGroups.find((g) => g.id === a.parentId)?.name ?? "Ad group";

  return (
    <div>
      <ViewHeader
        title="Assets"
        subtitle={`Extra details that make ads bigger and more useful. ${adGroup ? `Showing account, campaign and ${adGroup.name} assets.` : campaign ? `Showing account and ${campaign.name} assets.` : "Showing assets at every level."}`}
      >
        <Segmented
          value={filter}
          onChange={setFilter}
          size="xs"
          options={[{ value: "ALL" as Filter, label: "All", count: visible.length }, ...types.map((t) => ({ value: t as Filter, label: ASSET_TYPES[t].label, count: visible.filter((a) => a.type === t).length }))]}
        />
      </ViewHeader>
      {grouped.length === 0 && <EmptyState icon={Link2} title="No assets yet" body="Ask the agent to add sitelinks, callouts and a phone number. Ads with assets typically get more clicks." />}
      <div className="space-y-5">
        {grouped.map(({ type, items }) => {
          const Icon = ICONS[type];
          return (
            <div key={type}>
              <p className="mb-2 flex items-center gap-2 text-sm font-bold">
                <Icon className="h-4 w-4 text-muted-foreground" /> {ASSET_TYPES[type].label}
                <span className="text-xs font-normal text-muted-foreground">· {ASSET_TYPES[type].blurb}</span>
              </p>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((a) => (
                  <Card key={a.id} className={cn("p-3.5", a.status === "PAUSED" && "opacity-70")}>
                    <div className="flex items-start gap-2">
                      <StatusMenu
                        status={a.status}
                        onChange={(s) => applyDirect(`${s === "ENABLED" ? "Enable" : s === "PAUSED" ? "Pause" : "Remove"} ${ASSET_TYPES[a.type].label.toLowerCase()} "${a.title}"`, [{ kind: "status.set", entity: "ASSET", ids: [a.id], status: s }])}
                      />
                      <div className="min-w-0 flex-1">
                        {(type === "IMAGE" || type === "BUSINESS_LOGO") && <ImageTile label={a.title} className="mb-2 w-20" />}
                        <p className="text-xs font-semibold">{type === "STRUCTURED_SNIPPET" ? `${a.title}: ` : ""}{type === "STRUCTURED_SNIPPET" ? a.lines?.join(", ") : a.title}</p>
                        {type !== "STRUCTURED_SNIPPET" && a.lines?.map((l) => <p key={l} className="text-[11px] text-muted-foreground">{l}</p>)}
                        {a.finalUrl && <p className="mt-1 truncate text-[10px] text-[#1a0dab] dark:text-[#8ab4f8]">{a.finalUrl.replace(/^https?:\/\//, "")}</p>}
                      </div>
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      <Pill tone={a.level === "ACCOUNT" ? "brand" : "neutral"}>{levelLabel(a)}</Pill>
                      <PolicyPill policy={a.policy} />
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
