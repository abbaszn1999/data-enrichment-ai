"use client";

import { useState } from "react";
import { Users } from "lucide-react";
import { AUDIENCE_KINDS } from "@/lib/google-ads/constants";
import { num } from "@/lib/google-ads/metrics";
import type { AudienceTarget } from "@/lib/google-ads/types";
import { GaTable, type GaColumn } from "../ga-table";
import { Card, EmptyState, Pill, Segmented, ViewHeader } from "../ga-ui";
import { useGa } from "../use-ga";

type Tab = "targeting" | "exclusions" | "manager";

/** Read-only: segments are added, changed and removed by asking the agent. */
export function AudiencesView() {
  const { data, scope } = useGa();
  const [tab, setTab] = useState<Tab>("targeting");

  const inScope = data.audienceTargets.filter((t) => {
    if (!scope.campaignId) return true;
    if (t.level === "CAMPAIGN") return t.parentId === scope.campaignId;
    return scope.adGroupId ? t.parentId === scope.adGroupId : data.adGroups.find((g) => g.id === t.parentId)?.campaignId === scope.campaignId;
  });
  const targets = inScope.filter((t) => (tab === "exclusions" ? t.mode === "EXCLUSION" : t.mode !== "EXCLUSION"));

  const columns: GaColumn<AudienceTarget>[] = [
    {
      id: "segment",
      header: "Audience segment",
      render: (t) => {
        const s = data.audiences.find((x) => x.id === t.segmentId);
        return (
          <span>
            <span className="block font-semibold">{s?.name}</span>
            <span className="text-[10px] text-muted-foreground">{s && AUDIENCE_KINDS[s.kind].label}</span>
          </span>
        );
      },
    },
    {
      id: "where",
      header: "Added to",
      render: (t) => <span className="block max-w-56 truncate text-muted-foreground">{t.level === "CAMPAIGN" ? data.campaigns.find((c) => c.id === t.parentId)?.name : data.adGroups.find((g) => g.id === t.parentId)?.name}</span>,
    },
    ...(tab === "targeting"
      ? [
          {
            id: "mode",
            header: "Setting",
            render: (t: AudienceTarget) => <Pill tone={t.mode === "TARGETING" ? "brand" : "neutral"}>{t.mode === "TARGETING" ? "Targeting" : "Observation"}</Pill>,
          },
          {
            id: "bid",
            header: "Bid adj.",
            align: "right" as const,
            render: (t: AudienceTarget) => (t.bidModifier ? <span className="font-semibold text-emerald-600">+{Math.round(t.bidModifier * 100)}%</span> : <span className="text-muted-foreground">—</span>),
          },
        ]
      : []),
    {
      id: "size",
      header: "Size",
      align: "right",
      render: (t) => {
        const s = data.audiences.find((x) => x.id === t.segmentId);
        return s?.size ? num(s.size, { compact: true }) : <span className="text-muted-foreground">—</span>;
      },
    },
  ];

  return (
    <div className="space-y-4">
      <ViewHeader
        title="Audiences"
        subtitle="Observation reports how a segment performs without limiting reach. Targeting shows ads only to that segment. Exclusions never show ads to it."
      >
        <Segmented
          value={tab}
          onChange={setTab}
          size="xs"
          options={[
            { value: "targeting", label: "Targeting & observation", count: inScope.filter((t) => t.mode !== "EXCLUSION").length },
            { value: "exclusions", label: "Exclusions", count: inScope.filter((t) => t.mode === "EXCLUSION").length },
            { value: "manager", label: "Audience manager", count: data.audiences.length },
          ]}
        />
      </ViewHeader>
      {tab === "manager" ? (
        <AudienceManager />
      ) : targets.length ? (
        <GaTable rows={targets} columns={columns} rowKey={(t) => t.id} />
      ) : (
        <EmptyState
          icon={Users}
          title={tab === "exclusions" ? "No audience exclusions" : "No audience segments here"}
          body={tab === "exclusions" ? "Ask the agent to exclude recent buyers from prospecting campaigns so you don't pay to reach people who just bought." : "Ask the agent to add segments in observation to learn which audiences convert best."}
        />
      )}
    </div>
  );
}

function AudienceManager() {
  const { data } = useGa();
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {data.audiences.map((s) => (
        <Card key={s.id} className="p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-xs font-semibold">{s.name}</p>
            <span className="text-[10px] tabular-nums text-muted-foreground">{s.size !== undefined ? (s.size ? num(s.size, { compact: true }) : "Filling…") : "Google"}</span>
          </div>
          <Pill tone={s.kind === "REMARKETING" || s.kind === "CUSTOMER_MATCH" ? "brand" : "neutral"} className="mt-1.5">{AUDIENCE_KINDS[s.kind].label}</Pill>
          {s.description && <p className="mt-1.5 text-[11px] text-muted-foreground">{s.description}</p>}
          <p className="mt-1 text-[10px] text-muted-foreground">Used in {data.audienceTargets.filter((t) => t.segmentId === s.id).length} places</p>
        </Card>
      ))}
    </div>
  );
}
