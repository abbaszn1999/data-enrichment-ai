"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Brain,
  Check,
  ChevronRight,
  Circle,
  ClipboardList,
  CircleDot,
  CornerDownLeft,
  Database,
  FileSpreadsheet,
  FileText,
  Globe,
  Image as ImageIcon,
  ListChecks,
  Loader2,
  MessageCircleQuestion,
  PenLine,
  ShieldAlert,
  Sparkles,
  Trash2,
  Workflow,
  Wrench,
  X,
  Layers,
  Table2,
  Undo2,
  Zap,
} from "lucide-react";
import { questionCard, type MessageBlock } from "@/lib/store-agent/blocks";
import type { ToolKind } from "@/lib/store-agent/protocol";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ApprovalState } from "./api";
import { Markdown } from "./markdown";

type Handlers = {
  live: boolean;
  onApprove: (approvalId: string, approve: boolean) => void;
  onAnswer: (questionId: string, answers: string[][]) => void;
  onOpenFile: (fileId: string) => void;
  onOpenPlan?: (planId: string) => void;
  /** Undo state of approved changes, from the database. */
  approvals?: Record<string, ApprovalState>;
  onUndo?: (approvalId: string) => Promise<void>;
};

const TOOL_ICON: Record<ToolKind, typeof Wrench> = {
  store_read: Database,
  store_write: PenLine,
  web: Globe,
  image: ImageIcon,
  file: FileText,
  plan: ListChecks,
  think: Brain,
  agent: Workflow,
  other: Wrench,
};

export function FileKindIcon({ kind, mime = "", className }: { kind: string; mime?: string; className?: string }) {
  if (kind === "image" || mime.startsWith("image/")) return <ImageIcon className={className} />;
  if (kind === "csv" || kind === "table" || /csv|sheet|excel/.test(mime)) return <FileSpreadsheet className={className} />;
  if (kind === "plan") return <ListChecks className={className} />;
  return <FileText className={className} />;
}

function ThinkingBlock({ block, live }: { block: Extract<MessageBlock, { type: "thinking" }>; live: boolean }) {
  const [open, setOpen] = useState(false);
  const thinking = !block.done && live;
  const seconds = block.ms ? Math.max(1, Math.round(block.ms / 1000)) : null;
  return (
    <div className="text-[13px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
      >
        <Brain className={cn("h-3.5 w-3.5", thinking && "animate-pulse text-[#6B358D] dark:text-[#F76D01]")} />
        <span className={cn(thinking && "assistant-shimmer")}>
          {thinking ? "Thinking" : seconds ? `Thought for ${seconds}s` : "Thought"}
        </span>
        <ChevronRight className={cn("h-3 w-3 transition-transform", open && "rotate-90")} />
      </button>
      {open && block.text.trim() && (
        <div dir="auto" className="mt-1.5 ms-[7px] whitespace-pre-wrap border-s-2 border-muted ps-3 text-[12.5px] leading-relaxed text-muted-foreground">
          {block.text.trim()}
        </div>
      )}
    </div>
  );
}

