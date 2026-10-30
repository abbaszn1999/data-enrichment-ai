"use client";

import { create } from "zustand";
import { emptyReply, reduceReply, type ReplyState } from "@/lib/store-agent/blocks";
import { requestLabel } from "@/lib/store-agent/mentions";
import type { ModelParam, StoreAgentEvent } from "@/lib/store-agent/protocol";
import { toast } from "sonner";
import {
  ApiError,
  PLAN_TAB_PREFIX,
  readEvents,
  storeAgentApi,
  type ApprovalState,
  type ChatFile,
  type ChatMessage,
  type ChatSummary,
  type Insight,
  type ModelOption,
  type Plan,
} from "./api";

export type LiveRun = {
  runId: string | null;
  /** When the run started (ms), for the live clock. */
  startedAt: number;
  reply: ReplyState;
  /** The message being answered, shown until the chat reloads from the database. */
  userMessage: ChatMessage | null;
};

export type ChatState = {
  status: "loading" | "ready" | "error";
  messages: ChatMessage[];
  files: ChatFile[];
  plans: Plan[];
  live: LiveRun | null;
  panel: { openFileIds: string[]; activeFileId: string | null };
  /** Undo state of the chat's approved changes, by approval id. */
  approvals: Record<string, ApprovalState>;
  /** Older messages exist above the loaded page. */
  hasMore: boolean;
  loadingEarlier?: boolean;
  error?: string;
};

type Blocked = "NO_CREDITS" | "NO_SUBSCRIPTION" | null;

type State = {
  workspaceId: string | null;
  chats: ChatSummary[];
  chatsLoaded: boolean;
  openTabs: string[];
  activeChatId: string | null;
  chatStates: Record<string, ChatState>;
  /** Tabs not yet saved: a new chat becomes real on its first message or file. */
  drafts: Record<string, { modelId: string; modelParams: ModelParam[]; mode: "agent" | "plan" }>;
  models: ModelOption[];
  autoRun: boolean;
  blocked: Blocked;
  notice: string | null;
  /** Whether the agent can be used here: off (feature flag), no connected store, or ready. */
  availability: "checking" | "ready" | "off" | "no_store" | "error";
  /** Concrete gaps found in the store, for the new-chat screen. */
  insights: Insight[];
};

const initial: State = {
  availability: "checking",
  insights: [],
  workspaceId: null,
  chats: [],
  chatsLoaded: false,
  openTabs: [],
  activeChatId: null,
  chatStates: {},
  drafts: {},
  models: [],
  autoRun: false,
  blocked: null,
  notice: null,
};

export const useStoreAgent = create<State>(() => ({ ...initial }));

const set = useStoreAgent.setState;
const get = useStoreAgent.getState;
const readers = new Map<string, AbortController>();
/** Per chat: events up to this seq were already seen before a reconnect. */
const replayUntil = new Map<string, number>();
let onRunFinished: (() => void) | null = null;

const isDraft = (id: string) => id.startsWith("draft-");
const tabsKey = (ws: string) => `store-agent:tabs:${ws}`;

function saveTabs() {
  const { workspaceId, openTabs, activeChatId } = get();
  if (!workspaceId) return;
  try {
    localStorage.setItem(tabsKey(workspaceId), JSON.stringify({ tabs: openTabs.filter((t) => !isDraft(t)), active: activeChatId }));
  } catch {
    // storage unavailable
  }
}

function patchChat(chatId: string, patch: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) {
  set((state) => {
    const current = state.chatStates[chatId] ?? emptyChatState();
    const next = typeof patch === "function" ? patch(current) : patch;
    return { chatStates: { ...state.chatStates, [chatId]: { ...current, ...next } } };
  });
}

function emptyChatState(): ChatState {
  return { status: "ready", messages: [], files: [], plans: [], live: null, panel: { openFileIds: [], activeFileId: null }, approvals: {}, hasMore: false };
}

