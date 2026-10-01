"use client";

import { create } from "zustand";
import type {
  ProductRow,
  EnrichmentColumn,
  EnrichedData,
  SheetState,
  EnrichmentSettings,
  SessionKind,
  ColumnLayout,
  CatalogSidebarMode,
} from "@/types";
import {
  DEFAULT_ENRICHMENT_COLUMNS,
  DEFAULT_ENRICHMENT_SETTINGS,
  ensureImageSourcesColumn,
  ensureSourceUrlsColumn,
  resolveEnrichmentModel,
} from "@/types";
import { saveSession, loadSession, clearSession, type PersistedSession } from "@/lib/persistence";
import { expandToGroupMemberIds, visibleCatalogRows } from "@/lib/catalog/product-groups";
import { moveColumn, toggleColumnHidden } from "@/lib/sheet/column-layout";

function normalizeEnrichmentSettings(
  settings: EnrichmentSettings | Partial<EnrichmentSettings> | null | undefined
): EnrichmentSettings {
  const merged = {
    ...DEFAULT_ENRICHMENT_SETTINGS,
    ...(settings || {}),
  };
  return {
    ...merged,
    enrichmentModel: resolveEnrichmentModel(merged.enrichmentModel),
  };
}

/** Every column key in the sheet's natural order: source columns, then AI columns. */
function allColumnLayoutKeys(state: Pick<SheetState, "originalColumns" | "enrichmentColumns">): string[] {
  return [
    ...state.originalColumns.map((name) => `orig:${name}`),
    ...state.enrichmentColumns.map((col) => `enrich:${col.id}`),
  ];
}

function sheetRowsForState(state: Pick<SheetState, "rows" | "activeSheet" | "productGroupColumn">) {
  return visibleCatalogRows(state.rows, {
    groupColumn: state.productGroupColumn,
    activeSheet: state.activeSheet,
  });
}

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
  /** Moves an AI output column to another column's position, in the sidebar list and in the sheet. */
  reorderEnrichmentColumns: (fromId: string, toId: string) => void;
  updateEnrichmentColumnConfig: (id: string, config: Partial<EnrichmentColumn>) => void;
  // Source columns (which original columns to send to AI)
  toggleSourceColumn: (col: string) => void;
  setAllSourceColumns: (enabled: boolean) => void;
  // Row selection
  toggleRowSelection: (rowId: string) => void;
  selectAllRows: () => void;
  deselectAllRows: () => void;
  selectRowsByIds: (rowIds: string[]) => void;
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
  setStoppingEnrich: (value: boolean) => void;
  setEnrichProgress: (completed: number, total: number) => void;
  incrementError: () => void;
  resetEnrichState: () => void;
  // Settings
  updateSettings: (settings: Partial<EnrichmentSettings>) => void;
  // Pause/Resume
  setPaused: (paused: boolean) => void;
  // Persistence
  restoreSession: () => Promise<boolean>;
  // Supabase project
  loadProject: (workspaceId: string, projectId: string, fileName: string, columns: string[], rows: ProductRow[], sourceColumns: string[], enrichmentColumns: EnrichmentColumn[], enrichmentSettings: EnrichmentSettings, columnVisibility: Record<string, boolean>, sessionKind?: SessionKind, matchingSkipped?: boolean, productGroupColumn?: string | null, columnLayout?: ColumnLayout, view?: { sidebarMode?: CatalogSidebarMode; activeSheet?: "existing" | "new" }) => void;
  moveColumnLayout: (fromKey: string, toKey: string) => void;
  toggleColumnLayoutHidden: (key: string) => void;
  applyProjectRows: (rows: ProductRow[], progress?: { completed: number; total: number; errors: number }) => void;
  /** Replace the whole AI configuration, e.g. when applying a saved setting. */
  applyEnrichmentPreset: (settings: { sourceColumns?: string[]; enrichmentColumns?: EnrichmentColumn[]; enrichmentSettings?: EnrichmentSettings }) => void;
  setProjectId: (id: string | null) => void;
  setSaveStatus: (status: SheetState["saveStatus"]) => void;
  markUnsaved: () => void;
  // UI
  setSidebarOpen: (open: boolean) => void;
  // Sheet toggle
  setActiveSheet: (sheet: "existing" | "new") => void;
  setSidebarMode: (mode: CatalogSidebarMode) => void;
  // Existing column enrichment
  toggleExistingColumnEnrich: (col: string) => void;
  clearExistingColumnEnrich: () => void;
  setExistingColumnInstruction: (col: string, instruction: string) => void;
  setEnrichingContext: (tab: "existing" | "new" | null, existingCols?: string[], newCols?: string[]) => void;
}

