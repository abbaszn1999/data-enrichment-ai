"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUp,
  Bot,
  Brain,
  Check,
  ExternalLink,
  ListChecks,
  Users,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Megaphone,
  PenSquare,
  Sparkles,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { StreamingMarkdown } from "@/components/streaming-markdown";
import { DOC_TYPES } from "@/lib/google-ads/docs";
import { STARTER_PROMPTS } from "@/lib/google-ads/agent-sim";
import { runAgentTurn } from "@/lib/google-ads/agent-runner";
import { activeChatOf, chatOfMessage, useAccountState, useGoogleAds } from "@/lib/google-ads/store";
import type { AgentMessage, ChatThread, ProposedChange } from "@/lib/google-ads/types";
import { ChatTabs } from "@/components/store-agent/chat-tabs";
import type { ChatSummary } from "@/components/store-agent/api";
import { Pill } from "./ga-ui";

const RISK_TONE = { LOW: "good", MEDIUM: "warn", HIGH: "bad" } as const;

/** Saved chats shown the way the Store Agent shows its chats (same tab bar and History). */
function summarize(chat: ChatThread, acc: NonNullable<ReturnType<typeof useAccountState>>, busyChatId: string | null): ChatSummary {
  const waiting = chat.messages.some((m) => (m.changeIds ?? []).some((id) => acc.changes.find((c) => c.id === id)?.status === "PENDING"));
  return {
    id: chat.id,
    title: chat.title,
    model_id: "ads-agent",
    model_params: [],
    mode: chat.mode,
    status: busyChatId === chat.id ? "running" : waiting ? "awaiting_approval" : "idle",
    context_used: 0,
    context_window: null,
    credits_total: 0,
    pinned: chat.pinned,
    created_at: chat.createdAt,
    last_activity_at: chat.updatedAt,
  };
}

/**
 * The agent panel. Same design as the Store Agent: chat tabs with a + for a new
 * chat and History, messages, and the rounded composer. It cannot be hidden: drag
 * the divider to make it wider or narrower.
 */
export function GaChat({ width }: { width: number }) {
  const acc = useAccountState();
  const agentBusy = useGoogleAds((s) => s.agentBusy);
  const busyChatId = useGoogleAds((s) => s.busyChatId);
  const newChat = useGoogleAds((s) => s.newChat);
  const selectChat = useGoogleAds((s) => s.selectChat);
  const openChat = useGoogleAds((s) => s.openChat);
  const closeChat = useGoogleAds((s) => s.closeChat);
  const renameChat = useGoogleAds((s) => s.renameChat);
  const pinChat = useGoogleAds((s) => s.pinChat);
  const deleteChat = useGoogleAds((s) => s.deleteChat);
  const setChatMode = useGoogleAds((s) => s.setChatMode);
  const scope = useGoogleAds((s) => s.scope);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const chat = acc ? activeChatOf(acc) : null;
  const messages = chat?.messages ?? [];
  const lastSteps = messages[messages.length - 1]?.steps?.length ?? 0;
  useEffect(scrollToBottom, [chat?.id, messages.length, lastSteps, scrollToBottom]);

  // Alt+N: new chat. Alt+W: close the open chat tab.
  const activeId = chat?.id;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.code === "KeyN") {
        e.preventDefault();
        newChat();
      } else if (e.code === "KeyW" && activeId) {
        e.preventDefault();
        closeChat(activeId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newChat, closeChat, activeId]);

  const summaries = useMemo(
    () => (acc ? [...acc.chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((c) => summarize(c, acc, busyChatId)) : []),
    [acc, busyChatId]
  );
  const searchChats = useCallback(
    async (q: string) => {
      const term = q.toLowerCase();
      const ids = new Set((acc?.chats ?? []).filter((c) => c.title.toLowerCase().includes(term) || c.messages.some((m) => m.text.toLowerCase().includes(term))).map((c) => c.id));
      return summaries.filter((s) => ids.has(s.id));
    },
    [acc, summaries]
  );

  const send = (text: string) => {
    if (!text.trim() || agentBusy) return;
    runAgentTurn(text);
  };

  if (!acc || !chat) return null;
  const activeDoc = acc.activeTab !== "account" ? acc.docs.find((d) => d.id === acc.activeTab) : undefined;
  const scopeLabel = activeDoc
    ? `${DOC_TYPES[activeDoc.type].emoji} ${activeDoc.title}`
    : scope.adGroupId
    ? acc.data.adGroups.find((g) => g.id === scope.adGroupId)?.name
    : scope.campaignId
      ? acc.data.campaigns.find((c) => c.id === scope.campaignId)?.name
      : null;

  return (
    <aside aria-label="Ads agent" style={{ width }} className="flex h-full min-h-0 shrink-0 flex-col bg-background dark:bg-[#15121a]">
      <ChatTabs
        className="bg-transparent"
        deleteNote="will be deleted for good. Changes already applied to your ads account stay as they are."
        tabs={acc.openChatIds}
        activeId={chat.id}
        chats={summaries}
        onSelect={selectChat}
        onClose={closeChat}
        onNew={newChat}
        onOpenChat={openChat}
        onRename={async (id, title) => renameChat(id, title)}
        onPin={async (id) => pinChat(id)}
        onDelete={async (id) => deleteChat(id)}
        onSearch={searchChats}
      />

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {messages.length === 0 ? (
          <Welcome onPick={send} empty={!acc.data.campaigns.length} accountName={acc.data.account.name} />
        ) : (
          <div className="space-y-6 px-4 pb-8 pt-5">
            {messages.map((m) => (m.role === "user" ? <UserBubble key={m.id} message={m} /> : <AgentTurn key={m.id} message={m} onFollowUp={send} onReveal={scrollToBottom} />))}
          </div>
        )}
      </div>

      <div className="shrink-0 px-3 pb-3 pt-1">
        {scopeLabel && (
          <p className="mb-2 inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[10.5px] text-muted-foreground">
            Context: <span className="truncate font-semibold text-foreground">{scopeLabel}</span>
          </p>
        )}
        <GaComposer key={chat.id} busy={agentBusy} mode={chat.mode} onModeChange={setChatMode} onSend={send} accountName={acc.data.account.name} />
        <div className="mt-1.5 flex items-center justify-center gap-1.5 text-[10.5px] text-muted-foreground/70">
          <Megaphone className="h-3 w-3 shrink-0" />
          <span className="truncate">Demo data, nothing reaches Google Ads · Alt+N new chat</span>
        </div>
      </div>
    </aside>
  );
}