function upsertSummary(chat: ChatSummary) {
  set((state) => {
    const exists = state.chats.some((c) => c.id === chat.id);
    const chats = exists ? state.chats.map((c) => (c.id === chat.id ? { ...c, ...chat } : c)) : [chat, ...state.chats];
    return { chats };
  });
}

function defaultModel(): { modelId: string; modelParams: ModelParam[] } {
  const { models } = get();
  const model = models.find((m) => m.isDefault) ?? models[0];
  return { modelId: model?.id ?? "composer-2.5", modelParams: model?.defaultParams ?? [] };
}

// ─── Setup ───────────────────────────────────────────────────────────────────

export async function initStoreAgent(workspaceId: string, opts: { onRunFinished?: () => void } = {}) {
  onRunFinished = opts.onRunFinished ?? null;
  if (get().workspaceId === workspaceId && get().chatsLoaded) return;
  for (const reader of readers.values()) reader.abort();
  readers.clear();
  set({ ...initial, workspaceId });

  let catalog: Awaited<ReturnType<typeof storeAgentApi.models>>;
  try {
    catalog = await storeAgentApi.models(workspaceId);
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 0;
    set({ availability: status === 404 ? "off" : status === 409 ? "no_store" : "error", chatsLoaded: true });
    return;
  }
  const chats = await storeAgentApi.listChats(workspaceId).catch(() => ({ chats: [] as ChatSummary[] }));
  set({ chats: chats.chats, chatsLoaded: true, models: catalog.models, autoRun: catalog.prefs.autoRun, availability: "ready" });
  // Suggestions come from a quick scan of the store; the page does not wait for them.
  void storeAgentApi
    .insights(workspaceId)
    .then((r) => get().workspaceId === workspaceId && set({ insights: r.insights ?? [] }))
    .catch(() => undefined);

  let saved: { tabs?: string[]; active?: string | null } = {};
  try {
    saved = JSON.parse(localStorage.getItem(tabsKey(workspaceId)) ?? "{}");
  } catch {
    saved = {};
  }
  const known = new Set(chats.chats.map((c) => c.id));
  const tabs = (saved.tabs ?? []).filter((t) => known.has(t)).slice(0, 12);
  if (tabs.length) {
    set({ openTabs: tabs });
    const active = saved.active && tabs.includes(saved.active) ? saved.active : tabs[0]!;
    await openChat(active);
  } else {
    newChat();
  }
}

// ─── Tabs and chats ─────────────────────────────────────────────────────────

export function newChat() {
  const id = `draft-${crypto.randomUUID()}`;
  const { modelId, modelParams } = defaultModel();
  const last = get().chats.find((c) => c.id === get().activeChatId);
  set((state) => ({
    openTabs: [...state.openTabs, id],
    activeChatId: id,
    drafts: {
      ...state.drafts,
      [id]: { modelId: last?.model_id ?? modelId, modelParams: last?.model_params ?? modelParams, mode: last?.mode ?? "agent" },
    },
    chatStates: { ...state.chatStates, [id]: emptyChatState() },
  }));
  saveTabs();
  return id;
}

/** Turn a draft tab into a saved chat. Returns the real id. */
async function materialize(chatId: string): Promise<string> {
  if (!isDraft(chatId)) return chatId;
  const { workspaceId, drafts } = get();
  const draft = drafts[chatId];
  const { chat } = await storeAgentApi.createChat(workspaceId!, {
    modelId: draft?.modelId,
    modelParams: draft?.modelParams,
    mode: draft?.mode,
  });
  set((state) => {
    const { [chatId]: draftState, ...rest } = state.chatStates;
    const { [chatId]: _removed, ...drafts } = state.drafts;
    void _removed;
    return {
      chats: [chat, ...state.chats],
      openTabs: state.openTabs.map((t) => (t === chatId ? chat.id : t)),
      activeChatId: state.activeChatId === chatId ? chat.id : state.activeChatId,
      chatStates: { ...rest, [chat.id]: draftState ?? emptyChatState() },
      drafts,
    };
  });
  saveTabs();
  return chat.id;
}

