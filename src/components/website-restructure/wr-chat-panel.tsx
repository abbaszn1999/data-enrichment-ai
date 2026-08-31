"use client";

import { useEffect, useRef, useState, type DragEvent, type FormEvent, type ClipboardEvent } from "react";
import { Bot, ImagePlus, Loader2, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  WR_MAX_CHAT_ATTACHMENTS,
  WR_MAX_COMPETITORS,
  WR_MAX_EDIT_MESSAGES,
  WR_MAX_IMAGES,
  type WrChatAttachment,
  type WrPhase,
} from "@/lib/website-restructure/types";
import type { WrProjectRowWithUrls } from "@/lib/website-restructure/client-api";
import {
  WR_CHAT_IMAGE_ACCEPT,
  WR_CHAT_IMAGE_ONLY_INSTRUCTION,
  takeWrChatImages,
  wrChatImageFilesFromClipboard,
  wrChatImageFilesFromList,
} from "@/lib/website-restructure/wr-chat-images";
import { WrProgressTrace } from "./wr-progress-trace";

type PendingChatImage = { id: string; file: File; previewUrl: string };

type WrChatPanelProps = {
  project: WrProjectRowWithUrls;
  canWrite: boolean;
  busy: boolean;
  progressSteps: string[];
  onUploadImages: (files: File[]) => void;
  onDeleteImage: (imageId: string) => void;
  onUploadLogo: (file: File) => void;
  onDeleteLogo: () => void;
  onDoneWithImages: () => void;
  onDoneWithLogo: () => void;
  onAddCompetitor: (raw: string) => void;
  onRemoveCompetitor: (index: number) => void;
  onStartBuild: (skipCompetitors: boolean) => void;
  onSendEdit: (instruction: string, files: File[]) => void;
};

function AgentBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#400095] text-white shadow-sm dark:bg-[#F76D01]">
        <Bot className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 max-w-[92%] rounded-2xl rounded-tl-md border border-border/70 bg-card px-3.5 py-2.5 text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap">
        {children}
      </div>
    </div>
  );
}

