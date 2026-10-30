"use client";

import { useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Beaker, Calculator, Check, FlaskConical, Plus, Search, Square } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { GEO_TARGETS, LANGUAGES } from "@/lib/google-ads/constants";
import { forecastCampaign, keywordIdeas, type KeywordIdea } from "@/lib/google-ads/analytics";
import { addDays, money, num } from "@/lib/google-ads/metrics";
import { gid } from "@/lib/google-ads/mutations";
import { useGoogleAds } from "@/lib/google-ads/store";
import type { Experiment, MatchType, MutateOp } from "@/lib/google-ads/types";
import { Input } from "@/components/ui/input";
import { BulkButton, GaTable, type GaColumn } from "../ga-table";
import { ACCENT_BTN, Card, Delta, EmptyState, Field, Pill, SelectBox, ViewHeader } from "../ga-ui";
import { useGa } from "../use-ga";

// ─── Keyword Planner ───────────────────────────────────────────────────────

export function KeywordPlannerView() {
  const { data } = useGa();
  const applyDirect = useGoogleAds((s) => s.applyDirect);
  const [seed, setSeed] = useState("running shoes");
  const [location, setLocation] = useState("Saudi Arabia");
  const [language, setLanguage] = useState("English");
  const [query, setQuery] = useState({ seed: "running shoes", location: "Saudi Arabia", language: "English" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const groups = data.adGroups.filter((g) => g.type === "SEARCH_STANDARD" && g.status !== "REMOVED");
  const [target, setTarget] = useState(groups[0]?.id ?? "");
  const [match, setMatch] = useState<MatchType>("PHRASE");
  const ideas = useMemo(() => keywordIdeas(query.seed, query), [query]);

  const add = (texts: string[]) => {
    if (!target) return toast.error("Create a Search ad group first");
    const existing = new Set(data.keywords.filter((k) => k.adGroupId === target).map((k) => `${k.matchType}:${k.text}`));
    const keywords = texts.filter((t) => !existing.has(`${match}:${t}`)).map((text) => ({ id: gid("k"), adGroupId: target, text, matchType: match, status: "ENABLED" as const, policy: "UNDER_REVIEW" as const }));
    if (!keywords.length) return toast.info("Those keywords are already in the ad group");
    const res = applyDirect(`Add ${keywords.length} keyword${keywords.length > 1 ? "s" : ""} from Keyword Planner`, [{ kind: "keyword.create", keywords }]);
    if (res.ok) toast.success(`Added ${keywords.length} keywords`);
    setSelected(new Set());
  };

  const columns: GaColumn<KeywordIdea>[] = [
    { id: "text", header: "Keyword", label: "Keyword", sortValue: (k) => k.text, render: (k) => <span className="font-semibold">{k.text}</span> },
    {
      id: "volume",
      header: "Avg. monthly searches",
      label: "Avg. monthly searches",
      align: "right",
      sortValue: (k) => k.volume,
      render: (k) => {
        const max = Math.max(...k.trend);
        return (
          <span className="flex items-center justify-end gap-2">
            <span className="flex h-5 items-end gap-px">
              {k.trend.map((v, i) => (
                <span key={i} className="w-1 rounded-sm bg-[#400095]/60 dark:bg-violet-400/60" style={{ height: `${Math.max(10, (v / max) * 100)}%` }} />
              ))}
            </span>
            <span className="w-14 tabular-nums">{num(k.volume, { compact: true })}</span>
          </span>
        );
      },
    },
    { id: "competition", header: "Competition", label: "Competition", sortValue: (k) => k.competition, render: (k) => <Pill tone={k.competition === "HIGH" ? "bad" : k.competition === "MEDIUM" ? "warn" : "good"}>{k.competition.toLowerCase()}</Pill> },
    { id: "low", header: "Top of page bid (low)", label: "Top of page bid (low)", align: "right", sortValue: (k) => k.bidLow, render: (k) => money(k.bidLow, "USD", { decimals: 2 }) },
    { id: "high", header: "Top of page bid (high)", label: "Top of page bid (high)", align: "right", sortValue: (k) => k.bidHigh, render: (k) => money(k.bidHigh, "USD", { decimals: 2 }) },
  ];

  return (
    <div className="space-y-4">
      <ViewHeader title="Keyword Planner" subtitle="Find keywords, see how often people search for them and what a click costs." />
      <Card className="grid gap-3 p-4 sm:grid-cols-[1fr_200px_150px_auto] sm:items-end">
        <Field label="Products or services">
          <Input value={seed} onChange={(e) => setSeed(e.target.value)} onKeyDown={(e) => e.key === "Enter" && setQuery({ seed, location, language })} placeholder="e.g. trail running shoes" />
        </Field>
        <Field label="Location">
          <SelectBox value={location} onChange={setLocation} options={GEO_TARGETS.filter((g) => g.kind === "Country").map((g) => ({ value: g.name, label: g.name }))} />
        </Field>
        <Field label="Language">
          <SelectBox value={language} onChange={setLanguage} options={LANGUAGES.map((l) => ({ value: l, label: l }))} />
        </Field>
        <button type="button" onClick={() => setQuery({ seed, location, language })} className={cn("inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-xs font-semibold", ACCENT_BTN)}>
          <Search className="h-3.5 w-3.5" /> Get results
        </button>
      </Card>
      {groups.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Add selected to</span>
          <SelectBox value={target} onChange={setTarget} options={groups.map((g) => ({ value: g.id, label: `${data.campaigns.find((c) => c.id === g.campaignId)?.name} › ${g.name}` }))} className="w-80" />
          <SelectBox value={match} onChange={setMatch} options={[{ value: "BROAD", label: "Broad match" }, { value: "PHRASE", label: "Phrase match" }, { value: "EXACT", label: "Exact match" }]} className="w-36" />
        </div>
      )}
      <GaTable
        rows={ideas}
        columns={columns}
        rowKey={(k) => k.text}
        exportName="keyword-ideas"
        selectable
        selected={selected}
        onSelectedChange={setSelected}
        defaultSort={{ id: "volume", dir: "desc" }}
        bulkActions={(ids) => <BulkButton onClick={() => add(ids)}><Plus className="h-3 w-3" /> Add {ids.length} to ad group</BulkButton>}
      />
    </div>
  );
}

// ─── Experiments ───────────────────────────────────────────────────────────

const EXP_TEMPLATES: { id: string; label: string; build: (campaignId: string, data: ReturnType<typeof useGa>["data"]) => { change: string; ops: MutateOp[] } }[] = [
  {
    id: "troas",
    label: "Bid to a target ROAS",
    build: (cid) => ({ change: "Switch bidding to Target ROAS 400%", ops: [{ kind: "campaign.update", campaignId: cid, patch: { bidding: { type: "TARGET_ROAS", targetRoas: 4 } } }] }),
  },
  {
    id: "tcpa",
    label: "Bid to a target CPA",
    build: (cid) => ({ change: "Switch bidding to Target CPA $20", ops: [{ kind: "campaign.update", campaignId: cid, patch: { bidding: { type: "TARGET_CPA", targetCpa: 20 } } }] }),
  },
  {
    id: "broad",
    label: "Broad match keywords",
    build: (cid, data) => {
      const groups = new Set(data.adGroups.filter((g) => g.campaignId === cid).map((g) => g.id));
      const ks = data.keywords.filter((k) => groups.has(k.adGroupId) && k.status === "ENABLED" && k.matchType !== "BROAD");
      return { change: `Switch ${ks.length} keywords to broad match`, ops: ks.map((k) => ({ kind: "keyword.update" as const, keywordId: k.id, patch: { matchType: "BROAD" as const } })) };
    },
  },
  {
    id: "aimax",
    label: "Turn on AI Max for Search",
    build: (cid) => ({ change: "Enable AI Max (search term matching + URL expansion)", ops: [{ kind: "campaign.update", campaignId: cid, patch: { aiMax: true } }] }),
  },
];

export function ExperimentsView() {
  const { data } = useGa();
  const applyDirect = useGoogleAds((s) => s.applyDirect);
  const [creating, setCreating] = useState(false);
  const live = data.campaigns.filter((c) => c.status === "ENABLED");
  const [base, setBase] = useState(live[0]?.id ?? "");
  const [tpl, setTpl] = useState(EXP_TEMPLATES[0].id);
  const [split, setSplit] = useState(50);
  const [weeks, setWeeks] = useState(4);

  const create = () => {
    const t = EXP_TEMPLATES.find((x) => x.id === tpl)!;
    const { change, ops } = t.build(base, data);
    const today = new Date().toISOString().slice(0, 10);
    const exp: Experiment = { id: gid("exp"), name: `${t.label} · ${data.campaigns.find((c) => c.id === base)?.name}`, baseCampaignId: base, change, ops, split, status: "RUNNING", startDate: today, endDate: addDays(today, weeks * 7) };
    const res = applyDirect(`Start experiment "${exp.name}"`, [{ kind: "collection.upsert", collection: "experiments", items: [exp] }]);
    if (res.ok) {
      toast.success("Experiment started");
      setCreating(false);
    }
  };

  const applyExperiment = (e: Experiment) => {
    const res = applyDirect(`Apply experiment "${e.name}" to campaign`, [...e.ops, { kind: "collection.upsert", collection: "experiments", items: [{ ...e, status: "APPLIED" }] }]);
    if (res.ok) toast.success("Trial changes applied to the original campaign");
    else toast.error(res.error);
  };

  return (
    <div className="space-y-4">
      <ViewHeader
        title="Experiments"
        subtitle="Test a change on part of a campaign's traffic before rolling it out. Google splits traffic and reports the difference with statistical confidence."
        actions={
          <button type="button" onClick={() => setCreating(true)} className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold", ACCENT_BTN)}>
            <Plus className="h-3.5 w-3.5" /> New experiment
          </button>
        }
      />
      {creating && (
        <Card className="space-y-3 p-4">
          <p className="text-sm font-bold">New custom experiment</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Base campaign">
              <SelectBox value={base} onChange={setBase} options={live.map((c) => ({ value: c.id, label: c.name }))} />
            </Field>
            <Field label="What to test">
              <SelectBox value={tpl} onChange={setTpl} options={EXP_TEMPLATES.map((t) => ({ value: t.id, label: t.label }))} />
            </Field>
            <Field label={`Traffic split: ${split}% to the trial`}>
              <input type="range" min={10} max={90} step={10} value={split} onChange={(e) => setSplit(Number(e.target.value))} className="w-full accent-[#400095]" />
            </Field>
            <Field label="Duration">
              <SelectBox value={String(weeks)} onChange={(v) => setWeeks(Number(v))} options={[2, 4, 6, 8].map((w) => ({ value: String(w), label: `${w} weeks` }))} />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setCreating(false)} className="rounded-lg border border-border/70 px-3 py-1.5 text-xs font-medium hover:bg-muted">Cancel</button>
            <button type="button" onClick={create} disabled={!base} className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold", ACCENT_BTN)}>Start experiment</button>
          </div>
        </Card>
      )}
      {data.experiments.length === 0 && !creating && <EmptyState icon={FlaskConical} title="No experiments yet" body="Try a new bid strategy or broad match on half the traffic and see what actually works." />}
      <div className="grid gap-3 lg:grid-cols-2">
        {data.experiments.map((e) => {
          const r = e.result;
          const winning = r && r.confidence >= 0.9 && r.conversions + r.roas > 0;
          return (
            <Card key={e.id} className="p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#400095]/10 text-[#400095] dark:bg-violet-500/15 dark:text-violet-300">
                  <Beaker className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold">{e.name}</p>
                  <p className="text-[11px] text-muted-foreground">{e.change}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {e.split}% split · {e.startDate} → {e.endDate} · base: {data.campaigns.find((c) => c.id === e.baseCampaignId)?.name}
                  </p>
                </div>
                <Pill tone={e.status === "RUNNING" ? "info" : e.status === "APPLIED" ? "good" : "neutral"}>{e.status.toLowerCase()}</Pill>
              </div>
              {r ? (
                <div className="mt-3 rounded-xl bg-muted/40 p-3">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div><p className="text-[10px] text-muted-foreground">Conversions</p><Delta value={r.conversions} /></div>
                    <div><p className="text-[10px] text-muted-foreground">Cost / conv.</p><Delta value={r.cpa} higherIsBetter={false} /></div>
                    <div><p className="text-[10px] text-muted-foreground">ROAS</p><Delta value={r.roas} /></div>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                    Confidence
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <span className={cn("block h-full rounded-full", r.confidence >= 0.9 ? "bg-emerald-500" : "bg-amber-500")} style={{ width: `${r.confidence * 100}%` }} />
                    </span>
                    {Math.round(r.confidence * 100)}%
                  </div>
                  <p className="mt-1.5 text-[11px]">{winning ? "The trial is winning with high confidence." : r.confidence < 0.9 ? "Not significant yet. Keep it running or end it." : "The trial is not better than the base."}</p>
                </div>
              ) : (
                <p className="mt-3 rounded-xl bg-muted/40 p-3 text-[11px] text-muted-foreground">Collecting data. Results usually need 2–4 weeks. No extra budget: the trial shares the campaign&apos;s budget.</p>
              )}
              {e.status === "RUNNING" && (
                <div className="mt-3 flex gap-2">
                  {winning && e.ops.length > 0 && (
                    <button type="button" onClick={() => applyExperiment(e)} className="inline-flex items-center gap-1 rounded-lg bg-[#400095] px-3 py-1.5 text-[11px] font-semibold text-white dark:bg-violet-600">
                      <Check className="h-3.5 w-3.5" /> Apply to campaign
                    </button>
                  )}
                  <button type="button" onClick={() => applyDirect(`End experiment "${e.name}"`, [{ kind: "collection.upsert", collection: "experiments", items: [{ ...e, status: "ENDED" }] }])} className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-3 py-1.5 text-[11px] font-medium hover:bg-muted">
                    <Square className="h-3 w-3" /> End experiment
                  </button>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ─── Performance Planner ──────────────────────────────────────────────────

export function PlannerView() {
  const { data, range, currency, campaign } = useGa();
  const applyDirect = useGoogleAds((s) => s.applyDirect);
  const { resolvedTheme } = useTheme();
  const candidates = data.campaigns.filter((c) => c.status === "ENABLED" && (!campaign || c.id === campaign.id));
  const current = (id: string) => data.budgets.find((b) => b.id === data.campaigns.find((c) => c.id === id)?.budgetId)?.amount ?? 0;
  const [planned, setPlanned] = useState<Record<string, number>>(() => Object.fromEntries(candidates.map((c) => [c.id, current(c.id)])));

  if (!candidates.length) return <div><ViewHeader title="Performance Planner" /><EmptyState icon={Calculator} title="No enabled campaigns to plan" /></div>;

  const totals = (budgets: Record<string, number>) =>
    candidates.reduce(
      (s, c) => {
        const f = forecastCampaign(data, c, range, budgets[c.id] ?? current(c.id));
        return { cost: s.cost + f.cost, conversions: s.conversions + f.conversions, value: s.value + f.value, clicks: s.clicks + f.clicks };
      },
      { cost: 0, conversions: 0, value: 0, clicks: 0 }
    );
  const now = totals(Object.fromEntries(candidates.map((c) => [c.id, current(c.id)])));
  const plan = totals(planned);
  const curve = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5].map((k) => {
    const t = totals(Object.fromEntries(candidates.map((c) => [c.id, current(c.id) * k])));
    return { spend: Math.round(t.cost), conversions: Math.round(t.conversions) };
  });
  const changed = candidates.filter((c) => Math.abs((planned[c.id] ?? 0) - current(c.id)) >= 1);
  const axis = resolvedTheme === "dark" ? "#a1a1aa" : "#71717a";

  return (
    <div className="space-y-4">
      <ViewHeader title="Performance Planner" subtitle="See what happens to conversions and value if you change budgets. Forecasts are based on the last 30 days, seasonality and auction data." />
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "Monthly spend", now: now.cost, plan: plan.cost, fmt: (v: number) => money(v, currency), good: false },
          { label: "Conversions", now: now.conversions, plan: plan.conversions, fmt: (v: number) => num(v, { decimals: 0 }), good: true },
          { label: "Conv. value", now: now.value, plan: plan.value, fmt: (v: number) => money(v, currency), good: true },
          { label: "ROAS", now: now.value / (now.cost || 1), plan: plan.value / (plan.cost || 1), fmt: (v: number) => `${v.toFixed(2)}x`, good: true },
        ].map((m) => (
          <Card key={m.label} className="p-4">
            <p className="text-[11px] font-semibold text-muted-foreground">{m.label}</p>
            <p className="text-xl font-black tabular-nums">{m.fmt(m.plan)}</p>
            <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              now {m.fmt(m.now)} <Delta value={m.now ? (m.plan - m.now) / m.now : null} higherIsBetter={m.good} />
            </p>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <Card className="p-4">
          <p className="mb-2 text-sm font-bold">Conversions vs monthly spend</p>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={curve} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke={resolvedTheme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"} />
                <XAxis dataKey="spend" type="number" domain={["dataMin", "dataMax"]} tick={{ fontSize: 10, fill: axis }} tickFormatter={(v: number) => money(v, currency, { compact: true })} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: axis }} tickLine={false} axisLine={false} width={44} />
                <Tooltip formatter={(v) => [num(Number(v)), "Conversions"]} labelFormatter={(v) => `Spend ${money(Number(v), currency)}`} />
                <Line type="monotone" dataKey="conversions" stroke="#400095" strokeWidth={2} dot={{ r: 2 }} />
                <ReferenceDot x={Math.round(now.cost)} y={Math.round(now.conversions)} r={5} fill="#a1a1aa" stroke="none" />
                <ReferenceDot x={Math.round(plan.cost)} y={Math.round(plan.conversions)} r={6} fill="#F76D01" stroke="white" />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-muted-foreground"><span className="font-semibold text-[#F76D01]">●</span> your plan · <span className="font-semibold text-zinc-400">●</span> today. The curve flattens where extra budget buys fewer conversions.</p>
        </Card>
        <Card className="p-4">
          <p className="mb-3 text-sm font-bold">Daily budgets</p>
          <div className="space-y-4">
            {candidates.map((c) => {
              const cur = current(c.id);
              const v = planned[c.id] ?? cur;
              return (
                <div key={c.id}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="truncate font-semibold">{c.name}</span>
                    <span className="tabular-nums">{money(v, currency)} <span className="text-muted-foreground">/ {money(cur, currency)}</span></span>
                  </div>
                  <input type="range" min={Math.max(1, Math.round(cur * 0.3))} max={Math.round(cur * 3)} value={v} onChange={(e) => setPlanned((p) => ({ ...p, [c.id]: Number(e.target.value) }))} className="w-full accent-[#400095]" />
                  {c.servingIssues.includes("LIMITED_BY_BUDGET") && <p className="text-[10px] text-amber-600">Limited by budget: extra spend converts well here.</p>}
                </div>
              );
            })}
          </div>
          <button
            type="button"
            disabled={!changed.length}
            onClick={() => {
              const ops: MutateOp[] = changed.map((c) => ({ kind: "budget.update", budgetId: c.budgetId, amount: Math.round(planned[c.id]) }));
              const res = applyDirect(`Apply plan: ${changed.length} budget${changed.length > 1 ? "s" : ""}`, ops);
              if (res.ok) toast.success("Budgets updated");
            }}
            className={cn("mt-4 w-full rounded-lg py-2 text-xs font-semibold", ACCENT_BTN)}
          >
            Apply plan{changed.length ? ` (${changed.length} budget${changed.length > 1 ? "s" : ""})` : ""}
          </button>
        </Card>
      </div>
    </div>
  );
}
