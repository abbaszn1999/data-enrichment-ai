"use client";

import { useState } from "react";
import { Brain, CalendarClock, FileText, Link2, MessageSquare, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { runAgentTurn } from "@/lib/google-ads/agent-runner";
import { DOC_TYPES, type BusinessProfile, type DocType } from "@/lib/google-ads/docs";
import { money } from "@/lib/google-ads/metrics";
import { useGoogleAds } from "@/lib/google-ads/store";
import { Input } from "@/components/ui/input";
import { Card, EmptyState, Field, Pill, Segmented, ViewHeader } from "../ga-ui";
import { useGa } from "../use-ga";

function ago(iso: string) {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function DocumentsView() {
  const { acc } = useGa();
  const openDoc = useGoogleAds((s) => s.openDoc);
  const agentBusy = useGoogleAds((s) => s.agentBusy);
  const [filter, setFilter] = useState<"ALL" | "DRAFT" | "APPROVED">("ALL");
  const docs = acc.docs.filter((d) => filter === "ALL" || d.status === filter);

  return (
    <div className="space-y-6">
      <ViewHeader title="Documents" subtitle="Plans, reports and analyses the agent wrote for you. Each opens in its own tab beside the chat, where you can discuss and edit it." />

      <section>
        <p className="mb-2 text-sm font-bold">Ask the agent to write</p>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {(Object.keys(DOC_TYPES) as DocType[]).map((t) => (
            <button
              key={t}
              type="button"
              disabled={agentBusy}
              onClick={() => runAgentTurn(DOC_TYPES[t].prompt)}
              className="group flex items-start gap-3 rounded-2xl border border-border/60 bg-card p-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-[#400095]/30 hover:shadow-md disabled:opacity-50"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#400095]/10 to-[#F76D01]/15 text-xl">{DOC_TYPES[t].emoji}</span>
              <span className="min-w-0">
                <span className="flex items-center gap-1 text-sm font-semibold">
                  {DOC_TYPES[t].label}
                  <Plus className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </span>
                <span className="block text-[11px] text-muted-foreground">{DOC_TYPES[t].blurb}</span>
                <span className="mt-1 block truncate text-[10px] italic text-[#400095]/80 dark:text-violet-300/80">“{DOC_TYPES[t].prompt}”</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center gap-3">
          <p className="text-sm font-bold">Your documents</p>
          <Segmented value={filter} onChange={setFilter} size="xs" options={[{ value: "ALL", label: "All", count: acc.docs.length }, { value: "DRAFT", label: "Drafts" }, { value: "APPROVED", label: "Approved" }]} />
        </div>
        {!docs.length ? (
          <EmptyState icon={FileText} title="No documents yet" body="Ask for a plan, a report or an audit and it will appear here." />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {docs.map((d) => (
              <button key={d.id} type="button" onClick={() => openDoc(d.id)} className="text-left">
                <Card className="flex h-full gap-3 p-4 transition-shadow hover:shadow-md">
                  <span className="text-2xl leading-none">{DOC_TYPES[d.type].emoji}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-bold">{d.title}</p>
                      <Pill tone={d.status === "APPROVED" ? "good" : "neutral"}>{d.status === "APPROVED" ? "Approved" : "Draft"}</Pill>
                    </div>
                    <p className="truncate text-[11px] text-muted-foreground">{d.subtitle}</p>
                    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                      <span>v{d.version} · updated {ago(d.updatedAt)}</span>
                      <span>{d.sections.length} sections</span>
                      {d.comments.length > 0 && <span className="inline-flex items-center gap-1"><MessageSquare className="h-3 w-3" /> {d.comments.length}</span>}
                      {d.schedule && <span className="inline-flex items-center gap-1 text-sky-700"><CalendarClock className="h-3 w-3" /> {d.schedule.frequency.toLowerCase()}</span>}
                      {d.shareUrl && <span className="inline-flex items-center gap-1"><Link2 className="h-3 w-3" /> shared</span>}
                    </p>
                  </div>
                </Card>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Business profile & memory ─────────────────────────────────────────────

export function ProfileView() {
  const { acc, currency } = useGa();
  const setProfile = useGoogleAds((s) => s.setProfile);
  const addMemory = useGoogleAds((s) => s.addMemory);
  const removeMemory = useGoogleAds((s) => s.removeMemory);
  const [draft, setDraft] = useState<BusinessProfile>(acc.profile);
  const [memory, setMemory] = useState("");
  const p = draft;
  const dirty = JSON.stringify(draft) !== JSON.stringify(acc.profile);
  const list = (k: "markets" | "peakSeasons" | "neverAdvertise" | "competitors") => (
    <Input value={p[k].join(", ")} onChange={(e) => setDraft({ ...p, [k]: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
  );

  return (
    <div className="space-y-4">
      <ViewHeader
        title="Business profile & memory"
        subtitle="What the agent knows about your business. It uses this in every plan, report and recommendation, so advice fits your margins and goals instead of being generic."
        actions={
          dirty ? (
            <button
              type="button"
              onClick={() => {
                setProfile(draft);
                toast.success("Profile saved. The agent will use it from now on.");
              }}
              className="inline-flex h-8 items-center rounded-lg bg-[#400095] px-3 text-xs font-semibold text-white dark:bg-violet-600"
            >
              Save profile
            </button>
          ) : undefined
        }
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Business name">
            <Input value={p.businessName} onChange={(e) => setDraft({ ...p, businessName: e.target.value })} />
          </Field>
          <Field label="Gross margin (%)" hint={`Break-even ROAS = ${(1 / Math.max(0.01, p.margin)).toFixed(2)}×. Below this, ads lose money.`}>
            <Input type="number" value={Math.round(p.margin * 100)} onChange={(e) => setDraft({ ...p, margin: Number(e.target.value) / 100 })} />
          </Field>
          <Field label={`Average order value (${currency})`}>
            <Input type="number" value={p.averageOrderValue} onChange={(e) => setDraft({ ...p, averageOrderValue: Number(e.target.value) })} />
          </Field>
          <Field label="Target ROAS (×)">
            <Input type="number" step="0.1" value={p.targetRoas} onChange={(e) => setDraft({ ...p, targetRoas: Number(e.target.value) })} />
          </Field>
          <Field label={`Monthly budget cap (${currency})`} hint={`The agent warns before any plan above ${money(p.monthlyBudgetCap, currency)}.`}>
            <Input type="number" value={p.monthlyBudgetCap} onChange={(e) => setDraft({ ...p, monthlyBudgetCap: Number(e.target.value) })} />
          </Field>
          <Field label="Markets">{list("markets")}</Field>
          <Field label="Peak seasons">{list("peakSeasons")}</Field>
          <Field label="Competitors">{list("competitors")}</Field>
          <div className="sm:col-span-2">
            <Field label="Never advertise">{list("neverAdvertise")}</Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Brand voice" hint="Used whenever the agent writes ads or documents.">
              <textarea value={p.brandVoice} onChange={(e) => setDraft({ ...p, brandVoice: e.target.value })} rows={3} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30" />
            </Field>
          </div>
        </Card>

        <Card className="flex flex-col p-4">
          <p className="flex items-center gap-2 text-sm font-bold"><Brain className="h-4 w-4 text-[#400095] dark:text-violet-400" /> Memory</p>
          <p className="mb-3 text-[11px] text-muted-foreground">Facts the agent learned or you told it. Say “remember that…” in chat to add one.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!memory.trim()) return;
              addMemory(memory.trim(), "YOU");
              setMemory("");
            }}
            className="mb-3 flex gap-2"
          >
            <Input value={memory} onChange={(e) => setMemory(e.target.value)} placeholder="e.g. We never discount the Glide 3" />
            <button type="submit" className="rounded-lg border border-border/70 px-3 text-xs font-semibold hover:bg-muted">Add</button>
          </form>
          <div className="space-y-2">
            {acc.memories.map((m) => (
              <div key={m.id} className="group flex gap-2 rounded-xl border border-border/60 p-2.5 text-xs">
                <span className={cn("mt-0.5 h-2 w-2 shrink-0 rounded-full", m.source === "AGENT" ? "bg-[#400095]" : "bg-[#F76D01]")} />
                <div className="min-w-0 flex-1">
                  <p>{m.text}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{m.source === "AGENT" ? "Learned by the agent" : "From you"} · {ago(m.at)}</p>
                </div>
                <button type="button" onClick={() => removeMemory(m.id)} className="self-start rounded p-0.5 text-muted-foreground opacity-0 hover:text-red-600 group-hover:opacity-100" aria-label="Forget">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {!acc.memories.length && <p className="text-xs text-muted-foreground">Nothing remembered yet.</p>}
          </div>
          <button type="button" onClick={() => runAgentTurn("Make me a Ramadan campaign plan")} className="mt-4 rounded-lg bg-[#400095]/10 px-3 py-2 text-[11px] font-semibold text-[#400095] hover:bg-[#400095]/15 dark:bg-violet-500/15 dark:text-violet-300">
            See it in action: ask for a Ramadan plan
          </button>
        </Card>
      </div>
    </div>
  );
}
