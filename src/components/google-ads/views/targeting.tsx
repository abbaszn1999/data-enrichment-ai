"use client";

import { useMemo, useState } from "react";
import { Ban, Bot, Globe, MonitorPlay, Plus, Tag, Users2, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { contentMetrics, segmentRows } from "@/lib/google-ads/analytics";
import { formatMetric } from "@/lib/google-ads/metrics";
import { gid } from "@/lib/google-ads/mutations";
import { runAgentTurn } from "@/lib/google-ads/agent-runner";
import { useGoogleAds } from "@/lib/google-ads/store";
import type { ContentTarget, DemographicTarget } from "@/lib/google-ads/types";
import { Input } from "@/components/ui/input";
import { metricColumns } from "../ga-columns";
import { BulkButton, GaTable, type GaColumn } from "../ga-table";
import { ACCENT_BTN, Card, EmptyState, Field, Pill, Segmented, SelectBox, Toggle, ViewHeader } from "../ga-ui";
import { useGa } from "../use-ga";

const KIND: Record<ContentTarget["kind"], { label: string; icon: LucideIcon }> = {
  PLACEMENT: { label: "Website / app", icon: Globe },
  YOUTUBE_CHANNEL: { label: "YouTube channel", icon: MonitorPlay },
  TOPIC: { label: "Topic", icon: Tag },
  CONTENT_KEYWORD: { label: "Content keyword", icon: Tag },
};

const VISUAL_TYPES = new Set(["DISPLAY", "VIDEO", "DEMAND_GEN"]);

export function ContentView() {
  const { data, range, currency, campaign } = useGa();
  const applyDirect = useGoogleAds((s) => s.applyDirect);
  const [tab, setTab] = useState<"targeted" | "excluded">("targeted");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
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

  const exclude = (ids: string[]) => {
    const items = data.contentTargets.filter((t) => ids.includes(t.id)).map((t) => ({ ...t, excluded: true }));
    applyDirect(`Exclude ${items.length} placement${items.length > 1 ? "s" : ""}`, [{ kind: "collection.upsert", collection: "contentTargets", items }]);
    setSelected(new Set());
  };

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
    {
      id: "action",
      header: "",
      align: "right",
      render: (t) =>
        t.excluded ? (
          <BulkButton onClick={() => applyDirect(`Allow ${t.value}`, [{ kind: "collection.remove", collection: "contentTargets", ids: [t.id] }])}>Remove exclusion</BulkButton>
        ) : (
          <BulkButton tone="danger" onClick={() => exclude([t.id])}><Ban className="h-3 w-3" /> Exclude</BulkButton>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <ViewHeader
        title="Placements & content"
        subtitle="Where Display, YouTube and Demand Gen ads appear. Exclude sites and apps that spend without converting."
        actions={
          <>
            <button type="button" onClick={() => runAgentTurn("Find placements that waste budget")} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 px-3 text-xs font-semibold hover:bg-muted">
              <Bot className="h-3.5 w-3.5" /> Find bad placements
            </button>
            <button type="button" onClick={() => setAdding(true)} className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold", ACCENT_BTN)}>
              <Plus className="h-3.5 w-3.5" /> Add targeting
            </button>
          </>
        }
      >
        <Segmented value={tab} onChange={setTab} size="xs" options={[{ value: "targeted", label: "Where ads showed", count: targets.filter((t) => !t.excluded).length }, { value: "excluded", label: "Exclusions", count: targets.filter((t) => t.excluded).length }]} />
      </ViewHeader>
      {adding && <AddContentTarget campaigns={visual.map((c) => ({ id: c.id, name: c.name }))} onDone={() => setAdding(false)} />}
      <GaTable rows={rows} columns={columns} rowKey={(t) => t.id} exportName="placements" selectable={tab === "targeted"} selected={selected} onSelectedChange={setSelected} defaultSort={tab === "targeted" ? { id: "cost", dir: "desc" } : undefined} bulkActions={(ids) => <BulkButton tone="danger" onClick={() => exclude(ids)}><Ban className="h-3 w-3" /> Exclude</BulkButton>} />
    </div>
  );
}

function AddContentTarget({ campaigns, onDone }: { campaigns: { id: string; name: string }[]; onDone: () => void }) {
  const applyDirect = useGoogleAds((s) => s.applyDirect);
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? "");
  const [kind, setKind] = useState<ContentTarget["kind"]>("PLACEMENT");
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<"TARGET" | "EXCLUDE">("EXCLUDE");
  return (
    <Card className="grid gap-3 p-4 sm:grid-cols-[1fr_160px_1fr_140px_auto] sm:items-end">
      <Field label="Campaign">
        <SelectBox value={campaignId} onChange={setCampaignId} options={campaigns.map((c) => ({ value: c.id, label: c.name }))} />
      </Field>
      <Field label="Type">
        <SelectBox value={kind} onChange={setKind} options={(Object.keys(KIND) as ContentTarget["kind"][]).map((k) => ({ value: k, label: KIND[k].label }))} />
      </Field>
      <Field label="Value">
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === "PLACEMENT" ? "example.com" : kind === "YOUTUBE_CHANNEL" ? "Channel name" : "Sports & Fitness"} />
      </Field>
      <Field label="Action">
        <SelectBox value={mode} onChange={setMode} options={[{ value: "EXCLUDE", label: "Exclude" }, { value: "TARGET", label: "Target" }]} />
      </Field>
      <div className="flex gap-2">
        <button type="button" onClick={onDone} className="h-9 rounded-lg border border-border/70 px-3 text-xs hover:bg-muted">Cancel</button>
        <button
          type="button"
          disabled={!value.trim()}
          onClick={() => {
            const res = applyDirect(`${mode === "EXCLUDE" ? "Exclude" : "Target"} ${value.trim()}`, [{ kind: "collection.upsert", collection: "contentTargets", items: [{ id: gid("ct"), campaignId, kind, value: value.trim(), excluded: mode === "EXCLUDE", share: mode === "EXCLUDE" ? 0 : 1, efficiency: 1 }] }]);
            if (res.ok) {
              toast.success("Saved");
              onDone();
            }
          }}
          className={cn("h-9 rounded-lg px-3 text-xs font-semibold", ACCENT_BTN)}
        >
          Save
        </button>
      </div>
    </Card>
  );
}

