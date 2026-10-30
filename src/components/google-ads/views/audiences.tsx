"use client";

import { useState } from "react";
import { Plus, Trash2, Upload, Users } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AUDIENCE_KINDS } from "@/lib/google-ads/constants";
import { num } from "@/lib/google-ads/metrics";
import { gid } from "@/lib/google-ads/mutations";
import { useGoogleAds } from "@/lib/google-ads/store";
import type { AudienceSegment, AudienceTarget } from "@/lib/google-ads/types";
import { Input } from "@/components/ui/input";
import { GaTable, type GaColumn } from "../ga-table";
import { ACCENT_BTN, Card, EmptyState, Field, Pill, Segmented, SelectBox, ViewHeader } from "../ga-ui";
import { useGa } from "../use-ga";

type Tab = "targeting" | "exclusions" | "manager";

export function AudiencesView() {
  const { data, scope, campaign, adGroup } = useGa();
  const openDialog = useGoogleAds((s) => s.openDialog);
  const applyDirect = useGoogleAds((s) => s.applyDirect);
  const [tab, setTab] = useState<Tab>("targeting");

  const inScope = data.audienceTargets.filter((t) => {
    if (!scope.campaignId) return true;
    if (t.level === "CAMPAIGN") return t.parentId === scope.campaignId;
    return scope.adGroupId ? t.parentId === scope.adGroupId : data.adGroups.find((g) => g.id === t.parentId)?.campaignId === scope.campaignId;
  });
  const targets = inScope.filter((t) => (tab === "exclusions" ? t.mode === "EXCLUSION" : t.mode !== "EXCLUSION"));

  const switchMode = (t: AudienceTarget, mode: AudienceTarget["mode"]) => {
    if (t.mode === mode) return;
    applyDirect(`Set ${data.audiences.find((s) => s.id === t.segmentId)?.name} to ${mode.toLowerCase()}`, [
      { kind: "audience.detach", ids: [t.id] },
      { kind: "audience.attach", targets: [{ ...t, id: gid("at"), mode }] },
    ]);
  };

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
            render: (t: AudienceTarget) => (
              <Segmented value={t.mode} onChange={(m) => switchMode(t, m)} size="xs" options={[{ value: "OBSERVATION", label: "Observation" }, { value: "TARGETING", label: "Targeting" }]} />
            ),
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
    {
      id: "remove",
      header: "",
      align: "right",
      render: (t) => (
        <button type="button" onClick={() => applyDirect("Remove audience segment", [{ kind: "audience.detach", ids: [t.id] }])} className="rounded p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-600" aria-label="Remove">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <ViewHeader
        title="Audiences"
        subtitle="Observation reports how a segment performs without limiting reach. Targeting shows ads only to that segment. Exclusions never show ads to it."
        actions={
          tab !== "manager" ? (
            <button type="button" onClick={() => openDialog({ kind: "audience", campaignId: campaign?.id, adGroupId: adGroup?.id })} className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold", ACCENT_BTN)}>
              <Plus className="h-3.5 w-3.5" /> {tab === "exclusions" ? "Add exclusion" : "Add segment"}
            </button>
          ) : undefined
        }
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
          body={tab === "exclusions" ? "Exclude recent buyers from prospecting campaigns so you don't pay to reach people who just bought." : "Add segments in observation to learn which audiences convert best."}
        />
      )}
    </div>
  );
}

function AudienceManager() {
  const { data } = useGa();
  const applyDirect = useGoogleAds((s) => s.applyDirect);
  const [creating, setCreating] = useState<"REMARKETING" | "CUSTOMER_MATCH" | "CUSTOM" | null>(null);
  const [name, setName] = useState("");
  const [rule, setRule] = useState("/collections/running");
  const [duration, setDuration] = useState("30");
  const [file, setFile] = useState<string | null>(null);
  const [terms, setTerms] = useState("");

  const create = () => {
    if (!creating || !name.trim()) return;
    const seg: AudienceSegment =
      creating === "REMARKETING"
        ? { id: gid("aud"), name: name.trim(), kind: "REMARKETING", rule: `Visited pages containing "${rule}"`, durationDays: Number(duration), size: 0, description: `Visitors of ${rule} in the last ${duration} days` }
        : creating === "CUSTOMER_MATCH"
          ? { id: gid("aud"), name: name.trim(), kind: "CUSTOMER_MATCH", size: 0, description: `Uploaded from ${file ?? "customers.csv"}. Matching takes up to 48 hours.` }
          : { id: gid("aud"), name: name.trim(), kind: "CUSTOM", description: `People who search for or browse: ${terms}` };
    const res = applyDirect(`Create audience "${seg.name}"`, [{ kind: "collection.upsert", collection: "audiences", items: [seg] }]);
    if (res.ok) {
      toast.success("Audience created. It fills up as people match.");
      setCreating(null);
      setName("");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {([
          ["REMARKETING", "Website visitors"],
          ["CUSTOMER_MATCH", "Customer list"],
          ["CUSTOM", "Custom segment"],
        ] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setCreating(k)} className={cn("inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold", creating === k ? "border-[#400095] bg-[#400095]/10 text-[#400095] dark:text-violet-300" : "border-border/70 hover:bg-muted")}>
            <Plus className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>
      {creating && (
        <Card className="space-y-3 p-4">
          <p className="text-sm font-bold">{creating === "REMARKETING" ? "New website visitors segment" : creating === "CUSTOMER_MATCH" ? "New customer list" : "New custom segment"}</p>
          <Field label="Segment name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={creating === "REMARKETING" ? "Running page visitors (30d)" : creating === "CUSTOMER_MATCH" ? "All customers 2026" : "Competitor shoppers"} />
          </Field>
          {creating === "REMARKETING" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Visited a page whose URL contains">
                <Input value={rule} onChange={(e) => setRule(e.target.value)} />
              </Field>
              <Field label="Membership duration">
                <SelectBox value={duration} onChange={setDuration} options={["7", "30", "90", "180", "540"].map((d) => ({ value: d, label: `${d} days` }))} />
              </Field>
            </div>
          )}
          {creating === "CUSTOMER_MATCH" && (
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border p-4 text-xs hover:bg-muted/40">
              <Upload className="h-5 w-5 text-muted-foreground" />
              <span className="flex-1">{file ? <span className="font-semibold">{file}</span> : "Upload a CSV with emails or phone numbers. Data is hashed (SHA-256) before it leaves the browser."}</span>
              <input type="file" accept=".csv" className="hidden" onChange={(e) => setFile(e.target.files?.[0]?.name ?? null)} />
            </label>
          )}
          {creating === "CUSTOM" && (
            <Field label="Interests or searches" hint="Comma separated: keywords, websites or apps your buyers use.">
              <Input value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="nike running shoes, adidas ultraboost, strava.com" />
            </Field>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setCreating(null)} className="rounded-lg border border-border/70 px-3 py-1.5 text-xs hover:bg-muted">Cancel</button>
            <button type="button" onClick={create} disabled={!name.trim() || (creating === "CUSTOMER_MATCH" && !file)} className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold", ACCENT_BTN)}>Create segment</button>
          </div>
        </Card>
      )}
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
    </div>
  );
}
