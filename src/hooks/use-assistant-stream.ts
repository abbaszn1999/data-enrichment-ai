"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { executeBrowserAction } from "@/lib/assistant/driver/actions";
import { forgetFile, getAttachedFile, rememberFile } from "@/lib/assistant/driver/attachments";
import { clearApprovals, issueApproval } from "@/lib/assistant/driver/spend-guard";
import { hideCursor } from "@/lib/assistant/driver/cursor-controller";
import { assistantEventSchema, type AssistantEvent, type AttachedFile } from "@/lib/assistant/protocol";

export type ChatMessage =
  | { id: string; role: "user"; text: string; files?: string[] }
  | { id: string; role: "assistant"; text: string }
  | { id: string; role: "thinking"; text: string; startedAt: number; endedAt?: number }
  | {
      id: string;
      role: "tool";
      status: "running" | "completed" | "error";
      kind: "code" | "page" | "action" | "sheet" | "approval";
      title: string;
      detail?: string;
      summary?: string;
      startedAt: number;
      endedAt?: number;
    }
  | { id: string; role: "error"; text: string };

type ToolEvent = Extract<AssistantEvent, { type: "tool" }>;

/** Close the open reasoning block, if the last item is one. */
function closeThinking(current: ChatMessage[]): ChatMessage[] {
  const last = current[current.length - 1];
  if (last?.role === "thinking" && !last.endedAt) {
    return [...current.slice(0, -1), { ...last, endedAt: Date.now() }];
  }
  return current;
}

export type PendingConfirmation = {
  callId: string;
  title: string;
  details: string[];
  actionTarget: string;
};

type Status = "idle" | "running";

let counter = 0;
const nextId = () => `m${Date.now().toString(36)}${(counter += 1)}`;

async function post(path: string, body: unknown): Promise<void> {
  try {
    await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // The run times out on its own if the answer never arrives.
  }
}

