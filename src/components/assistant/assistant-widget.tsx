"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Bot, RotateCcw, X } from "lucide-react";
import { useAssistantStream } from "@/hooks/use-assistant-stream";
import { Composer } from "./composer";
import { ConfirmationCard } from "./confirmation-card";
import { CursorOverlay } from "./cursor-overlay";
import { MessageList } from "./message-list";

/** Floating assistant. Lives in the workspace layout, so a run continues while it navigates. */
export function AssistantWidget({ workspaceId, workspaceSlug }: { workspaceId: string; workspaceSlug: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const sessionId = /\/catalog-intelligence\/([0-9a-f-]{36})/i.exec(pathname)?.[1];
  const chat = useAssistantStream({ workspaceId, workspaceSlug, sessionId });
  const running = chat.status === "running";

  return (
    <>
      <CursorOverlay />
      {open ? (
        <div
          data-assistant-widget
          className="fixed bottom-4 right-4 z-[60] flex h-[min(560px,calc(100vh-6rem))] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border/70 bg-background shadow-2xl"
        >
          <div className="flex items-center gap-2 border-b border-border/60 bg-gradient-to-r from-[#400095] to-[#6B358D] px-3 py-2.5 text-white">
            <Bot className="h-4 w-4" />
            <span className="flex-1 text-xs font-bold">Assistant</span>
            <button
              type="button"
              aria-label="New conversation"
              disabled={running}
              onClick={chat.reset}
              className="rounded-md p-1 hover:bg-white/15 disabled:opacity-40"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
            <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="rounded-md p-1 hover:bg-white/15">
              <X className="h-4 w-4" />
            </button>
          </div>
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
        </div>
      ) : (
        <button
          type="button"
          data-assistant-widget
          aria-label="Open assistant"
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-[60] flex h-12 items-center gap-2 rounded-full bg-[#400095] px-4 text-xs font-bold text-white shadow-xl transition-transform hover:scale-105 dark:bg-[#F76D01]"
        >
          <Bot className="h-4 w-4" />
          {running ? "Working…" : "Assistant"}
        </button>
      )}
    </>
  );
}
