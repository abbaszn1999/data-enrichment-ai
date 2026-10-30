"use client";

// Client state for the Google Ads workspace. Prototype: account data lives in
// memory and changes apply locally. With the backend, `applyChange` becomes a
// POST to /api/google-ads/mutate and account data comes from the report cache.

import { create } from "zustand";
import { rangeFor } from "./metrics";
import { MANAGER_ACCOUNT, MERCHANT_ACCOUNTS, buildDemoAccount, buildEmptyAccount, buildSecondAccount, DEMO_GOOGLE_EMAIL } from "./mock-data";
import { applyOps, describeOps, gid } from "./mutations";
import { validateOps } from "./validation";
import { DEFAULT_PROFILE, seedMemories, type AgentDoc, type AgentMemory, type BusinessProfile } from "./docs";
import { seedDocs } from "./agent-docs";
import type {
  AccountData,
  AgentMessage,
  CampaignBundle,
  ChangeEvent,
  ChatThread,
  ChangeSource,
  DateRangePreset,
  DateRange,
  GaScope,
  GaView,
  GoogleAccount,
  MerchantAccount,
  MutateOp,
  ProposedChange,
} from "./types";

export type ConnectionStatus = "disconnected" | "authorizing" | "selecting" | "connected";

/** Merchant Center is its own connection (own consent, own account), separate from Google Ads. */
export type MerchantConnection = {
  status: ConnectionStatus;
  email: string | null;
  /** Accounts the signed-in user can reach; filled after consent. */
  accounts: MerchantAccount[];
  /** The chosen account. Kept while reconnecting so Cancel can fall back to it. */
  merchantId: string | null;
};

const NO_MERCHANT: MerchantConnection = { status: "disconnected", email: null, accounts: [], merchantId: null };

export type GaDialog =
  | { kind: "adGroup"; campaignId?: string }
  | { kind: "keywords"; adGroupId?: string }
  | { kind: "negatives"; campaignId?: string; adGroupId?: string }
  | { kind: "ad"; adGroupId?: string; adId?: string }
  | { kind: "asset"; campaignId?: string }
  | { kind: "budget"; campaignId: string }
  | { kind: "audience"; campaignId?: string; adGroupId?: string }
  | { kind: "conversion" };

export type ProposedChangeInput = Pick<ProposedChange, "title" | "rationale" | "ops" | "risk"> &
  Partial<Pick<ProposedChange, "impact" | "messageId" | "source">>;

type AccountState = {
  data: AccountData;
  changes: ProposedChange[];
  history: ChangeEvent[];
  /** Every conversation with the agent for this account. */
  chats: ChatThread[];
  /** Chats open as tabs, in order. */
  openChatIds: string[];
  activeChatId: string;
  docs: AgentDoc[];
  /** Document tabs open beside the Account tab, in order. */
  openDocIds: string[];
  /** "account" or a document id. */
  activeTab: string;
  profile: BusinessProfile;
  memories: AgentMemory[];
};

