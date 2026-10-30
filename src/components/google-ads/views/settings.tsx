"use client";

import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { BIDDING, BIDDING_BY_TYPE, CAMPAIGN_TYPES, LANGUAGES, OBJECTIVES } from "@/lib/google-ads/constants";
import { useGoogleAds } from "@/lib/google-ads/store";
import type { BiddingStrategyType, Campaign, CampaignObjective, MutateOp } from "@/lib/google-ads/types";
import { Input } from "@/components/ui/input";
import { ACCENT_BTN, Card, Field, SelectBox, Toggle, ViewHeader } from "../ga-ui";
import { useGa } from "../use-ga";

export function SettingsView() {
  const { campaign } = useGa();
  if (!campaign) return null;
  // Remount the form whenever the campaign changes (e.g. after an undo).
  return <SettingsForm key={`${campaign.id}:${JSON.stringify(campaign)}`} campaign={campaign} />;
}

function SettingsForm({ campaign }: { campaign: Campaign }) {
  const { data, currency } = useGa();
  const applyDirect = useGoogleAds((s) => s.applyDirect);
  const budget = data.budgets.find((b) => b.id === campaign.budgetId);
  const [draft, setDraft] = useState(campaign);
  const [amount, setAmount] = useState(String(budget?.amount ?? ""));
  const set = <K extends keyof Campaign>(key: K, value: Campaign[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const changedKeys = (Object.keys(draft) as (keyof Campaign)[]).filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(campaign[k]));
  const budgetChanged = budget && Number(amount) !== budget.amount;
  const dirty = changedKeys.length > 0 || budgetChanged;
  const target = BIDDING[draft.bidding.type].target;

  const save = () => {
    const patch = Object.fromEntries(changedKeys.map((k) => [k, draft[k]])) as Partial<Campaign>;
    const ops: MutateOp[] = [];
    if (changedKeys.length) ops.push({ kind: "campaign.update", campaignId: campaign.id, patch });
    if (budgetChanged) ops.push({ kind: "budget.update", budgetId: budget!.id, amount: Number(amount) });
    const res = applyDirect(`Edit settings · ${campaign.name}`, ops);
    if (res.ok) toast.success("Settings saved");
    else toast.error(res.error);
  };

  return (
    <div className="pb-20">
      <ViewHeader title="Campaign settings" subtitle={`${CAMPAIGN_TYPES[campaign.type].label} · created ${new Date(campaign.createdAt).toLocaleDateString()}`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-4 p-4">
          <p className="text-sm font-bold">General</p>
          <Field label="Campaign name">
            <Input value={draft.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Goal">
            <SelectBox<CampaignObjective>
              value={draft.objective}
              onChange={(v) => set("objective", v)}
              options={(Object.keys(OBJECTIVES) as CampaignObjective[]).filter((o) => OBJECTIVES[o].types.includes(campaign.type)).map((o) => ({ value: o, label: OBJECTIVES[o].label }))}
            />
          </Field>
          <Field label="Conversion goals" hint="Bidding uses these primary actions.">
            <div className="flex flex-wrap gap-1.5">
              {data.conversions.filter((c) => c.status !== "REMOVED").map((c) => {
                const on = draft.conversionActionIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => set("conversionActionIds", on ? draft.conversionActionIds.filter((x) => x !== c.id) : [...draft.conversionActionIds, c.id])}
                    className={cn("rounded-full border px-2.5 py-1 text-[11px]", on ? "border-[#400095] bg-[#400095]/10 font-semibold text-[#400095] dark:border-violet-400 dark:text-violet-300" : "border-border/70 text-muted-foreground")}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date">
              <Input type="date" value={draft.startDate} onChange={(e) => set("startDate", e.target.value)} />
            </Field>
            <Field label="End date" hint="Optional">
              <Input type="date" value={draft.endDate ?? ""} onChange={(e) => set("endDate", e.target.value || undefined)} />
            </Field>
          </div>
        </Card>

        <Card className="space-y-4 p-4">
          <p className="text-sm font-bold">Budget and bidding</p>
          <Field label={`Average daily budget (${currency})`} hint={`You'll pay at most ≈ ${(Number(amount) * 30.4 || 0).toFixed(0)} ${currency} per month. Some days spend up to 2× the daily budget.`}>
            <Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Bid strategy">
            <SelectBox<BiddingStrategyType>
              value={draft.bidding.type}
              onChange={(v) => set("bidding", { type: v })}
              options={BIDDING_BY_TYPE[campaign.type].map((b) => ({ value: b, label: BIDDING[b].label }))}
            />
          </Field>
          {target === "CPA" && (
            <Field label={`Target cost per action (${currency})`}>
              <Input type="number" value={draft.bidding.targetCpa ?? ""} onChange={(e) => set("bidding", { ...draft.bidding, targetCpa: Number(e.target.value) || undefined })} />
            </Field>
          )}
          {target === "ROAS" && (
            <Field label="Target ROAS (%)" hint="Conversion value you aim for per unit of spend. 400% = 4× return.">
              <Input type="number" value={draft.bidding.targetRoas ? Math.round(draft.bidding.targetRoas * 100) : ""} onChange={(e) => set("bidding", { ...draft.bidding, targetRoas: Number(e.target.value) / 100 || undefined })} />
            </Field>
          )}
          {target === "CPC" && (
            <Field label={`Maximum CPC bid limit (${currency})`} hint="Optional cap per click.">
              <Input type="number" value={draft.bidding.maxCpcLimit ?? ""} onChange={(e) => set("bidding", { ...draft.bidding, maxCpcLimit: Number(e.target.value) || undefined })} />
            </Field>
          )}
        </Card>

        <Card className="space-y-3 p-4">
          <p className="text-sm font-bold">Networks</p>
          {[
            { key: "googleSearch" as const, label: "Google Search", hint: "Always on for Search campaigns", lock: campaign.type === "SEARCH" },
            { key: "searchPartners" as const, label: "Search partners", hint: "Sites that partner with Google to show search ads" },
            { key: "displayNetwork" as const, label: "Display Network", hint: "Show ads on sites across the web. Usually off for Search." },
          ].map((n) => (
            <div key={n.key} className="flex items-center gap-3">
              <div className="flex-1">
                <p className="text-xs font-semibold">{n.label}</p>
                <p className="text-[11px] text-muted-foreground">{n.hint}</p>
              </div>
              <Toggle checked={draft.networks[n.key]} disabled={n.lock} onChange={(v) => set("networks", { ...draft.networks, [n.key]: v })} label={n.label} />
            </div>
          ))}
        </Card>

        <Card className="space-y-4 p-4">
          <p className="text-sm font-bold">Audience and more</p>
          <Field label="Languages">
            <div className="flex flex-wrap gap-1.5">
              {LANGUAGES.map((l) => {
                const on = draft.languages.includes(l);
                return (
                  <button
                    key={l}
                    type="button"
                    onClick={() => set("languages", on ? draft.languages.filter((x) => x !== l) : [...draft.languages, l])}
                    className={cn("rounded-full border px-2.5 py-1 text-[11px]", on ? "border-[#400095] bg-[#400095]/10 font-semibold text-[#400095] dark:border-violet-400 dark:text-violet-300" : "border-border/70 text-muted-foreground")}
                  >
                    {l}
                  </button>
                );
              })}
            </div>
          </Field>
          {campaign.type === "SEARCH" && (
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <p className="text-xs font-semibold">AI Max for Search</p>
                <p className="text-[11px] text-muted-foreground">Search term matching and final URL expansion beyond your keywords.</p>
              </div>
              <Toggle checked={!!draft.aiMax} onChange={(v) => set("aiMax", v)} label="AI Max" />
            </div>
          )}
          {campaign.type === "PERFORMANCE_MAX" && (
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <p className="text-xs font-semibold">Final URL expansion</p>
                <p className="text-[11px] text-muted-foreground">Let Google send people to other pages on your site when they match the search better. Turn off to keep traffic on your final URLs.</p>
              </div>
              <Toggle checked={!!draft.finalUrlExpansion} onChange={(v) => set("finalUrlExpansion", v)} label="Final URL expansion" />
            </div>
          )}
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <p className="text-xs font-semibold">EU political ads</p>
              <p className="text-[11px] text-muted-foreground">Required declaration: does this campaign contain EU political advertising?</p>
            </div>
            <Toggle checked={draft.euPoliticalAds} onChange={(v) => set("euPoliticalAds", v)} label="EU political ads" />
          </div>
        </Card>
      </div>

      {dirty && (
        <div className="fixed bottom-4 right-6 z-30 flex items-center gap-3 rounded-2xl border border-border bg-background px-4 py-3 shadow-2xl">
          <span className="text-xs text-muted-foreground">Unsaved changes</span>
          <button type="button" onClick={() => { setDraft(campaign); setAmount(String(budget?.amount ?? "")); }} className="rounded-lg border border-border/70 px-3 py-1.5 text-xs font-medium hover:bg-muted">
            Discard
          </button>
          <button type="button" onClick={save} className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold", ACCENT_BTN)}>
            Save
          </button>
        </div>
      )}
    </div>
  );
}
