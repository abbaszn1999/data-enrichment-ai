"use client";

import { useState } from "react";
import { CalendarClock, FileText, Link2, MessageSquare, Plus } from "lucide-react";
import { runAgentTurn } from "@/lib/google-ads/agent-runner";
import { DOC_TYPES, type DocType } from "@/lib/google-ads/docs";
import { useGoogleAds } from "@/lib/google-ads/store";
import { Card, EmptyState, Pill, Segmented, ViewHeader } from "../ga-ui";
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
