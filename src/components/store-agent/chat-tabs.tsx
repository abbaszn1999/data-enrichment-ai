"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Popover } from "radix-ui";
import { History, Loader2, MessageSquare, MoreHorizontal, Pencil, Pin, PinOff, Plus, Search, Trash2, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ChatSummary } from "./api";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(iso));
}

function StatusDot({ status }: { status: ChatSummary["status"] | "draft" }) {
  if (status === "running") return <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[#6B358D] dark:text-[#F76D01]" />;
  if (status === "awaiting_approval" || status === "awaiting_answer")
    return <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-500" title="Waiting for you" />;
  if (status === "error" || status === "interrupted") return <span className="h-2 w-2 shrink-0 rounded-full bg-red-500/70" />;
  return <MessageSquare className="h-3 w-3 shrink-0 opacity-50" />;
}

export function ChatTabs({
  tabs,
  activeId,
  chats,
  onSelect,
  onClose,
  onNew,
  onOpenChat,
  onRename,
  onPin,
  onDelete,
  onSearch,
  actions,
  className,
  deleteNote,
}: {
  /** Buttons shown next to History (store notes, change history). */
  actions?: React.ReactNode;
  /** Extra classes for the bar (another agent reuses this bar on its own surface). */
  className?: string;
  /** Replaces the sentence under "Delete this chat?" when the agent has no store or files. */
  deleteNote?: string;
  tabs: string[];
  activeId: string | null;
  chats: ChatSummary[];
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onOpenChat: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
  onPin: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSearch: (q: string) => Promise<ChatSummary[]>;
}) {
  const byId = useMemo(() => new Map(chats.map((c) => [c.id, c])), [chats]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ChatSummary[] | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState<ChatSummary | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const term = query.trim();
    if (!term) return;
    searchTimer.current = setTimeout(() => void onSearch(term).then(setResults).catch(() => setResults([])), 250);
  }, [query, onSearch]);

  const list = query.trim() ? (results ?? []) : chats;
  const pinned = list.filter((c) => c.pinned);
  const recent = list.filter((c) => !c.pinned);

  const row = (chat: ChatSummary) => (
    <div key={chat.id} className={cn("group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted", chat.id === activeId && "bg-muted")}>
      {renaming?.id === chat.id ? (
        <input
          autoFocus
          value={renaming.title}
          dir="auto"
          onChange={(e) => setRenaming({ id: chat.id, title: e.target.value })}
          onBlur={() => {
            void onRename(chat.id, renaming.title);
            setRenaming(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setRenaming(null);
          }}
          className="h-7 flex-1 rounded-md border bg-background px-2 text-[12.5px] outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            onOpenChat(chat.id);
            setHistoryOpen(false);
          }}
          className="flex min-w-0 flex-1 items-center gap-2 text-start"
        >
          <StatusDot status={chat.status} />
          <span dir="auto" className="truncate text-[12.5px]">
            {chat.title || "New chat"}
          </span>
          <span className="ms-auto shrink-0 text-[10.5px] text-muted-foreground">{relativeTime(chat.last_activity_at)}</span>
        </button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Chat actions" className="rounded p-1 text-muted-foreground opacity-0 hover:bg-background group-hover:opacity-100 data-[state=open]:opacity-100">
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onSelect={() => setRenaming({ id: chat.id, title: chat.title })}>
            <Pencil className="h-3.5 w-3.5" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void onPin(chat.id)}>
            {chat.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
            {chat.pinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setDeleting(chat)} className="text-destructive focus:text-destructive">
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return (
    <div className={cn("flex h-10 shrink-0 items-center gap-1 border-b bg-background px-2", className)}>
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
        {tabs.map((id) => {
          const chat = byId.get(id);
          const active = id === activeId;
          return (
            <div
              key={id}
              className={cn(
                "group relative flex h-8 min-w-[110px] max-w-[220px] shrink-0 items-center gap-1.5 rounded-lg ps-2.5 pe-1 text-[12.5px] transition-colors",
                active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              )}
            >
              <button type="button" onClick={() => onSelect(id)} onAuxClick={(e) => e.button === 1 && onClose(id)} className="flex min-w-0 flex-1 items-center gap-1.5">
                <StatusDot status={chat?.status ?? "draft"} />
                <span dir="auto" className="truncate">
                  {chat?.title || "New chat"}
                </span>
              </button>
              <button
                type="button"
                aria-label="Close tab"
                onClick={() => onClose(id)}
                className={cn("rounded p-0.5 hover:bg-background", active ? "opacity-70" : "opacity-0 group-hover:opacity-70")}
              >
                <X className="h-3 w-3" />
              </button>
              {active && <span className="absolute inset-x-2 -bottom-[5px] h-[2px] rounded-full bg-[#400095] dark:bg-[#F76D01]" />}
            </div>
          );
        })}
        <button
          type="button"
          onClick={onNew}
          aria-label="New chat"
          title="New chat"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {actions}
      <Popover.Root open={historyOpen} onOpenChange={setHistoryOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted"
          >
            <History className="h-3.5 w-3.5" />
            History
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="end" sideOffset={6} className="z-50 w-[340px] rounded-xl border bg-popover p-2 text-popover-foreground shadow-xl">
            <div className="relative mb-2">
              <Search className="absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search chats"
                className="h-8 w-full rounded-lg border bg-background ps-8 pe-2 text-[12.5px] outline-none focus:ring-2 focus:ring-[#6B358D]/20"
              />
            </div>
            <div className="max-h-[420px] overflow-y-auto">
              {list.length === 0 && <div className="px-2 py-6 text-center text-[12.5px] text-muted-foreground">{query ? "No chats match." : "No chats yet."}</div>}
              {pinned.length > 0 && (
                <>
                  <div className="px-2 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Pinned</div>
                  {pinned.map(row)}
                </>
              )}
              {recent.length > 0 && (
                <>
                  {pinned.length > 0 && <div className="px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Recent</div>}
                  {recent.map(row)}
                </>
              )}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleting?.title || "New chat"}”{" "}
              {deleteNote ?? "and its files will be deleted for good. Changes already made in your store stay as they are."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (deleting) void onDelete(deleting.id);
                setDeleting(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
