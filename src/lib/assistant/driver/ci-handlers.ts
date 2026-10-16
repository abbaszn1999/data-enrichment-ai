import { visibleCatalogRows } from "@/lib/catalog/product-groups";
import { useSheetStore } from "@/store/sheet-store";
import {
  DEFAULT_FINDER_OUTPUTS,
  LENS_FOUNDS_COLUMN_ID,
  PRODUCT_MODE_COLUMN_IDS,
  SOURCE_URLS_COLUMN_ID,
  isProductModeColumn,
} from "@/types";
import type { BrowserAction } from "../protocol";

type SelectAction = Extract<BrowserAction, { kind: "ci_select_rows" }>;
type ColumnsAction = Extract<BrowserAction, { kind: "ci_set_columns" }>;

const isEmpty = (value: unknown) => value === undefined || value === null || String(value).trim() === "";

function requireSheet() {
  const state = useSheetStore.getState();
  const open =
    state.projectId && typeof window !== "undefined" && window.location.pathname.includes(`/catalog-intelligence/${state.projectId}`);
  if (!open || state.rows.length === 0) {
    throw new Error("No catalog sheet is open on this page. Open a project first.");
  }
  return state;
}

function visibleRows() {
  const state = requireSheet();
  return visibleCatalogRows(state.rows, { groupColumn: state.productGroupColumn, activeSheet: state.activeSheet });
}

/** What `ci.run` runs with the tool that is open, mirroring the sidebar's run columns. */
function toolSummary(state: ReturnType<typeof requireSheet>) {
  const mode = state.sidebarMode;
  const label = (id: string) => state.enrichmentColumns.find((col) => col.id === id)?.label ?? id;
  const sources = state.sourceColumns.slice(0, 30);
  if (mode === "enrich") {
    return {
      tool: "Enrichment",
      willRun: state.enrichmentColumns
        .filter((col) => col.enabled && !isProductModeColumn(col.id, state.sessionKind))
        .map((col) => col.label),
      sourceColumns: sources,
    };
  }
  if (mode === "images") {
    const output = (state.enrichmentSettings.finderOutputs ?? DEFAULT_FINDER_OUTPUTS).find((o) => o !== "lens") ?? null;
    return {
      tool: "Source / Image Finder",
      willRun: output === "sourceUrls" ? [label(SOURCE_URLS_COLUMN_ID)] : output === "images" ? [label(PRODUCT_MODE_COLUMN_IDS.images)] : [],
      finderOutput: output ?? "none",
      sourceColumns: sources,
    };
  }
  if (mode === "lens") {
    return {
      tool: "Lens Source Checker",
      willRun: [label(LENS_FOUNDS_COLUMN_ID)],
      pictureColumn: state.enrichmentSettings.lensImageColumn ?? "chosen automatically",
    };
  }
  if (mode === "functions") return { tool: "Sheet Tools", willRun: [] };
  return { tool: "Categorize", willRun: [label(PRODUCT_MODE_COLUMN_IDS[mode])], sourceColumns: sources };
}

export function ciGetState() {
  const state = requireSheet();
  const rows = visibleRows();
  const byStatus: Record<string, number> = {};
  for (const row of rows) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
  return {
    sheetName: state.fileName,
    kind: state.sessionKind,
    activeSheet: state.activeSheet,
    mode: state.sidebarMode,
    toolPanelOpen: state.sidebarOpen,
    ...toolSummary(state),
    visibleRows: rows.length,
    selectedRows: rows.filter((row) => state.selectedRowIds.has(row.id)).length,
    isEnriching: state.isEnriching,
    progress: { completed: state.completedEnrich, total: state.totalToEnrich },
    statusCounts: byStatus,
    sourceColumns: state.originalColumns?.slice(0, 40) ?? [],
    outputColumns: state.enrichmentColumns.map((col) => ({ id: col.id, label: col.label, enabled: col.enabled })),
    firstRows: rows.slice(0, 3).map((row, index) => ({
      row: index + 1,
      status: row.status,
      values: Object.fromEntries(Object.entries(row.originalData ?? {}).slice(0, 6).map(([k, v]) => [k, String(v ?? "").slice(0, 60)])),
    })),
  };
}

export function ciSelectRows(action: SelectAction) {
  const state = requireSheet();
  const rows = visibleRows();
  let chosen: string[] = [];
  if (action.mode === "all") {
    chosen = rows.map((row) => row.id);
  } else if (action.mode === "indexes") {
    const wanted = new Set(action.indexes ?? []);
    chosen = rows.filter((_, i) => wanted.has(i + 1)).map((row) => row.id);
  } else if (action.mode === "empty_columns") {
    const names = (action.columns ?? []).map((name) => name.trim().toLowerCase()).filter(Boolean);
    if (names.length === 0) throw new Error("List the columns to check.");
    const resolved = names.map((name) => {
      const out = state.enrichmentColumns.find((col) => col.id.toLowerCase() === name || col.label.toLowerCase() === name);
      return out ? { kind: "enriched" as const, key: out.id } : { kind: "source" as const, key: name };
    });
    chosen = rows
      .filter((row) =>
        resolved.every((col) => {
          if (col.kind === "enriched") return isEmpty(row.enrichedData?.[col.key]);
          const sourceKey = Object.keys(row.originalData ?? {}).find((k) => k.toLowerCase() === col.key);
          return sourceKey ? isEmpty(row.originalData[sourceKey]) : true;
        })
      )
      .map((row) => row.id);
  }
  state.selectRowsByIds(chosen);
  return { selected: chosen.length, of: rows.length };
}

export function ciSetColumns(action: ColumnsAction) {
  const state = requireSheet();
  const find = (name: string) => {
    const key = name.trim().toLowerCase();
    return state.enrichmentColumns.find((col) => col.id.toLowerCase() === key || col.label.toLowerCase() === key);
  };
  const changed: string[] = [];
  const unknown: string[] = [];
  for (const [names, enabled] of [
    [action.enable ?? [], true],
    [action.disable ?? [], false],
  ] as const) {
    for (const name of names) {
      const column = find(name);
      if (!column) {
        unknown.push(name);
        continue;
      }
      useSheetStore.getState().updateEnrichmentColumnConfig(column.id, { enabled });
      changed.push(`${column.label}: ${enabled ? "on" : "off"}`);
    }
  }
  if (unknown.length > 0 && changed.length === 0) {
    throw new Error(`No output column named: ${unknown.join(", ")}. Use ci_get_state to read the names.`);
  }
  return { changed, ...(unknown.length ? { unknown } : {}) };
}
