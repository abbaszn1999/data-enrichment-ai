"use client";

import { create } from "zustand";
import type {
  ProductRow,
  EnrichmentColumn,
  EnrichedData,
  SheetState,
  EnrichmentSettings,
} from "@/types";
import { DEFAULT_ENRICHMENT_COLUMNS, DEFAULT_ENRICHMENT_SETTINGS } from "@/types";
import { saveSession, loadSession, clearSession, type PersistedSession } from "@/lib/persistence";

type UndoAction =
  | { type: "cell"; rowId: string; column: string; oldValue: string; newValue: string }
  | { type: "deleteRows"; deletedRows: ProductRow[]; deletedIds: string[] }
  | { type: "deleteColumn"; colName: string; colIndex: number; sourceIncluded: boolean; values: Record<string, string> }
  | { type: "renameColumn"; oldName: string; newName: string };

interface SheetActions {
  setFile: (fileName: string, columns: string[], rows: ProductRow[]) => void;
  clearFile: () => void;
  // Enrichment columns
  toggleEnrichmentColumn: (id: string) => void;
  setAllEnrichmentColumns: (enabled: boolean) => void;
  addCustomEnrichmentColumn: (col: Omit<EnrichmentColumn, "id" | "enabled" | "isCustom">) => void;
  removeCustomEnrichmentColumn: (id: string) => void;
  // Source columns (which original columns to send to AI)
  toggleSourceColumn: (col: string) => void;
  setAllSourceColumns: (enabled: boolean) => void;
  // Row selection
  toggleRowSelection: (rowId: string) => void;
  selectAllRows: () => void;
  deselectAllRows: () => void;
  selectRowRange: (startIdx: number, endIdx: number) => void;
  deleteSelectedRows: () => void;
  selectByStatus: (status: ProductRow["status"]) => void;
  invertSelection: () => void;
  // Row management
  addRow: () => void;
  reorderRows: (fromIndex: number, toIndex: number) => void;
  // Column management
  deleteColumn: (colName: string) => void;
  renameColumn: (oldName: string, newName: string) => void;
  reorderColumns: (fromIndex: number, toIndex: number) => void;
  setColumnVisibility: (visibility: Record<string, boolean>) => void;
  toggleColumnVisibility: (colName: string) => void;
  // Cell editing with undo/redo
  updateCellValue: (rowId: string, column: string, value: string) => void;
  updateEnrichedCellValue: (rowId: string, key: string, value: any) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  // Enrichment state
  setRowStatus: (
    rowId: string,
    status: ProductRow["status"],
    errorMessage?: string
  ) => void;
  setRowEnrichedData: (rowId: string, data: EnrichedData) => void;
  setIsEnriching: (value: boolean) => void;
  setEnrichProgress: (completed: number, total: number) => void;
  incrementError: () => void;
  resetEnrichState: () => void;
  // Settings
  updateSettings: (settings: Partial<EnrichmentSettings>) => void;
  // Pause/Resume
  setPaused: (paused: boolean) => void;
  // Persistence
  restoreSession: () => Promise<boolean>;
  // UI
  setSidebarOpen: (open: boolean) => void;
}

type SheetStore = SheetState & SheetActions;

const initialState: SheetState = {
  fileName: null,
  rows: [],
  originalColumns: [],
  sourceColumns: [],
  enrichmentColumns: DEFAULT_ENRICHMENT_COLUMNS,
  enrichmentSettings: DEFAULT_ENRICHMENT_SETTINGS,
  columnVisibility: {},
  selectedRowIds: new Set<string>(),
  isEnriching: false,
  isPaused: false,
  enrichProgress: 0,
  totalToEnrich: 0,
  completedEnrich: 0,
  errorCount: 0,
  sidebarOpen: true,
  undoVersion: 0,
};

// Undo/Redo stacks (kept outside store to avoid triggering re-renders)
const undoStack: UndoAction[] = [];
const redoStack: UndoAction[] = [];

