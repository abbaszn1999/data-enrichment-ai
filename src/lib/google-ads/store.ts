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
  messages: AgentMessage[];
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
  chatOpen: boolean;
  agentBusy: boolean;
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
  setChatOpen: (open: boolean) => void;
  setAgentBusy: (busy: boolean) => void;
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
  addMessage: (message: AgentMessage) => void;
  patchMessage: (id: string, patch: Partial<AgentMessage>) => void;
  clearChat: () => void;
};

const ACTOR = "You";

/** Views that make no sense at a scope fall back to the closest one that does. */
function viewForScope(view: GaView, scope: GaScope, isPmax: boolean): GaView {
  const accountOnly: GaView[] = ["campaigns", "conversions", "library", "products", "rules", "keywordPlanner", "experiments", "links", "accountSettings", "allAccounts", "documents", "profile", "connections"];
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
  chatOpen: true,
  agentBusy: false,
  editor: { open: false },
  dialog: null,

  startConnect: () => set({ status: "authorizing" }),

  completeAuth: () => {
    const demo = buildDemoAccount();
    const second = buildSecondAccount();
    const empty = buildEmptyAccount();
    const fresh = (data: AccountData, docs: AgentDoc[] = []): AccountState => ({
      data,
      changes: [],
      history: [],
      messages: [],
      docs,
      openDocIds: [],
      activeTab: "account",
      profile: { ...DEFAULT_PROFILE, businessName: data.account.name },
      memories: data.campaigns.length ? seedMemories() : [],
    });
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
  setChatOpen: (open) => set({ chatOpen: open }),
  setAgentBusy: (busy) => set({ agentBusy: busy }),
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

  addMessage: (message) => set((s) => withAccount(s, (a) => ({ ...a, messages: [...a.messages, message] }))),

  patchMessage: (id, patch) =>
    set((s) => withAccount(s, (a) => ({ ...a, messages: a.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) }))),

  clearChat: () => set((s) => withAccount(s, (a) => ({ ...a, messages: [] }))),
}));

/** The selected account's state; null until an account is picked. */
export function useAccountState(): AccountState | null {
  return useGoogleAds((s) => (s.customerId ? s.accounts[s.customerId] ?? null : null));
}

export function useAccountData(): AccountData | null {
  return useAccountState()?.data ?? null;
}