type GaStore = {
  status: ConnectionStatus;
  googleEmail: string | null;
  accessible: GoogleAccount[];
  accounts: Record<string, AccountState>;
  customerId: string | null;
  /** The user pressed "Go to agent". Connecting Google Ads alone doesn't open the workspace. */
  entered: boolean;
  merchant: MerchantConnection;

  view: GaView;
  scope: GaScope;
  range: DateRange;
  autoApprove: boolean;
  agentBusy: boolean;
  /** The chat the running agent turn belongs to. */
  busyChatId: string | null;
  editor: { open: boolean; draft?: CampaignBundle; changeId?: string };
  dialog: GaDialog | null;

  startConnect: () => void;
  completeAuth: () => void;
  /** First pick on the connect screen: connects the account but stays there until "Go to agent". */
  chooseAccount: (customerId: string) => void;
  /** Open (or switch to) an account inside the workspace. */
  selectAccount: (customerId: string) => void;
  /** Choose a different ad account from the connect screen. */
  changeAccount: () => void;
  enterWorkspace: () => void;
  disconnect: () => void;

  startMerchantConnect: () => void;
  completeMerchantAuth: () => void;
  selectMerchantAccount: (merchantId: string) => void;
  /** Pick another Merchant Center account without signing in again. */
  changeMerchantAccount: () => void;
  /** Leave the consent or picker step; keeps the previous account when there was one. */
  cancelMerchantConnect: () => void;
  disconnectMerchant: () => void;

  setView: (view: GaView) => void;
  setScope: (scope: GaScope, view?: GaView) => void;
  setRange: (preset: DateRangePreset) => void;
  setAutoApprove: (on: boolean) => void;
  setAgentBusy: (busy: boolean, chatId?: string) => void;
  openEditor: (draft?: CampaignBundle, changeId?: string) => void;
  closeEditor: () => void;
  openDialog: (dialog: GaDialog) => void;
  closeDialog: () => void;

  /** Queue a change for approval (or apply it straight away in auto-approve). */
  propose: (input: ProposedChangeInput) => ProposedChange;
  applyChange: (changeId: string) => void;
  rejectChange: (changeId: string) => void;
  /** Replace a pending change's ops after the user edited it (e.g. in the campaign editor). */
  reviseChange: (changeId: string, ops: MutateOp[], title?: string) => void;
  /** Apply right away: the user acted directly in the UI. */
  applyDirect: (title: string, ops: MutateOp[], source?: ChangeSource) => { ok: boolean; error?: string };
  undo: (eventId: string) => void;

  createDoc: (doc: AgentDoc, open?: boolean) => void;
  updateDoc: (docId: string, update: (doc: AgentDoc) => AgentDoc) => void;
  openDoc: (docId: string) => void;
  closeDocTab: (docId: string) => void;
  setActiveTab: (tab: string) => void;
  setProfile: (patch: Partial<BusinessProfile>) => void;
  addMemory: (text: string, source: AgentMemory["source"]) => void;
  removeMemory: (id: string) => void;
  /** Alerts are notifications, not account changes: no history entry. */
  markAlertsRead: (ids?: string[]) => void;
  /** Add to a chat (the open one unless `chatId` says otherwise). The first user message names the chat. */
  addMessage: (message: AgentMessage, chatId?: string) => void;
  /** Update a message wherever it lives. */
  patchMessage: (id: string, patch: Partial<AgentMessage>) => void;
  /** Start a new chat tab (reuses an empty one that is already open). */
  newChat: () => void;
  selectChat: (chatId: string) => void;
  /** Open a chat from History as a tab and show it. */
  openChat: (chatId: string) => void;
  closeChat: (chatId: string) => void;
  renameChat: (chatId: string, title: string) => void;
  pinChat: (chatId: string) => void;
  deleteChat: (chatId: string) => void;
  setChatMode: (mode: ChatThread["mode"]) => void;
};

const ACTOR = "You";

/** Views that make no sense at a scope fall back to the closest one that does. */
function viewForScope(view: GaView, scope: GaScope, isPmax: boolean): GaView {
  const accountOnly: GaView[] = ["campaigns", "conversions", "library", "products", "rules", "keywordPlanner", "experiments", "links", "accountSettings", "documents", "profile", "connections"];
  if (scope.adGroupId && (accountOnly.includes(view) || view === "adGroups" || view === "recommendations" || view === "locations" || view === "settings" || view === "planner" || view === "productGroups" || view === "content" || view === "demographics"))
    return "keywords";
  if (scope.campaignId && accountOnly.includes(view)) return "adGroups";
  if (!scope.campaignId && view === "productGroups") return "products";
  if (!scope.campaignId && view === "settings") return "campaigns";
  if (isPmax && (view === "ads" || view === "keywords")) return "adGroups";
  return view;
}

function current(state: GaStore): AccountState | null {
  return state.customerId ? state.accounts[state.customerId] ?? null : null;
}

