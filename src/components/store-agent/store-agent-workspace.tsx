"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { toast } from "sonner";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Boxes,
  Check,
  Copy,
  Crown,
  FileSearch,
  History,
  ImagePlus,
  Loader2,
  Megaphone,
  PackageSearch,
  ClipboardList,
  FileText,
  Paperclip,
  Pencil,
  RotateCcw,
  Settings,
  Sparkles,
  Store,
  Tags,
  Unplug,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageLoader } from "@/components/brand/page-loader";
import { replyText, type MessageBlock } from "@/lib/store-agent/blocks";
import type { TodoItem } from "@/lib/store-agent/protocol";
import type { ApprovalState, ChatMessage, Insight, Plan } from "./api";
import { ReplyBlocks } from "./blocks";
import { ChatTabs } from "./chat-tabs";
import { Composer } from "./composer";
import { mentionKind, refId, splitMentions } from "@/lib/store-agent/mentions";
import { ChangeHistoryDialog, IconAction, LiveStatus, StoreNotesDialog } from "./extras";
import { FilePanel } from "./file-panel";
import { PlanView } from "./plan-view";
import {
  answerQuestion,
  buildPlan,
  chatSettings,
  closeFile,
  closeTab,
  decideApproval,
  deleteChat,
  dismissBlocked,
  dismissNotice,
  initStoreAgent,
  loadEarlier,
  newChat,
  openChat,
  openFile,
  openPlan,
  refreshChats,
  renameChat,
  sendMessage,
  setAutoRun,
  setChatMode,
  setChatModel,
  steerRun,
  stopRun,
  togglePin,
  undoChange,
  uploadAttachment,
  useStoreAgent,
} from "./use-store-agent";

const SUGGESTIONS = [
  { icon: FileSearch, title: "SEO audit", prompt: "Audit the SEO of my products: missing or weak SEO titles and meta descriptions, thin descriptions and missing image alt text. Write the findings as a report with a prioritized fix list." },
  { icon: ImagePlus, title: "Products without images", prompt: "Find every product without a featured image, show them in a gallery, then find a real photo for each one and add it after I approve." },
  { icon: Sparkles, title: "Better descriptions", prompt: "Rewrite the descriptions of my draft products so they are clear, accurate and convincing, using only the facts already in each product." },
  { icon: Boxes, title: "Inventory check", prompt: "Which products are out of stock or running low? Give me a table by location and suggest what to restock first." },
  { icon: Tags, title: "Organize collections", prompt: "Review my collections: which products are in no collection, which collections are empty, and propose a cleaner structure." },
  { icon: Megaphone, title: "Publish drafts", prompt: "List my draft products that look ready to sell and help me publish them to the Online Store." },
  { icon: BarChart3, title: "Catalog overview", prompt: "Give me an overview of my catalog: product count by status, type and vendor, price ranges, and the biggest data quality gaps." },
  { icon: PackageSearch, title: "Price research", prompt: "Pick my 5 most important products and research how competitors price similar items online. Summarize in a table." },
] as const;

/** Open what a mention points to: a file or plan of this chat (store records stay as labels). */
type OpenMention = (kind: "file" | "plan", id: string) => void;

function MessageText({ text, onOpenMention }: { text: string; onOpenMention?: OpenMention }) {
  return (
    <>
      {splitMentions(text).map((part, i) => {
        if (part.kind === "text") return <span key={i}>{part.text}</span>;
        const kind = mentionKind(part.id);
        const Icon = kind === "file" ? FileText : kind === "plan" ? ClipboardList : null;
        const chip = "mx-0.5 inline-flex items-center gap-1 rounded-md bg-[#400095]/10 px-1.5 py-px text-[13px] font-medium text-[#400095] dark:bg-[#F76D01]/15 dark:text-[#F76D01]";
        if (kind !== "store" && onOpenMention) {
          return (
            <button key={i} type="button" onClick={() => onOpenMention(kind, refId(part.id))} className={cn(chip, "align-baseline hover:underline")}>
              {Icon && <Icon className="h-3 w-3" />}
              {part.title}
            </button>
          );
        }
        return (
          <span key={i} title={kind === "store" ? part.id : undefined} className={chip}>
            {Icon && <Icon className="h-3 w-3" />}
            {kind === "store" ? `@${part.title}` : part.title}
          </span>
        );
      })}
    </>
  );
}