type SheetStore = SheetState & SheetActions;

const initialState: SheetState = {
  workspaceId: null,
  projectId: null,
  sessionKind: "product",
  matchingSkipped: false,
  productGroupColumn: null,
  fileName: null,
  rows: [],
  originalColumns: [],
  sourceColumns: [],
  enrichmentColumns: DEFAULT_ENRICHMENT_COLUMNS,
  enrichmentSettings: DEFAULT_ENRICHMENT_SETTINGS,
  columnVisibility: {},
  columnLayout: { order: [], hidden: [] },
  selectedRowIds: new Set<string>(),
  isEnriching: false,
  isPaused: false,
  isStoppingEnrich: false,
  enrichProgress: 0,
  totalToEnrich: 0,
  completedEnrich: 0,
  errorCount: 0,
  sidebarOpen: true,
  activeSheet: "new" as "existing" | "new",
  sidebarMode: "enrich" as CatalogSidebarMode,
  existingColumnsToEnrich: [],
  existingColumnInstructions: {},
  enrichingTab: null,
  enrichingExistingColumns: [],
  enrichingNewColumns: [],
  undoVersion: 0,
  saveStatus: "saved",
  lastSavedAt: null,
};

// Undo/Redo stacks (kept outside store to avoid triggering re-renders)
const undoStack: UndoAction[] = [];
const redoStack: UndoAction[] = [];
const MAX_UNDO = 30;

function recordUndo(action: UndoAction) {
  undoStack.push(action);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
}

