"use client";

import { useState } from "react";
import { ArrowRight, Bot, Check, CheckCheck, ChevronDown, ClipboardCheck, History, Lightbulb, PenSquare, Undo2, User, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGoogleAds } from "@/lib/google-ads/store";
import type { ChangeEvent, ChangeSource, DiffRow, ProposedChange } from "@/lib/google-ads/types";
import { Card, EmptyState, Pill, ViewHeader } from "../ga-ui";
import { useGa } from "../use-ga";

const SOURCE: Record<ChangeSource, { label: string; icon: typeof Bot; tone: "brand" | "neutral" | "warn" }> = {
  AGENT: { label: "Agent", icon: Bot, tone: "brand" },
  USER: { label: "You", icon: User, tone: "neutral" },
  RECOMMENDATION: { label: "Google recommendation", icon: Lightbulb, tone: "warn" },
};

function timeAgo(iso: string) {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function DiffTable({ rows }: { rows: DiffRow[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border/60">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] items-center gap-3 border-b border-border/40 px-3 py-2 text-[11px] last:border-b-0 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,0.8fr)_16px_minmax(0,0.8fr)]">
          <span className="truncate text-muted-foreground" title={r.label}>{r.label}</span>
          <span className="hidden truncate text-right text-muted-foreground line-through decoration-muted-foreground/40 sm:block">{r.before ?? ""}</span>
          <ArrowRight className="hidden h-3 w-3 text-muted-foreground/60 sm:block" />
          <span className="truncate font-semibold" title={r.after}>{r.after}</span>
        </div>
      ))}
    </div>
  );
}

