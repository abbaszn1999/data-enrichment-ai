"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import ReactMarkdown from "react-markdown";
import {
  AlertTriangle,
  Brain,
  Check,
  ChevronRight,
  Eye,
  FileText,
  FolderOpen,
  Keyboard,
  Loader2,
  MousePointerClick,
  Navigation,
  Paperclip,
  Search,
  ShieldCheck,
  Table2,
  Timer,
  Upload,
  X,
} from "lucide-react";
import type { ChatMessage } from "@/hooks/use-assistant-stream";

type ToolMessage = Extract<ChatMessage, { role: "tool" }>;
type ThinkingMessage = Extract<ChatMessage, { role: "thinking" }>;

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  "Searching the platform": Search,
  Reading: FileText,
  Browsing: FolderOpen,
  "Looking at the page": Eye,
  "Waiting for the page": Timer,
  Opening: Navigation,
  Clicking: MousePointerClick,
  Typing: Keyboard,
  "Uploading the file": Upload,
  "Reading the sheet": Table2,
  "Selecting rows": Table2,
  "Choosing columns": Table2,
  "Reading the gallery": Table2,
  "Reading the visualizer": Table2,
  "Selecting products": Table2,
  "Asking for your approval": ShieldCheck,
};

function seconds(from: number, to?: number) {
  const value = Math.max(0, ((to ?? Date.now()) - from) / 1000);
  return value < 10 ? `${value.toFixed(1)}s` : `${Math.round(value)}s`;
}

/** Re-render every second while something is live, so timers move. */
function useTicker(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);
}

function ThinkingBlock({ message }: { message: ThinkingMessage }) {
  const live = !message.endedAt;
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  useTicker(live);
  useEffect(() => {
    if (live && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [live, message.text]);

  const expanded = live || open;
  return (
    <div className="text-[11px]">
      <button
        type="button"
        onClick={() => !live && setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
      >
        <Brain className={`h-3.5 w-3.5 ${live ? "animate-pulse text-[#6B358D] dark:text-[#C8A8D2]" : ""}`} />
        <span className={live ? "assistant-shimmer font-medium" : ""}>
          {live ? "Thinking…" : `Thought for ${seconds(message.startedAt, message.endedAt)}`}
        </span>
        {!live && <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />}
      </button>
      {expanded && message.text.trim() && (
        <div
          ref={bodyRef}
          dir="auto"
          className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap border-l-2 border-border/70 pl-2.5 leading-relaxed text-muted-foreground/90"
        >
          {message.text.trim()}
        </div>
      )}
    </div>
  );
}

function ToolRow({ message }: { message: ToolMessage }) {
  const Icon = ICONS[message.title] ?? MousePointerClick;
  const running = message.status === "running";
  useTicker(running);
  return (
    <div
      className={`rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors ${
        message.status === "error"
          ? "border-destructive/30 bg-destructive/5"
          : running
            ? "border-[#6B358D]/30 bg-[#400095]/[0.04]"
            : "border-border/60 bg-muted/30"
      }`}
    >
      <div className="flex items-center gap-2">
        <Icon className={`h-3.5 w-3.5 shrink-0 ${running ? "text-[#6B358D] dark:text-[#C8A8D2]" : "text-muted-foreground"}`} />
        <span className="shrink-0 font-semibold">{message.title}</span>
        {message.detail && (
          <span dir="auto" className="min-w-0 truncate font-mono text-[10px] text-muted-foreground">
            {message.detail}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] tabular-nums text-muted-foreground">
          {seconds(message.startedAt, message.endedAt)}
          {running ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : message.status === "error" ? (
            <X className="h-3 w-3 text-destructive" />
          ) : (
            <Check className="h-3 w-3 text-emerald-600" />
          )}
        </span>
      </div>
      {message.summary && (
        <div
          dir="auto"
          className={`mt-0.5 truncate pl-[22px] text-[10px] ${message.status === "error" ? "text-destructive" : "text-muted-foreground"}`}
        >
          {message.summary}
        </div>
      )}
    </div>
  );
}

function AssistantText({ text }: { text: string }) {
  return (
    <div dir="auto" className="max-w-[95%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-xs leading-relaxed">
      <ReactMarkdown
        components={{
          p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          ul: ({ children }) => <ul className="mb-1.5 list-disc space-y-0.5 ps-4 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-1.5 list-decimal space-y-0.5 ps-4 last:mb-0">{children}</ol>,
          code: ({ children }) => <code className="rounded bg-background/70 px-1 py-0.5 font-mono text-[10px]">{children}</code>,
          pre: ({ children }) => <pre className="mb-1.5 overflow-x-auto rounded-lg bg-background/70 p-2 text-[10px]">{children}</pre>,
          a: ({ children }) => <span className="underline">{children}</span>,
          h1: ({ children }) => <p className="mb-1 font-bold">{children}</p>,
          h2: ({ children }) => <p className="mb-1 font-bold">{children}</p>,
          h3: ({ children }) => <p className="mb-1 font-semibold">{children}</p>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export function MessageList({ messages, running }: { messages: ChatMessage[]; running: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, running]);

  if (messages.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-xs text-muted-foreground">
        <p className="text-sm font-semibold text-foreground">How can I help?</p>
        <p>Ask me to start a catalog project, pick columns, run enrichment, or explain how something works.</p>
      </div>
    );
  }

  const last = messages[messages.length - 1];
  const liveElsewhere = (last?.role === "thinking" && !last.endedAt) || (last?.role === "tool" && last.status === "running");

  return (
    <div className="space-y-1.5 px-3 py-3">
      {messages.map((message) => {
        switch (message.role) {
          case "user":
            return (
              <div key={message.id} className="flex flex-col items-end gap-1 pt-1">
                <div dir="auto" className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-[#400095] px-3 py-2 text-xs text-white">
                  {message.text}
                </div>
                {message.files?.map((name) => (
                  <span key={name} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Paperclip className="h-3 w-3" /> {name}
                  </span>
                ))}
              </div>
            );
          case "assistant":
            return <AssistantText key={message.id} text={message.text} />;
          case "thinking":
            return <ThinkingBlock key={message.id} message={message} />;
          case "tool":
            return <ToolRow key={message.id} message={message} />;
          default:
            return (
              <div
                key={message.id}
                dir="auto"
                className="flex items-start gap-1.5 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {message.text}
              </div>
            );
        }
      })}
      {running && !liveElsewhere && (
        <div className="flex items-center gap-1.5 px-0.5 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span className="assistant-shimmer">Working…</span>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
