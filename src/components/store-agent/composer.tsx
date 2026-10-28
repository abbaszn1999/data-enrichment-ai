"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, FileText, Image as ImageIcon, ListChecks, Loader2, Paperclip, ShieldCheck, ShieldOff, Square, X, Bot } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ModelParam } from "@/lib/store-agent/protocol";
import { STORE_AGENT_LIMITS } from "@/lib/store-agent/protocol";
import { cn } from "@/lib/utils";
import { storeAgentApi, type Mention, type ModelOption } from "./api";
import { ModelPicker } from "./model-picker";

export type MessagePart = { kind: "text"; text: string } | { kind: "mention"; title: string; id: string };

const MENTION = /@\[([^\]\n]{1,120})\]\((gid:\/\/shopify\/[A-Za-z]+\/\d+|woo:\/\/[a-z_]+\/\d+)\)/g;

/** Split a message into text and @[Title](gid) mentions. */
export function splitMentions(text: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let last = 0;
  for (const match of text.matchAll(MENTION)) {
    if (match.index! > last) parts.push({ kind: "text", text: text.slice(last, match.index) });
    parts.push({ kind: "mention", title: match[1]!, id: match[2]! });
    last = match.index! + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}

export type PendingAttachment = { key: string; name: string; mime: string; size: number; status: "uploading" | "ready" | "error"; id?: string };

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,application/pdf,text/csv,text/plain,text/markdown,application/json,.csv,.xlsx,.xls,.md";

function ContextRing({ used, window }: { used: number; window: number }) {
  if (!used || !window) return null;
  const percent = Math.min(100, Math.round((used / window) * 100));
  const R = 5.5;
  const C = 2 * Math.PI * R;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex h-8 items-center gap-1 px-1 text-[10.5px] font-medium tabular-nums text-muted-foreground">
          <svg width="16" height="16" viewBox="0 0 16 16" className={percent >= 85 ? "text-red-500" : percent >= 60 ? "text-amber-500" : ""}>
            <circle cx="8" cy="8" r={R} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
            <circle
              cx="8"
              cy="8"
              r={R}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - percent / 100)}
              transform="rotate(-90 8 8)"
            />
          </svg>
          {percent}%
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <div className="font-semibold">Context {percent}% full</div>
        <div>
          ~{Math.round(used / 1000)}K of {Math.round(window / 1000)}K tokens
        </div>
        <div className="text-muted-foreground">When it fills up, earlier parts are summarized automatically.</div>
      </TooltipContent>
    </Tooltip>
  );
}

