import { parseVisualizerProjectSettings } from "@/lib/visualizer/settings-schema";
import {
  DEFAULT_VISUALIZER_LAYOUT_ID,
  type VisualizerLayoutId,
} from "@/lib/visualizer/layouts";

export type { VisualizerLayoutId };

export type VisualizerSessionStatus =
  | "draft"
  | "ready"
  | "processing"
  | "paused"
  | "completed"
  | "failed";

export type VisualizerPhase = "description" | "images" | "full";

export type VisualizerRowStatus =
  | "not_started"
  | "generating"
  | "description_ready"
  | "images_ready"
  | "failed";

export type VisualizerGenerationStage =
  | "planning"
  | "description"
  | "images"
  | "finalizing";

export type VisualizerTier = "standard" | "premium";
export type VisualizerThinkingLevel = "low" | "medium" | "high";
export type VisualizerImageStyle =
  | "studio"
  | "white"
  | "lifestyle"
  | "editorial"
  | "custom";

export type VisualizerBrandGuideMode = "image" | "colors";

export interface VisualizerDescriptionSettings {
  tier: VisualizerTier;
  thinkingLevel: VisualizerThinkingLevel;
  instructions: string;
  /** Selected description+image layout template. */
  layoutId: VisualizerLayoutId;
  /** Exact image/placeholder count for the selected layout (1–6, layout-clamped). */
  imageCount: number;
  /** @deprecated Synced to imageCount for older code paths. */
  maxPlaceholders: number;
}

export interface VisualizerImagesSettings {
  tier: VisualizerTier;
  aspectRatio: string;
  resolution: string;
  outputFormat: "image/jpeg" | "image/png";
  style: VisualizerImageStyle;
  instructions: string;
  groundWithSearch: boolean;
  brandingEnabled: boolean;
  brandGuideMode: VisualizerBrandGuideMode;
  brandColors: string[];
  logoPath: string | null;
  brandGuidePath: string | null;
  sceneReferencePath: string | null;
}

export interface VisualizerBrandSettings {
  colorPrimary: string;
  colorSecondary: string;
  styleNotes: string;
  fontsNotes: string;
}

export interface VisualizerProjectSettings {
  selectedColumns: string[];
  productImageColumn: string | null;
  columnsSelectionExplicit: boolean;
  description: VisualizerDescriptionSettings;
  images: VisualizerImagesSettings;
  brand: VisualizerBrandSettings;
}

export interface VisualizerImagePlaceholder {
  index: number;
  visualBrief: string;
  alt: string;
  storagePath?: string | null;
}

export interface VisualizerRow {
  id: string;
  rowIndex: number;
  status: VisualizerRowStatus;
  /** Which field is actively generating during a run. */
  generationStage?: VisualizerGenerationStage;
  originalData: Record<string, string>;
  generatedDescription?: string;
  imagePlaceholders?: VisualizerImagePlaceholder[];
  errorMessage?: string;
}

export interface VisualizerActiveRun {
  id: string;
  phase: VisualizerPhase;
  status: "queued" | "running" | "cancelled" | "completed" | "failed";
  total: number;
  completed: number;
  failed: number;
  selectedRowIds?: string[];
  estimatedCredits?: number;
  usedCredits?: number;
  cancelRequested?: boolean;
  currentRowId?: string | null;
  startedAt?: string;
  updatedAt?: string;
  finishedAt?: string;
  errorMessage?: string | null;
}

export interface VisualizerWorksheetJson {
  sessionId: string;
  columns: string[];
  settings: VisualizerProjectSettings;
  activeRun: VisualizerActiveRun | null;
  rows: VisualizerRow[];
  revision?: number;
}