export async function openChat(chatId: string) {
  set((state) => ({
    openTabs: state.openTabs.includes(chatId) ? state.openTabs : [...state.openTabs, chatId],
    activeChatId: chatId,
  }));
  saveTabs();
  if (isDraft(chatId)) return;
  const existing = get().chatStates[chatId];
  if (existing && existing.status === "ready") {
    if (existing.live?.runId && !readers.has(chatId)) void follow(chatId, existing.live.runId, existing.live.reply.lastSeq);
    return;
  }
  await loadChat(chatId);
}

export async function loadChat(chatId: string) {
  const { workspaceId } = get();
  if (!workspaceId || isDraft(chatId)) return;
  patchChat(chatId, (s) => ({ status: s.messages.length ? s.status : "loading" }));
  try {
    const data = await storeAgentApi.loadChat(workspaceId, chatId);
    upsertSummary(data.chat);
    patchChat(chatId, (s) => ({
      status: "ready",
      messages: data.messages,
      files: data.files,
      plans: data.plans ?? [],
      approvals: data.approvals ?? {},
      hasMore: !!data.hasMore,
      live: data.live ? { runId: data.live.runId, startedAt: data.live.startedAt ?? Date.now(), reply: emptyReply(), userMessage: null } : null,
      panel: s.panel,
      error: undefined,
    }));
    if (data.live && !readers.has(chatId)) {
      replayUntil.set(chatId, data.live.lastSeq);
      void follow(chatId, data.live.runId, 0);
    }
  } catch (error) {
    patchChat(chatId, { status: "error", error: (error as Error).message });
  }
}

export function closeTab(chatId: string) {
  readers.get(chatId)?.abort();
  readers.delete(chatId);
  set((state) => {
    const index = state.openTabs.indexOf(chatId);
    const openTabs = state.openTabs.filter((t) => t !== chatId);
    const activeChatId =
      state.activeChatId === chatId ? (openTabs[Math.min(index, openTabs.length - 1)] ?? null) : state.activeChatId;
    const drafts = { ...state.drafts };
    delete drafts[chatId];
    return { openTabs, activeChatId, drafts };
  });
  saveTabs();
  if (!get().openTabs.length) newChat();
  else if (get().activeChatId) void openChat(get().activeChatId!);
}

export async function renameChat(chatId: string, title: string) {
  const { workspaceId } = get();
  if (!workspaceId || isDraft(chatId) || !title.trim()) return;
  const { chat } = await storeAgentApi.updateChat(workspaceId, chatId, { title: title.trim() });
  upsertSummary(chat);
}

export async function togglePin(chatId: string) {
  const { workspaceId, chats } = get();
  const chat = chats.find((c) => c.id === chatId);
  if (!workspaceId || !chat) return;
  const { chat: updated } = await storeAgentApi.updateChat(workspaceId, chatId, { pinned: !chat.pinned });
  upsertSummary(updated);
}

export async function deleteChat(chatId: string) {
  const { workspaceId } = get();
  if (!workspaceId) return;
  if (!isDraft(chatId)) await storeAgentApi.deleteChat(workspaceId, chatId);
  readers.get(chatId)?.abort();
  readers.delete(chatId);
  set((state) => ({ chats: state.chats.filter((c) => c.id !== chatId) }));
  if (get().openTabs.includes(chatId)) closeTab(chatId);
}

export async function refreshChats(search?: string) {
  const { workspaceId } = get();
  if (!workspaceId) return [];
  const { chats } = await storeAgentApi.listChats(workspaceId, search);
  if (!search) set({ chats });
  return chats;
}

// ─── Model, mode, auto-run ───────────────────────────────────────────────────

export function chatSettings(chatId: string | null): { modelId: string; modelParams: ModelParam[]; mode: "agent" | "plan" } {
  const state = get();
  if (chatId && state.drafts[chatId]) return state.drafts[chatId]!;
  const chat = state.chats.find((c) => c.id === chatId);
  if (chat) return { modelId: chat.model_id, modelParams: chat.model_params ?? [], mode: chat.mode };
  const fallback = defaultModel();
  return { ...fallback, mode: "agent" };
}