export const useSheetStore = create<SheetStore>((set, get) => ({
  ...initialState,

  setFile: (fileName, columns, rows) => {
    set({
      fileName,
      originalColumns: columns,
      sourceColumns: [...columns],
      rows: rows.map((r) => ({ ...r, selected: false })),
      selectedRowIds: new Set<string>(),
      enrichmentColumns: DEFAULT_ENRICHMENT_COLUMNS.map((col) => ({
        ...col,
        enabled: true,
      })),
    });
  },

  clearFile: () => {
    clearSession().catch(() => {});
    set(initialState);
  },

  // Enrichment columns
  toggleEnrichmentColumn: (id) =>
    set((state) => ({
      enrichmentColumns: state.enrichmentColumns.map((col) =>
        col.id === id ? { ...col, enabled: !col.enabled } : col
      ),
    })),

  setAllEnrichmentColumns: (enabled) =>
    set((state) => ({
      enrichmentColumns: state.enrichmentColumns.map((col) => ({
        ...col,
        enabled,
      })),
    })),

  addCustomEnrichmentColumn: (col) =>
    set((state) => {
      const id = col.label.toLowerCase().replace(/[^a-z0-9]+/g, "_");
      // Check if it already exists
      if (state.enrichmentColumns.some((c) => c.id === id)) {
        return state;
      }
      const newCol: EnrichmentColumn = {
        ...col,
        id,
        enabled: true,
        isCustom: true,
      };
      return {
        enrichmentColumns: [...state.enrichmentColumns, newCol],
      };
    }),

  removeCustomEnrichmentColumn: (id) =>
    set((state) => ({
      enrichmentColumns: state.enrichmentColumns.filter((col) => col.id !== id),
    })),

  // Source columns
  toggleSourceColumn: (col) =>
    set((state) => {
      const exists = state.sourceColumns.includes(col);
      return {
        sourceColumns: exists
          ? state.sourceColumns.filter((c) => c !== col)
          : [...state.sourceColumns, col],
      };
    }),

  setAllSourceColumns: (enabled) =>
    set((state) => ({
      sourceColumns: enabled ? [...state.originalColumns] : [],
    })),

  // Row selection
  toggleRowSelection: (rowId) =>
    set((state) => {
      const newSet = new Set(state.selectedRowIds);
      if (newSet.has(rowId)) {
        newSet.delete(rowId);
      } else {
        newSet.add(rowId);
      }
      return {
        selectedRowIds: newSet,
        rows: state.rows.map((r) =>
          r.id === rowId ? { ...r, selected: newSet.has(rowId) } : r
        ),
      };
    }),

  selectAllRows: () =>
    set((state) => {
      const allIds = new Set(state.rows.map((r) => r.id));
      return {
        selectedRowIds: allIds,
        rows: state.rows.map((r) => ({ ...r, selected: true })),
      };
    }),

  deselectAllRows: () =>
    set((state) => ({
      selectedRowIds: new Set<string>(),
      rows: state.rows.map((r) => ({ ...r, selected: false })),
    })),

  selectRowRange: (startIdx, endIdx) =>
    set((state) => {
      const min = Math.min(startIdx, endIdx);
      const max = Math.max(startIdx, endIdx);
      const newSet = new Set(state.selectedRowIds);
      const updatedRows = state.rows.map((r) => {
        if (r.rowIndex >= min && r.rowIndex <= max) {
          newSet.add(r.id);
          return { ...r, selected: true };
        }
        return r;
      });
      return { selectedRowIds: newSet, rows: updatedRows };
    }),

  // Cell editing with undo/redo
  updateCellValue: (rowId, column, value) => {
    const state = get();
    const row = state.rows.find((r) => r.id === rowId);
    if (!row) return;
    const oldValue = row.originalData[column] || "";
    if (oldValue === value) return;
    undoStack.push({ type: "cell", rowId, column, oldValue, newValue: value });
    redoStack.length = 0;
    set({
      rows: state.rows.map((r) =>
        r.id === rowId
          ? { ...r, originalData: { ...r.originalData, [column]: value } }
          : r
      ),
      undoVersion: state.undoVersion + 1,
    });
  },

  undo: () => {
    const action = undoStack.pop();
    if (!action) return;
    redoStack.push(action);
    const state = get();
    const nextVersion = state.undoVersion + 1;

    switch (action.type) {
      case "cell":
        set({
          rows: state.rows.map((r) =>
            r.id === action.rowId
              ? { ...r, originalData: { ...r.originalData, [action.column]: action.oldValue } }
              : r
          ),
          undoVersion: nextVersion,
        });
        break;

      case "deleteRows":
        // Re-insert deleted rows and restore selection
        const restoredRows = [...state.rows, ...action.deletedRows].sort((a, b) => a.rowIndex - b.rowIndex);
        const restoredIds = new Set(state.selectedRowIds);
        action.deletedIds.forEach((id) => restoredIds.add(id));
        set({ rows: restoredRows, selectedRowIds: restoredIds, undoVersion: nextVersion });
        break;

      case "deleteColumn": {
        // Re-insert column at original index
        const cols = [...state.originalColumns];
        cols.splice(action.colIndex, 0, action.colName);
        const srcCols = action.sourceIncluded
          ? [...state.sourceColumns, action.colName]
          : state.sourceColumns;
        set({
          originalColumns: cols,
          sourceColumns: srcCols,
          rows: state.rows.map((r) => ({
            ...r,
            originalData: { ...r.originalData, [action.colName]: action.values[r.id] ?? "" },
          })),
          undoVersion: nextVersion,
        });
        break;
      }

      case "renameColumn":
        // Reverse: rename newName back to oldName
        set({
          originalColumns: state.originalColumns.map((c) => (c === action.newName ? action.oldName : c)),
          sourceColumns: state.sourceColumns.map((c) => (c === action.newName ? action.oldName : c)),
          rows: state.rows.map((r) => {
            const { [action.newName]: val, ...rest } = r.originalData;
            return { ...r, originalData: { ...rest, [action.oldName]: val ?? "" } };
          }),
          undoVersion: nextVersion,
        });
        break;
    }
  },

  redo: () => {
    const action = redoStack.pop();
    if (!action) return;
    undoStack.push(action);
    const state = get();
    const nextVersion = state.undoVersion + 1;

    switch (action.type) {
      case "cell":
        set({
          rows: state.rows.map((r) =>
            r.id === action.rowId
              ? { ...r, originalData: { ...r.originalData, [action.column]: action.newValue } }
              : r
          ),
          undoVersion: nextVersion,
        });
        break;

      case "deleteRows":
        // Re-delete the rows
        const deletedSet = new Set(action.deletedIds);
        set({
          rows: state.rows.filter((r) => !deletedSet.has(r.id)),
          selectedRowIds: new Set<string>(),
          undoVersion: nextVersion,
        });
        break;

      case "deleteColumn":
        set({
          originalColumns: state.originalColumns.filter((c) => c !== action.colName),
          sourceColumns: state.sourceColumns.filter((c) => c !== action.colName),
          rows: state.rows.map((r) => {
            const { [action.colName]: _, ...rest } = r.originalData;
            return { ...r, originalData: rest };
          }),
          undoVersion: nextVersion,
        });
        break;

      case "renameColumn":
        set({
          originalColumns: state.originalColumns.map((c) => (c === action.oldName ? action.newName : c)),
          sourceColumns: state.sourceColumns.map((c) => (c === action.oldName ? action.newName : c)),
          rows: state.rows.map((r) => {
            const { [action.oldName]: val, ...rest } = r.originalData;
            return { ...r, originalData: { ...rest, [action.newName]: val ?? "" } };
          }),
          undoVersion: nextVersion,
        });
        break;
    }
  },

  canUndo: () => undoStack.length > 0,
  canRedo: () => redoStack.length > 0,

  updateEnrichedCellValue: (rowId, key, value) =>
    set((state) => ({
      rows: state.rows.map((row) =>
        row.id === rowId
          ? { ...row, enrichedData: { ...row.enrichedData, [key]: value } }
          : row
      ),
    })),

  // Enrichment state
  setRowStatus: (rowId, status, errorMessage) =>
    set((state) => ({
      rows: state.rows.map((row) =>
        row.id === rowId ? { ...row, status, errorMessage } : row
      ),
    })),

  setRowEnrichedData: (rowId, data) =>
    set((state) => ({
      rows: state.rows.map((row) =>
        row.id === rowId
          ? { ...row, enrichedData: { ...row.enrichedData, ...data }, status: "done" }
          : row
      ),
    })),

  setIsEnriching: (value) => set({ isEnriching: value }),

  setEnrichProgress: (completed, total) =>
    set({
      completedEnrich: completed,
      totalToEnrich: total,
      enrichProgress: total > 0 ? Math.round((completed / total) * 100) : 0,
    }),

  incrementError: () =>
    set((state) => ({ errorCount: state.errorCount + 1 })),

  resetEnrichState: () =>
    set((state) => ({
      isEnriching: false,
      enrichProgress: 0,
      totalToEnrich: 0,
      completedEnrich: 0,
      errorCount: 0,
      rows: state.rows.map((row) => ({
        ...row,
        status: "pending" as const,
        errorMessage: undefined,
        enrichedData: {},
      })),
    })),

  deleteSelectedRows: () => {
    const state = get();
    const deletedRows = state.rows.filter((r) => state.selectedRowIds.has(r.id));
    const deletedIds = [...state.selectedRowIds];
    undoStack.push({ type: "deleteRows", deletedRows, deletedIds });
    redoStack.length = 0;
    set({
      rows: state.rows.filter((r) => !state.selectedRowIds.has(r.id)),
      selectedRowIds: new Set<string>(),
      undoVersion: state.undoVersion + 1,
    });
  },

  renameColumn: (oldName, newName) => {
    if (!newName.trim() || oldName === newName) return;
    undoStack.push({ type: "renameColumn", oldName, newName });
    redoStack.length = 0;
    set((state) => ({
      originalColumns: state.originalColumns.map((c) => (c === oldName ? newName : c)),
      sourceColumns: state.sourceColumns.map((c) => (c === oldName ? newName : c)),
      rows: state.rows.map((r) => {
        const { [oldName]: val, ...rest } = r.originalData;
        return { ...r, originalData: { ...rest, [newName]: val ?? "" } };
      }),
      undoVersion: state.undoVersion + 1,
    }));
  },

  deleteColumn: (colName) => {
    const state = get();
    const colIndex = state.originalColumns.indexOf(colName);
    const sourceIncluded = state.sourceColumns.includes(colName);
    const values: Record<string, string> = {};
    for (const r of state.rows) {
      values[r.id] = r.originalData[colName] ?? "";
    }
    undoStack.push({ type: "deleteColumn", colName, colIndex, sourceIncluded, values });
    redoStack.length = 0;
    set({
      originalColumns: state.originalColumns.filter((c) => c !== colName),
      sourceColumns: state.sourceColumns.filter((c) => c !== colName),
      rows: state.rows.map((r) => {
        const { [colName]: _, ...rest } = r.originalData;
        return { ...r, originalData: rest };
      }),
      undoVersion: state.undoVersion + 1,
    });
  },

  selectByStatus: (status) =>
    set((state) => {
      const matching = new Set(state.rows.filter((r) => r.status === status).map((r) => r.id));
      return {
        selectedRowIds: matching,
        rows: state.rows.map((r) => ({ ...r, selected: matching.has(r.id) })),
      };
    }),

  invertSelection: () =>
    set((state) => {
      const inverted = new Set(state.rows.filter((r) => !state.selectedRowIds.has(r.id)).map((r) => r.id));
      return {
        selectedRowIds: inverted,
        rows: state.rows.map((r) => ({ ...r, selected: inverted.has(r.id) })),
      };
    }),

  addRow: () =>
    set((state) => {
      const newIndex = state.rows.length;
      const emptyData: Record<string, string> = {};
      for (const col of state.originalColumns) {
        emptyData[col] = "";
      }
      const newRow: ProductRow = {
        id: `row-${Date.now()}-${newIndex}`,
        rowIndex: newIndex,
        selected: false,
        status: "pending",
        originalData: emptyData,
        enrichedData: {},
      };
      return { rows: [...state.rows, newRow] };
    }),

  reorderRows: (fromIndex, toIndex) =>
    set((state) => {
      const newRows = [...state.rows];
      const [moved] = newRows.splice(fromIndex, 1);
      newRows.splice(toIndex, 0, moved);
      return { rows: newRows.map((r, i) => ({ ...r, rowIndex: i })) };
    }),

  reorderColumns: (fromIndex, toIndex) =>
    set((state) => {
      const newCols = [...state.originalColumns];
      const [moved] = newCols.splice(fromIndex, 1);
      newCols.splice(toIndex, 0, moved);
      return { originalColumns: newCols };
    }),

  setColumnVisibility: (visibility) => set({ columnVisibility: visibility }),

  toggleColumnVisibility: (colName) =>
    set((state) => ({
      columnVisibility: {
        ...state.columnVisibility,
        [colName]: state.columnVisibility[colName] === false ? true : false,
      },
    })),

  // Settings
  updateSettings: (settings) =>
    set((state) => ({
      enrichmentSettings: { ...state.enrichmentSettings, ...settings },
    })),

  // Pause/Resume
  setPaused: (paused) => set({ isPaused: paused }),

  // Persistence
  restoreSession: async () => {
    try {
      const session = await loadSession();
      if (!session || !session.fileName) return false;
      set({
        fileName: session.fileName,
        rows: session.rows.map((r) => ({
          ...r,
          // Reset any processing rows to pending on restore
          status: r.status === "processing" ? "pending" : r.status,
        })),
        originalColumns: session.originalColumns,
        sourceColumns: session.sourceColumns,
        enrichmentColumns: session.enrichmentColumns,
        enrichmentSettings: session.enrichmentSettings,
        columnVisibility: session.columnVisibility || {},
        selectedRowIds: new Set(session.rows.map((r) => r.id)),
        isEnriching: false,
        isPaused: false,
      });
      return true;
    } catch {
      return false;
    }
  },

  // UI
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
}));

// Auto-save to IndexedDB on relevant state changes (debounced)
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
useSheetStore.subscribe((state) => {
  if (!state.fileName) return;
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    const s = useSheetStore.getState();
    if (!s.fileName) return;
    const session: PersistedSession = {
      fileName: s.fileName,
      rows: s.rows,
      originalColumns: s.originalColumns,
      sourceColumns: s.sourceColumns,
      enrichmentColumns: s.enrichmentColumns,
      enrichmentSettings: s.enrichmentSettings,
      columnVisibility: s.columnVisibility,
      savedAt: Date.now(),
    };
    saveSession(session).catch(() => {});
  }, 2000);
});
