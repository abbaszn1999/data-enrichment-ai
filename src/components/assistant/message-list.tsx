"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle, Loader2, Paperclip } from "lucide-react";
import type { ChatMessage } from "@/hooks/use-assistant-stream";

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

  return (
    <div className="space-y-2 px-3 py-3">
      {messages.map((message) => {
        if (message.role === "user") {
          return (
            <div key={message.id} className="flex flex-col items-end gap-1">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-[#400095] px-3 py-2 text-xs text-white">
                {message.text}
              </div>
              {message.files?.map((name) => (
                <span key={name} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Paperclip className="h-3 w-3" /> {name}
                </span>
              ))}
            </div>
          );
        }
        if (message.role === "assistant") {
          return (
            <div key={message.id} className="max-w-[92%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-xs leading-relaxed">
              {message.text}
            </div>
          );
        }
        if (message.role === "step") {
          return (
            <div key={message.id} className="px-1 text-[10px] text-muted-foreground">
              · {message.text}
            </div>
          );
        }
        return (
          <div key={message.id} className="flex items-start gap-1.5 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {message.text}
          </div>
        );
      })}
      {running && (
        <div className="flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Working…
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
