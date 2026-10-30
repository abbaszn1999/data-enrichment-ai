"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { useTheme } from "next-themes";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, CheckCircle2, Circle, Clock, FolderKanban, Info, Lightbulb, Loader2, Play, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { accountBase, dailySeries, derive, formatMetric, money, num } from "@/lib/google-ads/metrics";
import { useGoogleAds } from "@/lib/google-ads/store";
import type { AgentDoc, ChecklistItem, DocBlock, ValueFormat } from "@/lib/google-ads/docs";
import { GaChart } from "../ga-chart";
import { Delta } from "../ga-ui";
import { useGa } from "../use-ga";

const PALETTE = ["#400095", "#F76D01", "#0d9488", "#2563eb", "#c026d3", "#ea580c", "#16a34a"];

function fmt(v: number, f: ValueFormat, currency: string) {
  if (f === "money") return money(v, currency, { compact: true });
  if (f === "percent") return `${(v * 100).toFixed(1)}%`;
  if (f === "ratio") return `${v.toFixed(2)}×`;
  return num(v, { compact: true });
}

export function DocBlockView({ block, doc, readOnly }: { block: DocBlock; doc: AgentDoc; readOnly?: boolean }) {
  switch (block.kind) {
    case "text":
      return (
        <div className="prose prose-sm max-w-none text-[13px] leading-relaxed dark:prose-invert prose-p:my-2 prose-ul:my-2 prose-li:my-0.5 prose-strong:text-foreground">
          <ReactMarkdown>{block.md}</ReactMarkdown>
        </div>
      );
    case "callout": {
      const tones = {
        info: { cls: "border-sky-500/30 bg-sky-500/[0.06]", icon: Info, ic: "text-sky-600" },
        good: { cls: "border-emerald-500/30 bg-emerald-500/[0.06]", icon: CheckCircle2, ic: "text-emerald-600" },
        warn: { cls: "border-amber-500/30 bg-amber-500/[0.07]", icon: AlertTriangle, ic: "text-amber-600" },
        bad: { cls: "border-red-500/30 bg-red-500/[0.06]", icon: XCircle, ic: "text-red-600" },
      }[block.tone];
      return (
        <div className={cn("flex gap-2.5 rounded-xl border p-3 text-[13px]", tones.cls)}>
          <tones.icon className={cn("mt-0.5 h-4 w-4 shrink-0", tones.ic)} />
          <p>
            <span className="font-semibold">{block.title}</span> {block.text}
          </p>
        </div>
      );
    }
    case "kpis":
      return <KpiBlock block={block} />;
    case "chart":
      return <ChartBlock block={block} />;
    case "table":
      return (
        <div className="overflow-x-auto rounded-xl border border-border/60">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-muted/40">
                {block.columns.map((c, i) => (
                  <th key={c} className={cn("whitespace-nowrap px-3 py-2 font-semibold text-muted-foreground", block.align?.[i] === "right" ? "text-right" : "text-left")}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((r, ri) => (
                <tr key={ri} className={cn("border-t border-border/50", block.highlightLast && ri === block.rows.length - 1 && "bg-muted/30 font-semibold")}>
                  {r.map((cell, ci) => (
                    <td key={ci} className={cn("px-3 py-2 align-top", block.align?.[ci] === "right" ? "text-right tabular-nums" : "text-left", ci === 0 && "font-medium")}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "tree":
      return (
        <div className="space-y-2">
          {block.items.map((it) => (
            <div key={it.name} className="rounded-xl border border-border/60 p-3">
              <p className="flex items-center gap-2 text-[13px] font-semibold">
                <FolderKanban className="h-4 w-4 text-[#400095] dark:text-violet-400" /> {it.name}
              </p>
              <p className="ml-6 text-[11px] text-muted-foreground">{it.meta}</p>
              <div className="ml-6 mt-2 space-y-1.5 border-l border-border/70 pl-3">
                {it.children.map((ch) => (
                  <div key={ch.name} className="text-[12px]">
                    <span className="font-medium">{ch.name}</span>
                    {ch.meta && <span className="text-muted-foreground"> · {ch.meta}</span>}
                    {ch.chips && (
                      <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
                        {ch.chips.map((c) => (
                          <span key={c} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                            {c}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    case "ads":
      return (
        <div className="grid gap-3 md:grid-cols-2">
          {block.items.map((ad, i) => (
            <div key={i} className="rounded-xl border border-border/60 bg-white p-3 text-[#202124] dark:bg-zinc-900 dark:text-zinc-100">
              {ad.audience && <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#F76D01]">{ad.audience}</p>}
              <p className="text-[11px]"><span className="font-bold">Sponsored</span> · {ad.url}</p>
              <p className="mt-1 text-[15px] leading-snug text-[#1a0dab] dark:text-[#8ab4f8]">{ad.headlines.join(" | ")}</p>
              <p className="mt-1 text-[12px] text-[#4d5156] dark:text-zinc-400">{ad.description}</p>
            </div>
          ))}
        </div>
      );
    case "timeline":
      return (
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(block.phases.length, 4)}, minmax(0, 1fr))` }}>
          {block.phases.map((ph, i) => (
            <div key={ph.label} className="relative rounded-xl border border-border/60 p-3">
              <div className="absolute inset-x-0 top-0 h-1 rounded-t-xl" style={{ background: PALETTE[i % PALETTE.length], opacity: 0.85 }} />
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{ph.when}</p>
              <p className="text-[13px] font-bold">{ph.label}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{ph.focus}</p>
              {ph.budgetShare !== undefined && (
                <p className="mt-2 text-[11px]">
                  <span className="font-semibold">{Math.round(ph.budgetShare * 100)}%</span> of budget
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full rounded-full" style={{ width: `${ph.budgetShare * 100}%`, background: PALETTE[i % PALETTE.length] }} />
                  </span>
                </p>
              )}
              <ul className="mt-2 space-y-0.5 text-[11px]">
                {ph.items.map((x) => (
                  <li key={x} className="flex gap-1.5">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-current" />
                    {x}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      );
    case "score": {
      const r = 34;
      const c = 2 * Math.PI * r;
      const color = block.score >= 80 ? "#16a34a" : block.score >= 60 ? "#f59e0b" : "#dc2626";
      return (
        <div className="flex flex-wrap items-center gap-6 rounded-xl border border-border/60 p-4">
          <div className="relative h-24 w-24">
            <svg viewBox="0 0 80 80" className="h-24 w-24 -rotate-90">
              <circle cx="40" cy="40" r={r} fill="none" stroke="currentColor" strokeWidth="8" className="text-muted" />
              <circle cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(c * block.score) / 100} ${c}`} />
            </svg>
            <span className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-black">{block.score}</span>
              <span className="text-[9px] text-muted-foreground">/ 100</span>
            </span>
          </div>
          <div className="min-w-56 flex-1 space-y-1.5">
            <p className="text-sm font-bold" style={{ color }}>{block.label}</p>
            {block.parts.map((p) => (
              <div key={p.label} className="flex items-center gap-2 text-[11px]">
                <span className="w-40 text-muted-foreground">{p.label}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full" style={{ width: `${p.score}%`, background: p.score >= 80 ? "#16a34a" : p.score >= 60 ? "#f59e0b" : "#dc2626" }} />
                </span>
                <span className="w-8 text-right tabular-nums">{p.score}</span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    case "checklist":
      return <ChecklistBlock items={block.items} doc={doc} readOnly={readOnly} />;
  }
}

function KpiBlock({ block }: { block: Extract<DocBlock, { kind: "kpis" }> }) {
  const { data, range, currency } = useGa();
  const live = useMemo(() => derive(accountBase(data, range)), [data, range]);
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4" style={{ gridTemplateColumns: block.items.length === 5 ? "repeat(5, minmax(0, 1fr))" : undefined }}>
      {block.items.map((k) => (
        <div key={k.label} className="rounded-xl border border-border/60 bg-muted/20 p-3">
          <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {k.label}
            {k.metric && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title="Live from your account" />}
          </p>
          <p className="mt-1 text-xl font-black tabular-nums">{k.metric ? formatMetric(k.metric, live[k.metric], currency) : k.value}</p>
          {k.delta !== undefined && <Delta value={k.delta} higherIsBetter={k.metric !== "cost" && k.metric !== "cpa"} />}
          {k.hint && <p className="mt-0.5 text-[10px] text-muted-foreground">{k.hint}</p>}
        </div>
      ))}
    </div>
  );
}

function ChartBlock({ block }: { block: Extract<DocBlock, { kind: "chart" }> }) {
  const { data, range, currency } = useGa();
  const { resolvedTheme } = useTheme();
  const axis = resolvedTheme === "dark" ? "#a1a1aa" : "#71717a";
  const livePoints = useMemo(() => (block.live ? dailySeries(data, range, block.live.campaignIds) : []), [data, range, block.live]);
  return (
    <div className="rounded-xl border border-border/60 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold">
        {block.title}
        {block.live && <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-700 dark:text-emerald-400">Live</span>}
      </p>
      {block.live ? (
        <GaChart points={livePoints} primary={block.live.metric} secondary={block.live.metric2} currency={currency} height={220} />
      ) : block.variant === "donut" ? (
        <div className="flex flex-wrap items-center gap-4">
          <div style={{ width: 200, height: 200 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={block.data} dataKey="value" nameKey="label" innerRadius={56} outerRadius={90} paddingAngle={2} stroke="none">
                  {block.data?.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => fmt(Number(v), block.format, currency)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="min-w-48 flex-1 space-y-1.5">
            {block.data?.map((d, i) => {
              const total = block.data!.reduce((s, x) => s + x.value, 0) || 1;
              return (
                <div key={d.label} className="flex items-center gap-2 text-[12px]">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
                  <span className="flex-1 truncate">{d.label}</span>
                  <span className="tabular-nums text-muted-foreground">{((d.value / total) * 100).toFixed(0)}%</span>
                  <span className="w-20 text-right font-semibold tabular-nums">{fmt(d.value, block.format, currency)}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div style={{ height: 220 }}>
          <ResponsiveContainer>
            <BarChart data={block.data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={resolvedTheme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: axis }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: axis }} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => fmt(v, block.format, currency)} />
              <Tooltip formatter={(v) => fmt(Number(v), block.format, currency)} cursor={{ fill: "rgba(64,0,149,0.06)" }} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {block.data?.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/** Steps in a plan; running one creates a pending change the user approves. */
function ChecklistBlock({ items, doc, readOnly }: { items: ChecklistItem[]; doc: AgentDoc; readOnly?: boolean }) {
  const { acc } = useGa();
  const propose = useGoogleAds((s) => s.propose);
  const updateDoc = useGoogleAds((s) => s.updateDoc);
  const setActiveTab = useGoogleAds((s) => s.setActiveTab);
  const setView = useGoogleAds((s) => s.setView);

  const statusOf = (it: ChecklistItem) => {
    if (it.done) return "DONE" as const;
    const ch = acc.changes.find((c) => c.id === it.changeId);
    if (!ch) return "TODO" as const;
    return ch.status === "APPLIED" ? ("DONE" as const) : ch.status === "PENDING" ? ("PENDING" as const) : ("FAILED" as const);
  };

  const run = (ids: string[]) => {
    const created: Record<string, string> = {};
    for (const it of items) {
      if (!ids.includes(it.id) || !it.ops?.length || statusOf(it) === "DONE" || statusOf(it) === "PENDING") continue;
      created[it.id] = propose({ title: it.text, rationale: `Step from "${doc.title}". ${it.detail ?? ""}`.trim(), ops: it.ops, risk: it.risk ?? "LOW", source: "AGENT" }).id;
    }
    if (!Object.keys(created).length) return;
    updateDoc(doc.id, (d) => ({
      ...d,
      sections: d.sections.map((s) => ({ ...s, blocks: s.blocks.map((b) => (b.kind === "checklist" ? { ...b, items: b.items.map((x) => (created[x.id] ? { ...x, changeId: created[x.id] } : x)) } : b)) })),
    }));
  };

  if (!items.length) return <p className="text-[12px] text-muted-foreground">Nothing to apply.</p>;
  const runnable = items.filter((i) => i.ops?.length && statusOf(i) === "TODO");
  const doneCount = items.filter((i) => statusOf(i) === "DONE").length;

  return (
    <div className="rounded-xl border border-border/60">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <span className="text-[11px] font-semibold text-muted-foreground">
          {doneCount}/{items.length} done
        </span>
        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
          <span className="block h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(doneCount / items.length) * 100}%` }} />
        </span>
        {!readOnly && runnable.length > 1 && (
          <button type="button" onClick={() => run(runnable.map((r) => r.id))} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-[#400095] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#33007a] dark:bg-violet-600 print:hidden">
            <Play className="h-3 w-3" /> Run all {runnable.length} steps
          </button>
        )}
      </div>
      {items.map((it) => {
        const st = statusOf(it);
        return (
          <div key={it.id} className="flex items-start gap-2.5 border-b border-border/40 px-3 py-2.5 last:border-b-0">
            {st === "DONE" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : st === "PENDING" ? <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /> : st === "FAILED" ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />}
            <div className="min-w-0 flex-1">
              <p className={cn("text-[13px] font-medium", st === "DONE" && "text-muted-foreground line-through")}>{it.text}</p>
              {it.detail && <p className="text-[11px] text-muted-foreground">{it.detail}</p>}
            </div>
            {it.risk && st === "TODO" && <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-semibold", it.risk === "HIGH" ? "bg-red-500/10 text-red-700" : it.risk === "MEDIUM" ? "bg-amber-500/10 text-amber-700" : "bg-emerald-500/10 text-emerald-700")}>{it.risk.toLowerCase()}</span>}
            {!readOnly && st === "TODO" && it.ops?.length ? (
              <button type="button" onClick={() => run([it.id])} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border/70 px-2 py-1 text-[11px] font-medium hover:bg-muted print:hidden">
                <Play className="h-3 w-3" /> Run
              </button>
            ) : st === "PENDING" ? (
              <button type="button" onClick={() => { setActiveTab("account"); setView("pending"); }} className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-amber-700 hover:underline print:hidden">
                <Loader2 className="h-3 w-3" /> Awaiting approval
              </button>
            ) : st === "DONE" ? (
              <span className="text-[11px] font-semibold text-emerald-600">Applied</span>
            ) : null}
          </div>
        );
      })}
      {!readOnly && (
        <p className="flex items-center gap-1.5 border-t border-border/40 px-3 py-2 text-[10px] text-muted-foreground print:hidden">
          <Lightbulb className="h-3 w-3" /> Running a step creates a change in Pending changes. Nothing reaches Google Ads until you approve it.
        </p>
      )}
    </div>
  );
}