export async function setChatModel(chatId: string, modelId: string, modelParams: ModelParam[]) {
  if (isDraft(chatId)) {
    set((state) => ({ drafts: { ...state.drafts, [chatId]: { ...state.drafts[chatId]!, modelId, modelParams } } }));
    return;
  }
  set((state) => ({ chats: state.chats.map((c) => (c.id === chatId ? { ...c, model_id: modelId, model_params: modelParams } : c)) }));
  const { workspaceId } = get();
  if (workspaceId) await storeAgentApi.updateChat(workspaceId, chatId, { modelId, modelParams }).catch(() => undefined);
}

export async function setChatMode(chatId: string, mode: "agent" | "plan") {
  if (isDraft(chatId)) {
    set((state) => ({ drafts: { ...state.drafts, [chatId]: { ...state.drafts[chatId]!, mode } } }));
    return;
  }
  set((state) => ({ chats: state.chats.map((c) => (c.id === chatId ? { ...c, mode } : c)) }));
  const { workspaceId } = get();
  if (workspaceId) await storeAgentApi.updateChat(workspaceId, chatId, { mode }).catch(() => undefined);
}

export async function setAutoRun(autoRun: boolean) {
  const { workspaceId } = get();
  set({ autoRun });
  if (workspaceId) await storeAgentApi.setAutoRun(workspaceId, autoRun).catch(() => set({ autoRun: !autoRun }));
}

export const dismissBlocked = () => set({ blocked: null });
export const dismissNotice = () => set({ notice: null });

// ─── Files and the panel ─────────────────────────────────────────────────────

export async function uploadAttachment(chatId: string, file: File): Promise<{ chatId: string; file: { id: string; name: string; mime: string; size: number } }> {
  const { workspaceId } = get();
  const realId = await materialize(chatId);
  const { file: uploaded } = await storeAgentApi.upload(workspaceId!, realId, file);
  // In the Files panel and the @ menu right away, not after the next reload.
  patchChat(realId, (s) =>
    s.files.some((f) => f.id === uploaded.id)
      ? {}
      : {
          files: [
            ...s.files,
            {
              id: uploaded.id,
              name: uploaded.name,
              kind: "upload",
              mime: uploaded.mime,
              size: uploaded.size,
              created_by: "user",
              created_at: new Date().toISOString(),
              path: `uploads/${uploaded.name}`,
              shown: true,
            },
          ],
        }
  );
  return { chatId: realId, file: uploaded };
}

export function openFile(chatId: string, fileId: string) {
  patchChat(chatId, (s) => ({
    panel: {
      openFileIds: s.panel.openFileIds.includes(fileId) ? s.panel.openFileIds : [...s.panel.openFileIds, fileId],
      activeFileId: fileId,
    },
  }));
}

export function closeFile(chatId: string, fileId: string) {
  patchChat(chatId, (s) => {
    const openFileIds = s.panel.openFileIds.filter((f) => f !== fileId);
    return {
      panel: {
        openFileIds,
        activeFileId: s.panel.activeFileId === fileId ? (openFileIds[openFileIds.length - 1] ?? null) : s.panel.activeFileId,
      },
    };
  });
}

// ─── Runs ────────────────────────────────────────────────────────────────────