function ChatImageThumbs({
  items,
  size = "md",
  tone = "onLight",
  onRemove,
}: {
  items: Array<{ id: string; src: string; alt: string }>;
  size?: "sm" | "md";
  tone?: "onDark" | "onLight";
  onRemove?: (id: string) => void;
}) {
  const box = size === "sm" ? "h-11 w-11" : "h-14 w-14";
  const frame =
    tone === "onDark"
      ? "border-white/15 bg-white/10"
      : "border-border/70 bg-muted";
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <div
          key={item.id}
          className={`group relative ${box} overflow-hidden rounded-lg border ${frame}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.src} alt={item.alt} className="h-full w-full object-cover" />
          {onRemove ? (
            <button
              type="button"
              onClick={() => onRemove(item.id)}
              className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100"
              aria-label={`Remove ${item.alt}`}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function UserBubble({
  text,
  attachments,
  imageUrls,
}: {
  text: string;
  attachments?: WrChatAttachment[];
  imageUrls: Record<string, string>;
}) {
  const thumbs = (attachments ?? [])
    .map((att) => ({ id: att.id, src: imageUrls[att.id] ?? "", alt: att.filename }))
    .filter((t) => t.src);
  const showText = text.trim() && text.trim() !== WR_CHAT_IMAGE_ONLY_INSTRUCTION;
  return (
    <div className="flex justify-end animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
      <div className="max-w-[88%] space-y-1.5 rounded-2xl rounded-tr-md bg-foreground px-2.5 py-2 text-xs leading-relaxed text-background">
        {thumbs.length > 0 ? <ChatImageThumbs items={thumbs} size="sm" tone="onDark" /> : null}
        {showText ? <div className="whitespace-pre-wrap px-1 py-0.5">{text}</div> : null}
      </div>
    </div>
  );
}

const PHASE_PROMPTS: Record<WrPhase, string> = {
  collecting: "Loading your store's categories and navigation…",
  awaiting_images:
    "Upload a few screenshots of your current header — include one with any dropdown or mega menu open, so I can see how it's organized.",
  awaiting_logo: "Now upload your store's logo, so I can place it correctly in the new header.",
  awaiting_competitors:
    "Optionally, name up to 4 competitor stores (a brand name, or a URL) and I'll look at how their headers are organized before building yours.",
  building: "Building your header now — this takes a moment.",
  editing:
    "Your header is ready on the right. Tell me what to change, or paste an image — a logo, a color palette, a screenshot — and I'll use it.",
  locked: "The edit limit for this project has been reached. You can still preview and download the header.",
  failed: "The last build failed. You can try again below.",
};

export function WrChatPanel({
  project,
  canWrite,
  busy,
  progressSteps,
  onUploadImages,
  onDeleteImage,
  onUploadLogo,
  onDeleteLogo,
  onDoneWithImages,
  onDoneWithLogo,
  onAddCompetitor,
  onRemoveCompetitor,
  onStartBuild,
  onSendEdit,
}: WrChatPanelProps) {
  const [competitorDraft, setCompetitorDraft] = useState("");
  const [editDraft, setEditDraft] = useState("");
  const [pending, setPending] = useState<PendingChatImage[]>([]);
  const [composerDragOver, setComposerDragOver] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);

  const { phase, state } = project;
  const readOnly = !canWrite;
  const editMessagesLeft = Math.max(0, WR_MAX_EDIT_MESSAGES - project.editMessagesUsed);
  const composerLocked = busy || editMessagesLeft === 0;

  useEffect(() => {
    return () => {
      pending.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    };
    // Revoke leftover blob URLs if the panel unmounts mid-compose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const queuePending = (files: File[]) => {
    const { accepted, rejectedReason } = takeWrChatImages(files, pending.length);
    if (rejectedReason && accepted.length === 0) {
      toast.error(rejectedReason);
      return;
    }
    if (rejectedReason) toast.error(rejectedReason);
    if (accepted.length === 0) return;
    setPending((prev) => [
      ...prev,
      ...accepted.map((file) => ({
        id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()),
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ]);
  };

  const removePending = (id: string) => {
    setPending((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  };

  const submitEdit = (e: FormEvent) => {
    e.preventDefault();
    const text = editDraft.trim();
    if ((!text && pending.length === 0) || busy || readOnly || editMessagesLeft === 0) return;
    const files = pending.map((p) => p.file);
    pending.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    setPending([]);
    setEditDraft("");
    onSendEdit(text, files);
  };

  const handleComposerPaste = (e: ClipboardEvent) => {
    if (composerLocked || readOnly) return;
    const files = wrChatImageFilesFromClipboard(e.clipboardData);
    if (files.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    queuePending(files);
    const pastedText = e.clipboardData.getData("text/plain");
    if (pastedText) setEditDraft((d) => d + pastedText);
  };

  const handleComposerDragOver = (e: DragEvent) => {
    if (composerLocked || readOnly) return;
    if (![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault();
    setComposerDragOver(true);
  };

  const handleComposerDrop = (e: DragEvent) => {
    setComposerDragOver(false);
    if (composerLocked || readOnly) return;
    const files = wrChatImageFilesFromList(e.dataTransfer.files);
    if (files.length === 0) return;
    e.preventDefault();
    queuePending(files);
  };

  const submitCompetitor = (e: FormEvent) => {
    e.preventDefault();
    const text = competitorDraft.trim();
    if (!text || readOnly || state.competitors.length >= WR_MAX_COMPETITORS) return;
    onAddCompetitor(text);
    setCompetitorDraft("");
  };

  const canSend = !composerLocked && (editDraft.trim().length > 0 || pending.length > 0);

  return (
    <aside className="autommerce-dashboard flex h-full min-h-0 w-full flex-col bg-muted/20 [font-family:var(--brand-font)]">
      <div className="flex items-center gap-2.5 border-b border-border/60 px-4 py-3 shrink-0">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#400095] text-white shadow-sm dark:bg-[#F76D01]">
          <Bot className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black tracking-tight truncate">{project.name}</div>
          <div className="text-[11px] text-muted-foreground truncate">Header builder</div>
        </div>
        {phase === "editing" ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {editMessagesLeft} edit{editMessagesLeft === 1 ? "" : "s"} left
          </span>
        ) : null}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
        <AgentBubble>{PHASE_PROMPTS[phase]}</AgentBubble>
        {project.lastError ? (
          <AgentBubble>
            <span className="text-destructive">{project.lastError}</span>
          </AgentBubble>
        ) : null}

        {busy && phase !== "editing" && phase !== "locked" ? <WrProgressTrace steps={progressSteps} done={false} /> : null}

        {phase === "awaiting_images" && !readOnly ? (
          <div
            className="space-y-2 rounded-2xl border border-border/60 bg-card p-3"
            onPaste={(e) => {
              const files = wrChatImageFilesFromClipboard(e.clipboardData);
              if (files.length === 0) return;
              e.preventDefault();
              onUploadImages(files);
            }}
            onDragOver={(e) => {
              if ([...e.dataTransfer.types].includes("Files")) e.preventDefault();
            }}
            onDrop={(e) => {
              const files = wrChatImageFilesFromList(e.dataTransfer.files);
              if (files.length === 0) return;
              e.preventDefault();
              onUploadImages(files);
            }}
          >
            <div className="grid grid-cols-3 gap-2">
              {state.images.map((img) => (
                <div key={img.id} className="group relative aspect-square overflow-hidden rounded-lg border border-border/60 bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={state.imageUrls[img.id] ?? ""} alt={img.filename} className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => onDeleteImage(img.id)}
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label="Remove image"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {state.images.length < WR_MAX_IMAGES ? (
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border/70 text-muted-foreground hover:text-foreground hover:border-foreground/40"
                >
                  <ImagePlus className="h-4 w-4" />
                  <span className="text-[10px]">Add</span>
                </button>
              ) : null}
            </div>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length > 0) onUploadImages(files);
                e.target.value = "";
              }}
            />
            <p className="text-[11px] text-muted-foreground">
              {state.images.length}/{WR_MAX_IMAGES} uploaded — paste or drop a screenshot, and include one with the menu
              open if possible.
            </p>
            <button
              type="button"
              onClick={onDoneWithImages}
              disabled={state.images.length === 0 || busy}
              className="w-full rounded-full bg-[#400095] px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-[#6B358D] disabled:opacity-40 dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
            >
              Done with screenshots
            </button>
          </div>
        ) : null}

        {phase === "awaiting_logo" && !readOnly ? (
          <div
            className="space-y-2 rounded-2xl border border-border/60 bg-card p-3"
            onPaste={(e) => {
              const files = wrChatImageFilesFromClipboard(e.clipboardData);
              if (files.length === 0) return;
              e.preventDefault();
              if (files[0]) onUploadLogo(files[0]);
            }}
            onDragOver={(e) => {
              if ([...e.dataTransfer.types].includes("Files")) e.preventDefault();
            }}
            onDrop={(e) => {
              const files = wrChatImageFilesFromList(e.dataTransfer.files);
              if (files.length === 0) return;
              e.preventDefault();
              if (files[0]) onUploadLogo(files[0]);
            }}
          >
            {state.logo ? (
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={state.imageUrls[state.logo.id] ?? ""} alt="Logo" className="h-full w-full object-contain" />
                </div>
                <button
                  type="button"
                  onClick={onDeleteLogo}
                  className="inline-flex items-center gap-1 rounded-full border border-border/70 px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  <Trash2 className="h-3 w-3" />
                  Remove
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border/70 py-6 text-muted-foreground hover:text-foreground hover:border-foreground/40"
              >
                <ImagePlus className="h-4 w-4" />
                <span className="text-[11px]">Upload logo — or paste with Ctrl+V</span>
              </button>
            )}
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onUploadLogo(file);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={onDoneWithLogo}
              disabled={busy}
              className="w-full rounded-full bg-[#400095] px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-[#6B358D] disabled:opacity-40 dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
            >
              {state.logo ? "Continue" : "Skip — no logo"}
            </button>
          </div>
        ) : null}

        {phase === "awaiting_competitors" && !readOnly ? (
          <div className="space-y-2 rounded-2xl border border-border/60 bg-card p-3">
            <div className="space-y-1.5">
              {state.competitors.map((c, i) => (
                <div key={i} className="flex items-center justify-between gap-2 rounded-lg bg-muted/60 px-2.5 py-1.5 text-xs">
                  <span className="min-w-0 truncate">{c.raw}</span>
                  <button
                    type="button"
                    onClick={() => onRemoveCompetitor(i)}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label="Remove competitor"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            {state.competitors.length < WR_MAX_COMPETITORS ? (
              <form onSubmit={submitCompetitor} className="flex items-center gap-1.5">
                <input
                  value={competitorDraft}
                  onChange={(e) => setCompetitorDraft(e.target.value)}
                  placeholder="Brand name or URL"
                  className="min-w-0 flex-1 rounded-full border border-border/70 bg-background px-3 py-1.5 text-xs outline-none placeholder:text-muted-foreground"
                />
                <button
                  type="submit"
                  disabled={!competitorDraft.trim()}
                  className="rounded-full border border-border/70 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  Add
                </button>
              </form>
            ) : null}
            <button
              type="button"
              onClick={() => onStartBuild(state.competitors.length === 0)}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-[#400095] px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-[#6B358D] disabled:opacity-40 dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {state.competitors.length === 0 ? "Build my header" : "Build with these competitors"}
            </button>
          </div>
        ) : null}

        {phase === "failed" && !readOnly ? (
          <button
            type="button"
            onClick={() => onStartBuild(state.competitors.length === 0)}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-[#400095] px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-[#6B358D] disabled:opacity-40 dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Try building again
          </button>
        ) : null}

        {state.chat.map((m) =>
          m.role === "user" ? (
            <UserBubble key={m.id} text={m.text} attachments={m.attachments} imageUrls={state.imageUrls} />
          ) : (
            <AgentBubble key={m.id}>
              <span className={m.isError ? "text-destructive" : undefined}>{m.text}</span>
            </AgentBubble>
          )
        )}

        {busy && (phase === "editing" || phase === "locked") ? (
          <WrProgressTrace steps={progressSteps} done={false} />
        ) : null}
      </div>

      {(phase === "editing" || phase === "locked") && !readOnly ? (
        <form onSubmit={submitEdit} className="shrink-0 border-t border-border/60 px-3 py-3">
          <div
            onPaste={handleComposerPaste}
            onDragOver={handleComposerDragOver}
            onDragLeave={() => setComposerDragOver(false)}
            onDrop={handleComposerDrop}
            tabIndex={0}
            className={`rounded-2xl border bg-background px-2.5 py-2 transition-colors ${
              composerDragOver
                ? "border-[#400095] ring-2 ring-[#400095]/20 dark:border-[#F76D01] dark:ring-[#F76D01]/20"
                : "border-border/70"
            } ${composerLocked ? "opacity-70" : ""}`}
          >
            {pending.length > 0 ? (
              <div className="mb-2">
                <ChatImageThumbs
                  items={pending.map((p) => ({ id: p.id, src: p.previewUrl, alt: p.file.name }))}
                  onRemove={composerLocked ? undefined : removePending}
                />
              </div>
            ) : null}
            <div className="flex items-end gap-1.5">
              <button
                type="button"
                disabled={composerLocked || pending.length >= WR_MAX_CHAT_ATTACHMENTS}
                onClick={() => chatFileInputRef.current?.click()}
                className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
                aria-label="Attach image"
                title="Attach image (or paste with Ctrl+V)"
              >
                <ImagePlus className="h-4 w-4" />
              </button>
              <input
                ref={chatFileInputRef}
                type="file"
                accept={WR_CHAT_IMAGE_ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) queuePending(files);
                  e.target.value = "";
                }}
              />
              <textarea
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                onPaste={handleComposerPaste}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitEdit(e);
                  }
                }}
                disabled={composerLocked}
                rows={2}
                placeholder={
                  editMessagesLeft === 0
                    ? "Edit limit reached — you can still preview and download"
                    : "Describe a change, or paste an image…"
                }
                className="min-h-[44px] max-h-28 flex-1 resize-none bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
              />
              <button
                type="submit"
                disabled={!canSend}
                className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#400095] text-white shadow-sm transition-opacity hover:bg-[#6B358D] disabled:opacity-30 dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
                aria-label="Send"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        </form>
      ) : null}

      {readOnly ? (
        <p className="shrink-0 border-t border-border/60 px-4 py-2.5 text-[11px] text-muted-foreground">
          Viewer access — you can preview and download, but not build or edit.
        </p>
      ) : null}
    </aside>
  );
}
