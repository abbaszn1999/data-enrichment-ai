import type { EnrichmentColumn, EnrichmentPreset, EnrichmentPresetSettings, SessionKind } from "@/types";

/** A `catalog_presets` row as selected by the presets API. */
export interface PresetRow {
  id: string;
  kind: string;
  name: string;
  payload: unknown;
  created_at: string;
  updated_at: string;
}

const MAX_COLUMNS = 100;
const MAX_SOURCES = 300;
const MAX_INSTRUCTION_CHARS = 4000;
const MAX_PAYLOAD_CHARS = 250_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate what a client sends as a preset body. A preset is the sheet's
 * columns (with each column's custom instruction), the chosen source columns
 * and the language. Returns null when nothing usable is selected.
 */
export function normalizePresetPayload(input: unknown): EnrichmentPresetSettings | null {
  if (!isRecord(input)) return null;

  const columns: EnrichmentColumn[] = [];
  const seen = new Set<string>();
  if (Array.isArray(input.enrichmentColumns)) {
    for (const raw of input.enrichmentColumns.slice(0, MAX_COLUMNS)) {
      if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id || seen.has(raw.id)) continue;
      seen.add(raw.id);
      const col = { ...raw } as unknown as EnrichmentColumn;
      col.label = typeof raw.label === "string" && raw.label.trim() ? raw.label.trim().slice(0, 120) : raw.id;
      col.enabled = raw.enabled !== false;
      if (typeof col.customInstruction === "string") {
        col.customInstruction = col.customInstruction.slice(0, MAX_INSTRUCTION_CHARS);
      }
      columns.push(col);
    }
  }
  if (!columns.some((col) => col.enabled)) return null;

  const sourceColumns = Array.isArray(input.sourceColumns)
    ? input.sourceColumns.filter((c): c is string => typeof c === "string" && c.length > 0 && c.length <= 200).slice(0, MAX_SOURCES)
    : [];

  const rawSettings = isRecord(input.enrichmentSettings) ? input.enrichmentSettings : {};
  const settings = {
    outputLanguage: typeof rawSettings.outputLanguage === "string" ? rawSettings.outputLanguage : "English",
    customLanguage: typeof rawSettings.customLanguage === "string" ? rawSettings.customLanguage.slice(0, 80) : "",
    enrichmentModel: rawSettings.enrichmentModel === "premium" ? "premium" : "standard",
    thinkingLevel: typeof rawSettings.thinkingLevel === "string" ? rawSettings.thinkingLevel : "low",
  } as EnrichmentPresetSettings["enrichmentSettings"];

  const payload: EnrichmentPresetSettings = { sourceColumns, enrichmentColumns: columns, enrichmentSettings: settings };
  if (JSON.stringify(payload).length > MAX_PAYLOAD_CHARS) return null;
  return payload;
}

export function presetRowToPreset(row: PresetRow): EnrichmentPreset {
  const payload = isRecord(row.payload) ? row.payload : {};
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    kind: (row.kind === "plp" ? "plp" : "product") as SessionKind,
    settings: {
      sourceColumns: Array.isArray(payload.sourceColumns) ? (payload.sourceColumns as string[]) : [],
      enrichmentColumns: Array.isArray(payload.enrichmentColumns) ? (payload.enrichmentColumns as EnrichmentColumn[]) : [],
      enrichmentSettings: (isRecord(payload.enrichmentSettings)
        ? payload.enrichmentSettings
        : { outputLanguage: "English", customLanguage: "", enrichmentModel: "standard", thinkingLevel: "low" }) as unknown as EnrichmentPresetSettings["enrichmentSettings"],
    },
  };
}