export function Composer({
  running,
  disabled,
  models,
  modelId,
  modelParams,
  mode,
  autoRun,
  context,
  storeName,
  onSend,
  onStop,
  onSteer,
  onUpload,
  onModelChange,
  onModeChange,
  onAutoRunChange,
  autoFocus,
  seed,
  workspaceId,
}: {
  workspaceId: string;
  running: boolean;
  disabled?: boolean;
  models: ModelOption[];
  modelId: string;
  modelParams: ModelParam[];
  mode: "agent" | "plan";
  autoRun: boolean;
  context: { used: number; window: number };
  storeName?: string;
  onSend: (text: string, attachments: Array<{ id: string; name: string; mime: string; size: number }>) => Promise<{ restore?: string } | void>;
  onStop: () => void;
  onSteer: (text: string) => Promise<boolean>;
  onUpload: (file: File) => Promise<{ id: string; name: string; mime: string; size: number }>;
  onModelChange: (modelId: string, params: ModelParam[]) => void;
  onModeChange: (mode: "agent" | "plan") => void;
  onAutoRunChange: (value: boolean) => void;
  autoFocus?: boolean;
  /** Put text in the box (a suggestion was clicked); `nonce` makes repeats count. */
  seed?: { text: string; nonce: number };
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [steering, setSteering] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // @-mentions: the box shows "@Title"; the message carries "@[Title](gid)".
  const [mentions, setMentions] = useState<Array<{ title: string; id: string }>>([]);
  const [picker, setPicker] = useState<{ query: string; start: number; index: number } | null>(null);
  const [results, setResults] = useState<Mention[]>([]);
  const [searching, setSearching] = useState(false);

  // A clicked suggestion (or "edit and resend") replaces the text once per nonce.
  const [seedNonce, setSeedNonce] = useState<number | null>(null);
  if (seed && seed.nonce !== seedNonce) {
    setSeedNonce(seed.nonce);
    const parts = splitMentions(seed.text);
    setText(parts.map((p) => (p.kind === "text" ? p.text : `@${p.title}`)).join(""));
    setMentions(parts.flatMap((p) => (p.kind === "mention" ? [{ title: p.title, id: p.id }] : [])));
  }

  // Search the store for the word after "@", a moment after typing stops.
  useEffect(() => {
    if (!picker || picker.query.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      storeAgentApi
        .search(workspaceId, picker.query, controller.signal)
        .then((r) => setResults(r.results))
        .catch(() => undefined)
        .finally(() => setSearching(false));
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [picker?.query, workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const updatePicker = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const match = /(^|\s)@([^\s@][^@\n]{0,40})?$/.exec(before);
    if (!match) return setPicker(null);
    const query = match[2] ?? "";
    setPicker((p) => ({ query, start: caret - query.length - 1, index: p?.query === query ? p.index : 0 }));
    if (query.length < 2) setResults([]);
  };

  const choose = (item: Mention) => {
    if (!picker) return;
    const end = picker.start + 1 + picker.query.length;
    const insert = `@${item.title} `;
    const next = text.slice(0, picker.start) + insert + text.slice(end);
    setText(next);
    setMentions((m) => (m.some((x) => x.id === item.id) ? m : [...m, { title: item.title, id: item.id }]));
    setPicker(null);
    setResults([]);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const pos = picker.start + insert.length;
      el.setSelectionRange(pos, pos);
    });
  };

  /** The text with each chosen "@Title" turned into "@[Title](gid)" for the agent. */
  const encode = (value: string) =>
    mentions.reduce((acc, m) => acc.split(`@${m.title}`).join(`@[${m.title}](${m.id})`), value);
  useEffect(() => {
    if (seedNonce === null) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [seedNonce]);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);
  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  const addFiles = useCallback(
    (files: File[]) => {
      const room = STORE_AGENT_LIMITS.maxAttachments - attachments.length;
      for (const file of files.slice(0, Math.max(0, room))) {
        const key = crypto.randomUUID();
        setAttachments((a) => [...a, { key, name: file.name, mime: file.type, size: file.size, status: "uploading" }]);
        onUpload(file)
          .then((uploaded) => setAttachments((a) => a.map((x) => (x.key === key ? { ...x, status: "ready", id: uploaded.id } : x))))
          .catch((error: Error) => {
            setAttachments((a) => a.filter((x) => x.key !== key));
            toast.error(`Could not attach ${file.name}`, { description: error.message });
          });
      }
      if (files.length > room) toast.info(`Up to ${STORE_AGENT_LIMITS.maxAttachments} files per message.`);
    },
    [attachments.length, onUpload]
  );

  const uploading = attachments.some((a) => a.status === "uploading");
  const canSend = !disabled && !uploading && (text.trim().length > 0 || attachments.some((a) => a.status === "ready"));

  const submit = async () => {
    if (running) {
      const steerText = encode(text).trim();
      if (!steerText) return;
      setSteering(true);
      const ok = await onSteer(steerText);
      setSteering(false);
      if (ok) {
        setText("");
        toast.success("Sent to the agent while it works.");
      } else toast.error("The agent could not take that right now. Try again when it finishes.");
      return;
    }
    if (!canSend) return;
    const ready = attachments.filter((a) => a.status === "ready" && a.id).map((a) => ({ id: a.id!, name: a.name, mime: a.mime, size: a.size }));
    const message = encode(text);
    const shown = text;
    setText("");
    setAttachments([]);
    setPicker(null);
    const result = await onSend(message, ready);
    if (result && "restore" in result && result.restore) setText(shown);
    else setMentions([]);
  };

  return (
    <div
      className={cn(
        "relative rounded-2xl border bg-background shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors focus-within:border-[#6B358D]/50 dark:focus-within:border-[#F76D01]/50",
        dragging && "border-dashed border-[#6B358D] bg-[#400095]/[0.03] dark:border-[#F76D01]"
      )}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-3">
          {attachments.map((a) => (
            <span key={a.key} className="inline-flex max-w-[200px] items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-[11.5px] font-medium">
              {a.status === "uploading" ? (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              ) : a.mime.startsWith("image/") ? (
                <ImageIcon className="h-3 w-3 text-muted-foreground" />
              ) : (
                <FileText className="h-3 w-3 text-muted-foreground" />
              )}
              <span className="truncate">{a.name}</span>
              <button type="button" aria-label={`Remove ${a.name}`} onClick={() => setAttachments((x) => x.filter((y) => y.key !== a.key))} className="hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {picker && (
        <div className="absolute inset-x-2 bottom-full z-30 mb-2 overflow-hidden rounded-xl border bg-popover shadow-xl">
          <div className="border-b px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {picker.query.length < 2 ? "Type a product, collection or category name" : searching && !results.length ? "Searching your store…" : "Mention from your store"}
          </div>
          {picker.query.length >= 2 && !searching && results.length === 0 && (
            <div className="px-3 py-3 text-[12.5px] text-muted-foreground">Nothing matches “{picker.query}”.</div>
          )}
          <div className="max-h-64 overflow-y-auto py-1">
            {results.map((item, i) => (
              <button
                key={item.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(item);
                }}
                onMouseEnter={() => setPicker((p) => (p ? { ...p, index: i } : p))}
                className={cn("flex w-full items-center gap-2.5 px-3 py-1.5 text-start", i === picker.index && "bg-muted")}
              >
                {item.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.image} alt="" className="h-7 w-7 shrink-0 rounded-md border object-cover" />
                ) : (
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] font-bold text-muted-foreground">
                    {item.type === "Product" ? "P" : "C"}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span dir="auto" className="block truncate text-[12.5px] font-medium">
                    {item.title}
                  </span>
                  <span className="text-[10.5px] text-muted-foreground">
                    {item.type} · {item.detail}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={text}
        dir="auto"
        rows={1}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          updatePicker(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onBlur={() => setTimeout(() => setPicker(null), 150)}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files);
          if (files.length) {
            e.preventDefault();
            addFiles(files);
          }
        }}
        onKeyDown={(e) => {
          if (picker && results.length) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const step = e.key === "ArrowDown" ? 1 : -1;
              setPicker({ ...picker, index: (picker.index + step + results.length) % results.length });
              return;
            }
            if ((e.key === "Enter" || e.key === "Tab") && !e.nativeEvent.isComposing) {
              e.preventDefault();
              choose(results[picker.index] ?? results[0]!);
              return;
            }
          }
          if (picker && e.key === "Escape") {
            e.preventDefault();
            setPicker(null);
            return;
          }
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder={
          running
            ? "Add guidance while the agent works…"
            : mode === "plan"
              ? "Describe what you want planned — nothing in the store will change…"
              : `Ask anything about ${storeName || "your store"}, or tell the agent what to do…`
        }
        className="block max-h-[240px] w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[14px] leading-relaxed outline-none placeholder:text-muted-foreground/60 disabled:opacity-50"
      />

      <div className="flex items-center gap-1 px-2 pb-2 pt-1">
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={disabled}
              aria-label="Attach files"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
            >
              <Paperclip className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Attach images, PDF, CSV or Excel</TooltipContent>
        </Tooltip>

        <div className="flex items-center rounded-lg bg-muted p-0.5">
          {(["agent", "plan"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onModeChange(m)}
              disabled={running}
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

        <ModelPicker models={models} modelId={modelId} params={modelParams} onChange={onModelChange} disabled={running} />

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onAutoRunChange(!autoRun)}
              aria-pressed={autoRun}
              className={cn(
                "flex h-8 items-center gap-1 rounded-lg px-2 text-[11.5px] font-semibold transition-colors",
                autoRun ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {autoRun ? <ShieldOff className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[260px] text-xs">
            {autoRun
              ? "Auto-run is on: store changes apply without asking, and you can undo them. Deletes still ask, since they can't be undone. Bulk changes (over 25 records) need an owner or admin."
              : "Ask first: every change to your store waits for your approval."}
          </TooltipContent>
        </Tooltip>

        <div className="flex-1" />
        <ContextRing used={context.used} window={context.window} />

        {running && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onStop}
                aria-label="Stop"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-80"
              >
                <Square className="h-3 w-3 fill-current" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Stop</TooltipContent>
          </Tooltip>
        )}
        {(!running || text.trim()) && (
          <button
            type="button"
            onClick={() => void submit()}
            disabled={running ? !text.trim() || steering : !canSend}
            aria-label={running ? "Send guidance" : "Send"}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#400095] text-white transition-all hover:bg-[#6B358D] disabled:bg-muted disabled:text-muted-foreground dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90 dark:disabled:bg-muted"
          >
            {steering || uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );
}
