"use client";

import { useEffect, useState } from "react";
import { BookOpen, Check, History, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { storeAgentApi, type AuditEntry } from "./api";

/** "1:24 · 1.3K tokens · 7 steps" while a run works. */
export function LiveStatus({ startedAt, outputTokens, toolCalls }: { startedAt: number; outputTokens: number; toolCalls: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const tokens = outputTokens >= 1000 ? `${(outputTokens / 1000).toFixed(1)}K` : String(outputTokens);
  return (
    <div className="flex items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#6B358D]/60 dark:bg-[#F76D01]/60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-[#6B358D] dark:bg-[#F76D01]" />
      </span>
      <span>{clock}</span>
      {outputTokens > 0 && <span>· {tokens} tokens</span>}
      {toolCalls > 0 && <span>· {toolCalls} steps</span>}
    </div>
  );
}

export function StoreNotesDialog({ workspaceId, open, onOpenChange }: { workspaceId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [content, setContent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    storeAgentApi
      .notes(workspaceId)
      .then((r) => alive && setContent(r.content))
      .catch(() => alive && setContent(""));
    return () => {
      alive = false;
    };
  }, [open, workspaceId]);

  const save = async () => {
    if (content === null) return;
    setSaving(true);
    try {
      await storeAgentApi.saveNotes(workspaceId, content);
      toast.success("Store notes saved. Vera follows them in every chat.");
      onOpenChange(false);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-[#6B358D] dark:text-[#F76D01]" />
            Store notes
          </DialogTitle>
          <DialogDescription>
            What Vera should always know about this store: brand voice, the language for product text, naming, pricing or SEO rules. Shared with
            everyone in this workspace. Vera adds to it when you tell her to remember something.
          </DialogDescription>
        </DialogHeader>
        {content === null ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div>
            <textarea
              value={content}
              dir="auto"
              onChange={(e) => setContent(e.target.value.slice(0, 8000))}
              placeholder={"- Write product descriptions in a warm, simple tone\n- Product text is in English; replies to me in Arabic\n- Never change prices without asking"}
              className="h-64 w-full resize-none rounded-xl border bg-muted/20 p-3 font-mono text-[12.5px] leading-relaxed outline-none focus:ring-2 focus:ring-[#6B358D]/25 dark:focus:ring-[#F76D01]/25"
            />
            <div className="mt-1 text-end text-[11px] text-muted-foreground">{content.length.toLocaleString()} / 8,000</div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving || content === null} className="gap-1.5 bg-[#400095] text-white hover:bg-[#6B358D] dark:bg-[#F76D01]">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function when(iso: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function ChangeHistoryDialog({
  workspaceId,
  open,
  onOpenChange,
  onOpenChat,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenChat: (chatId: string) => void;
}) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [more, setMore] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    storeAgentApi
      .audit(workspaceId)
      .then((r) => {
        if (!alive) return;
        setEntries(r.entries);
        setMore(r.entries.length === 100);
      })
      .catch(() => alive && setEntries([]));
    return () => {
      alive = false;
    };
  }, [open, workspaceId]);

  const loadMore = async () => {
    if (!entries?.length) return;
    setLoading(true);
    try {
      const r = await storeAgentApi.audit(workspaceId, entries[entries.length - 1]!.createdAt);
      setEntries([...entries, ...r.entries]);
      setMore(r.entries.length === 100);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-[#6B358D] dark:text-[#F76D01]" />
            Store change history
          </DialogTitle>
          <DialogDescription>Every change the Store Agent made to your store in this workspace, with who approved it.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          {entries === null ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : entries.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No changes yet.</div>
          ) : (
            <div className="divide-y rounded-xl border">
              {entries.map((e) => (
                <div key={e.id} className="flex items-start gap-3 px-3 py-2.5 text-[12.5px]">
                  <span className={cn("mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full", e.ok ? "bg-emerald-500/15 text-emerald-600" : "bg-red-500/15 text-red-600")}>
                    {e.ok ? <Check className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-[11.5px] font-semibold">{e.operation}</span>
                      <span className="text-muted-foreground">
                        {e.records.toLocaleString()} record{e.records === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11.5px] text-muted-foreground">
                      <span>{when(e.createdAt)}</span>
                      {e.by && <span>· {e.by}</span>}
                      {e.chatId && (
                        <button
                          type="button"
                          onClick={() => {
                            onOpenChat(e.chatId!);
                            onOpenChange(false);
                          }}
                          className="truncate text-[#6B358D] hover:underline dark:text-[#F76D01]"
                        >
                          · {e.chatTitle || "Open chat"}
                        </button>
                      )}
                    </div>
                    {e.error && <div className="mt-1 line-clamp-2 text-[11.5px] text-destructive">{e.error}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {more && entries && entries.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => void loadMore()} disabled={loading} className="mx-auto">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Load more"}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
