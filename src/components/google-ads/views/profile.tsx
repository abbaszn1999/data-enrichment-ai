"use client";

import type { ReactNode } from "react";
import { Brain, Building2, CalendarClock, Check, ExternalLink, Globe2, Lock, Palette, ShieldBan, Sparkles, Swords, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { profileCompleteness } from "@/lib/google-ads/docs";
import { money } from "@/lib/google-ads/metrics";
import { Card, Pill, ViewHeader } from "../ga-ui";
import { useGa } from "../use-ga";

function ago(iso?: string) {
  if (!iso) return "never";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** Links come from the agent; only ever render real web links. */
const safeUrl = (u: string) => (/^https?:\/\//i.test(u) ? u : undefined);
const hostOf = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");

function NotFilled() {
  return <p className="text-xs italic text-muted-foreground">Not filled yet. The agent will ask you during onboarding.</p>;
}

function Section({ icon: Icon, title, hint, filled, children, className }: { icon: typeof Brain; title: string; hint?: string; filled: boolean; children: ReactNode; className?: string }) {
  return (
    <Card className={cn("p-5", className)}>
      <div className="mb-3 flex items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#400095]/10 text-[#400095] dark:bg-violet-500/15 dark:text-violet-300">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-tight">{title}</p>
          {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
        </div>
        {filled && <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-label="Filled" />}
      </div>
      {children}
    </Card>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <p className="mb-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">{children}</p>;
}

function Chips({ items, tone = "neutral" }: { items: string[]; tone?: "neutral" | "brand" | "bad" }) {
  if (!items.length) return <NotFilled />;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((i) => (
        <Pill key={i} tone={tone}>
          {i}
        </Pill>
      ))}
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  if (!items.length) return <NotFilled />;
  return (
    <ul className="space-y-1.5">
      {items.map((i) => (
        <li key={i} className="flex gap-2 text-xs leading-relaxed">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#F76D01]" />
          {i}
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 px-3.5 py-3">
      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-black leading-none tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * The business knowledge base. Read-only on purpose: the agent fills it during
 * onboarding and keeps it current, and every plan and report reads from it.
 */
export function ProfileView() {
  const { acc, currency } = useGa();
  const p = acc.profile;
  const { sections, done, total } = profileCompleteness(p);
  const filled = (id: string) => sections.find((s) => s.id === id)?.filled ?? false;
  const site = safeUrl(p.website);
  const economicsReady = p.margin > 0 && p.averageOrderValue > 0 && p.targetRoas > 0 && p.monthlyBudgetCap > 0;

  return (
    <div className="space-y-4">
      <ViewHeader
        title="Business profile"
        subtitle="What the agent knows about your business. It reads this before every plan, report and recommendation. To change anything, tell the agent in chat."
        actions={
          <>
            <Pill>
              <Lock className="mr-1 inline h-3 w-3" /> Read-only
            </Pill>
            <span className="text-[11px] text-muted-foreground">Updated by the agent {ago(p.updatedAt)}</span>
          </>
        }
      />

      <Card className="p-4">
        <div className="mb-2.5 flex items-center justify-between">
          <p className="text-xs font-bold">
            Knowledge base <span className="font-normal text-muted-foreground">· {done} of {total} sections filled</span>
          </p>
          <div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-gradient-to-r from-[#400095] to-[#F76D01]" style={{ width: `${(done / total) * 100}%` }} />
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {sections.map((s) => (
            <Pill key={s.id} tone={s.filled ? "good" : "neutral"}>
              {s.filled ? "✓ " : ""}
              {s.label}
            </Pill>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Section icon={Building2} title="Business" filled={filled("business")}>
            <div className="flex items-center gap-4">
              {p.brand.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.brand.logoUrl} alt={`${p.businessName} logo`} className="h-14 w-14 shrink-0 rounded-xl border border-border/60 object-cover" />
              ) : (
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-dashed border-border text-[10px] text-muted-foreground">No logo</span>
              )}
              <div className="min-w-0">
                <p className="truncate text-base font-black tracking-tight">{p.businessName || "Not filled yet"}</p>
                {site ? (
                  <a href={site} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-[#400095] hover:underline dark:text-violet-300">
                    {hostOf(site)} <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <NotFilled />
                )}
              </div>
            </div>
          </Section>

          <Section icon={Globe2} title="Markets & catalog" hint="Where you sell and what the website sells." filled={filled("markets")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Target markets</Label>
                <Chips items={p.markets} tone="brand" />
              </div>
              <div>
                <Label>Categories the website sells</Label>
                <Chips items={p.categories} />
              </div>
            </div>
          </Section>

          <Section icon={Wallet} title="Economics" hint="The agent judges every plan against these numbers." filled={filled("economics")}>
            {economicsReady ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Stat label="Gross margin" value={`${Math.round(p.margin * 100)}%`} />
                  <Stat label="Average order value" value={money(p.averageOrderValue, currency)} />
                  <Stat label="Target ROAS" value={`${p.targetRoas}×`} hint={`Break-even ${(1 / p.margin).toFixed(2)}×`} />
                  <Stat label="Monthly budget cap" value={money(p.monthlyBudgetCap, currency)} hint="Agent warns above this" />
                </div>
                <p className="mt-3 text-[11px] text-muted-foreground">Below the break-even ROAS, ads lose money at this margin.</p>
              </>
            ) : (
              <NotFilled />
            )}
          </Section>

          <Section icon={Swords} title="Positioning" hint="Why customers choose you, and who you compete with." filled={filled("positioning")}>
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <Label>Key selling points</Label>
                <Bullets items={p.keySellingPoints} />
              </div>
              <div>
                <Label>Competitive advantages</Label>
                <Bullets items={p.competitiveAdvantages} />
              </div>
            </div>
            <div className="mt-5">
              <Label>Competitors</Label>
              {p.competitors.length ? (
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {p.competitors.map((c) => {
                    const url = safeUrl(c.url);
                    return (
                      <div key={c.name} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-xs">
                        <span className="font-semibold">{c.name}</span>
                        {url ? (
                          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline">
                            {hostOf(url)} <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">No link</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <NotFilled />
              )}
            </div>
          </Section>

          <Section icon={ShieldBan} title="Guardrails" hint="Timing to plan around, and things the agent must never advertise." filled={filled("guardrails")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>
                  <CalendarClock className="mr-1 inline h-3 w-3" /> Peak seasons
                </Label>
                <Chips items={p.peakSeasons} tone="brand" />
              </div>
              <div>
                <Label>Never advertise</Label>
                <Chips items={p.neverAdvertise} tone="bad" />
              </div>
            </div>
          </Section>

          <Section icon={Palette} title="Brand guidelines" hint="The agent follows these when it writes ads and picks images." filled={filled("brand")}>
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <Label>Identity</Label>
                {p.brand.identity ? <p className="text-xs leading-relaxed">{p.brand.identity}</p> : <NotFilled />}
              </div>
              <div>
                <Label>Visual direction</Label>
                {p.brand.visualDirection ? <p className="text-xs leading-relaxed">{p.brand.visualDirection}</p> : <NotFilled />}
              </div>
              <div className="sm:col-span-2">
                <Label>Brand voice</Label>
                {p.brandVoice ? <p className="text-xs leading-relaxed">{p.brandVoice}</p> : <NotFilled />}
              </div>
            </div>
            <div className="mt-5">
              <Label>Colour palette</Label>
              {p.brand.palette.length ? (
                <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-5">
                  {p.brand.palette.map((c) => (
                    <div key={c.hex} className="overflow-hidden rounded-xl border border-border/60">
                      <div className="h-12" style={{ backgroundColor: c.hex }} />
                      <div className="px-2.5 py-2">
                        <p className="truncate text-[11px] font-semibold">{c.name}</p>
                        <p className="text-[10px] uppercase text-muted-foreground">{c.hex}</p>
                        <p className="truncate text-[10px] text-muted-foreground">{c.role}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <NotFilled />
              )}
            </div>
          </Section>
        </div>

        <Card className="h-fit p-5">
          <p className="flex items-center gap-2 text-sm font-bold">
            <Brain className="h-4 w-4 text-[#400095] dark:text-violet-400" /> Memory
          </p>
          <p className="mb-3 mt-1 text-[11px] text-muted-foreground">Facts the agent learned along the way. Say “remember that…” in chat to add one.</p>
          <div className="space-y-2">
            {acc.memories.map((m) => (
              <div key={m.id} className="flex gap-2 rounded-xl border border-border/60 p-2.5 text-xs">
                <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", m.source === "AGENT" ? "bg-[#400095]" : "bg-[#F76D01]")} />
                <div className="min-w-0 flex-1">
                  <p>{m.text}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {m.source === "AGENT" ? "Learned by the agent" : "From you"} · {ago(m.at)}
                  </p>
                </div>
              </div>
            ))}
            {!acc.memories.length && <p className="text-xs text-muted-foreground">Nothing remembered yet.</p>}
          </div>
          <p className="mt-4 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Sparkles className="h-3 w-3" /> To forget something, ask the agent.
          </p>
        </Card>
      </div>
    </div>
  );
}
