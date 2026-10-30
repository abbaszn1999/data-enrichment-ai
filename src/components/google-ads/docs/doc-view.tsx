"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import {
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  History,
  Link2,
  MessageSquare,
  RotateCcw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { commentOnDoc, runAgentTurn } from "@/lib/google-ads/agent-runner";
import { DOC_TYPES, reviseDoc, type AgentDoc, type DocSection } from "@/lib/google-ads/docs";
import { addDays } from "@/lib/google-ads/metrics";
import { useGoogleAds } from "@/lib/google-ads/store";
import { Pill, Toggle } from "../ga-ui";
import { useGa } from "../use-ga";
import { DocBlockView } from "./doc-blocks";

const ROLE_COLOR: Record<string, string> = {
  Analyst: "bg-sky-500",
  Strategist: "bg-[#400095]",
  Copywriter: "bg-[#F76D01]",
  Forecaster: "bg-emerald-600",
  Auditor: "bg-red-500",
  "Feed specialist": "bg-teal-600",
  Researcher: "bg-fuchsia-600",
};

function ago(iso: string) {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function DocView({ docId }: { docId: string }) {
  const { acc } = useGa();
  const doc = acc.docs.find((d) => d.id === docId);
  if (!doc) return <p className="p-8 text-sm text-muted-foreground">This document no longer exists.</p>;
  return <DocViewInner key={doc.id} doc={doc} />;
}

function DocViewInner({ doc }: { doc: AgentDoc }) {
  const updateDoc = useGoogleAds((s) => s.updateDoc);
  const agentBusy = useGoogleAds((s) => s.agentBusy);
  const [viewing, setViewing] = useState<number | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(doc.comments.length > 0);
  const [commentFor, setCommentFor] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [printing, setPrinting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const meta = DOC_TYPES[doc.type];

  const shown = viewing ? doc.versions.find((v) => v.version === viewing) : null;
  const sections: DocSection[] = shown ? shown.sections : doc.sections;
  const changed = new Set(shown ? shown.changedSectionIds : doc.changedSectionIds);
  const openComments = doc.comments.filter((c) => !c.resolved).length;

  // Highlights fade once seen.
  useEffect(() => {
    if (!doc.changedSectionIds.length) return;
    const t = window.setTimeout(() => updateDoc(doc.id, (d) => ({ ...d, changedSectionIds: [] })), 9000);
    return () => window.clearTimeout(t);
  }, [doc.changedSectionIds, doc.id, updateDoc]);

  useEffect(() => {
    if (!printing) return;
    const t = window.setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 400);
    return () => window.clearTimeout(t);
  }, [printing]);

  const jump = (id: string) => scrollRef.current?.querySelector(`[data-sec="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const isReport = doc.type === "REPORT" || doc.type === "AUDIT";

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/30">
      {/* Header */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border/60 bg-background px-5 py-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#400095]/10 to-[#F76D01]/15 text-xl">{meta.emoji}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-lg font-black tracking-tight">{doc.title}</h1>
            <Pill tone={doc.status === "APPROVED" ? "good" : "neutral"}>{doc.status === "APPROVED" ? "Approved" : "Draft"}</Pill>
            {doc.schedule && <Pill tone="info"><CalendarClock className="h-3 w-3" /> {doc.schedule.frequency.toLowerCase()}</Pill>}
          </div>
          <p className="truncate text-[11px] text-muted-foreground">
            {meta.label} · {doc.subtitle} · updated {ago(doc.updatedAt)}
          </p>
        </div>
        {doc.team.length > 0 && (
          <div className="hidden items-center lg:flex" title={`Written by ${doc.team.join(", ")}`}>
            {doc.team.map((r, i) => (
              <span key={r} className={cn("-ml-1.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-background text-[10px] font-bold text-white first:ml-0", ROLE_COLOR[r] ?? "bg-zinc-500")} style={{ zIndex: 10 - i }}>
                {r[0]}
              </span>
            ))}
            <span className="ml-2 text-[10px] text-muted-foreground">{doc.team.length} specialists</span>
          </div>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 px-2.5 text-xs font-medium hover:bg-muted">
            <History className="h-3.5 w-3.5" /> v{viewing ?? doc.version}
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">Version history</DropdownMenuLabel>
            {[...doc.versions].reverse().map((v) => (
              <DropdownMenuItem key={v.version} onSelect={() => setViewing(v.version === doc.version ? null : v.version)} className="flex-col items-start gap-0.5">
                <span className="flex w-full items-center gap-2 text-xs font-semibold">
                  v{v.version} {v.version === doc.version && <span className="text-[10px] font-normal text-emerald-600">current</span>}
                  <span className="ml-auto text-[10px] font-normal text-muted-foreground">{ago(v.at)}</span>
                </span>
                <span className="text-[11px] text-muted-foreground">{v.author === "AGENT" ? "Agent" : "You"}: {v.note}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <button type="button" onClick={() => setCommentsOpen((o) => !o)} className={cn("relative inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium hover:bg-muted", commentsOpen ? "border-[#400095]/40 bg-[#400095]/5" : "border-border/70")}>
          <MessageSquare className="h-3.5 w-3.5" /> Comments
          {openComments > 0 && <span className="rounded-full bg-[#F76D01] px-1.5 text-[10px] font-bold text-white">{openComments}</span>}
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 px-2.5 text-xs font-medium hover:bg-muted">
            <Download className="h-3.5 w-3.5" /> Export
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={() => setPrinting(true)} className="text-xs">Download PDF</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setShareOpen(true)} className="text-xs">Share link…</DropdownMenuItem>
            {isReport && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">Send automatically</DropdownMenuLabel>
                {(["WEEKLY", "MONTHLY"] as const).map((f) => (
                  <DropdownMenuItem
                    key={f}
                    onSelect={() => {
                      updateDoc(doc.id, (d) => ({ ...d, schedule: { frequency: f, recipients: ["owner@stride-demo.com"], nextRun: addDays(new Date().toISOString().slice(0, 10), f === "WEEKLY" ? 7 : 30) } }));
                      toast.success(`The agent will refresh and email this ${f === "WEEKLY" ? "every Monday" : "on the 1st of each month"}`);
                    }}
                    className="gap-2 text-xs"
                  >
                    {f === "WEEKLY" ? "Every week" : "Every month"}
                    {doc.schedule?.frequency === f && <Check className="ml-auto h-3.5 w-3.5" />}
                  </DropdownMenuItem>
                ))}
                {doc.schedule && <DropdownMenuItem onSelect={() => updateDoc(doc.id, (d) => ({ ...d, schedule: undefined }))} className="text-xs text-red-600">Stop sending</DropdownMenuItem>}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {doc.status !== "APPROVED" ? (
          <button
            type="button"
            onClick={() => {
              updateDoc(doc.id, (d) => ({ ...d, status: "APPROVED" }));
              toast.success(doc.type === "PLAN" ? "Plan approved. Run its steps from the last section." : "Marked as approved");
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#400095] px-3 text-xs font-semibold text-white hover:bg-[#33007a] dark:bg-violet-600"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> {doc.type === "PLAN" || doc.type === "BUDGET" ? "Approve plan" : "Approve"}
          </button>
        ) : (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> Approved
          </span>
        )}
      </div>

      {shown && (
        <div className="flex shrink-0 items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-5 py-2 text-xs">
          <History className="h-4 w-4 text-amber-700" />
          <span>
            Viewing <span className="font-semibold">version {shown.version}</span> ({shown.note}). Read-only.
          </span>
          <button
            type="button"
            onClick={() => {
              updateDoc(doc.id, (d) => reviseDoc(d, shown.sections, `Restored version ${shown.version}`, "YOU"));
              setViewing(null);
              toast.success(`Restored version ${shown.version} as a new version`);
            }}
            className="ml-auto inline-flex items-center gap-1 rounded-md bg-amber-600 px-2.5 py-1 font-semibold text-white"
          >
            <RotateCcw className="h-3 w-3" /> Restore this version
          </button>
          <button type="button" onClick={() => setViewing(null)} className="rounded-md px-2 py-1 hover:bg-amber-500/20">
            Back to current
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Outline */}
        <aside className="hidden w-52 shrink-0 overflow-y-auto px-3 py-5 xl:block">
          <p className="mb-2 px-2 text-[9px] font-black uppercase tracking-[0.18em] text-muted-foreground/70">Contents</p>
          {sections.map((s, i) => (
            <button key={s.id} type="button" onClick={() => jump(s.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-muted-foreground hover:bg-background hover:text-foreground">
              <span className="w-4 text-[10px] tabular-nums">{i + 1}</span>
              <span className="flex-1 truncate">{s.title}</span>
              {changed.has(s.id) && <span className="h-1.5 w-1.5 rounded-full bg-[#F76D01]" />}
              {doc.comments.some((c) => c.sectionId === s.id && !c.resolved) && <MessageSquare className="h-3 w-3" />}
            </button>
          ))}
        </aside>

        {/* Paper */}
        <div ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto px-4 py-5">
          <DocPaper
            doc={doc}
            sections={sections}
            changed={changed}
            readOnly={!!shown || agentBusy}
            onComment={(id) => {
              setCommentsOpen(true);
              setCommentFor(id);
            }}
          />
        </div>

        {commentsOpen && <CommentsPanel doc={doc} sectionFor={commentFor} onClearSection={() => setCommentFor(null)} onClose={() => setCommentsOpen(false)} onJump={jump} />}
      </div>

      {shareOpen && <ShareDialog doc={doc} onClose={() => setShareOpen(false)} />}
      {printing &&
        createPortal(
          <div data-print-portal className="hidden print:block">
            <style>{`@media print { body > *:not([data-print-portal]) { display: none !important; } [data-print-portal] { display: block !important; } @page { margin: 14mm; } }`}</style>
            <DocPaper doc={doc} sections={doc.sections} changed={new Set()} readOnly onComment={() => {}} />
          </div>,
          document.body
        )}
    </div>
  );
}

function DocPaper({ doc, sections, changed, readOnly, onComment }: { doc: AgentDoc; sections: DocSection[]; changed: Set<string>; readOnly: boolean; onComment: (sectionId: string) => void }) {
  const meta = DOC_TYPES[doc.type];
  return (
    <article className="mx-auto max-w-[920px] rounded-2xl border border-border/60 bg-background px-8 py-8 shadow-sm print:max-w-none print:border-0 print:p-0 print:shadow-none">
      <header className="mb-6 border-b border-border/60 pb-5">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#F76D01]">{meta.emoji} {meta.label}</p>
        <h2 className="mt-1 text-3xl font-black tracking-tight">{doc.title}</h2>
        {doc.subtitle && <p className="mt-1 text-sm text-muted-foreground">{doc.subtitle}</p>}
      </header>
      <div className="space-y-8">
        {sections.map((s, i) => (
          <motion.section
            key={s.id}
            data-sec={s.id}
            initial={changed.has(s.id) ? { backgroundColor: "rgba(247,109,1,0.12)" } : false}
            animate={{ backgroundColor: "rgba(247,109,1,0)" }}
            transition={{ duration: 6 }}
            className={cn("group relative -mx-3 scroll-mt-4 rounded-xl px-3 py-1", changed.has(s.id) && "ring-1 ring-[#F76D01]/40")}
          >
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#400095]/10 text-[11px] font-bold text-[#400095] dark:bg-violet-500/15 dark:text-violet-300">{i + 1}</span>
              <h3 className="text-[17px] font-bold tracking-tight">{s.title}</h3>
              {changed.has(s.id) && <Pill tone="warn" className="ml-1">Updated in v{doc.version}</Pill>}
              {!readOnly && (
                <span className="ml-auto flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 print:hidden">
                  <button type="button" onClick={() => onComment(s.id)} className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background px-2 py-0.5 text-[10px] font-medium hover:bg-muted">
                    <MessageSquare className="h-3 w-3" /> Comment
                  </button>
                  <button type="button" onClick={() => runAgentTurn(`Improve the "${s.title}" section`)} className="inline-flex items-center gap-1 rounded-md border border-[#400095]/30 bg-[#400095]/5 px-2 py-0.5 text-[10px] font-semibold text-[#400095] hover:bg-[#400095]/10 dark:text-violet-300">
                    <Sparkles className="h-3 w-3" /> Ask agent
                  </button>
                </span>
              )}
            </div>
            <div className="space-y-3">
              {s.blocks.map((b, bi) => (
                <DocBlockView key={bi} block={b} doc={doc} readOnly={readOnly} />
              ))}
            </div>
          </motion.section>
        ))}
      </div>
      <footer className="mt-10 border-t border-border/60 pt-4 text-[10px] text-muted-foreground">
        Prepared by the Autommerce Ads agent{doc.team.length ? ` (${doc.team.join(", ")})` : ""} · version {doc.version} · numbers marked live update from your account.
      </footer>
    </article>
  );
}

function CommentsPanel({ doc, sectionFor, onClearSection, onClose, onJump }: { doc: AgentDoc; sectionFor: string | null; onClearSection: () => void; onClose: () => void; onJump: (id: string) => void }) {
  const [text, setText] = useState("");
  const updateDoc = useGoogleAds((s) => s.updateDoc);
  const target = doc.sections.find((s) => s.id === sectionFor);
  const threads = useMemo(() => [...doc.comments].sort((a, b) => Number(!!a.resolved) - Number(!!b.resolved) || b.at.localeCompare(a.at)), [doc.comments]);

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border/60 bg-background">
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
        <MessageSquare className="h-4 w-4" />
        <p className="text-sm font-bold">Comments</p>
        <button type="button" onClick={onClose} className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Close comments">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="border-b border-border/60 p-3">
        {target ? (
          <p className="mb-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
            On <button type="button" onClick={() => onJump(target.id)} className="font-semibold text-foreground hover:underline">{target.title}</button>
            <button type="button" onClick={onClearSection} className="ml-auto" aria-label="Clear section"><X className="h-3 w-3" /></button>
          </p>
        ) : (
          <p className="mb-1.5 text-[11px] text-muted-foreground">Hover a section and click Comment, or comment on the whole document.</p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            commentOnDoc(doc.id, target?.id ?? doc.sections[0].id, text);
            setText("");
          }}
          className="flex items-end gap-2"
        >
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Ask why, or ask for a change…" className="flex-1 resize-none rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40" />
          <button type="submit" disabled={!text.trim()} className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#400095] text-white disabled:opacity-30 dark:bg-violet-600" aria-label="Send comment">
            <Send className="h-3.5 w-3.5" />
          </button>
        </form>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {!threads.length && <p className="py-6 text-center text-xs text-muted-foreground">No comments yet. The agent answers every comment and can edit the section for you.</p>}
        {threads.map((c) => {
          const sec = doc.sections.find((s) => s.id === c.sectionId);
          return (
            <div key={c.id} className={cn("rounded-xl border p-2.5", c.resolved ? "border-border/40 opacity-70" : "border-border/70")}>
              <button type="button" onClick={() => sec && onJump(sec.id)} className="mb-1 block truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
                {sec?.title ?? "Document"}
              </button>
              <p className="text-xs"><span className="font-semibold">You:</span> {c.text}</p>
              {c.replies.map((r, i) => (
                <p key={i} className="mt-1.5 rounded-lg bg-[#400095]/[0.05] p-2 text-xs dark:bg-violet-500/10">
                  <span className="font-semibold text-[#400095] dark:text-violet-300">Agent:</span> {r.text}
                </p>
              ))}
              {!c.replies.length && <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground"><Sparkles className="h-3 w-3 animate-pulse" /> Agent is replying…</p>}
              <div className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                {ago(c.at)}
                <button type="button" onClick={() => updateDoc(doc.id, (d) => ({ ...d, comments: d.comments.map((x) => (x.id === c.id ? { ...x, resolved: !x.resolved } : x)) }))} className="ml-auto font-semibold hover:text-foreground">
                  {c.resolved ? "Reopen" : "Resolve"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function ShareDialog({ doc, onClose }: { doc: AgentDoc; onClose: () => void }) {
  const updateDoc = useGoogleAds((s) => s.updateDoc);
  const url = doc.shareUrl ?? `https://app.autommerce.com/share/${doc.id.replace("doc_", "")}`;
  const on = !!doc.shareUrl;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share “{doc.title}”</DialogTitle>
          <DialogDescription>People with the link can view this document. They can&apos;t see or change your Google Ads account.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3 rounded-xl border border-border/60 p-3">
          <Link2 className="h-4 w-4 text-muted-foreground" />
          <div className="flex-1">
            <p className="text-xs font-semibold">Anyone with the link can view</p>
            <p className="text-[11px] text-muted-foreground">Expires in 30 days · live numbers stay up to date</p>
          </div>
          <Toggle checked={on} label="Link sharing" onChange={(v) => updateDoc(doc.id, (d) => ({ ...d, shareUrl: v ? url : undefined }))} />
        </div>
        {on && (
          <div className="flex gap-2">
            <input readOnly value={url} className="h-9 flex-1 rounded-md border border-input bg-muted/40 px-3 font-mono text-xs" />
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(url);
                toast.success("Link copied");
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-border/70 px-3 text-xs font-semibold hover:bg-muted"
            >
              <Copy className="h-3.5 w-3.5" /> Copy
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