function withAccount(state: GaStore, update: (a: AccountState) => AccountState): Partial<GaStore> {
  const acc = current(state);
  if (!acc || !state.customerId) return {};
  return { accounts: { ...state.accounts, [state.customerId]: update(acc) } };
}

export const NEW_CHAT_TITLE = "New chat";

function newThread(): ChatThread {
  const now = new Date().toISOString();
  return { id: gid("chat"), title: NEW_CHAT_TITLE, messages: [], mode: "agent", pinned: false, createdAt: now, updatedAt: now };
}

function chatTitleFrom(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 42 ? `${clean.slice(0, 41).trimEnd()}…` : clean || NEW_CHAT_TITLE;
}

/** The chat shown in the agent panel. */
export function activeChatOf(acc: Pick<AccountState, "chats" | "activeChatId">): ChatThread {
  return acc.chats.find((c) => c.id === acc.activeChatId) ?? acc.chats[0]!;
}

/** The chat that holds a message. */
export function chatOfMessage(acc: Pick<AccountState, "chats">, messageId: string): ChatThread | undefined {
  return acc.chats.find((c) => c.messages.some((m) => m.id === messageId));
}

/** Always keeps at least one chat open: closing or deleting the last one starts a fresh chat. */
function ensureChat(a: AccountState): AccountState {
  if (a.openChatIds.length && a.chats.some((c) => c.id === a.activeChatId && a.openChatIds.includes(c.id))) return a;
  if (a.openChatIds.length) return { ...a, activeChatId: a.openChatIds[a.openChatIds.length - 1]! };
  const fresh = newThread();
  return { ...a, chats: [fresh, ...a.chats], openChatIds: [fresh.id], activeChatId: fresh.id };
}