export const useSheetStore = create<SheetStore>((set, get) => ({
  ...initialState,

  setFile: (fileName, columns, rows) => {
    set({
      fileName,
      originalColumns: columns,
      sourceColumns: [...columns],
      rows: rows.map((r) => ({ ...r, selected: false })),
      selectedRowIds: new Set<string>(),
      enrichmentColumns: DEFAULT_ENRICHMENT_COLUMNS.map((col) => ({ ...col })),
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
      const slug =
        col.label
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_|_$/g, "") || "column";
      const taken = new Set(state.enrichmentColumns.map((c) => c.id));
      let id = `custom_${slug}`;
      let n = 2;
      while (taken.has(id)) {
        id = `custom_${slug}_${n}`;
        n += 1;
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

  reorderEnrichmentColumns: (fromId, toId) =>
    set((state) => {
      const from = state.enrichmentColumns.findIndex((col) => col.id === fromId);
      const to = state.enrichmentColumns.findIndex((col) => col.id === toId);
      if (from < 0 || to < 0 || from === to) return {};
      const next = [...state.enrichmentColumns];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return {
        enrichmentColumns: next,
        // The sheet shows the columns in this same order (its own layout wins over list order).
        columnLayout: moveColumn(
          state.columnLayout,
          allColumnLayoutKeys(state),
          `enrich:${fromId}`,
          `enrich:${toId}`
        ),
      };
    }),

  updateEnrichmentColumnConfig: (id, config) =>
    set((state) => ({
      enrichmentColumns: state.enrichmentColumns.map((col) =>
        col.id === id ? { ...col, ...config } : col
      ),
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
    set((state) => {
      if (!enabled) return { sourceColumns: [] };

      const hasEnrichedValue = (colId: string, row: (typeof state.rows)[number]) => {
        const val = row.enrichedData?.[colId];
        if (Array.isArray(val)) return val.length > 0;
        return val !== undefined && val !== null && val !== "";
      };

      // Match the sidebar: only AI columns that have data on the current selection.
      const scopeRows =
        state.selectedRowIds.size > 0
          ? sheetRowsForState(state).filter((row) => state.selectedRowIds.has(row.id))
          : [];

      const enrichedWithData = state.enrichmentColumns
        .filter((col) => scopeRows.some((row) => hasEnrichedValue(col.id, row)))
        .map((col) => col.id);

      return { sourceColumns: [...state.originalColumns, ...enrichedWithData] };
    }),

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
      const sheetRows = sheetRowsForState(state);
      const sheetIds = new Set(sheetRows.map((r) => r.id));
      const newSelected = new Set(state.selectedRowIds);
      sheetIds.forEach((id) => newSelected.add(id));
      return {
        selectedRowIds: newSelected,
        rows: state.rows.map((r) => ({
          ...r,
          selected: sheetIds.has(r.id) ? true : r.selected,
        })),
      };
    }),

  deselectAllRows: () =>
    set((state) => {
      const sheetRows = sheetRowsForState(state);
      const sheetIds = new Set(sheetRows.map((r) => r.id));
      const newSelected = new Set(state.selectedRowIds);
      sheetIds.forEach((id) => newSelected.delete(id));
      return {
        selectedRowIds: newSelected,
        rows: state.rows.map((r) => ({
          ...r,
          selected: sheetIds.has(r.id) ? false : r.selected,
        })),
      };
    }),

  // Replace the whole selection with exactly the given row IDs (e.g. "select
  // current page only"), regardless of active sheet.
  selectRowsByIds: (rowIds) =>
    set((state) => {
      const idSet = new Set(rowIds);
      return {
        selectedRowIds: idSet,
        rows: state.rows.map((r) => ({ ...r, selected: idSet.has(r.id) })),
      };
    }),

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
    recordUndo({ type: "cell", rowId, column, oldValue, newValue: value });
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

  setIsEnriching: (value) =>
    set(
      value
        ? { isEnriching: true }
        : { isEnriching: false, isStoppingEnrich: false }
    ),

  setStoppingEnrich: (value) => set({ isStoppingEnrich: value }),

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
      isStoppingEnrich: false,
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
    // Only delete rows that are in the active sheet AND selected
    const sheetIds = new Set(sheetRowsForState(state).map((r) => r.id));
    const selectedOnSheet = [...state.selectedRowIds].filter((id) => sheetIds.has(id));
    const toDelete = new Set(
      expandToGroupMemberIds(selectedOnSheet, state.rows, state.productGroupColumn)
    );
    const deletedRows = state.rows.filter((r) => toDelete.has(r.id));
    const deletedIds = [...toDelete];
    recordUndo({ type: "deleteRows", deletedRows, deletedIds });
    const newSelected = new Set(state.selectedRowIds);
    toDelete.forEach((id) => newSelected.delete(id));
    set({
      rows: state.rows.filter((r) => !toDelete.has(r.id)),
      selectedRowIds: newSelected,
      undoVersion: state.undoVersion + 1,
    });
  },

  renameColumn: (oldName, newName) => {
    if (!newName.trim() || oldName === newName) return;
    recordUndo({ type: "renameColumn", oldName, newName });
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
    recordUndo({ type: "deleteColumn", colName, colIndex, sourceIncluded, values });
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
      // Only select rows in active sheet with the given status
      const sheetRows = sheetRowsForState(state);
      const matching = new Set(sheetRows.filter((r) => r.status === status).map((r) => r.id));
      // Keep selections from other sheet
      const otherSheetSelected = [...state.selectedRowIds].filter((id) => !sheetRows.some((r) => r.id === id));
      const newSelected = new Set([...otherSheetSelected, ...matching]);
      return {
        selectedRowIds: newSelected,
        rows: state.rows.map((r) => ({ ...r, selected: newSelected.has(r.id) })),
      };
    }),

  invertSelection: () =>
    set((state) => {
      // Only invert selection within active sheet
      const sheetRows = sheetRowsForState(state);
      const sheetIds = new Set(sheetRows.map((r) => r.id));
      const otherSheetSelected = [...state.selectedRowIds].filter((id) => !sheetIds.has(id));
      const invertedSheet = sheetRows.filter((r) => !state.selectedRowIds.has(r.id)).map((r) => r.id);
      const newSelected = new Set([...otherSheetSelected, ...invertedSheet]);
      return {
        selectedRowIds: newSelected,
        rows: state.rows.map((r) => ({ ...r, selected: newSelected.has(r.id) })),
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

  moveColumnLayout: (fromKey, toKey) =>
    set((state) => ({
      columnLayout: moveColumn(state.columnLayout, allColumnLayoutKeys(state), fromKey, toKey),
    })),

  toggleColumnLayoutHidden: (key) =>
    set((state) => ({
      columnLayout: toggleColumnHidden(state.columnLayout, allColumnLayoutKeys(state), key),
    })),

  // Settings
  updateSettings: (settings) =>
    set((state) => ({
      enrichmentSettings: normalizeEnrichmentSettings({
        ...state.enrichmentSettings,
        ...settings,
      }),
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
        enrichmentColumns: ensureSourceUrlsColumn(
          ensureImageSourcesColumn(session.enrichmentColumns, get().sessionKind),
          get().sessionKind
        ),
        enrichmentSettings: normalizeEnrichmentSettings(session.enrichmentSettings),
        columnVisibility: session.columnVisibility || {},
        selectedRowIds: new Set(session.rows.map((r) => r.id)),
        isEnriching: false,
        isPaused: false,
        isStoppingEnrich: false,
      });
      return true;
    } catch {
      return false;
    }
  },

  // Supabase project
  loadProject: (workspaceId, projectId, fileName, columns, rows, sourceColumns, enrichmentColumns, enrichmentSettings, columnVisibility, sessionKind, matchingSkipped, productGroupColumn, columnLayout, view) => {
    const groupColumn = productGroupColumn ?? null;
    applyingStoredState = true;
    try {
      set({
        workspaceId,
        projectId,
        sessionKind: sessionKind ?? "product",
        matchingSkipped: matchingSkipped ?? false,
        productGroupColumn: groupColumn,
        fileName,
        originalColumns: columns,
        rows: rows.map((r) => ({ ...r, selected: false })),
        sourceColumns,
        enrichmentColumns: ensureSourceUrlsColumn(
          ensureImageSourcesColumn(enrichmentColumns, sessionKind ?? "product"),
          sessionKind ?? "product"
        ),
        enrichmentSettings: normalizeEnrichmentSettings(enrichmentSettings),
        columnVisibility,
        columnLayout: columnLayout ?? { order: [], hidden: [] },
        // Reopen on the tool and sheet tab the user left (product sheets only have the modes).
        sidebarMode: (sessionKind ?? "product") === "plp" ? "enrich" : (view?.sidebarMode ?? "enrich"),
        activeSheet: view?.activeSheet === "existing" ? "existing" : "new",
        selectedRowIds: new Set<string>(),
        isEnriching: false,
        isPaused: false,
        isStoppingEnrich: false,
        enrichProgress: 0,
        totalToEnrich: 0,
        completedEnrich: 0,
        errorCount: 0,
        saveStatus: "saved",
        lastSavedAt: Date.now(),
      });
    } finally {
      applyingStoredState = false;
    }
    // A cross-session module-level "last saved" fingerprint would otherwise
    // read as changed the instant a *different* project's data replaces it,
    // scheduling a phantom autosave a few seconds after every page open —
    // one that can race an in-progress background enrichment run and
    // overwrite its freshly written results with this stale snapshot.
    markProjectSnapshotAsSaved();
  },

  applyProjectRows: (rows, progress) => {
    const errorCount = progress?.errors ?? rows.filter((r) => r.status === "error").length;
    const completed = progress?.completed ?? rows.filter((r) => r.status === "done").length;
    const total = progress?.total ?? get().totalToEnrich;
    applyingStoredState = true;
    try {
      set({
        rows: rows.map((r) => ({ ...r, selected: r.selected !== false })),
        completedEnrich: completed,
        errorCount,
        enrichProgress: total > 0 ? Math.round((completed / total) * 100) : 0,
        totalToEnrich: total || get().totalToEnrich,
        lastSavedAt: Date.now(),
      });
    } finally {
      applyingStoredState = false;
    }
    // Rows that came from the server are already stored: they are the new baseline for delta saves.
    snapshotSavedRows(get().rows);
    reconcileSaveStatus();
  },

  setProjectId: (id) => set({ projectId: id }),

  /**
   * Apply a saved setting over the live configuration. Enriched cells are
   * deliberately preserved: values are keyed by column id, so a column that is
   * turned off here comes back with its data intact if re-enabled.
   */
  applyEnrichmentPreset: ({ sourceColumns, enrichmentColumns, enrichmentSettings }) =>
    set((state) => {
      const next: Partial<SheetState> = {};

      if (enrichmentColumns) {
        // The preset's list is the new list. Columns it does not mention are
        // kept (switched off) only when they already hold data on the sheet,
        // so loading a setting never hides generated values or leaves stray
        // empty columns behind.
        const presetIds = new Set(enrichmentColumns.map((c) => c.id));
        const orphanCustom = state.enrichmentColumns.filter(
          (c) =>
            !presetIds.has(c.id) &&
            state.rows.some((r) => {
              const val = r.enrichedData?.[c.id];
              return Array.isArray(val) ? val.length > 0 : val !== undefined && val !== null && val !== "";
            })
        );
        next.enrichmentColumns = ensureSourceUrlsColumn(
          ensureImageSourcesColumn(
            [
              ...enrichmentColumns.map((col) => ({ ...col })),
              ...orphanCustom.map((col) => ({ ...col, enabled: false })),
            ],
            state.sessionKind
          ),
          state.sessionKind
        );
      }

      if (sourceColumns) {
        // Only columns that exist in this file can be sources. Checked against
        // the merged column list so a source added by this preset survives.
        const available = new Set([
          ...state.originalColumns,
          ...(next.enrichmentColumns ?? state.enrichmentColumns).map((c) => c.id),
        ]);
        next.sourceColumns = sourceColumns.filter((c) => available.has(c));
      }

      if (enrichmentSettings) {
        next.enrichmentSettings = normalizeEnrichmentSettings(enrichmentSettings);
      }

      return { ...next, undoVersion: state.undoVersion + 1 };
    }),

  setSaveStatus: (status) => set({ saveStatus: status, ...(status === "saved" ? { lastSavedAt: Date.now() } : {}) }),

  markUnsaved: () => {
    const { saveStatus } = get();
    if (saveStatus !== "saving") {
      set({ saveStatus: "unsaved" });
    }
  },

  // UI
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setActiveSheet: (sheet) => set({ activeSheet: sheet }),
  setSidebarMode: (mode) => set({ sidebarMode: mode }),

  // Existing column enrichment
  toggleExistingColumnEnrich: (col) =>
    set((state) => {
      const current = state.existingColumnsToEnrich;
      if (current.includes(col)) {
        return { existingColumnsToEnrich: current.filter((c) => c !== col) };
      }
      return { existingColumnsToEnrich: [...current, col] };
    }),
  clearExistingColumnEnrich: () => set({ existingColumnsToEnrich: [] }),
  setExistingColumnInstruction: (col, instruction) =>
    set((state) => ({
      existingColumnInstructions: {
        ...state.existingColumnInstructions,
        [col]: instruction,
      },
    })),
  setEnrichingContext: (tab, existingCols = [], newCols = []) =>
    set({
      enrichingTab: tab,
      enrichingExistingColumns: existingCols,
      enrichingNewColumns: newCols,
    }),
}));

// ─── Optimized Auto-save ─────────────────────────────────────────────────────
// Instead of JSON.stringify-ing ALL rows on every state change, rows are
// compared by reference against the copy last stored, and settings by a small
// config hash. "Unsaved" therefore always means "differs from what is stored":
// results written by a background run and applied from the server read as
// saved, and undoing an edit reads as saved again. Edits save 8 s after the last
// change; leaving the page flushes them at once (flushProjectSave).

let saveTimeout: ReturnType<typeof setTimeout> | null = null;
let lastSavedConfigHash = "";
// The row objects as last stored, to find what changed without stringifying rows.
let lastSavedRows = new Map<string, ProductRow>();
/** True while the store applies state that is already stored (project load, server rows). */
let applyingStoredState = false;
/** Saves run one at a time so an older snapshot can never land after a newer one. */
let saveChain: Promise<void> = Promise.resolve();
/** Above this many changed rows a delta is not worth it; save everything. */
const MAX_DELTA_ROWS = 2000;
const SAVE_DEBOUNCE_MS = 8000;

function snapshotSavedRows(rows: ProductRow[]): void {
  lastSavedRows = new Map(rows.map((r) => [r.id, r]));
}

function storedRowChanged(a: ProductRow, b: ProductRow): boolean {
  return (
    a.originalData !== b.originalData ||
    a.enrichedData !== b.enrichedData ||
    a.status !== b.status ||
    a.errorMessage !== b.errorMessage ||
    a.matchType !== b.matchType ||
    a.rowIndex !== b.rowIndex
  );
}

/**
 * Rows that differ from the last stored copy, or null when the change is
 * structural (rows added, removed or replaced) or too large for a delta.
 */
function changedRowsSinceSave(rows: ProductRow[]): ProductRow[] | null {
  if (rows.length !== lastSavedRows.size) return null;
  const changed: ProductRow[] = [];
  for (const row of rows) {
    const saved = lastSavedRows.get(row.id);
    if (!saved) return null;
    if (storedRowChanged(saved, row)) {
      changed.push(row);
      if (changed.length > MAX_DELTA_ROWS) return null;
    }
  }
  return changed;
}

function rowsDifferFromSaved(rows: ProductRow[]): boolean {
  const changed = changedRowsSinceSave(rows);
  return changed === null || changed.length > 0;
}

function toStoredRow(r: ProductRow) {
  return {
    id: r.id,
    rowIndex: r.rowIndex,
    status: r.status === "processing" ? ("pending" as const) : r.status,
    errorMessage: r.errorMessage,
    originalData: r.originalData,
    enrichedData: r.enrichedData,
    matchType: r.matchType,
  };
}

// Lightweight config hash (settings/columns — small objects, safe to stringify)
function configHash(state: SheetState): string {
  return JSON.stringify({
    sc: state.sourceColumns,
    ec: state.enrichmentColumns,
    es: state.enrichmentSettings,
    cv: state.columnVisibility,
    cl: state.columnLayout,
    cols: state.originalColumns,
    pg: state.productGroupColumn,
    sm: state.sidebarMode,
    as: state.activeSheet,
  });
}

function hasUnsavedProjectChanges(state: SheetState): boolean {
  return configHash(state) !== lastSavedConfigHash || rowsDifferFromSaved(state.rows);
}

function clearScheduledSave(): void {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = null;
}

function scheduleSave(): void {
  clearScheduledSave();
  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    void persistProject();
  }, SAVE_DEBOUNCE_MS);
}

/**
 * Sets the badge from the real difference with the stored copy and keeps a
 * save scheduled only while there is something to store.
 */
function reconcileSaveStatus(): void {
  const state = useSheetStore.getState();
  if (!state.workspaceId || !state.projectId || !state.fileName) return;
  if (state.saveStatus === "saving") return;
  // A running job owns the stored rows: its results arrive through
  // applyProjectRows, so only settings can be unsaved while it runs.
  const running = state.isEnriching || state.isStoppingEnrich;
  const unsaved = running
    ? configHash(state) !== lastSavedConfigHash
    : hasUnsavedProjectChanges(state);
  if (!unsaved) {
    clearScheduledSave();
    if (state.saveStatus !== "saved") useSheetStore.setState({ saveStatus: "saved" });
    return;
  }
  if (state.saveStatus === "saved") useSheetStore.setState({ saveStatus: "unsaved" });
  if (running) return;
  scheduleSave();
}

/** Re-baseline the "last saved" fingerprint against whatever is in the store
 * right now (e.g. right after loading a project from Storage). Without this,
 * opening/switching projects immediately looks "changed" against the
 * previous project's fingerprint and schedules a save a few seconds later. */
function markProjectSnapshotAsSaved(): void {
  clearScheduledSave();
  lastSavedConfigHash = configHash(useSheetStore.getState());
  snapshotSavedRows(useSheetStore.getState().rows);
}

function persistProject(): Promise<void> {
  const run = saveChain.then(persistProjectNow, persistProjectNow);
  saveChain = run.catch(() => undefined);
  return run;
}

async function persistProjectNow() {
  const s = useSheetStore.getState();
  if (!s.workspaceId || !s.projectId || !s.fileName) return;
  // Re-check at execution time, not just at scheduling time: a debounce timer
  // armed before enrichment started (e.g. right after opening the page) must
  // not fire mid-run or right after it finishes and blindly overwrite the
  // background job's freshly saved results with this stale row snapshot.
  if (s.isEnriching || s.isStoppingEnrich) return;

  // Everything the save compares against is read now, before any await, so a
  // project opened meanwhile cannot mix its baseline into this save.
  const savedConfig = configHash(s);
  const settingsChanged = savedConfig !== lastSavedConfigHash;
  const changed = changedRowsSinceSave(s.rows);
  if (!settingsChanged && changed !== null && changed.length === 0) {
    useSheetStore.setState({ saveStatus: "saved" });
    return;
  }

  useSheetStore.setState({ saveStatus: "saving" });

  try {
    const { saveProjectJson, saveProjectDelta } = await import("@/lib/storage-helpers");
    const { updateImportSession } = await import("@/lib/supabase");

    const meta = {
      kind: s.sessionKind,
      matchingSkipped: s.matchingSkipped,
      productGroupColumn: s.productGroupColumn,
      columns: s.originalColumns,
      sourceColumns: s.sourceColumns,
      enrichmentColumns: s.enrichmentColumns,
      enrichmentSettings: s.enrichmentSettings,
      columnVisibility: s.columnVisibility,
      columnLayout: s.columnLayout,
      sidebarMode: s.sidebarMode,
      activeSheet: s.activeSheet,
    };

    // Cell edits only send the rows that changed (and the settings when they
    // changed); structural edits (rows added / removed) and big changes send
    // the whole sheet. The server can also ask for a full save.
    let savedAsDelta = false;
    if (changed) {
      const result = await saveProjectDelta(s.workspaceId, s.projectId, {
        rows: changed.map(toStoredRow),
        rowCount: s.rows.length,
        ...(settingsChanged ? { meta } : {}),
      });
      savedAsDelta = result.ok;
    }
    if (!savedAsDelta) {
      await saveProjectJson(s.workspaceId, s.projectId, { ...meta, rows: s.rows.map(toStoredRow) });
    }

    // Update session metadata in DB (enriched count only)
    const enrichedCount = s.rows.filter((r) => r.status === "done").length;
    await updateImportSession(s.projectId, { enriched_count: enrichedCount });

    // Another project was opened while this one saved: its own baseline stands.
    if (useSheetStore.getState().projectId !== s.projectId) return;
    snapshotSavedRows(s.rows);
    lastSavedConfigHash = savedConfig;
    useSheetStore.setState({ saveStatus: "saved", lastSavedAt: Date.now() });
    // Edits made while the request was out are still pending.
    reconcileSaveStatus();
  } catch (err) {
    console.error("Auto-save failed:", err);
    if (useSheetStore.getState().projectId === s.projectId) {
      useSheetStore.setState({ saveStatus: "error" });
    }
  }
}

/**
 * Stores pending changes right away (leaving the page, hiding the tab).
 * Resolves once the store matches what is saved, or the save has failed.
 */
export async function flushProjectSave(): Promise<void> {
  const state = useSheetStore.getState();
  if (!state.workspaceId || !state.projectId || !state.fileName) return;
  if (state.isEnriching || state.isStoppingEnrich) return;
  if (!saveTimeout && !hasUnsavedProjectChanges(state)) {
    await saveChain;
    return;
  }
  clearScheduledSave();
  await persistProject();
}

useSheetStore.subscribe((state, prevState) => {
  if (applyingStoredState) return;
  if (!state.workspaceId || !state.projectId || !state.fileName) return;

  // Quick change detection: row arrays and the undo counter by reference,
  // settings by their small hash. Anything else (selection, UI) is ignored.
  const touched =
    state.rows !== prevState.rows ||
    state.undoVersion !== prevState.undoVersion ||
    configHash(state) !== configHash(prevState);
  if (!touched) return;

  reconcileSaveStatus();
});