export function useAssistantStream(params: { workspaceId: string; workspaceSlug: string; sessionId?: string }) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const [attached, setAttached] = useState<AttachedFile[]>([]);
  const runIdRef = useRef<string | null>(null);
  const conversationRef = useRef<string | undefined>(undefined);
  const routerRef = useRef(router);
  const paramsRef = useRef(params);
  const confirmationRef = useRef<PendingConfirmation | null>(null);
  routerRef.current = router;
  paramsRef.current = params;
  confirmationRef.current = confirmation;

  const push = useCallback((message: ChatMessage) => setMessages((current) => [...current, message]), []);

  const appendAssistantText = useCallback((text: string) => {
    setMessages((before) => {
      const current = closeThinking(before);
      const last = current[current.length - 1];
      if (last && last.role === "assistant") return [...current.slice(0, -1), { ...last, text: `${last.text}${text}` }];
      return [...current, { id: nextId(), role: "assistant", text }];
    });
  }, []);

  const appendThinking = useCallback((text: string) => {
    setMessages((current) => {
      const last = current[current.length - 1];
      if (last?.role === "thinking" && !last.endedAt) {
        return [...current.slice(0, -1), { ...last, text: `${last.text}${text}` }];
      }
      return [...current, { id: nextId(), role: "thinking", text: text.replace(/^\s+/, ""), startedAt: Date.now() }];
    });
  }, []);

  const endThinking = useCallback(() => setMessages((current) => closeThinking(current)), []);

  const upsertTool = useCallback((event: ToolEvent) => {
    setMessages((before) => {
      const current = closeThinking(before);
      const index = current.findIndex((m) => m.role === "tool" && m.id === event.id);
      if (index >= 0) {
        const existing = current[index] as Extract<ChatMessage, { role: "tool" }>;
        const updated: ChatMessage = {
          ...existing,
          status: event.status,
          summary: event.summary ?? existing.summary,
          detail: event.detail ?? existing.detail,
          endedAt: event.status === "running" ? undefined : Date.now(),
        };
        return [...current.slice(0, index), updated, ...current.slice(index + 1)];
      }
      return [
        ...current,
        {
          id: event.id,
          role: "tool",
          status: event.status,
          kind: event.kind,
          title: event.title,
          detail: event.detail,
          summary: event.summary,
          startedAt: Date.now(),
          ...(event.status === "running" ? {} : { endedAt: Date.now() }),
        },
      ];
    });
  }, []);

  const attach = useCallback((files: FileList | File[]) => {
    const list = Array.from(files).slice(0, 5);
    setAttached((current) => [...current, ...list.map((file) => rememberFile(file))].slice(0, 5));
  }, []);

  const detach = useCallback((id: string) => {
    forgetFile(id);
    setAttached((current) => current.filter((file) => file.id !== id));
  }, []);

  const handleBrowserAction = useCallback(async (runId: string, callId: string, action: Parameters<typeof executeBrowserAction>[0]) => {
    const outcome = await executeBrowserAction(action, {
      workspaceSlug: paramsRef.current.workspaceSlug,
      navigate: (path) => routerRef.current.push(path),
      getFile: getAttachedFile,
    });
    await post("/api/assistant/tool-result", {
      runId,
      callId,
      ok: outcome.ok,
      ...(outcome.ok ? { result: outcome.result } : { error: outcome.error }),
    });
  }, []);

  const resolveConfirmation = useCallback(async (approved: boolean) => {
    const pending = confirmationRef.current;
    const runId = runIdRef.current;
    setConfirmation(null);
    if (!pending || !runId) return;
    await post("/api/assistant/tool-result", {
      runId,
      callId: pending.callId,
      ok: true,
      result: approved
        ? { approved: true, approvalToken: issueApproval(pending.actionTarget) }
        : { approved: false, reason: "The user declined." },
    });
  }, []);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || status === "running") return;
      const files = attached;
      push({ id: nextId(), role: "user", text: message, files: files.map((f) => f.name) });
      setStatus("running");
      setAttached([]);

      const current = paramsRef.current;
      let response: Response;
      try {
        response = await fetch("/api/assistant/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message,
            conversationId: conversationRef.current,
            files: files.length ? files : undefined,
            context: {
              workspaceSlug: current.workspaceSlug,
              workspaceId: current.workspaceId,
              path: window.location.pathname,
              sessionId: current.sessionId,
            },
          }),
        });
      } catch {
        push({ id: nextId(), role: "error", text: "Could not reach the assistant. Check your connection." });
        setStatus("idle");
        return;
      }

      if (!response.ok || !response.body) {
        const known: Record<number, string> = {
          402: "Your plan has no credits left for the assistant.",
          429: "The assistant is busy. Try again in a moment.",
        };
        push({ id: nextId(), role: "error", text: known[response.status] ?? "The assistant is not available right now." });
        setStatus("idle");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline: number;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line) continue;
            let parsed;
            try {
              parsed = assistantEventSchema.safeParse(JSON.parse(line));
            } catch {
              continue;
            }
            if (!parsed.success) continue;
            const event = parsed.data;
            switch (event.type) {
              case "run":
                runIdRef.current = event.runId;
                if (event.conversationId) conversationRef.current = event.conversationId;
                break;
              case "text":
                appendAssistantText(event.text);
                break;
              case "thinking":
                appendThinking(event.text);
                break;
              case "thinking_end":
                endThinking();
                break;
              case "tool":
                upsertTool(event);
                break;
              case "browser_action":
                if (runIdRef.current) void handleBrowserAction(runIdRef.current, event.callId, event.action);
                break;
              case "confirmation":
                setConfirmation({
                  callId: event.callId,
                  title: event.title,
                  details: event.details,
                  actionTarget: event.actionTarget,
                });
                break;
              case "error":
                push({ id: nextId(), role: "error", text: event.message });
                break;
              default:
                break;
            }
          }
        }
      } catch {
        push({ id: nextId(), role: "error", text: "The assistant connection was interrupted." });
      } finally {
        setMessages((current) =>
          closeThinking(current).map((m) =>
            m.role === "tool" && m.status === "running" ? { ...m, status: "error", endedAt: Date.now() } : m
          )
        );
        hideCursor();
        clearApprovals();
        setConfirmation(null);
        runIdRef.current = null;
        setStatus("idle");
      }
    },
    [appendAssistantText, appendThinking, attached, endThinking, handleBrowserAction, push, status, upsertTool]
  );

  const stop = useCallback(async () => {
    const runId = runIdRef.current;
    if (runId) await post("/api/assistant/cancel", { runId });
  }, []);

  const reset = useCallback(() => {
    conversationRef.current = undefined;
    setMessages([]);
    setAttached([]);
  }, []);

  // Leaving the app (closing the tab) cancels a live run.
  useEffect(() => {
    const onHide = () => {
      const runId = runIdRef.current;
      if (runId) navigator.sendBeacon?.("/api/assistant/cancel", new Blob([JSON.stringify({ runId })], { type: "application/json" }));
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  return { messages, status, confirmation, attached, attach, detach, send, stop, reset, resolveConfirmation };
}