export function PendingView() {
  const { acc } = useGa();
  const applyChange = useGoogleAds((s) => s.applyChange);
  const [showResolved, setShowResolved] = useState(false);
  const pending = acc.changes.filter((c) => c.status === "PENDING");
  const resolved = acc.changes.filter((c) => c.status !== "PENDING");

  return (
    <div>
      <ViewHeader
        title="Pending changes"
        subtitle="Everything the agent proposes waits here. Nothing reaches Google Ads until you approve it."
        actions={
          pending.length > 1 ? (
            <button type="button" onClick={() => pending.forEach((c) => applyChange(c.id))} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#400095] px-3 text-xs font-semibold text-white hover:bg-[#33007a] dark:bg-violet-600">
              <CheckCheck className="h-3.5 w-3.5" /> Approve all ({pending.length})
            </button>
          ) : undefined
        }
      />
      {pending.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="Nothing waiting for approval" body="Ask the agent to audit the account, cut waste or build a campaign. Its proposals show up here." />
      ) : (
        <div className="space-y-3">
          {pending.map((c) => (
            <ChangeCard key={c.id} change={c} />
          ))}
        </div>
      )}
      {resolved.length > 0 && (
        <div className="mt-6">
          <button type="button" onClick={() => setShowResolved((o) => !o)} className="mb-2 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !showResolved && "-rotate-90")} />
            Resolved ({resolved.length})
          </button>
          {showResolved && (
            <div className="space-y-2">
              {resolved.map((c) => (
                <ChangeCard key={c.id} change={c} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChangeCard({ change }: { change: ProposedChange }) {
  const applyChange = useGoogleAds((s) => s.applyChange);
  const rejectChange = useGoogleAds((s) => s.rejectChange);
  const openEditor = useGoogleAds((s) => s.openEditor);
  const src = SOURCE[change.source];
  const create = change.ops.find((o) => o.kind === "campaign.create");
  const isPending = change.status === "PENDING";

  return (
    <Card className={cn("p-4", isPending ? "border-[#F76D01]/30" : "opacity-75")}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <Pill tone={src.tone}>
              <src.icon className="h-3 w-3" /> {src.label}
            </Pill>
            <Pill tone={change.risk === "HIGH" ? "bad" : change.risk === "MEDIUM" ? "warn" : "good"}>{change.risk.toLowerCase()} risk</Pill>
            <span className="text-[10px] text-muted-foreground">{timeAgo(change.createdAt)}</span>
          </div>
          <p className="text-sm font-bold">{change.title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{change.rationale}</p>
          {change.impact && <p className="mt-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">Expected: {change.impact}</p>}
        </div>
        {isPending ? (
          <div className="flex gap-1.5">
            {create && create.kind === "campaign.create" && (
              <button type="button" onClick={() => openEditor(create.bundle, change.id)} className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2.5 py-1.5 text-[11px] font-medium hover:bg-muted">
                <PenSquare className="h-3.5 w-3.5" /> Edit
              </button>
            )}
            <button type="button" onClick={() => rejectChange(change.id)} className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2.5 py-1.5 text-[11px] font-medium hover:bg-muted">
              <X className="h-3.5 w-3.5" /> Reject
            </button>
            <button type="button" onClick={() => applyChange(change.id)} className="inline-flex items-center gap-1 rounded-lg bg-[#400095] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#33007a] dark:bg-violet-600">
              <Check className="h-3.5 w-3.5" /> Approve
            </button>
          </div>
        ) : (
          <Pill tone={change.status === "APPLIED" ? "good" : change.status === "FAILED" ? "bad" : "neutral"}>{change.status.toLowerCase()}</Pill>
        )}
      </div>
      {change.error && <p className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-[11px] text-red-700 dark:text-red-400">{change.error}</p>}
      {change.diff.length > 0 && (
        <div className="mt-3">
          <DiffTable rows={change.diff} />
        </div>
      )}
    </Card>
  );
}

export function HistoryView() {
  const { acc } = useGa();
  const undo = useGoogleAds((s) => s.undo);
  const events = acc.history;

  return (
    <div>
      <ViewHeader title="Change history" subtitle="Every change made from here, by you or the agent. Undo restores the previous values." />
      {events.length === 0 ? (
        <EmptyState icon={History} title="No changes yet" body="Changes you make or approve appear here with an undo button." />
      ) : (
        <div className="relative space-y-3 pl-5 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-px before:bg-border">
          {events.map((e) => (
            <HistoryItem key={e.id} event={e} onUndo={() => undo(e.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryItem({ event, onUndo }: { event: ChangeEvent; onUndo: () => void }) {
  const [open, setOpen] = useState(false);
  const src = SOURCE[event.source];
  return (
    <div className="relative">
      <span className={cn("absolute -left-5 top-3 flex h-3.5 w-3.5 items-center justify-center rounded-full ring-4 ring-background", event.undone ? "bg-muted-foreground/40" : event.source === "AGENT" ? "bg-[#400095] dark:bg-violet-500" : "bg-emerald-500")} />
      <Card className={cn("p-3", event.undone && "opacity-60")}>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={src.tone}>
            <src.icon className="h-3 w-3" /> {event.actor}
          </Pill>
          <p className={cn("min-w-0 flex-1 truncate text-xs font-semibold", event.undone && "line-through")}>{event.title}</p>
          <span className="text-[10px] text-muted-foreground">{timeAgo(event.at)}</span>
          {event.diff.length > 0 && (
            <button type="button" onClick={() => setOpen((o) => !o)} className="rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted">
              {event.diff.length} detail{event.diff.length > 1 ? "s" : ""}
            </button>
          )}
          {event.inverse && !event.undone && (
            <button type="button" onClick={onUndo} className="inline-flex items-center gap-1 rounded-md border border-border/70 px-2 py-0.5 text-[11px] font-medium hover:bg-muted">
              <Undo2 className="h-3 w-3" /> Undo
            </button>
          )}
          {event.undone && <Pill>undone</Pill>}
        </div>
        {open && (
          <div className="mt-2">
            <DiffTable rows={event.diff} />
          </div>
        )}
      </Card>
    </div>
  );
}
