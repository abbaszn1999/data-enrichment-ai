"use client";

import { Ban, Laptop, MapPin, Smartphone, Tablet } from "lucide-react";
import { cn } from "@/lib/utils";
import { WEEKDAYS } from "@/lib/google-ads/constants";
import { useGoogleAds } from "@/lib/google-ads/store";
import type { Campaign } from "@/lib/google-ads/types";
import { Card, Pill, ViewHeader } from "../ga-ui";
import { useGa } from "../use-ga";

const pct = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`;

/** Read-only: targeting is changed by asking the agent. */
export function LocationsView() {
  const { data, campaign } = useGa();
  const setScope = useGoogleAds((s) => s.setScope);
  if (!campaign) {
    return (
      <div>
        <ViewHeader title="Locations" subtitle="Where each campaign shows. Open a campaign to see its targeting." />
        <Card className="divide-y divide-border/50">
          {data.campaigns.filter((c) => c.status !== "REMOVED").map((c) => (
            <button key={c.id} type="button" onClick={() => setScope({ campaignId: c.id }, "locations")} className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left hover:bg-muted/30">
              <span className="w-56 truncate text-xs font-semibold">{c.name}</span>
              {c.locations.map((l) => (
                <Pill key={l.id} tone={l.excluded ? "bad" : "neutral"}>{l.excluded ? "Excl. " : ""}{l.name}</Pill>
              ))}
              <span className="ml-auto text-[11px] text-muted-foreground">{c.languages.join(", ")}</span>
            </button>
          ))}
        </Card>
      </div>
    );
  }
  return <CampaignLocations campaign={campaign} />;
}

function CampaignLocations({ campaign }: { campaign: Campaign }) {
  return (
    <div className="space-y-4">
      <ViewHeader title="Locations" subtitle={`Where ${campaign.name} shows. To change it, ask the agent.`} />
      <Card className="p-4">
        <p className="mb-3 flex items-center gap-2 text-sm font-bold"><MapPin className="h-4 w-4 text-muted-foreground" /> Locations</p>
        <div className="overflow-hidden rounded-xl border border-border/60">
          {campaign.locations.map((l) => (
            <div key={l.id} className="flex items-center gap-3 border-b border-border/40 px-3 py-2 text-xs last:border-b-0">
              {l.excluded ? <Ban className="h-3.5 w-3.5 text-red-600" /> : <MapPin className="h-3.5 w-3.5 text-emerald-600" />}
              <span className="font-semibold">{l.name}</span>
              <span className="text-muted-foreground">{l.kind} · {l.excluded ? "Excluded" : "Targeted"}</span>
              {!l.excluded && <span className="ml-auto text-[11px] text-muted-foreground">Bid adj. <span className="font-semibold text-foreground">{l.bidModifier ? pct(l.bidModifier) : "none"}</span></span>}
            </div>
          ))}
          {!campaign.locations.length && <p className="px-3 py-4 text-xs text-muted-foreground">All countries and territories.</p>}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Languages: {campaign.languages.join(", ")}</p>
      </Card>
    </div>
  );
}

/** Ad schedule tab: account level lists every campaign, inside a campaign shows its hour grid. */
export function ScheduleView() {
  const { data, campaign } = useGa();
  const setScope = useGoogleAds((s) => s.setScope);
  if (!campaign) {
    return (
      <div>
        <ViewHeader title="Ad schedule" subtitle="When each campaign shows. Open a campaign to see its hours." />
        <Card className="divide-y divide-border/50">
          {data.campaigns.filter((c) => c.status !== "REMOVED").map((c) => (
            <button key={c.id} type="button" onClick={() => setScope({ campaignId: c.id }, "schedule")} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/30">
              <span className="w-56 truncate text-xs font-semibold">{c.name}</span>
              <Pill tone={c.schedule.length ? "brand" : "neutral"}>{c.schedule.length ? `${c.schedule.length} schedule rules` : "All day, every day"}</Pill>
            </button>
          ))}
        </Card>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <ViewHeader title="Ad schedule" subtitle={`When ${campaign.name} shows. To change it, ask the agent.`} />
      <SchedulePanel campaign={campaign} />
    </div>
  );
}

/** Devices tab: account level lists every campaign's device adjustments, inside a campaign shows its values. */
export function DevicesView() {
  const { data, campaign } = useGa();
  const setScope = useGoogleAds((s) => s.setScope);
  if (!campaign) {
    return (
      <div>
        <ViewHeader title="Devices" subtitle="Bid adjustments by device. Open a campaign to see them." />
        <Card className="divide-y divide-border/50">
          {data.campaigns.filter((c) => c.status !== "REMOVED").map((c) => (
            <button key={c.id} type="button" onClick={() => setScope({ campaignId: c.id }, "devices")} className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left hover:bg-muted/30">
              <span className="w-56 truncate text-xs font-semibold">{c.name}</span>
              <Pill>Mobile {pct(c.devices.mobile)}</Pill>
              <Pill>Computers {pct(c.devices.desktop)}</Pill>
              <Pill>Tablets {pct(c.devices.tablet)}</Pill>
            </button>
          ))}
        </Card>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <ViewHeader title="Devices" subtitle={`Bid adjustments for ${campaign.name}. To change them, ask the agent.`} />
      <DevicesPanel campaign={campaign} />
    </div>
  );
}

function SchedulePanel({ campaign }: { campaign: Campaign }) {
  const allDay = campaign.schedule.length === 0;
  const active = (day: Campaign["schedule"][number]["day"], hour: number) => allDay || campaign.schedule.some((s) => s.day === day && hour >= s.startHour && hour < s.endHour);
  const modifierFor = (day: Campaign["schedule"][number]["day"], hour: number) => campaign.schedule.find((s) => s.day === day && hour >= s.startHour && hour < s.endHour)?.bidModifier;

  return (
    <Card className="p-4">
      <div className="mb-3">
        <p className="text-sm font-bold">Ad schedule</p>
        <p className="text-[11px] text-muted-foreground">{allDay ? "Ads run all day, every day." : `${campaign.schedule.length} rules · darker cells have a bid adjustment.`}</p>
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[640px] grid-cols-[48px_repeat(24,1fr)] gap-px text-[9px]">
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="text-center text-muted-foreground">{h % 3 === 0 ? h : ""}</span>
          ))}
          {WEEKDAYS.map((day) => (
            <div key={day} className="contents">
              <span className="pr-1 text-right font-semibold text-muted-foreground">{day.slice(0, 3)}</span>
              {Array.from({ length: 24 }, (_, h) => {
                const on = active(day, h);
                const mod = modifierFor(day, h);
                return <span key={h} title={`${day} ${h}:00${mod ? ` · +${Math.round(mod * 100)}%` : ""}`} className={cn("h-5 rounded-sm", on ? (mod ? "bg-[#400095] dark:bg-violet-500" : "bg-[#400095]/40 dark:bg-violet-500/40") : "bg-muted")} />;
              })}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function DevicesPanel({ campaign }: { campaign: Campaign }) {
  const items = [
    { key: "mobile" as const, label: "Mobile phones", icon: Smartphone },
    { key: "desktop" as const, label: "Computers", icon: Laptop },
    { key: "tablet" as const, label: "Tablets", icon: Tablet },
  ];
  return (
    <Card className="p-4">
      <p className="text-sm font-bold">Devices</p>
      <p className="mb-3 text-[11px] text-muted-foreground">Bid adjustments by device. Smart Bidding sets these automatically, except -100%.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {items.map((d) => (
          <div key={d.key} className="flex items-center gap-3 rounded-xl border border-border/60 p-3">
            <d.icon className="h-5 w-5 text-muted-foreground" />
            <span className="flex-1 text-xs font-semibold">{d.label}</span>
            <span className="text-xs font-semibold tabular-nums">{campaign.devices[d.key] ? pct(campaign.devices[d.key]) : "No adj."}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