function ToolBlock({ block }: { block: Extract<MessageBlock, { type: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const Icon = TOOL_ICON[block.kind] ?? Wrench;
  const failed = block.status === "error";
  const links = block.links ?? [];
  // "No results" is said in the row itself; there is nothing more to open.
  const noResults = block.tool === "webSearch" && !failed && !links.length && !!block.summary;
  const expandable = (!!block.summary && !noResults) || links.length > 0;
  return (
    <div className="text-[13px]">
      <button
        type="button"
        disabled={!expandable}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "group flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-start transition-colors",
          expandable && "hover:bg-muted/60"
        )}
      >
        <span
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded",
            block.kind === "store_write" ? "bg-[#400095]/10 text-[#400095] dark:bg-[#F76D01]/10 dark:text-[#F76D01]" : "bg-muted text-muted-foreground"
          )}
        >
          <Icon className="h-3 w-3" />
        </span>
        <span className={cn("shrink-0 font-medium", failed ? "text-destructive" : "text-foreground/90")}>{block.title}</span>
        {block.detail && (
          <span dir="auto" className="min-w-0 truncate text-muted-foreground">
            {block.detail}
          </span>
        )}
        {block.tool === "webSearch" && links.length > 0 && (
          <span className="shrink-0 text-[11.5px] text-muted-foreground/80">
            {links.length} {links.length === 1 ? "result" : "results"}
          </span>
        )}
        {noResults && <span className="shrink-0 text-[11.5px] text-muted-foreground/80">{block.summary}</span>}
        <span className="ms-auto shrink-0">
          {block.status === "running" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          ) : failed ? (
            <X className="h-3.5 w-3.5 text-destructive" />
          ) : (
            <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          )}
        </span>
      </button>
      {open && block.summary && !noResults && (
        <div dir="auto" className={cn("ms-8 mt-0.5 rounded-md px-2 py-1 text-[12px]", failed ? "bg-destructive/5 text-destructive" : "bg-muted/50 text-muted-foreground")}>
          {block.summary}
        </div>
      )}
      {open && links.length > 0 && (
        <ul className="ms-8 mt-0.5 space-y-0.5 rounded-md bg-muted/50 px-2 py-1.5">
          {links.map((link) => (
            <li key={link.url} className="min-w-0">
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="group/link flex min-w-0 items-baseline gap-2 text-[12px]"
              >
                <span dir="auto" className="min-w-0 truncate text-foreground/85 group-hover/link:text-[#6B358D] group-hover/link:underline dark:group-hover/link:text-[#F76D01]">
                  {link.title}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{hostOf(link.url)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function TodosBlock({ block }: { block: Extract<MessageBlock, { type: "todos" }> }) {
  const done = block.items.filter((t) => t.status === "completed").length;
  return (
    <div className="rounded-xl border bg-muted/20 px-3 py-2.5">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <ListChecks className="h-3.5 w-3.5" />
        Plan
        <span className="ms-auto font-medium normal-case tracking-normal">
          {done} of {block.items.length}
        </span>
      </div>
      <div className="mb-2 h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-[#400095] transition-all duration-500 dark:bg-[#F76D01]"
          style={{ width: `${block.items.length ? (done / block.items.length) * 100 : 0}%` }}
        />
      </div>
      <ul className="space-y-1">
        {block.items.map((item) => (
          <li key={item.id} className="flex items-start gap-2 text-[13px]">
            {item.status === "completed" ? (
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : item.status === "in_progress" ? (
              <CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-pulse text-[#6B358D] dark:text-[#F76D01]" />
            ) : item.status === "cancelled" ? (
              <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
            )}
            <span
              dir="auto"
              className={cn(
                item.status === "completed" && "text-muted-foreground line-through decoration-muted-foreground/40",
                item.status === "cancelled" && "text-muted-foreground line-through",
                item.status === "in_progress" && "font-medium"
              )}
            >
              {item.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const RISK_STYLE = {
  write: { label: "Store change", icon: PenLine, tone: "border-amber-500/40 bg-amber-500/[0.06]", accent: "text-amber-700 dark:text-amber-400" },
  delete: { label: "Delete from the store", icon: Trash2, tone: "border-red-500/40 bg-red-500/[0.06]", accent: "text-red-700 dark:text-red-400" },
  bulk: { label: "Bulk change", icon: Layers, tone: "border-[#6B358D]/40 bg-[#400095]/[0.05] dark:border-[#F76D01]/40 dark:bg-[#F76D01]/[0.06]", accent: "text-[#6B358D] dark:text-[#F76D01]" },
} as const;

function ApprovalCard({
  block,
  live,
  onApprove,
  onOpenFile,
  state,
  onUndo,
}: {
  block: Extract<MessageBlock, { type: "approval" }>;
  live: boolean;
  onApprove: Handlers["onApprove"];
  onOpenFile: Handlers["onOpenFile"];
  state?: ApprovalState;
  onUndo?: Handlers["onUndo"];
}) {
  const [busy, setBusy] = useState<"yes" | "no" | "undo" | null>(null);
  const [expanded, setExpanded] = useState(false);
  // Undo once the run is over and the change is known to be applied.
  const canUndo = !live && !!state?.undoable && !!onUndo;
  const undone = !!state?.undone;
  const style = RISK_STYLE[block.risk];
  const Icon = style.icon;
  const items = block.preview?.items ?? [];
  const shown = expanded ? items : items.slice(0, 3);
  const pending = block.status === "pending" && live;

  const decide = (approve: boolean) => {
    setBusy(approve ? "yes" : "no");
    onApprove(block.approvalId, approve);
  };

  return (
    <div className={cn("overflow-hidden rounded-xl border", style.tone)}>
      <div className="flex items-start gap-2.5 px-3.5 pt-3">
        <span className={cn("mt-0.5", style.accent)}>
          {block.risk === "delete" ? <ShieldAlert className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className={cn("flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide", style.accent)}>
            {style.label}
            {!!block.records && block.records > 1 && (
              <span className="rounded-full bg-background/70 px-1.5 py-px text-[10px] font-semibold normal-case tracking-normal text-muted-foreground">
                {block.records.toLocaleString()} records
              </span>
            )}
          </div>
          <div dir="auto" className="mt-0.5 text-[13.5px] font-medium leading-snug">
            {block.summary}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {block.operations.map((op, i) => (
              <span key={`${op}-${i}`} className="rounded bg-background/70 px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">
                {op}
              </span>
            ))}
          </div>
        </div>
      </div>

      {items.length > 0 && (
        <div className="mx-3.5 mt-3 space-y-2">
          {shown.map((item) => (
            <div key={item.id} className="rounded-lg border bg-background/80 px-2.5 py-2">
              <div dir="auto" className="truncate text-[12.5px] font-semibold">
                {item.label}
              </div>
              {item.changes.length > 0 && (
                <div className="mt-1.5 space-y-1.5">
                  {item.changes.slice(0, 8).map((change) => (
                    <div key={change.field} className="text-[12px]">
                      <div className="font-mono text-[10.5px] text-muted-foreground">{change.field}</div>
                      {change.before !== undefined && (
                        <div dir="auto" className="mt-0.5 rounded bg-red-500/[0.07] px-1.5 py-0.5 text-red-800 line-through decoration-red-800/30 dark:text-red-300">
                          {change.before || "—"}
                        </div>
                      )}
                      <div dir="auto" className="mt-0.5 rounded bg-emerald-500/[0.08] px-1.5 py-0.5 text-emerald-900 dark:text-emerald-300">
                        {change.after || "—"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            {items.length > 3 && (
              <button type="button" onClick={() => setExpanded((v) => !v)} className="text-[12px] font-medium text-muted-foreground hover:text-foreground">
                {expanded ? "Show less" : `Show ${items.length - 3} more here`}
              </button>
            )}
            {block.previewFileId && (
              <button
                type="button"
                onClick={() => onOpenFile(block.previewFileId!)}
                className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#6B358D] hover:underline dark:text-[#F76D01]"
              >
                <Table2 className="h-3.5 w-3.5" />
                Review every change{block.preview?.more ? ` (${(items.length + block.preview.more).toLocaleString()})` : ""}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2 border-t bg-background/40 px-3.5 py-2.5">
        {pending ? (
          <>
            <Button
              size="sm"
              onClick={() => decide(true)}
              disabled={!!busy}
              className={cn(
                "h-8 gap-1.5 rounded-lg px-3.5 text-[12.5px] text-white",
                block.risk === "delete" ? "bg-red-600 hover:bg-red-700" : "bg-[#400095] hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
              )}
            >
              {busy === "yes" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {block.risk === "delete" ? "Delete" : "Apply"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => decide(false)} disabled={!!busy} className="h-8 rounded-lg px-3 text-[12.5px]">
              {busy === "no" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Decline"}
            </Button>
            <span className="ms-auto text-[11px] text-muted-foreground">Nothing changes until you approve.</span>
          </>
        ) : (
          <>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-[12px] font-medium",
                undone ? "text-muted-foreground" : block.status === "approved" ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"
              )}
            >
              {undone ? (
                <Undo2 className="h-3.5 w-3.5" />
              ) : block.auto ? (
                <Zap className="h-3.5 w-3.5" />
              ) : block.status === "approved" ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <X className="h-3.5 w-3.5" />
              )}
              {undone
                ? "Undone"
                : block.status === "approved"
                  ? block.auto
                    ? "Applied automatically (Auto-run)"
                    : "Approved"
                  : block.status === "rejected"
                    ? "Declined"
                    : "Not answered"}
            </span>
            {canUndo && !undone && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy === "undo"}
                onClick={async () => {
                  setBusy("undo");
                  try {
                    await onUndo!(block.approvalId);
                  } finally {
                    setBusy(null);
                  }
                }}
                className="ms-auto h-7 gap-1.5 rounded-lg px-2.5 text-[12px]"
              >
                {busy === "undo" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                Undo
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * One card of questions, each with clickable options and a free answer. A
 * single one-choice question sends on click; otherwise the user answers each
 * and sends them together.
 */
function QuestionCard({ block, live, onAnswer }: { block: Extract<MessageBlock, { type: "question" }>; live: boolean; onAnswer: Handlers["onAnswer"] }) {
  const { questions, answers: saved } = questionCard(block);
  const [picked, setPicked] = useState<string[][]>(() => questions.map(() => []));
  const [custom, setCustom] = useState<string[]>(() => questions.map(() => ""));
  const [sent, setSent] = useState<string[][] | null>(null);
  const answered = saved ?? sent;
  const open = live && !answered;
  const instant = questions.length === 1 && !questions[0]!.multiple;

  const answerFor = (i: number) => [...picked[i]!, ...(custom[i]!.trim() ? [custom[i]!.trim()] : [])];
  const complete = questions.every((_, i) => answerFor(i).length > 0);
  const submit = (answers: string[][]) => {
    setSent(answers);
    onAnswer(block.questionId, answers);
  };
  const choose = (i: number, option: string) => {
    if (instant) return submit([[option]]);
    setPicked((all) =>
      all.map((p, j) => (j !== i ? p : questions[i]!.multiple ? (p.includes(option) ? p.filter((x) => x !== option) : [...p, option]) : [option]))
    );
    // A one-choice question takes either an option or a typed answer.
    if (!questions[i]!.multiple) setCustom((all) => all.map((c, j) => (j === i ? "" : c)));
  };

  return (
    <div className="rounded-xl border border-[#6B358D]/25 bg-[#400095]/[0.03] px-3.5 py-3 dark:border-[#F76D01]/25 dark:bg-[#F76D01]/[0.04]">
      <div className="space-y-3.5">
        {questions.map((q, i) => {
          const chosen = answered?.[i] ?? picked[i]!;
          return (
            <div key={q.id}>
              <div className="flex items-start gap-2">
                <MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0 text-[#6B358D] dark:text-[#F76D01]" />
                <div dir="auto" className="text-[13.5px] font-medium leading-snug">
                  {questions.length > 1 && <span className="me-1 text-muted-foreground">{i + 1}.</span>}
                  {q.text}
                  {q.multiple && <span className="ms-1.5 text-[11px] font-normal text-muted-foreground">(choose any)</span>}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {q.options.map((option) => (
                  <button
                    key={option}
                    type="button"
                    disabled={!open}
                    dir="auto"
                    onClick={() => choose(i, option)}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-[12.5px] transition-colors",
                      chosen.includes(option)
                        ? "border-[#400095] bg-[#400095] text-white dark:border-[#F76D01] dark:bg-[#F76D01]"
                        : "bg-background hover:border-[#6B358D]/50 hover:bg-[#400095]/5 disabled:opacity-60 dark:hover:border-[#F76D01]/50"
                    )}
                  >
                    {option}
                  </button>
                ))}
                {answered && chosen.filter((a) => !q.options.includes(a)).map((a) => (
                  <span key={a} dir="auto" className="rounded-lg border border-[#400095] bg-[#400095] px-3 py-1.5 text-[12.5px] text-white dark:border-[#F76D01] dark:bg-[#F76D01]">
                    {a}
                  </span>
                ))}
              </div>
              {open && (
                <input
                  value={custom[i]}
                  onChange={(e) => {
                    const value = e.target.value;
                    setCustom((all) => all.map((c, j) => (j === i ? value : c)));
                    if (value.trim() && !q.multiple) setPicked((all) => all.map((p, j) => (j === i ? [] : p)));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && complete) submit(questions.map((_, j) => answerFor(j)));
                  }}
                  dir="auto"
                  placeholder="Or type your own answer…"
                  className="mt-2 h-8 w-full rounded-lg border bg-background px-2.5 text-[12.5px] outline-none focus:ring-2 focus:ring-[#6B358D]/25 dark:focus:ring-[#F76D01]/25"
                />
              )}
            </div>
          );
        })}
      </div>
      {open && !(instant && !custom[0]!.trim()) && (
        <div className="mt-3 flex justify-end">
          <Button
            size="sm"
            onClick={() => submit(questions.map((_, j) => answerFor(j)))}
            disabled={!complete}
            className="h-8 rounded-lg bg-[#400095] px-3.5 text-[12px] text-white hover:bg-[#6B358D] dark:bg-[#F76D01]"
          >
            {questions.length > 1 ? "Send answers" : "Send"}
          </Button>
        </div>
      )}
      {answered && <div className="mt-2 text-[11.5px] text-muted-foreground">{block.inChat ? "Answered in the chat" : "Answered"}</div>}
      {!answered && !live && <div className="mt-2 text-[11.5px] text-muted-foreground">Not answered</div>}
    </div>
  );
}

/** The plan this reply wrote or revised: opens it in the panel, where it can be built. */
function PlanBlock({ block, onOpenPlan }: { block: Extract<MessageBlock, { type: "plan" }>; onOpenPlan?: Handlers["onOpenPlan"] }) {
  return (
    <button
      type="button"
      onClick={() => onOpenPlan?.(block.planId)}
      className="group flex w-full items-center gap-3 rounded-xl border border-[#6B358D]/25 bg-gradient-to-br from-[#400095]/[0.04] to-transparent px-3.5 py-3 text-start transition-colors hover:border-[#6B358D]/50 dark:border-[#F76D01]/25 dark:from-[#F76D01]/[0.05] dark:hover:border-[#F76D01]/50"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#400095]/10 text-[#6B358D] dark:bg-[#F76D01]/10 dark:text-[#F76D01]">
        <ClipboardList className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Plan{block.version > 1 ? ` · version ${block.version}` : ""}
        </span>
        <span dir="auto" className="block truncate text-[13.5px] font-semibold">
          {block.title}
        </span>
      </span>
      <span className="shrink-0 text-[12px] font-medium text-[#6B358D] group-hover:underline dark:text-[#F76D01]">Open</span>
    </button>
  );
}

function FileBlock({ block, onOpenFile }: { block: Extract<MessageBlock, { type: "file" }>; onOpenFile: Handlers["onOpenFile"] }) {
  return (
    <button
      type="button"
      onClick={() => onOpenFile(block.fileId)}
      className="group inline-flex max-w-full items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5 text-[12.5px] transition-colors hover:border-[#6B358D]/40 hover:bg-[#400095]/[0.04] dark:hover:border-[#F76D01]/40"
    >
      <FileKindIcon kind={block.kind} mime={block.mime} className="h-3.5 w-3.5 shrink-0 text-[#6B358D] dark:text-[#F76D01]" />
      <span className="truncate font-medium">{block.name}</span>
      <span className="shrink-0 text-muted-foreground group-hover:text-foreground">Open</span>
    </button>
  );
}

/**
 * A finished stretch of work (several tool calls with their short thoughts)
 * collapses into one line, like an IDE's "explored 6 files", so the reply
 * reads as answer-first. It opens to every step.
 */
function ActivityGroup({ blocks, live }: { blocks: MessageBlock[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  const tools = blocks.filter((b): b is Extract<MessageBlock, { type: "tool" }> => b.type === "tool");
  const failed = tools.filter((t) => t.status === "error").length;
  const seconds = Math.round(blocks.reduce((sum, b) => sum + (b.type === "thinking" ? (b.ms ?? 0) : 0), 0) / 1000);
  const counts = new Map<string, number>();
  for (const t of tools) counts.set(t.title, (counts.get(t.title) ?? 0) + 1);
  const summary = [...counts]
    .slice(0, 3)
    .map(([title, n]) => (n > 1 ? `${title} ×${n}` : title))
    .join(" · ");
  return (
    <div className="text-[13px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-start text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted">
          <Layers className="h-3 w-3" />
        </span>
        <span className="shrink-0 font-medium text-foreground/90">{tools.length} steps</span>
        <span className="min-w-0 truncate">{summary}</span>
        <span className="ms-auto flex shrink-0 items-center gap-1.5">
          {failed > 0 && <span className="text-[11px] text-destructive">{failed} failed</span>}
          {seconds > 0 && <span className="text-[11px]">{seconds}s thinking</span>}
          <ChevronRight className={cn("h-3 w-3 transition-transform", open && "rotate-90")} />
        </span>
      </button>
      {open && (
        <div className="ms-3 mt-1 space-y-1 border-s ps-2">
          {blocks.map((b, i) => (b.type === "tool" ? <ToolBlock key={b.callId} block={b} /> : b.type === "thinking" ? <ThinkingBlock key={i} block={b} live={live} /> : null))}
        </div>
      )}
    </div>
  );
}

type RenderItem = { kind: "block"; block: MessageBlock; index: number } | { kind: "group"; blocks: MessageBlock[]; key: string };

/** Fold finished runs of 3+ tool calls (with the thoughts between them) into groups. */
function groupActivity(blocks: MessageBlock[], live: boolean): RenderItem[] {
  const items: RenderItem[] = [];
  let run: Array<{ block: MessageBlock; index: number }> = [];
  const flush = (isTail: boolean) => {
    const tools = run.filter((r) => r.block.type === "tool");
    const stillWorking = live && isTail;
    if (tools.length >= 3 && !stillWorking && !tools.some((t) => t.block.type === "tool" && t.block.status === "running")) {
      items.push({ kind: "group", blocks: run.map((r) => r.block), key: `g${run[0]!.index}` });
    } else {
      for (const r of run) items.push({ kind: "block", block: r.block, index: r.index });
    }
    run = [];
  };
  blocks.forEach((block, index) => {
    if (block.type === "tool" || block.type === "thinking") run.push({ block, index });
    else {
      if (run.length) flush(false);
      items.push({ kind: "block", block, index });
    }
  });
  if (run.length) flush(true);
  return items;
}

export function ReplyBlocks({ blocks, ...handlers }: { blocks: MessageBlock[] } & Handlers) {
  return (
    <div className="space-y-2">
      {groupActivity(blocks, handlers.live).map((item) => {
        if (item.kind === "group") return <ActivityGroup key={item.key} blocks={item.blocks} live={handlers.live} />;
        const { block, index: i } = item;
        switch (block.type) {
          case "text":
            return block.text.trim() ? <Markdown key={i} text={block.text} /> : null;
          case "guidance":
            return (
              <div key={i} className="flex flex-col items-end gap-1 py-1">
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <CornerDownLeft className="h-3 w-3" /> Sent while Vera was working
                </span>
                <div
                  dir="auto"
                  className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-ee-md bg-[#400095]/[0.07] px-3.5 py-2 text-[13.5px] leading-relaxed dark:bg-[#F76D01]/10"
                >
                  {block.text}
                </div>
              </div>
            );
          case "thinking":
            return <ThinkingBlock key={i} block={block} live={handlers.live} />;
          case "tool":
            return <ToolBlock key={block.callId} block={block} />;
          case "todos":
            return <TodosBlock key={i} block={block} />;
          case "approval":
            return (
              <ApprovalCard
                key={block.approvalId}
                block={block}
                live={handlers.live}
                onApprove={handlers.onApprove}
                onOpenFile={handlers.onOpenFile}
                state={handlers.approvals?.[block.approvalId]}
                onUndo={handlers.onUndo}
              />
            );
          case "question":
            return <QuestionCard key={block.questionId} block={block} live={handlers.live} onAnswer={handlers.onAnswer} />;
          case "plan":
            return <PlanBlock key={block.planId} block={block} onOpenPlan={handlers.onOpenPlan} />;
          case "file":
            return <FileBlock key={block.fileId} block={block} onOpenFile={handlers.onOpenFile} />;
          case "summary":
            return (
              <div key={i} className="flex items-center gap-2 py-1 text-[11.5px] text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                {block.status === "started" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {block.status === "started" ? "Summarizing earlier context…" : "Earlier context summarized"}
                <span className="h-px flex-1 bg-border" />
              </div>
            );
          case "error":
            return (
              <div key={i} dir="auto" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {block.message}
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