export const useGoogleAds = create<GaStore>((set, get) => ({
  status: "disconnected",
  googleEmail: null,
  accessible: [],
  accounts: {},
  customerId: null,
  entered: false,
  merchant: NO_MERCHANT,

  view: "overview",
  scope: {},
  range: rangeFor("LAST_30_DAYS"),
  autoApprove: false,
  agentBusy: false,
  busyChatId: null,
  editor: { open: false },
  dialog: null,

  startConnect: () => set({ status: "authorizing" }),

  completeAuth: () => {
    const demo = buildDemoAccount();
    const second = buildSecondAccount();
    const empty = buildEmptyAccount();
    const fresh = (data: AccountData, docs: AgentDoc[] = []): AccountState => {
      const first = newThread();
      return {
        data,
        changes: [],
        history: [],
        chats: [first],
        openChatIds: [first.id],
        activeChatId: first.id,
        docs,
        openDocIds: [],
        activeTab: "account",
        profile: { ...DEFAULT_PROFILE, businessName: data.account.name },
        memories: data.campaigns.length ? seedMemories() : [],
      };
    };
    set({
      status: "selecting",
      googleEmail: DEMO_GOOGLE_EMAIL,
      accessible: [MANAGER_ACCOUNT, demo.account, second.account, empty.account],
      accounts: {
        [demo.account.customerId]: fresh(demo, seedDocs(demo)),
        [second.account.customerId]: fresh(second),
        [empty.account.customerId]: fresh(empty),
      },
    });
  },

  chooseAccount: (customerId) =>
    set({ status: "connected", entered: false, customerId, view: "overview", scope: {}, editor: { open: false }, dialog: null }),

  selectAccount: (customerId) =>
    set({ status: "connected", entered: true, customerId, view: "overview", scope: {}, editor: { open: false }, dialog: null }),

  changeAccount: () => set((s) => (s.status === "connected" ? { status: "selecting", entered: false } : {})),

  enterWorkspace: () => set((s) => (s.status === "connected" && s.customerId ? { entered: true, view: "overview", scope: {} } : {})),

  disconnect: () =>
    set({ status: "disconnected", entered: false, googleEmail: null, accessible: [], accounts: {}, customerId: null, view: "overview", scope: {} }),

  startMerchantConnect: () => set((s) => ({ merchant: { ...s.merchant, status: "authorizing" } })),

  completeMerchantAuth: () =>
    set((s) => ({ merchant: { ...s.merchant, status: "selecting", email: DEMO_GOOGLE_EMAIL, accounts: MERCHANT_ACCOUNTS } })),

  selectMerchantAccount: (merchantId) =>
    set((s) => (s.merchant.accounts.some((a) => a.merchantId === merchantId) ? { merchant: { ...s.merchant, status: "connected", merchantId } } : {})),

  changeMerchantAccount: () => set((s) => (s.merchant.email ? { merchant: { ...s.merchant, status: "selecting", accounts: MERCHANT_ACCOUNTS } } : {})),

  cancelMerchantConnect: () =>
    set((s) => ({ merchant: s.merchant.merchantId ? { ...s.merchant, status: "connected" } : NO_MERCHANT })),

  disconnectMerchant: () => set({ merchant: NO_MERCHANT }),

  setView: (view) => set({ view }),

  setScope: (scope, view) =>
    set((s) => {
      const data = current(s)?.data;
      const isPmax = data?.campaigns.find((c) => c.id === scope.campaignId)?.type === "PERFORMANCE_MAX";
      return { scope, view: viewForScope(view ?? s.view, scope, isPmax) };
    }),

  setRange: (preset) => set({ range: rangeFor(preset) }),
  setAutoApprove: (on) => set({ autoApprove: on }),
  setAgentBusy: (busy, chatId) =>
    set((s) => {
      const acc = current(s);
      return { agentBusy: busy, busyChatId: busy ? chatId ?? (acc ? acc.activeChatId : null) : null };
    }),
  openEditor: (draft, changeId) => set({ editor: { open: true, draft, changeId } }),
  closeEditor: () => set({ editor: { open: false } }),
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),

  propose: (input) => {
    const acc = current(get());
    if (!acc) throw new Error("No account selected");
    const change: ProposedChange = {
      id: gid("chg"),
      createdAt: new Date().toISOString(),
      source: input.source ?? "AGENT",
      title: input.title,
      rationale: input.rationale,
      impact: input.impact,
      risk: input.risk,
      status: "PENDING",
      ops: input.ops,
      diff: describeOps(acc.data, input.ops),
      messageId: input.messageId,
    };
    set((s) => withAccount(s, (a) => ({ ...a, changes: [change, ...a.changes] })));
    if (get().autoApprove) get().applyChange(change.id);
    return change;
  },

  applyChange: (changeId) => {
    const acc = current(get());
    const change = acc?.changes.find((c) => c.id === changeId);
    if (!acc || !change || change.status !== "PENDING") return;
    const errors = validateOps(acc.data, change.ops);
    if (errors.length) {
      set((s) =>
        withAccount(s, (a) => ({
          ...a,
          changes: a.changes.map((c) => (c.id === changeId ? { ...c, status: "FAILED", error: errors.join(" ") } : c)),
        }))
      );
      return;
    }
    try {
      const { next, inverse } = applyOps(acc.data, change.ops);
      const event: ChangeEvent = {
        id: gid("evt"),
        at: new Date().toISOString(),
        actor: change.source === "AGENT" ? "Agent (approved by you)" : ACTOR,
        source: change.source,
        title: change.title,
        diff: change.diff,
        inverse,
        changeId,
      };
      set((s) =>
        withAccount(s, (a) => ({
          ...a,
          data: next,
          changes: a.changes.map((c) => (c.id === changeId ? { ...c, status: "APPLIED" } : c)),
          history: [event, ...a.history],
        }))
      );
    } catch (err) {
      set((s) =>
        withAccount(s, (a) => ({
          ...a,
          changes: a.changes.map((c) => (c.id === changeId ? { ...c, status: "FAILED", error: (err as Error).message } : c)),
        }))
      );
    }
  },

  rejectChange: (changeId) =>
    set((s) =>
      withAccount(s, (a) => ({
        ...a,
        changes: a.changes.map((c) => (c.id === changeId && c.status === "PENDING" ? { ...c, status: "REJECTED" } : c)),
      }))
    ),

  reviseChange: (changeId, ops, title) => {
    const acc = current(get());
    if (!acc) return;
    set((s) =>
      withAccount(s, (a) => ({
        ...a,
        changes: a.changes.map((c) =>
          c.id === changeId && c.status === "PENDING"
            ? { ...c, ops, title: title ?? c.title, diff: describeOps(acc.data, ops), rationale: `${c.rationale} Edited by you before approval.` }
            : c
        ),
      }))
    );
  },

  applyDirect: (title, ops, source = "USER") => {
    const acc = current(get());
    if (!acc) return { ok: false, error: "No account selected" };
    const errors = validateOps(acc.data, ops);
    if (errors.length) return { ok: false, error: errors.join(" ") };
    try {
      const diff = describeOps(acc.data, ops);
      const { next, inverse } = applyOps(acc.data, ops);
      const event: ChangeEvent = { id: gid("evt"), at: new Date().toISOString(), actor: ACTOR, source, title, diff, inverse };
      set((s) => withAccount(s, (a) => ({ ...a, data: next, history: [event, ...a.history] })));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  },

  undo: (eventId) => {
    const acc = current(get());
    const event = acc?.history.find((e) => e.id === eventId);
    if (!acc || !event?.inverse || event.undone) return;
    const diff = describeOps(acc.data, event.inverse);
    const { next } = applyOps(acc.data, event.inverse);
    const undoEvent: ChangeEvent = { id: gid("evt"), at: new Date().toISOString(), actor: ACTOR, source: "USER", title: `Undo: ${event.title}`, diff };
    set((s) =>
      withAccount(s, (a) => ({
        ...a,
        data: next,
        history: [undoEvent, ...a.history.map((e) => (e.id === eventId ? { ...e, undone: true } : e))],
      }))
    );
  },

  createDoc: (doc, open = true) =>
    set((s) =>
      withAccount(s, (a) => ({
        ...a,
        docs: [doc, ...a.docs],
        openDocIds: open ? [...a.openDocIds.filter((id) => id !== doc.id), doc.id] : a.openDocIds,
        activeTab: open ? doc.id : a.activeTab,
      }))
    ),

  updateDoc: (docId, update) => set((s) => withAccount(s, (a) => ({ ...a, docs: a.docs.map((d) => (d.id === docId ? update(d) : d)) }))),

  openDoc: (docId) =>
    set((s) =>
      withAccount(s, (a) => ({
        ...a,
        openDocIds: a.openDocIds.includes(docId) ? a.openDocIds : [...a.openDocIds, docId],
        activeTab: docId,
      }))
    ),

  closeDocTab: (docId) =>
    set((s) =>
      withAccount(s, (a) => {
        const idx = a.openDocIds.indexOf(docId);
        const openDocIds = a.openDocIds.filter((id) => id !== docId);
        const activeTab = a.activeTab !== docId ? a.activeTab : openDocIds[Math.max(0, idx - 1)] ?? "account";
        return { ...a, openDocIds, activeTab };
      })
    ),

  setActiveTab: (tab) => set((s) => withAccount(s, (a) => ({ ...a, activeTab: tab }))),

  setProfile: (patch) => set((s) => withAccount(s, (a) => ({ ...a, profile: { ...a.profile, ...patch } }))),

  addMemory: (text, source) =>
    set((s) => withAccount(s, (a) => ({ ...a, memories: [{ id: gid("mem"), text, source, at: new Date().toISOString() }, ...a.memories] }))),

  removeMemory: (id) => set((s) => withAccount(s, (a) => ({ ...a, memories: a.memories.filter((m) => m.id !== id) }))),

  markAlertsRead: (ids) =>
    set((s) =>
      withAccount(s, (a) => ({
        ...a,
        data: { ...a.data, alerts: a.data.alerts.map((al) => (!ids || ids.includes(al.id) ? { ...al, read: true } : al)) },
      }))
    ),

  addMessage: (message, chatId) =>
    set((s) =>
      withAccount(s, (a) => {
        const id = chatId ?? a.activeChatId;
        const now = new Date().toISOString();
        return {
          ...a,
          chats: a.chats.map((c) => {
            if (c.id !== id) return c;
            const name = c.title === NEW_CHAT_TITLE && message.role === "user" ? chatTitleFrom(message.text) : c.title;
            return { ...c, title: name, messages: [...c.messages, message], updatedAt: now };
          }),
        };
      })
    ),

  patchMessage: (id, patch) =>
    set((s) =>
      withAccount(s, (a) => ({
        ...a,
        chats: a.chats.map((c) => (c.messages.some((m) => m.id === id) ? { ...c, messages: c.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) } : c)),
      }))
    ),

  newChat: () =>
    set((s) =>
      withAccount(s, (a) => {
        // An empty chat that is already open is the new chat.
        const empty = a.openChatIds.map((id) => a.chats.find((c) => c.id === id)).find((c) => c && c.messages.length === 0);
        if (empty) return { ...a, activeChatId: empty.id };
        const fresh = newThread();
        return { ...a, chats: [fresh, ...a.chats], openChatIds: [...a.openChatIds, fresh.id], activeChatId: fresh.id };
      })
    ),

  selectChat: (chatId) => set((s) => withAccount(s, (a) => (a.openChatIds.includes(chatId) ? { ...a, activeChatId: chatId } : a))),

  openChat: (chatId) =>
    set((s) =>
      withAccount(s, (a) =>
        a.chats.some((c) => c.id === chatId) ? { ...a, openChatIds: a.openChatIds.includes(chatId) ? a.openChatIds : [...a.openChatIds, chatId], activeChatId: chatId } : a
      )
    ),

  closeChat: (chatId) =>
    set((s) =>
      withAccount(s, (a) => {
        const idx = a.openChatIds.indexOf(chatId);
        if (idx < 0) return a;
        const openChatIds = a.openChatIds.filter((id) => id !== chatId);
        const activeChatId = a.activeChatId !== chatId ? a.activeChatId : (openChatIds[Math.max(0, idx - 1)] ?? "");
        return ensureChat({ ...a, openChatIds, activeChatId });
      })
    ),

  renameChat: (chatId, title) =>
    set((s) => withAccount(s, (a) => ({ ...a, chats: a.chats.map((c) => (c.id === chatId ? { ...c, title: title.trim() || c.title } : c)) }))),

  pinChat: (chatId) => set((s) => withAccount(s, (a) => ({ ...a, chats: a.chats.map((c) => (c.id === chatId ? { ...c, pinned: !c.pinned } : c)) }))),

  deleteChat: (chatId) =>
    set((s) =>
      withAccount(s, (a) => {
        const idx = a.openChatIds.indexOf(chatId);
        const openChatIds = a.openChatIds.filter((id) => id !== chatId);
        const activeChatId = a.activeChatId !== chatId ? a.activeChatId : (openChatIds[Math.max(0, idx - 1)] ?? "");
        return ensureChat({ ...a, chats: a.chats.filter((c) => c.id !== chatId), openChatIds, activeChatId });
      })
    ),

  setChatMode: (mode) => set((s) => withAccount(s, (a) => ({ ...a, chats: a.chats.map((c) => (c.id === a.activeChatId ? { ...c, mode } : c)) }))),
}));

/** The selected account's state; null until an account is picked. */
export function useAccountState(): AccountState | null {
  return useGoogleAds((s) => (s.customerId ? s.accounts[s.customerId] ?? null : null));
}

export function useAccountData(): AccountData | null {
  return useAccountState()?.data ?? null;
}
