import { create } from "zustand";

export type SyncMode = "fast" | "pro";

export type SyncWorkingMemory = {
  lastCreatedRowIndexes: number[];
  lastTargetedRowIndexes: number[];
  lastExplicitEntityLabel: string | null;
  lastResearchSummary: string | null;
  lastResearchSubject: string | null;
  lastTouchedColumns: string[];
  lastActionType: "append_row" | "target_rows" | "write_column" | "research_web" | "load_sheet" | null;
  updatedAt: number | null;
};

export const EMPTY_SYNC_WORKING_MEMORY: SyncWorkingMemory = {
  lastCreatedRowIndexes: [],
  lastTargetedRowIndexes: [],
  lastExplicitEntityLabel: null,
  lastResearchSummary: null,
  lastResearchSubject: null,
  lastTouchedColumns: [],
  lastActionType: null,
  updatedAt: null,
};

export interface SyncAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
}

export type SyncActionReceipt = {
  toolsExecuted: string[];
  rowsAffected: number;
  columnsAffected: string[];
  sheetRowCount: number;
  warnings: string[];
};

export interface SyncMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  attachments?: SyncAttachment[];
  progress?: string[];
  sessionSummary?: string;
  actionReceipt?: SyncActionReceipt;
}

export type SyncSheetSnapshot = {
  title: string;
  columns: string[];
  rows: Record<string, unknown>[];
};

const MAX_SHEET_HISTORY = 5;

interface SyncState {
  isFocusMode: boolean;
  messages: SyncMessage[];
  isStreaming: boolean;
  mode: SyncMode;
  webEnabled: boolean;
  pendingAttachments: File[];
  workingMemory: SyncWorkingMemory;
  sheetHistory: SyncSheetSnapshot[];
  redoHistory: SyncSheetSnapshot[];
}

interface SyncActions {
  setFocusMode: (focused: boolean) => void;
  setMode: (mode: SyncMode) => void;
  toggleWebEnabled: () => void;
  addMessage: (message: SyncMessage) => void;
  updateLastAssistantMessage: (content: string) => void;
  updateLastAssistantProgress: (progress: string[]) => void;
  updateLastAssistantSessionSummary: (sessionSummary: string) => void;
  setStreaming: (streaming: boolean) => void;
  addPendingAttachment: (file: File) => void;
  removePendingAttachment: (index: number) => void;
  clearPendingAttachments: () => void;
  setWorkingMemory: (workingMemory: SyncWorkingMemory) => void;
  updateLastAssistantActionReceipt: (receipt: SyncActionReceipt) => void;
  pushSheetSnapshot: (sheet: SyncSheetSnapshot) => void;
  pushRedoSnapshot: (sheet: SyncSheetSnapshot) => void;
  undoSheet: () => SyncSheetSnapshot | null;
  redoSheet: () => SyncSheetSnapshot | null;
  clearSheetHistory: () => void;
  clearRedoHistory: () => void;
  resetChat: () => void;
}

export const useSyncStore = create<SyncState & SyncActions>((set, get) => ({
  isFocusMode: false,
  messages: [],
  isStreaming: false,
  mode: "fast",
  webEnabled: false,
  pendingAttachments: [],
  workingMemory: EMPTY_SYNC_WORKING_MEMORY,
  sheetHistory: [],
  redoHistory: [],

  setFocusMode: (focused) =>
    set((s) => (s.isFocusMode === focused ? s : { ...s, isFocusMode: focused })),
  setMode: (mode) => set({ mode }),
  toggleWebEnabled: () => set((s) => ({ webEnabled: !s.webEnabled })),
  addMessage: (message) => set((s) => ({ messages: [...s.messages, message] })),
  updateLastAssistantMessage: (content) =>
    set((s) => {
      const msgs = [...s.messages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "assistant") {
          msgs[i] = { ...msgs[i], content };
          break;
        }
      }
      return { messages: msgs };
    }),
  updateLastAssistantProgress: (progress) =>
    set((s) => {
      const msgs = [...s.messages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "assistant") {
          msgs[i] = { ...msgs[i], progress };
          break;
        }
      }
      return { messages: msgs };
    }),
  updateLastAssistantSessionSummary: (sessionSummary) =>
    set((s) => {
      const msgs = [...s.messages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "assistant") {
          msgs[i] = { ...msgs[i], sessionSummary };
          break;
        }
      }
      return { messages: msgs };
    }),
  setStreaming: (streaming) => set({ isStreaming: streaming }),
  addPendingAttachment: (file) =>
    set((s) => ({ pendingAttachments: [...s.pendingAttachments, file] })),
  removePendingAttachment: (index) =>
    set((s) => ({
      pendingAttachments: s.pendingAttachments.filter((_, i) => i !== index),
    })),
  clearPendingAttachments: () => set({ pendingAttachments: [] }),
  setWorkingMemory: (workingMemory) => set({ workingMemory }),
  updateLastAssistantActionReceipt: (actionReceipt) =>
    set((s) => {
      const msgs = [...s.messages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "assistant") {
          msgs[i] = { ...msgs[i], actionReceipt };
          break;
        }
      }
      return { messages: msgs };
    }),
  pushSheetSnapshot: (sheet) =>
    set((s) => ({
      sheetHistory: [...s.sheetHistory, sheet].slice(-MAX_SHEET_HISTORY),
      redoHistory: [],
    })),
  pushRedoSnapshot: (sheet) =>
    set((s) => ({
      redoHistory: [...s.redoHistory, sheet].slice(-MAX_SHEET_HISTORY),
    })),
  undoSheet: () => {
    const { sheetHistory } = get();
    if (sheetHistory.length === 0) return null;
    const last = sheetHistory[sheetHistory.length - 1];
    set({ sheetHistory: sheetHistory.slice(0, -1) });
    return last;
  },
  redoSheet: () => {
    const { redoHistory } = get();
    if (redoHistory.length === 0) return null;
    const last = redoHistory[redoHistory.length - 1];
    set({ redoHistory: redoHistory.slice(0, -1) });
    return last;
  },
  clearSheetHistory: () => set({ sheetHistory: [] }),
  clearRedoHistory: () => set({ redoHistory: [] }),
  resetChat: () =>
    set({
      messages: [],
      isStreaming: false,
      isFocusMode: false,
      pendingAttachments: [],
      workingMemory: EMPTY_SYNC_WORKING_MEMORY,
      sheetHistory: [],
      redoHistory: [],
    }),
}));