function applyEvent(chatId: string, event: StoreAgentEvent) {
  patchChat(chatId, (s) => {
    if (!s.live) return {};
    const live: LiveRun = { ...s.live, reply: reduceReply(s.live.reply, event) };
    if (event.type === "run") live.runId = event.runId;
    const next: Partial<ChatState> = { live };
    if (event.type === "file") {
      const prev = s.files.find((f) => f.id === event.fileId);
      const file: ChatFile = {
        id: event.fileId,
        name: event.name.split("/").pop() ?? event.name,
        kind: event.kind,
        mime: event.mime,
        size: prev?.size ?? 0,
        created_by: prev?.created_by ?? "agent",
        created_at: prev?.created_at ?? new Date().toISOString(),
        path: event.name,
        // Once a result, always one.
        shown: !!prev?.shown || event.shown === true,
        folder: event.folder ?? prev?.folder ?? null,
        request: prev?.request ?? (s.live.userMessage ? requestLabel(s.live.userMessage.content) : null),
      };
      next.files = prev ? s.files.map((f) => (f.id === file.id ? file : f)) : [...s.files, file];
      if (event.open) {
        next.panel = {
          openFileIds: s.panel.openFileIds.includes(event.fileId) ? s.panel.openFileIds : [...s.panel.openFileIds, event.fileId],
          activeFileId: event.fileId,
        };
      }
    }
    if (event.type === "plan") {
      const existing = s.plans.find((p) => p.id === event.planId);
      const plan: Plan = {
        id: event.planId,
        title: event.title,
        content: event.content,
        version: event.version,
        status: event.status,
        build_run_id: event.status === "draft" ? (existing?.build_run_id ?? null) : (s.live?.runId ?? existing?.build_run_id ?? null),
        updated_at: new Date().toISOString(),
      };
      next.plans = existing ? s.plans.map((p) => (p.id === plan.id ? plan : p)) : [plan, ...s.plans];
      // A new or revised plan, or one starting to build, comes to the front of the panel.
      if (event.status !== "built") {
        const tab = PLAN_TAB_PREFIX + event.planId;
        next.panel = { openFileIds: s.panel.openFileIds.includes(tab) ? s.panel.openFileIds : [...s.panel.openFileIds, tab], activeFileId: tab };
      }
    }
    return next;
  });
  // Events replayed on reconnect already happened: no fresh notifications for them.
  const replayed = event.seq <= (replayUntil.get(chatId) ?? 0);
  if (event.type === "approval" && !replayed) notifyUser(chatId, "Vera is waiting for your approval");
  if (event.type === "question" && !replayed) notifyUser(chatId, "Vera has a question for you");
  if (event.type === "approval_resolved") {
    patchChat(chatId, (s) => ({
      approvals: {
        ...s.approvals,
        [event.approvalId]: { status: event.status, kind: "write", undoable: !!event.undoable, undone: false, applied: event.status === "approved" },
      },
    }));
  }
  if (event.type === "run" || event.type === "done") {
    set((state) => ({
      chats: state.chats.map((c) =>
        c.id === chatId ? { ...c, status: event.type === "run" ? "running" : "idle", last_activity_at: new Date().toISOString() } : c
      ),
    }));
  }
}

/**
 * Tell the user when a chat needs them or is done and they are looking
 * elsewhere: a toast when on another chat or page, a system notification
 * when the browser tab is in the background.
 */
function notifyUser(chatId: string, label: string) {
  const state = get();
  const title = state.chats.find((c) => c.id === chatId)?.title || "Store Agent";
  const hidden = typeof document !== "undefined" && document.hidden;
  const onThisChat = state.activeChatId === chatId && typeof window !== "undefined" && window.location.pathname.endsWith("/store-assistant");
  if (!hidden && !onThisChat) {
    toast(label, { description: title, action: { label: "Open", onClick: () => void openChat(chatId) } });
  }
  if (hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
    try {
      const n = new Notification(label, { body: title, tag: `store-agent-${chatId}` });
      n.onclick = () => {
        window.focus();
        void openChat(chatId);
      };
    } catch {
      // notifications unavailable
    }
  }
}

function notifyFinished(chatId: string) {
  const reply = get().chatStates[chatId]?.live?.reply;
  if (!reply) return;
  notifyUser(chatId, reply.status === "finished" ? "Vera finished" : reply.status === "cancelled" ? "Vera stopped" : "Vera needs your attention");
}

/** Ask once, when the user starts a run, so a long run can tell them it is done. */
function askForNotifications() {
  if (typeof Notification === "undefined" || Notification.permission !== "default") return;
  try {
    void Notification.requestPermission();
  } catch {
    // ignore
  }
}