export interface VisualizerSession {
  id: string;
  workspace_id: string;
  name: string;
  status: VisualizerSessionStatus;
  source_file_name: string;
  storage_path: string | null;
  images_prefix: string | null;
  total_rows: number;
  ready_rows: number;
  failed_rows: number;
  total_cost: number;
  total_credits: number;
  error_message: string | null;
  awaiting_user_action: boolean;
  active_phase: VisualizerPhase | null;
  cancel_requested: boolean;
  worksheet_revision: number;
  settings: VisualizerProjectSettings;
  settings_revision: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export const DEFAULT_VISUALIZER_DESCRIPTION: VisualizerDescriptionSettings = {
  tier: "standard",
  thinkingLevel: "medium",
  instructions: "",
  layoutId: DEFAULT_VISUALIZER_LAYOUT_ID,
  imageCount: 4,
  maxPlaceholders: 4,
};

export const DEFAULT_VISUALIZER_IMAGES: VisualizerImagesSettings = {
  tier: "premium",
  aspectRatio: "1:1",
  resolution: "1K",
  outputFormat: "image/jpeg",
  style: "lifestyle",
  instructions: "",
  groundWithSearch: false,
  brandingEnabled: false,
  brandGuideMode: "colors",
  brandColors: ["#111827", "#2563EB", "#F59E0B"],
  logoPath: null,
  brandGuidePath: null,
  sceneReferencePath: null,
};

export const DEFAULT_VISUALIZER_BRAND: VisualizerBrandSettings = {
  colorPrimary: "#111827",
  colorSecondary: "#2563EB",
  styleNotes: "",
  fontsNotes: "",
};

export const DEFAULT_VISUALIZER_SETTINGS: VisualizerProjectSettings = {
  selectedColumns: [],
  productImageColumn: null,
  columnsSelectionExplicit: false,
  description: { ...DEFAULT_VISUALIZER_DESCRIPTION },
  images: {
    ...DEFAULT_VISUALIZER_IMAGES,
    brandColors: [...DEFAULT_VISUALIZER_IMAGES.brandColors],
  },
  brand: { ...DEFAULT_VISUALIZER_BRAND },
};

export function getVisualizerProjectSettingsFromWorksheet(
  worksheet: VisualizerWorksheetJson
): VisualizerProjectSettings {
  return parseVisualizerProjectSettings(worksheet.settings);
}

export function applyVisualizerProjectSettings(
  worksheet: VisualizerWorksheetJson,
  settings: VisualizerProjectSettings
): VisualizerWorksheetJson {
  const parsed = parseVisualizerProjectSettings(settings);
  return {
    ...worksheet,
    settings: parsed,
  };
}

export function normalizeVisualizerWorksheet(
  worksheet: VisualizerWorksheetJson
): VisualizerWorksheetJson {
  const settings = parseVisualizerProjectSettings(worksheet.settings ?? {});
  const columns = Array.isArray(worksheet.columns) ? [...worksheet.columns] : [];
  const hydrated =
    settings.selectedColumns.length === 0 && !settings.columnsSelectionExplicit
      ? {
          ...settings,
          selectedColumns: [...columns],
        }
      : {
          ...settings,
          selectedColumns: settings.selectedColumns.filter((column) =>
            columns.includes(column)
          ),
          productImageColumn:
            settings.productImageColumn &&
            columns.includes(settings.productImageColumn)
              ? settings.productImageColumn
              : null,
        };

  return {
    sessionId: worksheet.sessionId,
    columns,
    settings: hydrated,
    activeRun: worksheet.activeRun ?? null,
    revision:
      typeof worksheet.revision === "number" ? worksheet.revision : undefined,
    rows: (worksheet.rows ?? []).map((row, index) => ({
      id: String(row.id || `row-${index}`),
      rowIndex: typeof row.rowIndex === "number" ? row.rowIndex : index,
      status:
        row.status === "description_ready" ||
        row.status === "images_ready" ||
        row.status === "failed" ||
        row.status === "generating"
          ? row.status
          : "not_started",
      generationStage:
        row.generationStage === "planning" ||
        row.generationStage === "description" ||
        row.generationStage === "images" ||
        row.generationStage === "finalizing"
          ? row.generationStage
          : undefined,
      originalData: Object.fromEntries(
        Object.entries(row.originalData || {}).map(([key, value]) => [
          key,
          String(value ?? ""),
        ])
      ),
      generatedDescription: row.generatedDescription
        ? String(row.generatedDescription)
        : undefined,
      imagePlaceholders: Array.isArray(row.imagePlaceholders)
        ? row.imagePlaceholders.map((item, placeholderIndex) => ({
            index:
              typeof item.index === "number"
                ? item.index
                : placeholderIndex + 1,
            visualBrief: String(item.visualBrief || ""),
            alt: String(item.alt || ""),
            storagePath: item.storagePath ? String(item.storagePath) : null,
          }))
        : undefined,
      errorMessage: row.errorMessage ? String(row.errorMessage) : undefined,
    })),
  };
}

export function createEmptyVisualizerWorksheet(
  sessionId: string,
  columns: string[],
  rows: Array<{ id: string; rowIndex: number; originalData: Record<string, string> }>
): VisualizerWorksheetJson {
  return {
    sessionId,
    columns: [...columns],
    settings: {
      ...DEFAULT_VISUALIZER_SETTINGS,
      selectedColumns: [...columns],
      description: { ...DEFAULT_VISUALIZER_DESCRIPTION },
      images: {
        ...DEFAULT_VISUALIZER_IMAGES,
        brandColors: [...DEFAULT_VISUALIZER_IMAGES.brandColors],
      },
      brand: { ...DEFAULT_VISUALIZER_BRAND },
    },
    activeRun: null,
    rows: rows.map((row) => ({
      ...row,
      status: "not_started",
    })),
  };
}

/** Standard/Premium → OpenAI description models (same as Gallery Scraping). */
export function resolveVisualizerDescriptionModel(
  tier: VisualizerTier | undefined
): "gpt-5.6-terra" | "gpt-5.6-sol" {
  return tier === "premium" ? "gpt-5.6-sol" : "gpt-5.6-terra";
}

/** Standard/Premium → Gemini image models (same as Gallery AI). */
export function resolveVisualizerImageModel(
  tier: VisualizerTier | undefined
): "gemini-3.1-flash-image" | "gemini-3-pro-image" {
  return tier === "premium" ? "gemini-3-pro-image" : "gemini-3.1-flash-image";
}