/** The Store Agent's message box: rounded card, mode switch at the bottom left, round send button. */
function GaComposer({
  busy,
  mode,
  onModeChange,
  onSend,
  accountName,
}: {
  busy: boolean;
  mode: ChatThread["mode"];
  onModeChange: (mode: ChatThread["mode"]) => void;
  onSend: (text: string) => void;
  accountName: string;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const submit = () => {
    if (busy || !text.trim()) return;
    onSend(text);
    setText("");
  };

  return (
    <div className="relative rounded-2xl border bg-background shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors focus-within:border-[#6B358D]/50 dark:focus-within:border-[#F76D01]/50">
      <textarea
        ref={ref}
        value={text}
        dir="auto"
        rows={1}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={mode === "plan" ? "Describe what you want planned. Nothing in the account will change…" : `Ask anything about ${accountName}, or tell the agent what to do…`}
        className="block max-h-[240px] w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[14px] leading-relaxed outline-none placeholder:text-muted-foreground/60"
      />
      <div className="flex items-center gap-1 px-2 pb-2 pt-1">
        <div className="flex items-center rounded-lg bg-muted p-0.5">
          {(["agent", "plan"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onModeChange(m)}
              disabled={busy}
              aria-pressed={mode === m}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-semibold transition-all disabled:opacity-60",
                mode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {m === "agent" ? <Bot className="h-3 w-3" /> : <ListChecks className="h-3 w-3" />}
              {m === "agent" ? "Agent" : "Plan"}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={submit}
          disabled={busy || !text.trim()}
          aria-label="Send"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[#400095] text-white transition-all hover:bg-[#6B358D] disabled:bg-muted disabled:text-muted-foreground dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90 dark:disabled:bg-muted"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function Welcome({ onPick, empty, accountName }: { onPick: (t: string) => void; empty: boolean; accountName: string }) {
  const prompts = empty
    ? ["Create a Search campaign for running shoes in Saudi Arabia with $60/day", "Create a Performance Max campaign for gym wear in UAE with $80/day", "What can you do?"]
    : STARTER_PROMPTS;
  return (
    <div className="px-4 py-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="mb-5">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#400095] to-[#6B358D] text-white shadow-[0_8px_24px_rgba(64,0,149,.22)] dark:from-[#F76D01] dark:to-[#C40000]">
          <Sparkles className="h-5 w-5" />
        </div>
        <h1 className="text-xl font-black tracking-[-0.03em]">What should we do in {accountName}?</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
          {empty
            ? "This account is empty. Describe a product, country and budget and I'll build the campaign. Every change waits for your approval."
            : "I read every campaign, keyword and search term of this account, write reports and plans, and prepare changes. Every change waits for your approval and can be undone."}
        </p>
      </motion.div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Ideas</div>
      <div className="grid gap-1.5">
        {prompts.map((p, i) => (
          <motion.button
            key={p}
            type="button"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.05 + i * 0.03 }}
            onClick={() => onPick(p)}
            className="group flex items-center gap-3 rounded-xl border border-border/70 bg-background px-3 py-2.5 text-start transition-all hover:border-[#6B358D]/40 hover:bg-[#400095]/[0.03] dark:hover:border-[#F76D01]/40 dark:hover:bg-[#F76D01]/[0.04]"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted transition-colors group-hover:bg-[#400095]/10 dark:group-hover:bg-[#F76D01]/10">
              <Sparkles className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-[#6B358D] dark:group-hover:text-[#F76D01]" />
            </span>
            <span className="line-clamp-2 min-w-0 text-[12.5px] font-semibold leading-snug">{p}</span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function UserBubble({ message }: { message: AgentMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[88%]">
        <div dir="auto" className="whitespace-pre-wrap break-words rounded-2xl rounded-ee-md bg-[#400095]/[0.07] px-3.5 py-2.5 text-[14px] leading-relaxed dark:bg-[#F76D01]/10">
          {message.text}
        </div>
      </div>
    </div>
  );
}

function AgentTurn({ message, onFollowUp, onReveal }: { message: AgentMessage; onFollowUp: (t: string) => void; onReveal: () => void }) {
  const acc = useAccountState();
  const openEditor = useGoogleAds((s) => s.openEditor);
  const [stepsOpen, setStepsOpen] = useState(true);
  const working = !message.text;
  const changes = (message.changeIds ?? []).map((id) => acc?.changes.find((c) => c.id === id)).filter((c): c is ProposedChange => !!c);

  useEffect(() => {
    if (!working) {
      const t = window.setTimeout(() => setStepsOpen(false), 600);
      return () => window.clearTimeout(t);
    }
  }, [working]);

  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#400095] to-[#6B358D] text-white shadow-sm dark:from-[#F76D01] dark:to-[#C40000]">
        <Sparkles className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1 space-y-2 pt-0.5">
      {message.team && message.team.length > 0 && <TeamPanel team={message.team} />}
      {message.todo && message.todo.length > 0 && working && <TodoPanel todo={message.todo} />}
      {(message.steps?.length || working) && (
        <div className="rounded-xl border border-border/60 bg-muted/30">
          <button type="button" onClick={() => setStepsOpen((o) => !o)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">
            {working ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[#400095] dark:text-violet-400" /> : <Wrench className="h-3.5 w-3.5" />}
            {working ? "Working on it" : `Used ${message.steps?.length ?? 0} tools`}
            <ChevronDown className={cn("ml-auto h-3.5 w-3.5 transition-transform", !stepsOpen && "-rotate-90")} />
          </button>
          <AnimatePresence initial={false}>
            {stepsOpen && (
              <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="space-y-1 overflow-hidden px-3 pb-2">
                {message.steps?.map((s, i) => (
                  <motion.li key={i} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} className="flex items-start gap-2 text-[11px]">
                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                    <span className="min-w-0">
                      <span className="text-foreground">{s.label}</span>
                      <code className="ml-1.5 rounded bg-muted px-1 text-[9px] text-muted-foreground">{s.tool}</code>
                      {s.detail && <span className="block truncate text-[10px] text-muted-foreground">{s.detail}</span>}
                    </span>
                  </motion.li>
                ))}
                {working && (
                  <li className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="h-3 w-3 animate-pulse rounded-full bg-muted-foreground/30" /> Thinking…
                  </li>
                )}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      )}

      {message.text && (
        <StreamingMarkdown
          text={message.text}
          messageId={message.id}
          onReveal={onReveal}
          className="prose prose-sm max-w-none text-[13px] leading-relaxed dark:prose-invert prose-p:my-1.5 prose-ul:my-1.5 prose-li:my-0.5 prose-strong:text-foreground"
        />
      )}

      {message.questions && <QuestionChips message={message} />}

      {message.docId && <DocCard docId={message.docId} action={message.docAction} note={message.docNote} />}

      {message.memoryAdded && (
        <p className="inline-flex items-center gap-1.5 rounded-lg bg-[#400095]/[0.06] px-2.5 py-1.5 text-[11px] text-[#400095] dark:bg-violet-500/10 dark:text-violet-300">
          <Brain className="h-3.5 w-3.5" /> Saved to memory
        </p>
      )}

      {changes.length > 0 && (
        <div className="space-y-1.5">
          {changes.map((c) => (
            <ChangeCard key={c.id} change={c} />
          ))}
        </div>
      )}

      {message.draftBundle && changes.some((c) => c.status === "PENDING") && (
        <button
          type="button"
          onClick={() => openEditor(message.draftBundle, changes[0]?.id)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-2.5 py-1.5 text-[11px] font-medium hover:bg-muted"
        >
          <PenSquare className="h-3.5 w-3.5" /> Open in campaign editor
        </button>
      )}

      {message.followUps && message.text && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {message.followUps.map((f) => (
            <button key={f} type="button" onClick={() => onFollowUp(f)} className="rounded-full border border-border/70 px-2.5 py-1 text-[10px] text-muted-foreground hover:border-[#400095]/40 hover:text-foreground">
              {f}
            </button>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

const ROLE_COLOR: Record<string, string> = {
  Analyst: "bg-sky-500",
  Strategist: "bg-[#400095]",
  Copywriter: "bg-[#F76D01]",
  Forecaster: "bg-emerald-600",
  Auditor: "bg-red-500",
  "Feed specialist": "bg-teal-600",
  Researcher: "bg-fuchsia-600",
};

/** Specialists the agent split the job across, shown while they work in parallel. */
function TeamPanel({ team }: { team: NonNullable<AgentMessage["team"]> }) {
  const done = team.every((t) => t.status === "DONE");
  return (
    <div className="rounded-xl border border-border/60 bg-gradient-to-br from-[#400095]/[0.03] to-[#F76D01]/[0.04] p-2.5">
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
        <Users className="h-3.5 w-3.5" /> {done ? `${team.length} specialists worked on this` : `Working with ${team.length} specialists`}
      </p>
      <div className="space-y-1">
        {team.map((t) => (
          <div key={t.role} className="flex items-center gap-2 text-[11px]">
            <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white", ROLE_COLOR[t.role] ?? "bg-zinc-500")}>{t.role[0]}</span>
            <span className="font-semibold">{t.role}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{t.task}</span>
            {t.status === "DONE" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : t.status === "WORKING" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[#400095] dark:text-violet-400" /> : <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />}
          </div>
        ))}
      </div>
    </div>
  );
}

function TodoPanel({ todo }: { todo: NonNullable<AgentMessage["todo"]> }) {
  return (
    <div className="rounded-xl border border-dashed border-border/80 p-2.5">
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
        <ListChecks className="h-3.5 w-3.5" /> Plan · {todo.filter((t) => t.done).length}/{todo.length}
      </p>
      {todo.map((t) => (
        <p key={t.label} className={cn("flex items-center gap-2 text-[11px]", t.done ? "text-muted-foreground line-through" : "")}>
          {t.done ? <CheckCircle2 className="h-3 w-3 text-emerald-600" /> : <span className="h-3 w-3 rounded-full border border-muted-foreground/40" />}
          {t.label}
        </p>
      ))}
    </div>
  );
}

/** Plan mode: the agent asks before it builds; answers go back as one message. */
function QuestionChips({ message }: { message: AgentMessage }) {
  const acc = useAccountState();
  const patchMessage = useGoogleAds((s) => s.patchMessage);
  const [picked, setPicked] = useState<Record<string, string>>({});
  if (!message.questions || message.answered) return null;
  const all = message.questions.every((q) => picked[q.id]);
  const msgs = (acc ? chatOfMessage(acc, message.id) : undefined)?.messages ?? [];
  const idx = msgs.findIndex((m) => m.id === message.id);
  const request = [...msgs.slice(0, idx)].reverse().find((m) => m.role === "user")?.text ?? "";
  return (
    <div className="space-y-2 rounded-xl border border-[#400095]/25 bg-[#400095]/[0.03] p-3">
      {message.questions.map((q) => (
        <div key={q.id}>
          <p className="mb-1 text-[11px] font-semibold">{q.label}</p>
          <div className="flex flex-wrap gap-1.5">
            {q.options.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setPicked((p) => ({ ...p, [q.id]: o }))}
                className={cn("rounded-full border px-2.5 py-1 text-[11px]", picked[q.id] === o ? "border-[#400095] bg-[#400095] font-semibold text-white dark:border-violet-500 dark:bg-violet-600" : "border-border/70 bg-background hover:border-[#400095]/40")}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      ))}
      <button
        type="button"
        disabled={!all}
        onClick={() => {
          patchMessage(message.id, { answered: true });
          runAgentTurn(`Answers for "${request}": Budget: ${picked.budget} · Goal: ${picked.goal} · Focus: ${picked.focus}`);
        }}
        className="w-full rounded-lg bg-[#400095] py-1.5 text-[11px] font-semibold text-white disabled:opacity-40 dark:bg-violet-600"
      >
        Build the plan
      </button>
    </div>
  );
}

function DocCard({ docId, action, note }: { docId: string; action?: "created" | "updated"; note?: string }) {
  const acc = useAccountState();
  const openDoc = useGoogleAds((s) => s.openDoc);
  const doc = acc?.docs.find((d) => d.id === docId);
  if (!doc) return null;
  return (
    <button type="button" onClick={() => openDoc(doc.id)} className="flex w-full items-center gap-3 rounded-xl border border-border/70 bg-card p-3 text-left shadow-sm transition-all hover:border-[#400095]/40 hover:shadow-md">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#400095]/10 to-[#F76D01]/15 text-xl">{DOC_TYPES[doc.type].emoji}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-bold">{doc.title}</span>
        <span className="block truncate text-[10px] text-muted-foreground">{action === "updated" ? `Updated: ${note} · v${doc.version}` : `${DOC_TYPES[doc.type].label} · ${doc.sections.length} sections · v${doc.version}`}</span>
      </span>
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#400095] dark:text-violet-300">
        Open <ExternalLink className="h-3 w-3" />
      </span>
    </button>
  );
}

function ChangeCard({ change }: { change: ProposedChange }) {
  const applyChange = useGoogleAds((s) => s.applyChange);
  const rejectChange = useGoogleAds((s) => s.rejectChange);
  const setView = useGoogleAds((s) => s.setView);
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-3 transition-colors",
        change.status === "PENDING" ? "border-[#F76D01]/40 shadow-sm" : "border-border/60 opacity-80"
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold leading-snug">{change.title}</p>
          {change.impact && <p className="mt-0.5 text-[11px] text-emerald-700 dark:text-emerald-400">{change.impact}</p>}
        </div>
        <Pill tone={RISK_TONE[change.risk]}>{change.risk.toLowerCase()} risk</Pill>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">{change.diff.length} item{change.diff.length === 1 ? "" : "s"} · <button type="button" className="underline-offset-2 hover:underline" onClick={() => setView("pending")}>review details</button></p>
      {change.status === "PENDING" ? (
        <div className="mt-2 flex gap-1.5">
          <button
            type="button"
            onClick={() => applyChange(change.id)}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-[#400095] px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-[#33007a] dark:bg-violet-600"
          >
            <Check className="h-3.5 w-3.5" /> Approve
          </button>
          <button type="button" onClick={() => rejectChange(change.id)} className="inline-flex items-center justify-center gap-1 rounded-lg border border-border/70 px-2.5 py-1.5 text-[11px] font-medium hover:bg-muted">
            <X className="h-3.5 w-3.5" /> Reject
          </button>
        </div>
      ) : (
        <p
          className={cn(
            "mt-2 inline-flex items-center gap-1 text-[11px] font-semibold",
            change.status === "APPLIED" ? "text-emerald-600" : change.status === "FAILED" ? "text-red-600" : "text-muted-foreground"
          )}
        >
          {change.status === "APPLIED" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
          {change.status === "APPLIED" ? "Applied" : change.status === "FAILED" ? `Failed: ${change.error}` : "Rejected"}
        </p>
      )}
    </div>
  );
}
