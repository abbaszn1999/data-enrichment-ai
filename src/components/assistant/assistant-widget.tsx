"use client";

import { useCallback, useState, type FormEvent } from "react";
import { usePathname } from "next/navigation";
import { Bot, KeyRound, Loader2, Lock, RotateCcw, X } from "lucide-react";
import { useAssistantStream } from "@/hooks/use-assistant-stream";
import { Composer } from "./composer";
import { ConfirmationCard } from "./confirmation-card";
import { CursorOverlay } from "./cursor-overlay";
import { MessageList } from "./message-list";

type Access = "unknown" | "checking" | "locked" | "unlocked";

const UNLOCK_ERRORS: Record<number, string> = {
  403: "Wrong code.",
  429: "Too many attempts. Try again in 15 minutes.",
  503: "Access is not set up on this server.",
};

/** Floating agent. Lives in the workspace layout, so a run continues while it navigates. */
export function AssistantWidget({ workspaceId, workspaceSlug }: { workspaceId: string; workspaceSlug: string }) {
  const [open, setOpen] = useState(false);
  const [access, setAccess] = useState<Access>("unknown");
  const pathname = usePathname();
  const sessionId = /\/catalog-intelligence\/([0-9a-f-]{36})/i.exec(pathname)?.[1];
  const chat = useAssistantStream({ workspaceId, workspaceSlug, sessionId, onLocked: () => setAccess("locked") });
  const running = chat.status === "running";

  const openWidget = useCallback(async () => {
    setOpen(true);
    if (access !== "unknown") return;
    setAccess("checking");
    try {
      const res = await fetch("/api/assistant/access", { cache: "no-store" });
      const data = res.ok ? await res.json() : null;
      setAccess(data?.unlocked ? "unlocked" : "locked");
    } catch {
      setAccess("locked");
    }
  }, [access]);

  const lock = useCallback(async () => {
    chat.reset();
    setAccess("locked");
    await fetch("/api/assistant/access", { method: "DELETE" }).catch(() => {});
  }, [chat]);

  return (
    <>
      <CursorOverlay />
      {open ? (
        <div
          data-assistant-widget
          className="pointer-events-auto fixed bottom-[92px] right-5 z-[60] flex h-[min(560px,calc(100vh-8.5rem))] w-[min(380px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-border/70 bg-background shadow-2xl"
        >
          <div className="flex items-center gap-2 border-b border-border/60 bg-gradient-to-r from-[#400095] to-[#6B358D] px-3 py-2.5 text-white">
            <Bot className="h-4 w-4" />
            <span className="flex-1 text-xs font-bold">Agent</span>
            {access === "unlocked" && (
              <>
                <button
                  type="button"
                  aria-label="New conversation"
                  disabled={running}
                  onClick={chat.reset}
                  className="rounded-md p-1 hover:bg-white/15 disabled:opacity-40"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Lock the agent"
                  title="Lock the agent in this browser"
                  disabled={running}
                  onClick={() => void lock()}
                  className="rounded-md p-1 hover:bg-white/15 disabled:opacity-40"
                >
                  <Lock className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="rounded-md p-1 hover:bg-white/15">
              <X className="h-4 w-4" />
            </button>
          </div>
          {access === "unlocked" ? (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <MessageList messages={chat.messages} running={running} />
              </div>
              {chat.confirmation && (
                <ConfirmationCard
                  confirmation={chat.confirmation}
                  workspaceId={workspaceId}
                  onDecide={(approved) => void chat.resolveConfirmation(approved)}
                />
              )}
              <Composer
                running={running}
                attached={chat.attached}
                onSend={(text) => void chat.send(text)}
                onStop={() => void chat.stop()}
                onAttach={chat.attach}
                onDetach={chat.detach}
              />
            </>
          ) : access === "locked" ? (
            <UnlockForm onUnlocked={() => setAccess("unlocked")} />
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          data-assistant-widget
          aria-label={running ? "Agent is working" : "Open agent"}
          title={running ? "Agent is working…" : "Agent"}
          onClick={() => void openWidget()}
          className="pointer-events-auto fixed bottom-[92px] right-5 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[#400095] to-[#6B358D] text-white shadow-lg transition-transform hover:scale-105 dark:from-[#F76D01] dark:to-[#c55500]"
        >
          {running ? <Loader2 className="h-6 w-6 animate-spin" /> : <Bot className="h-6 w-6" />}
        </button>
      )}
    </>
  );
}

function UnlockForm({ onUnlocked }: { onUnlocked: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/assistant/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (res.ok) {
        onUnlocked();
        return;
      }
      setError(UNLOCK_ERRORS[res.status] ?? "Could not check the code.");
      setCode("");
    } catch {
      setError("Could not check the code.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#400095]/10 text-[#400095] dark:bg-[#F76D01]/10 dark:text-[#F76D01]">
        <KeyRound className="h-5 w-5" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-bold">Private agent</p>
        <p className="text-xs text-muted-foreground">Enter the access code to open it in this browser.</p>
      </div>
      <input
        type="password"
        autoComplete="off"
        autoFocus
        aria-label="Access code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        disabled={busy}
        className="w-full rounded-xl border bg-muted/30 px-3 py-2 text-center text-sm tracking-widest outline-none focus:ring-2 focus:ring-[#6B358D]/30"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <button
        type="submit"
        disabled={!code.trim() || busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#400095] px-3 py-2 text-xs font-bold text-white hover:bg-[#6B358D] disabled:opacity-40 dark:bg-[#F76D01]"
      >
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Unlock
      </button>
    </form>
  );
}
