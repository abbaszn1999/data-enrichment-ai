"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, CircleAlert, CircleCheck, CirclePause, Loader2 } from "lucide-react";
import type { AppNotification, JobInboxActiveRun } from "@/lib/jobs/types";
import { jobKindLabel } from "@/lib/jobs/href";

function EventIcon({ event }: { event: AppNotification["event"] }) {
  if (event === "completed") {
    return <CircleCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />;
  }
  if (event === "paused_no_credits") {
    return <CirclePause className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />;
  }
  return <CircleAlert className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />;
}

function timeAgo(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.round(delta / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function JobInbox({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [inProgress, setInProgress] = useState<JobInboxActiveRun[]>([]);
  const [loading, setLoading] = useState(false);

  const loadInbox = useCallback(async () => {
    const res = await fetch(
      `/api/notifications?workspaceId=${encodeURIComponent(workspaceId)}`
    );
    if (!res.ok) return;
    const data = (await res.json()) as {
      unreadCount: number;
      notifications: AppNotification[];
      inProgress: JobInboxActiveRun[];
    };
    setUnreadCount(data.unreadCount ?? 0);
    setNotifications(data.notifications ?? []);
    setInProgress(data.inProgress ?? []);
  }, [workspaceId]);

  useEffect(() => {
    void loadInbox();
    const tick = () => {
      if (document.visibilityState === "hidden") return;
      void loadInbox();
    };
    const timer = window.setInterval(tick, 15_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void loadInbox();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadInbox]);

  const markRead = async (ids?: string[]) => {
    setLoading(true);
    try {
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          ids?.length ? { workspaceId, ids } : { workspaceId, all: true }
        ),
      });
      await loadInbox();
    } finally {
      setLoading(false);
    }
  };

  const openItem = async (href: string, id?: string) => {
    setOpen(false);
    if (id) await markRead([id]);
    router.push(href);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative h-8 w-8 flex items-center justify-center rounded-md hover:bg-muted transition-colors"
        title="Messages"
        aria-label="Messages"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-primary text-[9px] font-bold text-primary-foreground flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full right-0 mt-1 w-80 bg-popover border rounded-lg shadow-lg z-50 overflow-hidden">
            <div className="px-3 py-2 border-b flex items-center justify-between">
              <div className="text-xs font-semibold">Messages</div>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => void markRead()}
                  className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                  disabled={loading}
                >
                  <CheckCheck className="h-3 w-3" />
                  Mark all read
                </button>
              )}
            </div>
            {inProgress.length > 0 && (
              <div className="border-b">
                <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  In progress
                </div>
                {inProgress.map((run) => (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => void openItem(run.href)}
                    className="w-full text-left px-3 py-2 hover:bg-muted"
                  >
                    <div className="text-xs font-medium truncate">
                      {jobKindLabel(run.kind)}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {run.sessionName} · {run.completedCount}/{run.total}
                    </div>
                  </button>
                ))}
              </div>
            )}
            <div className="max-h-72 overflow-y-auto">
              {notifications.length === 0 && inProgress.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                  ) : (
                    "No messages yet"
                  )}
                </div>
              ) : (
                notifications.map((note) => (
                  <button
                    key={note.id}
                    type="button"
                    onClick={() => void openItem(note.href, note.id)}
                    className={`w-full text-left px-3 py-2.5 hover:bg-muted border-b last:border-0 ${
                      note.read_at ? "opacity-70" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-1.5 min-w-0">
                        <EventIcon event={note.event} />
                        <div className="text-xs font-medium leading-snug">{note.title}</div>
                      </div>
                      {!note.read_at && (
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                      {note.body}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      {timeAgo(note.created_at)}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