async function finishRun(chatId: string) {
  readers.delete(chatId);
  notifyFinished(chatId);
  onRunFinished?.();
  // Reload from the database: the saved reply replaces the live one, and the
  // summary (title, credits, context) is refreshed.
  await loadChat(chatId);
  patchChat(chatId, { live: null });
}

/** Follow a live run (after a reload or when switching back to its tab). */
async function follow(chatId: string, runId: string, after: number) {
  const { workspaceId } = get();
  if (!workspaceId) return;
  const controller = new AbortController();
  readers.get(chatId)?.abort();
  readers.set(chatId, controller);
  patchChat(chatId, (s) => ({ live: s.live ?? { runId, startedAt: Date.now(), reply: emptyReply(), userMessage: null } }));
  try {
    const res = await storeAgentApi.stream(workspaceId, runId, after, controller.signal);
    if (res.status === 404) return void (await finishRun(chatId));
    if (!res.ok) throw new ApiError("Could not reconnect", res.status);
    let done = false;
    await readEvents(res, (event) => {
      applyEvent(chatId, event);
      if (event.type === "done") done = true;
    });
    if (done) await finishRun(chatId);
    else if (!controller.signal.aborted) setTimeout(() => void follow(chatId, runId, get().chatStates[chatId]?.live?.reply.lastSeq ?? 0), 1500);
  } catch (error) {
    if (controller.signal.aborted) return;
    setTimeout(() => void follow(chatId, runId, get().chatStates[chatId]?.live?.reply.lastSeq ?? 0), 3000);
    void error;
  }
}

export async function sendMessage(
  chatId: string,
  text: string,
  attachments: Array<{ id: string; name: string; mime: string; size: number }>,
  opts: { buildPlanId?: string } = {}
) {
  const { workspaceId } = get();
  if (!workspaceId) return;
  const message = text.trim();
  if (!message && !attachments.length) return;

  let realId: string;
  try {
    realId = await materialize(chatId);
  } catch (error) {
    set({ notice: (error as Error).message });
    return;
  }
  const settings = chatSettings(realId);
  const userMessage: ChatMessage = {
    id: `local-${crypto.randomUUID()}`,
    run_id: null,
    role: "user",
    content: message,
    blocks: [],
    attachments: attachments.map((a) => ({ fileId: a.id, name: a.name, mime: a.mime, size: a.size })),
    created_at: new Date().toISOString(),
  };
  patchChat(realId, { live: { runId: null, startedAt: Date.now(), reply: emptyReply(), userMessage } });
  askForNotifications();

  const controller = new AbortController();
  readers.get(realId)?.abort();
  readers.set(realId, controller);
  try {
    const res = await storeAgentApi.send(
      workspaceId,
      realId,
      {
        message,
        attachmentIds: attachments.map((a) => a.id),
        model: { id: settings.modelId, params: settings.modelParams },
        mode: opts.buildPlanId ? "agent" : settings.mode,
        ...(opts.buildPlanId ? { buildPlanId: opts.buildPlanId } : {}),
      },
      controller.signal
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      patchChat(realId, { live: null });
      readers.delete(realId);
      if (res.status === 402) set({ blocked: body.error === "NO_SUBSCRIPTION" ? "NO_SUBSCRIPTION" : "NO_CREDITS" });
      else set({ notice: body.error || "The agent could not start." });
      return { restore: message };
    }
    let done = false;
    await readEvents(res, (event) => {
      applyEvent(realId, event);
      if (event.type === "done") done = true;
    });
    if (done) await finishRun(realId);
    else {
      const runId = get().chatStates[realId]?.live?.runId;
      if (runId && !controller.signal.aborted) void follow(realId, runId, get().chatStates[realId]?.live?.reply.lastSeq ?? 0);
    }
  } catch (error) {
    if (controller.signal.aborted) return;
    const runId = get().chatStates[realId]?.live?.runId;
    // The connection dropped mid-run: the run continues on the server, so pick it back up.
    if (runId) void follow(realId, runId, get().chatStates[realId]?.live?.reply.lastSeq ?? 0);
    else {
      patchChat(realId, { live: null });
      set({ notice: (error as Error).message || "Network error" });
    }
  }
}

