"use client";

import { useMemo, useState } from "react";
import { Bot, Globe, MonitorPlay, Tag, Users2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { contentMetrics, segmentRows } from "@/lib/google-ads/analytics";
import { formatMetric } from "@/lib/google-ads/metrics";
import { runAgentTurn } from "@/lib/google-ads/agent-runner";
import type { ContentTarget } from "@/lib/google-ads/types";
import { metricColumns } from "../ga-columns";
import { GaTable, type GaColumn } from "../ga-table";
import { EmptyState, Pill, Segmented, SelectBox, ViewHeader } from "../ga-ui";
import { useGa } from "../use-ga";

const KIND: Record<ContentTarget["kind"], { label: string; icon: LucideIcon }> = {
  PLACEMENT: { label: "Website / app", icon: Globe },
  YOUTUBE_CHANNEL: { label: "YouTube channel", icon: MonitorPlay },
  TOPIC: { label: "Topic", icon: Tag },
  CONTENT_KEYWORD: { label: "Content keyword", icon: Tag },
};

const VISUAL_TYPES = new Set(["DISPLAY", "VIDEO", "DEMAND_GEN"]);

/** Read-only: placements are targeted and excluded by asking the agent. */
export function ContentView() {
  const { data, range, currency, campaign } = useGa();
  const [tab, setTab] = useState<"targeted" | "excluded">("targeted");
  const visual = data.campaigns.filter((c) => VISUAL_TYPES.has(c.type) && c.status !== "REMOVED" && (!campaign || c.id === campaign.id));
  const targets = data.contentTargets.filter((t) => visual.some((c) => c.id === t.campaignId));
  const metrics = useMemo(() => contentMetrics(data, range, data.contentTargets), [data, range]);
  const rows = targets.filter((t) => (tab === "excluded" ? t.excluded : !t.excluded));

  if (!visual.length) {
    return (
      <div>
        <ViewHeader title="Placements & content" />
        <EmptyState icon={Globe} title="No Display, Video or Demand Gen campaigns here" body="Placements, topics and YouTube channels control where visual ads appear." />
      </div>
    );
  }

  const columns: GaColumn<ContentTarget>[] = [
    {
      id: "value",
      header: "Where ads showed",
      label: "Placement",
      sticky: true,
      sortValue: (t) => t.value,
      render: (t) => {
        const k = KIND[t.kind];
        return (
          <span className="flex items-center gap-2">
            <k.icon className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-semibold">{t.value.replace("mobileapp::", "App: ")}</span>
          </span>
        );
      },
    },
    { id: "kind", header: "Type", label: "Type", render: (t) => <span className="text-muted-foreground">{KIND[t.kind].label}</span> },
    { id: "campaign", header: "Campaign", label: "Campaign", render: (t) => <span className="block max-w-48 truncate text-muted-foreground">{data.campaigns.find((c) => c.id === t.campaignId)?.name}</span> },
    ...(tab === "targeted" ? metricColumns<ContentTarget>((t) => metrics.get(t.id)!, currency, { keys: ["impressions", "clicks", "ctr", "cost", "conversions", "cpa"] }) : []),
  ];

  return (
    <div className="space-y-4">
      <ViewHeader
        title="Placements & content"
        subtitle="Where Display, YouTube and Demand Gen ads appear. To exclude sites and apps that spend without converting, ask the agent."
        actions={
          <button type="button" onClick={() => runAgentTurn("Find placements that waste budget")} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 px-3 text-xs font-semibold hover:bg-muted">
            <Bot className="h-3.5 w-3.5" /> Find bad placements
          </button>
        }
      >
        <Segmented value={tab} onChange={setTab} size="xs" options={[{ value: "targeted", label: "Where ads showed", count: targets.filter((t) => !t.excluded).length }, { value: "excluded", label: "Exclusions", count: targets.filter((t) => t.excluded).length }]} />
      </ViewHeader>
      <GaTable rows={rows} columns={columns} rowKey={(t) => t.id} exportName="placements" defaultSort={tab === "targeted" ? { id: "cost", dir: "desc" } : undefined} />
    </div>
  );
}

// ─── Demographics ──────────────────────────────────────────────────────────

const AGE = ["18–24", "25–34", "35–44", "45–54", "55–64", "65+", "Unknown"];
const GENDER = ["Female", "Male", "Unknown"];

/** Read-only: exclusions and bid adjustments are changed by asking the agent. */
export function DemographicsView() {
  const { data, range, currency, campaign } = useGa();
  const eligible = data.campaigns.filter((c) => c.status !== "REMOVED" && c.type !== "PERFORMANCE_MAX" && c.type !== "SHOPPING");
  const [cid, setCid] = useState(campaign && eligible.some((c) => c.id === campaign.id) ? campaign.id : eligible[0]?.id ?? "");
  const selectedCampaign = data.campaigns.find((c) => c.id === cid);
  const ageRows = useMemo(() => (cid ? segmentRows(data, range, "age", [cid]) : []), [data, range, cid]);
  const genderRows = useMemo(() => (cid ? segmentRows(data, range, "gender", [cid]) : []), [data, range, cid]);

  if (!selectedCampaign) return <div><ViewHeader title="Demographics" /><EmptyState icon={Users2} title="No campaigns that support demographics" body="Performance Max and Shopping use audience signals instead." /></div>;

  const smart = !["MANUAL_CPC"].includes(selectedCampaign.bidding.type);
  const record = (kind: "AGE" | "GENDER", value: string) => data.demographics.find((d) => d.campaignId === cid && d.kind === kind && d.value === value);

  const block = (kind: "AGE" | "GENDER", values: string[], rows: ReturnType<typeof segmentRows>) => (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
      <p className="border-b border-border/60 px-4 py-3 text-sm font-bold">{kind === "AGE" ? "Age" : "Gender"}</p>
      <div className="divide-y divide-border/40">
        {values.map((v) => {
          const d = record(kind, v);
          const excluded = !!d?.excluded;
          const m = rows.find((r) => r.key === v)?.metrics;
          const bid = d?.bidModifier;
          return (
            <div key={v} className={cn("grid grid-cols-[90px_1fr_auto] items-center gap-3 px-4 py-2.5 text-xs sm:grid-cols-[90px_repeat(3,minmax(0,1fr))_auto]", excluded && "opacity-60")}>
              <span className="font-semibold">{v}</span>
              {m && !excluded ? (
                <>
                  <span className="text-muted-foreground">{formatMetric("cost", m.cost, currency)}</span>
                  <span className="hidden text-muted-foreground sm:block">{formatMetric("conversions", m.conversions, currency)} conv.</span>
                  <span className={cn("hidden font-semibold sm:block", m.roas >= 3 ? "text-emerald-600" : m.roas < 1.5 ? "text-red-600" : "")}>{m.roas.toFixed(2)}x</span>
                </>
              ) : (
                <span className="col-span-1 text-muted-foreground sm:col-span-3">{excluded ? "Excluded" : "—"}</span>
              )}
              <span className="justify-self-end text-[11px] text-muted-foreground">
                {excluded ? <Pill tone="bad">Excluded</Pill> : bid ? <span className="font-semibold text-foreground">{bid > 0 ? "+" : ""}{Math.round(bid * 100)}% bid</span> : "No bid adj."}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <ViewHeader
        title="Demographics"
        subtitle="Who sees your ads by age and gender. To exclude groups that don't buy, or adjust bids, ask the agent."
        actions={
          <button type="button" onClick={() => runAgentTurn("Which age groups and genders convert best?")} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 px-3 text-xs font-semibold hover:bg-muted">
            <Bot className="h-3.5 w-3.5" /> Analyse with agent
          </button>
        }
      >
        {!campaign && <SelectBox value={cid} onChange={setCid} options={eligible.map((c) => ({ value: c.id, label: c.name }))} className="w-72" />}
      </ViewHeader>
      {smart && <p className="text-[11px] text-muted-foreground"><Pill tone="info">Smart Bidding</Pill> adjusts bids by demographic automatically; exclusions still apply.</p>}
      <div className="grid gap-4 xl:grid-cols-2">
        {block("AGE", AGE, ageRows)}
        {block("GENDER", GENDER, genderRows)}
      </div>
    </div>
  );
}
