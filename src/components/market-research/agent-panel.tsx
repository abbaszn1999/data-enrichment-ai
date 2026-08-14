"use client";

import type { ReactNode } from "react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Bot, Loader2, RefreshCw, Send } from "lucide-react";
import { type MarketResearchStage } from "./mock-data";
import { cn } from "@/lib/utils";

export type Stage1ChatMessage = {
  id: string;
  role: "agent" | "user";
  text: string;
};

type AgentPanelProps = {
  stage: MarketResearchStage;
  storeLabel: string;
  projectName?: string;
  analyzingStage1: boolean;
  pendingStage1: boolean;
  stage1Done: boolean;
  preparingStage2?: boolean;
  preparingStage3?: boolean;
  messages: Stage1ChatMessage[];
  onSendMessage: (text: string) => void;
  chatBusy?: boolean;
  /** Activity timeline + receipts, rendered under the header. */
  timeline?: ReactNode;
  /** The agent asked to confirm a full re-read before spending another pass. */
  pendingReread?: boolean;
  onConfirmReread?: () => void;
  onDismissReread?: () => void;
  /** After Extract — conversation is visible, input is closed. */
  readOnly?: boolean;
};

/** Continuous research conversation — Stage 1 chat; later stages stay in the same thread. */
export function AgentPanel({
  stage,
  storeLabel,
  projectName,
  analyzingStage1,
  pendingStage1,
  stage1Done,
  preparingStage2 = false,
  preparingStage3 = false,
  messages,
  onSendMessage,
  chatBusy = false,
  timeline,
  pendingReread = false,
  onConfirmReread,
  onDismissReread,
  readOnly = false,
}: AgentPanelProps) {
  const busy =
    (stage === 1 && analyzingStage1) || preparingStage2 || preparingStage3;
  const pending = stage === 1 && pendingStage1 && !analyzingStage1;
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputId = useId();

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, busy, stage]);

  useEffect(() => {
    setDraft("");
  }, [stage]);

  const canChat =
    !readOnly &&
    !busy &&
    ((stage === 1 && (stage1Done || pending)) ||
      (stage === 2 && stage1Done && !preparingStage2) ||
      (stage === 3 && stage1Done && !preparingStage3));
  const inputDisabled = !canChat || chatBusy;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || inputDisabled) return;
    onSendMessage(text);
    setDraft("");
  };

  const statusLabel = readOnly
    ? "Locked"
    : busy
      ? preparingStage3
        ? "Preparing Stage 3"
        : preparingStage2
          ? "Preparing Stage 2"
          : "Reading site"
      : pending
        ? "Waiting"
        : "Ready";

  return (
    <aside className="flex h-full min-h-0 w-full flex-col bg-muted/20">
      <div className="flex items-center gap-2.5 border-b border-border/60 px-4 py-3 shrink-0">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
          <Bot className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold tracking-tight truncate">
            {projectName ?? "Research agent"}
          </div>
          <div className="text-[11px] text-muted-foreground truncate">
            Research agent · {storeLabel}
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              readOnly
                ? "bg-muted-foreground/50"
                : busy
                  ? "bg-amber-500 animate-pulse"
                  : pending
                    ? "bg-sky-500"
                    : "bg-emerald-500"
            )}
          />
          {statusLabel}
        </span>
      </div>

      {timeline}

      <div
        ref={listRef}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3"
      >
        {messages.length === 0 && pending ? (
          <AgentBubble>
            Stage 1 is a first read of your website — I don’t know your niche
            yet. When analysis runs, I’ll explain what the store appears to sell
            in plain language. You can challenge me, ask for another pass, then
            press Next when you’re ready for catalog scope.
          </AgentBubble>
        ) : null}

        {messages.map((m) =>
          m.role === "user" ? (
            <UserBubble key={m.id}>{m.text}</UserBubble>
          ) : (
            <AgentBubble key={m.id}>{m.text}</AgentBubble>
          )
        )}

        {busy ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            {preparingStage3
              ? "Building broad seed variations…"
              : preparingStage2
                ? "Expanding niches into catalog scope…"
                : "Still reading the website…"}
          </div>
        ) : null}
        {chatBusy && !busy ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            Thinking…
          </div>
        ) : null}
      </div>

      {!readOnly && pendingReread && onConfirmReread ? (
        <div className="shrink-0 space-y-2 border-t border-border/60 bg-muted/30 px-3 py-2.5">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            A full re-read replaces the current niche picture and reopens the
            later stages. Confirm to run another pass.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onConfirmReread}
              className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1 text-[11px] font-medium text-background"
            >
              <RefreshCw className="h-3 w-3" />
              Re-read the store
            </button>
            <button
              type="button"
              onClick={onDismissReread}
              className="rounded-full border border-border/70 px-3 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              Keep current read
            </button>
          </div>
        </div>
      ) : null}

      {readOnly ? (
        <p className="shrink-0 border-t border-border/60 px-4 py-2.5 text-[11px] text-muted-foreground">
          Conversation locked after extract — you can read what was discussed.
        </p>
      ) : (
      <form
        onSubmit={submit}
        className="shrink-0 border-t border-border/60 px-3 py-3"
      >
        <label className="sr-only" htmlFor={inputId}>
          Message the research agent
        </label>
        <div
          className={cn(
            "flex items-end gap-2 rounded-2xl border border-border/70 bg-background px-2.5 py-2",
            inputDisabled && "opacity-70"
          )}
        >
          <textarea
            id={inputId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(e);
              }
            }}
            disabled={inputDisabled}
            rows={2}
            placeholder={
              busy
                ? preparingStage3
                  ? "Wait while seed variations are prepared…"
                  : preparingStage2
                    ? "Wait while catalog scope is prepared…"
                    : "Wait for the first read to finish…"
                : pending
                  ? "Run analysis first, or ask what’s coming…"
                  : stage === 3
                    ? "Ask about these seed rows, or go back to refine catalog scope…"
                    : stage === 2
                      ? "Ask about collections, or refine the Stage 1 niches…"
                      : "Ask about these niches, or request another site read…"
            }
            className="min-h-[44px] max-h-28 flex-1 resize-none bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={inputDisabled || !draft.trim()}
            className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-foreground text-background transition-opacity disabled:opacity-30"
            aria-label="Send"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="mt-1.5 px-1 text-[10px] text-muted-foreground">
          {stage === 1
            ? "Stage 1 · discuss niches, then use Next on the right"
            : stage === 2
              ? "Stage 2 · select collections, then Next for seed variations"
              : "Stage 3 · broad seeds from your catalog scope"}
        </p>
      </form>
      )}
    </aside>
  );
}

function AgentBubble({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2.5 animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <Bot className="h-3.5 w-3.5 text-primary" />
      </div>
      <div className="min-w-0 max-w-[92%] rounded-2xl rounded-tl-md border border-border/70 bg-card px-3.5 py-2.5 text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap">
        {children}
      </div>
    </div>
  );
}

function UserBubble({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-end animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
      <div className="max-w-[88%] rounded-2xl rounded-tr-md bg-foreground px-3.5 py-2.5 text-xs leading-relaxed text-background whitespace-pre-wrap">
        {children}
      </div>
    </div>
  );
}