export async function stopRun(chatId: string) {
  const { workspaceId } = get();
  const runId = get().chatStates[chatId]?.live?.runId;
  if (!workspaceId || !runId) return;
  await storeAgentApi.runAction(workspaceId, runId, "cancel").catch(() => undefined);
}

export async function steerRun(chatId: string, text: string): Promise<boolean> {
  const { workspaceId } = get();
  const runId = get().chatStates[chatId]?.live?.runId;
  if (!workspaceId || !runId) return false;
  const res = await storeAgentApi.runAction(workspaceId, runId, "steer", { text }).catch(() => null);
  return !!res?.ok;
}

export async function decideApproval(chatId: string, approvalId: string, approve: boolean) {
  const { workspaceId } = get();
  const runId = get().chatStates[chatId]?.live?.runId;
  if (!workspaceId || !runId) return;
  await storeAgentApi.runAction(workspaceId, runId, "approve", { approvalId, approve }).catch((e) => set({ notice: (e as Error).message }));
}

/**
 * Build a plan: an Agent-mode run in the same chat with the chat's model,
 * which carries out the plan's latest version. Like Cursor, the chat is in
 * Agent mode afterwards.
 */
export async function buildPlan(chatId: string, planId: string) {
  const plan = get().chatStates[chatId]?.plans.find((p) => p.id === planId);
  if (!plan || plan.status === "building") return;
  void setChatMode(chatId, "agent");
  await sendMessage(chatId, `Build the plan: ${plan.title}`, [], { buildPlanId: planId });
}

export function openPlan(chatId: string, planId: string) {
  openFile(chatId, PLAN_TAB_PREFIX + planId);
}

export async function answerQuestion(chatId: string, questionId: string, answers: string[][]) {
  const { workspaceId } = get();
  const runId = get().chatStates[chatId]?.live?.runId;
  if (!workspaceId || !runId) return;
  await storeAgentApi.runAction(workspaceId, runId, "answer", { questionId, answers }).catch((e) => set({ notice: (e as Error).message }));
}

export async function loadEarlier(chatId: string) {
  const { workspaceId } = get();
  const current = get().chatStates[chatId];
  const oldest = current?.messages[0]?.created_at;
  if (!workspaceId || !current?.hasMore || !oldest || current.loadingEarlier) return;
  patchChat(chatId, { loadingEarlier: true });
  try {
    const data = await storeAgentApi.loadChat(workspaceId, chatId, oldest);
    patchChat(chatId, (s) => ({
      messages: [...data.messages.filter((m) => !s.messages.some((x) => x.id === m.id)), ...s.messages],
      hasMore: !!data.hasMore,
      approvals: { ...data.approvals, ...s.approvals },
      loadingEarlier: false,
    }));
  } catch (error) {
    patchChat(chatId, { loadingEarlier: false });
    set({ notice: (error as Error).message });
  }
}

/** Put back what an approved change overwrote. Returns a short summary for the toast. */
export async function undoChange(chatId: string, approvalId: string): Promise<string> {
  const { workspaceId } = get();
  if (!workspaceId) throw new Error("No workspace");
  const result = await storeAgentApi.undo(workspaceId, approvalId);
  patchChat(chatId, (s) => ({
    approvals: { ...s.approvals, [approvalId]: { ...(s.approvals[approvalId] ?? { status: "approved", kind: "write", applied: true }), undoable: false, undone: true } },
  }));
  const parts = [`${result.restored} restored`];
  if (result.failed) parts.push(`${result.failed} could not be restored`);
  if (result.skipped.length) parts.push(`${result.skipped.length} with fields undo cannot restore (such as images)`);
  return parts.join(" · ");
}

export const isDraftChat = isDraft;
