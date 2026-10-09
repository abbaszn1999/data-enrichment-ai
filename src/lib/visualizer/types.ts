import { parseVisualizerProjectSettings } from "@/lib/visualizer/settings-schema";
import { VISUALIZER_PLANNER_OPENAI_MODEL, type EnrichOpenAiModelId } from "@/lib/enrich/models";
import {
  DEFAULT_VISUALIZER_LAYOUT_ID,
  isVisualizerSlotRole,
  type VisualizerLayoutId,
  type VisualizerSlotRole,
} from "@/lib/visualizer/layouts";
import { DEFAULT_VISUALIZER_THEME, type VisualizerImageStyle } from "@/lib/visualizer/themes";
import { EMPTY_COLUMN_LAYOUT, type ColumnLayout } from "@/lib/sheet/column-layout";

export type { VisualizerLayoutId, ColumnLayout };

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
export type { VisualizerImageStyle };

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
  /** Sheet column order + hidden set, source and result columns mixed. */
  columnLayout: ColumnLayout;
  description: VisualizerDescriptionSettings;
  images: VisualizerImagesSettings;
  brand: VisualizerBrandSettings;
}

export interface VisualizerImagePlaceholder {
  index: number;
  visualBrief: string;
  alt: string;
  /** Spec this slot proves (waterproof, UV protection, …). Optional on
   *  rows saved before skill 01 required it. */
  specClaim?: string;
  /** Complete Nano Banana prompt written by the planner. Older rows only have visualBrief. */
  prompt?: string;
  /** Camera perspective the planner chose for this slot. */
  perspective?: string;
  /** True when the brand logo is sent with this slot's image request. */
  useLogo?: boolean;
  /** What the slot shows; rows saved before roles existed are "feature". */
  role?: VisualizerSlotRole;
  /** Image ratio for this slot; rows saved before per-slot ratios use the settings ratio. */
  aspectRatio?: string;
  /** Exact product facts sent first with this slot's image request; absent on older rows. */
  identityLock?: string;
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
  tier: "standard",
  aspectRatio: "1:1",
  resolution: "1K",
  outputFormat: "image/jpeg",
  style: DEFAULT_VISUALIZER_THEME,
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
  columnLayout: EMPTY_COLUMN_LAYOUT,
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
            specClaim: item.specClaim ? String(item.specClaim) : undefined,
            prompt: item.prompt ? String(item.prompt) : undefined,
            perspective: item.perspective ? String(item.perspective) : undefined,
            useLogo: item.useLogo === true ? true : undefined,
            role: isVisualizerSlotRole(item.role) ? item.role : undefined,
            aspectRatio: item.aspectRatio ? String(item.aspectRatio) : undefined,
            identityLock: item.identityLock ? String(item.identityLock) : undefined,
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

/**
 * The planner (description + per-image prompts) is one fixed agent for both
 * quality tiers: GPT-6.1 Sol at medium reasoning. The tier only picks the
 * image model.
 */
export function resolveVisualizerDescriptionModel(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept so callers stay tier-aware
  _tier?: VisualizerTier | undefined
): EnrichOpenAiModelId {
  return VISUALIZER_PLANNER_OPENAI_MODEL;
}

/** Standard/Premium → Gemini image models (same as Gallery AI). */
export function resolveVisualizerImageModel(
  tier: VisualizerTier | undefined
): "gemini-3.1-flash-image" | "gemini-3-pro-image" {
  return tier === "premium" ? "gemini-3-pro-image" : "gemini-3.1-flash-image";
}