// ─── Demographics ──────────────────────────────────────────────────────────

const AGE = ["18–24", "25–34", "35–44", "45–54", "55–64", "65+", "Unknown"];
const GENDER = ["Female", "Male", "Unknown"];

export function DemographicsView() {
  const { data, range, currency, campaign } = useGa();
  const applyDirect = useGoogleAds((s) => s.applyDirect);
  const eligible = data.campaigns.filter((c) => c.status !== "REMOVED" && c.type !== "PERFORMANCE_MAX" && c.type !== "SHOPPING");
  const [cid, setCid] = useState(campaign && eligible.some((c) => c.id === campaign.id) ? campaign.id : eligible[0]?.id ?? "");
  const selectedCampaign = data.campaigns.find((c) => c.id === cid);
  const ageRows = useMemo(() => (cid ? segmentRows(data, range, "age", [cid]) : []), [data, range, cid]);
  const genderRows = useMemo(() => (cid ? segmentRows(data, range, "gender", [cid]) : []), [data, range, cid]);

  if (!selectedCampaign) return <div><ViewHeader title="Demographics" /><EmptyState icon={Users2} title="No campaigns that support demographics" body="Performance Max and Shopping use audience signals instead." /></div>;

  const smart = !["MANUAL_CPC"].includes(selectedCampaign.bidding.type);
  const record = (kind: DemographicTarget["kind"], value: string): DemographicTarget =>
    data.demographics.find((d) => d.campaignId === cid && d.kind === kind && d.value === value) ?? { id: gid("dm"), campaignId: cid, kind, value, excluded: false };

  const save = (d: DemographicTarget, title: string) => applyDirect(title, [{ kind: "collection.upsert", collection: "demographics", items: [d] }]);

  const block = (kind: "AGE" | "GENDER", values: string[], rows: ReturnType<typeof segmentRows>) => (
    <Card className="overflow-hidden">
      <p className="border-b border-border/60 px-4 py-3 text-sm font-bold">{kind === "AGE" ? "Age" : "Gender"}</p>
      <div className="divide-y divide-border/40">
        {values.map((v) => {
          const d = record(kind, v);
          const m = rows.find((r) => r.key === v)?.metrics;
          return (
            <div key={v} className={cn("grid grid-cols-[90px_1fr_auto_auto] items-center gap-3 px-4 py-2.5 text-xs sm:grid-cols-[90px_repeat(3,minmax(0,1fr))_auto_auto]", d.excluded && "opacity-60")}>
              <span className="font-semibold">{v}</span>
              {m && !d.excluded ? (
                <>
                  <span className="text-muted-foreground">{formatMetric("cost", m.cost, currency)}</span>
                  <span className="hidden text-muted-foreground sm:block">{formatMetric("conversions", m.conversions, currency)} conv.</span>
                  <span className={cn("hidden font-semibold sm:block", m.roas >= 3 ? "text-emerald-600" : m.roas < 1.5 ? "text-red-600" : "")}>{m.roas.toFixed(2)}x</span>
                </>
              ) : (
                <span className="col-span-1 text-muted-foreground sm:col-span-3">{d.excluded ? "Excluded" : "—"}</span>
              )}
              <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <input
                  key={d.bidModifier ?? 0}
                  type="number"
                  disabled={d.excluded || smart}
                  defaultValue={Math.round((d.bidModifier ?? 0) * 100)}
                  onBlur={(e) => {
                    const bm = Number(e.target.value) / 100;
                    if (bm !== (d.bidModifier ?? 0)) save({ ...d, bidModifier: bm || undefined }, `Bid adjustment ${v}: ${Math.round(bm * 100)}%`);
                  }}
                  title={smart ? "Smart Bidding sets these automatically" : "Bid adjustment"}
                  className="h-7 w-14 rounded border border-input bg-background px-1.5 text-right disabled:opacity-50"
                />
                %
              </label>
              <Toggle checked={!d.excluded} label={`Show ads to ${v}`} onChange={(on) => save({ ...d, excluded: !on }, `${on ? "Include" : "Exclude"} ${kind === "AGE" ? "age" : "gender"} ${v}`)} />
            </div>
          );
        })}
      </div>
    </Card>
  );

  return (
    <div className="space-y-4">
      <ViewHeader
        title="Demographics"
        subtitle="Who sees your ads by age and gender. Exclude groups that don't buy, or adjust bids (manual bidding only)."
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