function UserBubble({
  message,
  workspaceId,
  onEdit,
  onOpenMention,
}: {
  message: ChatMessage;
  workspaceId: string;
  onEdit?: (text: string) => void;
  onOpenMention?: OpenMention;
}) {
  return (
    <div className="group flex justify-end">
      <div className="max-w-[88%] space-y-1.5">
        {message.attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {message.attachments.map((a) =>
              a.mime.startsWith("image/") ? (
                <button key={a.fileId} type="button" onClick={() => onOpenMention?.("file", a.fileId)} aria-label={`Open ${a.name}`} className="rounded-lg">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/store-agent/files/${a.fileId}?workspaceId=${workspaceId}`} alt={a.name} className="h-20 w-20 rounded-lg border object-cover" />
                </button>
              ) : (
                <button
                  key={a.fileId}
                  type="button"
                  onClick={() => onOpenMention?.("file", a.fileId)}
                  className="inline-flex items-center gap-1 rounded-lg bg-muted px-2 py-1 text-[11.5px] font-medium transition-colors hover:bg-muted/70"
                >
                  <Paperclip className="h-3 w-3" />
                  {a.name}
                </button>
              )
            )}
          </div>
        )}
        {message.content && (
          <div dir="auto" className="whitespace-pre-wrap break-words rounded-2xl rounded-ee-md bg-[#400095]/[0.07] px-3.5 py-2.5 text-[14px] leading-relaxed dark:bg-[#F76D01]/10">
            <MessageText text={message.content} onOpenMention={onOpenMention} />
          </div>
        )}
        {onEdit && message.content && (
          <div className="flex justify-end opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              onClick={() => onEdit(message.content)}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Pencil className="h-3 w-3" /> Edit and resend
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function AssistantTurn({
  message,
  live,
  running,
  chatId,
  approvals,
  startedAt,
  progress,
  onRetry,
}: {
  message: Pick<ChatMessage, "blocks" | "run">;
  live: boolean;
  running: boolean;
  chatId: string;
  approvals: Record<string, ApprovalState>;
  startedAt?: number;
  progress?: { outputTokens: number; toolCalls: number };
  onRetry?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const blocks = message.blocks;
  const credits = message.run?.credits ?? 0;
  const seconds =
    message.run?.started_at && message.run.finished_at
      ? Math.max(1, Math.round((new Date(message.run.finished_at).getTime() - new Date(message.run.started_at).getTime()) / 1000))
      : null;
  const text = replyText(blocks);
  return (
    <div className="group flex gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#400095] to-[#6B358D] text-[12px] font-black text-white shadow-sm dark:from-[#F76D01] dark:to-[#C40000]">
        V
      </div>
      <div className="min-w-0 flex-1 space-y-2 pt-0.5">
        {blocks.length === 0 && running && <div className="assistant-shimmer text-[13px]">Vera is starting…</div>}
        <ReplyBlocks
          blocks={blocks}
          live={live}
          approvals={approvals}
          onApprove={(approvalId, approve) => void decideApproval(chatId, approvalId, approve)}
          onAnswer={(questionId, answers) => void answerQuestion(chatId, questionId, answers)}
          onOpenFile={(fileId) => openFile(chatId, fileId)}
          onOpenPlan={(planId) => openPlan(chatId, planId)}
          onUndo={async (approvalId) => {
            try {
              toast.success("Change undone", { description: await undoChange(chatId, approvalId) });
            } catch (error) {
              toast.error("Could not undo", { description: (error as Error).message });
            }
          }}
        />
        {running && startedAt && <LiveStatus startedAt={startedAt} outputTokens={progress?.outputTokens ?? 0} toolCalls={progress?.toolCalls ?? 0} />}
        {!running && (credits > 0 || seconds || text) && (
          <div className="flex items-center gap-2 pt-0.5 text-[11px] text-muted-foreground/80">
            {credits > 0 && <span>{credits.toFixed(credits < 1 ? 3 : 2)} credits</span>}
            {seconds && <span>· {seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`}</span>}
            {message.run?.status === "cancelled" && <span>· stopped</span>}
            <span className="ms-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              {text && (
                <button
                  type="button"
                  aria-label="Copy reply"
                  onClick={() => {
                    void navigator.clipboard.writeText(text);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="rounded-md p-1 hover:bg-muted hover:text-foreground"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              )}
              {onRetry && (
                <button type="button" aria-label="Try again" title="Send the same request again" onClick={onRetry} className="rounded-md p-1 hover:bg-muted hover:text-foreground">
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function Hero({ storeName, insights, onPick }: { storeName: string; insights: Insight[]; onPick: (prompt: string) => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="mb-5">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#400095] to-[#6B358D] text-lg font-black text-white shadow-[0_8px_24px_rgba(64,0,149,.22)] dark:from-[#F76D01] dark:to-[#C40000]">
          V
        </div>
        <h1 className="text-xl font-black tracking-[-0.03em]">What should we do in {storeName}?</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
          Vera reads and edits your products, collections, inventory, files and sales channels, researches the web and creates images. Every
          change to your store waits for your approval, and can be undone.
        </p>
      </motion.div>

      {insights.length > 0 && (
        <div className="mb-4">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Found in your store</div>
          <div className="grid gap-1.5">
            {insights.slice(0, 4).map((insight, i) => (
              <motion.button
                key={insight.id}
                type="button"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.04 }}
                onClick={() => onPick(insight.prompt)}
                className="group flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.05] px-3 py-2.5 text-start transition-all hover:border-amber-500/60 hover:bg-amber-500/[0.09]"
              >
                <span className="flex h-7 min-w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 px-1.5 text-[12px] font-black tabular-nums text-amber-700 dark:text-amber-400">
                  {insight.count}
                </span>
                <span className="min-w-0 text-[12.5px] font-semibold">{insight.title.replace(/^\d+\s/, "")}</span>
              </motion.button>
            ))}
          </div>
        </div>
      )}

      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Ideas</div>
      <div className="grid gap-1.5">
        {SUGGESTIONS.map((s, i) => (
          <motion.button
            key={s.title}
            type="button"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.05 + i * 0.03 }}
            onClick={() => onPick(s.prompt)}
            className="group flex items-center gap-3 rounded-xl border border-border/70 bg-background px-3 py-2.5 text-start transition-all hover:border-[#6B358D]/40 hover:bg-[#400095]/[0.03] dark:hover:border-[#F76D01]/40 dark:hover:bg-[#F76D01]/[0.04]"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted transition-colors group-hover:bg-[#400095]/10 dark:group-hover:bg-[#F76D01]/10">
              <s.icon className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-[#6B358D] dark:group-hover:text-[#F76D01]" />
            </span>
            <span className="min-w-0">
              <span className="block text-[12.5px] font-semibold">{s.title}</span>
              <span className="line-clamp-1 text-[11.5px] leading-snug text-muted-foreground">{s.prompt}</span>
            </span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

export function StoreAgentWorkspace({
  workspaceId,
  basePath,
  storeName,
  canEdit,
  onCreditsChanged,
}: {
  workspaceId: string;
  basePath: string;
  storeName: string;
  canEdit: boolean;
  onCreditsChanged?: () => void;
}) {
  const state = useStoreAgent();
  const [seed, setSeed] = useState<{ text: string; nonce: number } | undefined>();
  const [chatWidth, setChatWidth] = useState(480);
  const [notesOpen, setNotesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    void initStoreAgent(workspaceId, { onRunFinished: onCreditsChanged });
  }, [workspaceId, onCreditsChanged]);

  useEffect(() => {
    if (!state.notice) return;
    toast.error(state.notice);
    dismissNotice();
  }, [state.notice]);

  const chatId = state.activeChatId;
  const chatState = chatId ? state.chatStates[chatId] : undefined;
  const summary = state.chats.find((c) => c.id === chatId);
  const settings = chatSettings(chatId);
  const live = chatState?.live ?? null;
  const running = !!live && live.reply.status === "running";
  // While a run streams, its saved placeholder reply is replaced by the live one.
  const liveRunId = live?.runId ?? null;
  const messages = (chatState?.messages ?? []).filter((m) => !(liveRunId && m.role === "assistant" && m.run_id === liveRunId));
  const files = chatState?.files ?? [];
  const plans = chatState?.plans ?? [];
  const panel = chatState?.panel ?? { openFileIds: [], activeFileId: null };
  // A plan's steps as its Build run ticks them off: live while it runs, then from the saved reply.
  const planProgress = (plan: Plan): TodoItem[] | null => {
    if (!plan.build_run_id) return null;
    const blocks =
      live && live.runId === plan.build_run_id ? live.reply.blocks : (chatState?.messages.find((m) => m.role === "assistant" && m.run_id === plan.build_run_id)?.blocks ?? []);
    const todos = blocks.find((b): b is Extract<MessageBlock, { type: "todos" }> => b.type === "todos");
    return todos?.items ?? null;
  };
  const approvals = chatState?.approvals ?? {};
  const lastUser = [...messages].reverse().find((m) => m.role === "user");

  // Follow the reply while the user is at the bottom; leave them alone if they scrolled up.
  const liveLength = live ? live.reply.lastSeq : 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, liveLength, chatId]);
  useEffect(() => {
    stickToBottom.current = true;
  }, [chatId]);

  // Keyboard: Alt+N new chat, Alt+W close tab, Escape stops a run.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyN") {
        e.preventDefault();
        newChat();
      } else if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyW" && chatId) {
        e.preventDefault();
        closeTab(chatId);
      } else if (e.key === "Escape" && running && chatId && !document.querySelector("[role=dialog]")) {
        void stopRun(chatId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chatId, running]);

  // Dragging the divider resizes the chat column; the workspace takes the rest.
  const startResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const start = chatWidth;
      const rtl = document.dir === "rtl";
      const move = (ev: PointerEvent) => {
        const delta = rtl ? startX - ev.clientX : ev.clientX - startX;
        setChatWidth(Math.max(360, Math.min(window.innerWidth * 0.6, start + delta)));
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [chatWidth]
  );

  if (state.availability === "checking") return <PageLoader />;
  if (state.availability !== "ready") {
    const noStore = state.availability === "no_store";
    return (
      <div className="autommerce-dashboard flex flex-1 items-center justify-center p-8 [font-family:var(--brand-font)]">
        <div className="max-w-md space-y-5 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#400095]/10 to-[#F76D01]/10">
            {noStore ? <Unplug className="h-7 w-7 text-[#6B358D] dark:text-[#F76D01]" /> : <AlertTriangle className="h-7 w-7 text-amber-500" />}
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-black">
              {noStore ? "Connect your store" : state.availability === "off" ? "Store Agent is not available yet" : "Could not reach the agent"}
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {noStore
                ? "The Store Agent works on a connected Shopify or WooCommerce store. Connect it in Settings to start."
                : state.availability === "off"
                  ? "This feature is not turned on for this workspace."
                  : "The agent service did not answer. Try again in a moment."}
            </p>
          </div>
          {noStore && (
            <Button asChild className="gap-2 rounded-xl bg-[#400095] text-white hover:bg-[#6B358D] dark:bg-[#F76D01]">
              <Link href={`${basePath}/settings`}>
                <Settings className="h-4 w-4" /> Go to Settings
              </Link>
            </Button>
          )}
        </div>
      </div>
    );
  }

  const context = live?.reply.context
    ? { used: live.reply.context.usedTokens, window: live.reply.context.windowTokens }
    : { used: summary?.context_used ?? 0, window: summary?.context_window ?? 0 };
  const empty = messages.length === 0 && !live;
  const pick = (prompt: string) => setSeed({ text: prompt, nonce: Date.now() });
  const openMention: OpenMention = (kind, id) => {
    if (!chatId) return;
    if (kind === "plan") openPlan(chatId, id);
    else openFile(chatId, id);
  };
  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;

  const composer = chatId && (
    <Composer
      key={chatId}
      workspaceId={workspaceId}
      running={running}
      disabled={!canEdit}
      models={state.models}
      modelId={settings.modelId}
      modelParams={settings.modelParams}
      mode={settings.mode}
      autoRun={state.autoRun}
      context={context}
      storeName={storeName}
      files={files}
      plans={plans}
      seed={seed}
      autoFocus
      onSend={async (text, attachments) => {
        stickToBottom.current = true;
        return (await sendMessage(chatId, text, attachments)) ?? undefined;
      }}
      onStop={() => void stopRun(chatId)}
      onSteer={(text) => steerRun(chatId, text)}
      onUpload={async (file) => (await uploadAttachment(chatId, file)).file}
      onModelChange={(modelId, params) => void setChatModel(chatId, modelId, params)}
      onModeChange={(mode) => void setChatMode(chatId, mode)}
      onAutoRunChange={(value) => void setAutoRun(value)}
    />
  );

  return (
    <div className="autommerce-dashboard flex h-full min-h-0 flex-col overflow-hidden bg-background [font-family:var(--brand-font)]">
      <ChatTabs
        tabs={state.openTabs}
        activeId={chatId}
        chats={state.chats}
        onSelect={(id) => void openChat(id)}
        onClose={closeTab}
        onNew={() => newChat()}
        onOpenChat={(id) => void openChat(id)}
        onRename={renameChat}
        onPin={togglePin}
        onDelete={deleteChat}
        onSearch={(q) => refreshChats(q)}
        actions={
          <>
            <IconAction label="Store notes: what Vera always follows" onClick={() => setNotesOpen(true)}>
              <BookOpen className="h-4 w-4" />
            </IconAction>
            <IconAction label="Store change history" onClick={() => setHistoryOpen(true)}>
              <History className="h-4 w-4" />
            </IconAction>
          </>
        }
      />

      <div className="flex min-h-0 flex-1">
        {/* Chat on the left: fixed width, resizable; full width on small screens. */}
        <section style={{ ["--chat-w" as string]: `${chatWidth}px` }} className="relative flex w-full min-w-0 shrink-0 flex-col md:w-[var(--chat-w)] md:min-w-[360px]">
          {chatState?.status === "loading" ? (
            <PageLoader />
          ) : empty ? (
            <Hero storeName={storeName} insights={state.insights} onPick={pick} />
          ) : (
            <div
              ref={scrollRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
              }}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            >
              <div className="space-y-6 px-4 pb-8 pt-5">
                {chatState?.hasMore && chatId && (
                  <div className="flex justify-center">
                    <Button variant="ghost" size="sm" onClick={() => void loadEarlier(chatId)} disabled={chatState.loadingEarlier} className="h-7 text-[12px] text-muted-foreground">
                      {chatState.loadingEarlier ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Load earlier messages"}
                    </Button>
                  </div>
                )}
                {messages.map((m) =>
                  m.role === "user" ? (
                    <UserBubble key={m.id} message={m} workspaceId={workspaceId} onEdit={!running && canEdit ? pick : undefined} onOpenMention={openMention} />
                  ) : (
                    <AssistantTurn
                      key={m.id}
                      message={m}
                      live={false}
                      running={false}
                      chatId={chatId!}
                      approvals={approvals}
                      onRetry={
                        m.id === lastAssistantId && !live && lastUser && canEdit
                          ? () => void sendMessage(chatId!, lastUser.content, lastUser.attachments.map((a) => ({ id: a.fileId, name: a.name, mime: a.mime, size: a.size })))
                          : undefined
                      }
                    />
                  )
                )}
                {live?.userMessage && <UserBubble message={live.userMessage} workspaceId={workspaceId} onOpenMention={openMention} />}
                {live && (
                  <AssistantTurn
                    message={{
                      blocks: live.reply.blocks,
                      run: { id: live.runId ?? "", credits: live.reply.credits, status: live.reply.status, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, started_at: "", finished_at: null },
                    }}
                    live
                    running={running}
                    chatId={chatId!}
                    approvals={approvals}
                    startedAt={live.startedAt}
                    progress={live.reply.progress}
                  />
                )}
              </div>
            </div>
          )}

          <div className="shrink-0 px-3 pb-3 pt-1">
            {composer}
            <div className="mt-1.5 flex items-center justify-center gap-1.5 text-[10.5px] text-muted-foreground/70">
              <Store className="h-3 w-3 shrink-0" />
              <span className="truncate">
                {storeName} · Type @ to mention a product · Alt+N new chat
              </span>
            </div>
          </div>
        </section>

        {/* Workspace on the right: always there, empty until the agent produces something. */}
        <div
          role="separator"
          aria-orientation="vertical"
          onPointerDown={startResize}
          className="hidden w-1 shrink-0 cursor-col-resize border-s bg-border/40 transition-colors hover:bg-[#6B358D]/40 md:block dark:hover:bg-[#F76D01]/40"
        />
        <aside className="hidden min-w-0 flex-1 md:block">
          {chatId && (
            <FilePanel
              workspaceId={workspaceId}
              files={files}
              plans={plans}
              renderPlan={(plan) => (
                <PlanView
                  key={plan.id}
                  plan={plan}
                  models={state.models}
                  modelId={settings.modelId}
                  modelParams={settings.modelParams}
                  onModelChange={(modelId, params) => void setChatModel(chatId, modelId, params)}
                  onBuild={() => {
                    stickToBottom.current = true;
                    void buildPlan(chatId, plan.id);
                  }}
                  canBuild={!running && canEdit}
                  progress={planProgress(plan)}
                />
              )}
              openFileIds={panel.openFileIds}
              activeFileId={panel.activeFileId}
              working={running}
              onOpen={(fileId) => openFile(chatId, fileId)}
              onClose={(fileId) => closeFile(chatId, fileId)}
            />
          )}
        </aside>
      </div>

      <StoreNotesDialog workspaceId={workspaceId} open={notesOpen} onOpenChange={setNotesOpen} />
      <ChangeHistoryDialog workspaceId={workspaceId} open={historyOpen} onOpenChange={setHistoryOpen} onOpenChat={(id) => void openChat(id)} />

      <Dialog open={!!state.blocked} onOpenChange={(open) => !open && dismissBlocked()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {state.blocked === "NO_SUBSCRIPTION" ? <Crown className="h-4 w-4 text-[#6B358D]" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />}
              {state.blocked === "NO_SUBSCRIPTION" ? "Subscription required" : "Not enough credits"}
            </DialogTitle>
            <DialogDescription>
              {state.blocked === "NO_SUBSCRIPTION"
                ? "The Store Agent needs an active subscription."
                : "You need more credits to send this message. Buy credits or upgrade your plan to continue."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button asChild className="bg-[#400095] text-white hover:bg-[#6B358D] dark:bg-[#F76D01]">
              <Link href={`${basePath}/subscription`}>{state.blocked === "NO_SUBSCRIPTION" ? "View plans" : "Buy credits"}</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
