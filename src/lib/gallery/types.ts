import {
  parseAiSettings,
  parseScrapingSettings,
} from "@/lib/gallery/settings-schema";

export type GallerySessionStatus =
  | "draft"
  | "ready"
  | "processing"
  | "completed"
  | "failed";

export type GalleryRowStatus =
  | "not_started"
  | "queued"
  | "generating"
  | "ready"
  | "failed";

export type GalleryGenerationStage =
  | "planning"
  | "searching"
  | "main"
  | "gallery"
  | "finalizing";

export type GalleryProvider = "scraping" | "ai";

/**
 * Explicit generation phase for two-step Find-main → Gallery workflows.
 * - main: source/create Main images only
 * - gallery: source/create Gallery using existing Main
 * - full: Main from original column + Gallery in one run
 */
export type GalleryRunPhase = "main" | "gallery" | "full";

/**
 * Decide which generation phase to run for a row.
 * Original-image column always runs Main+Gallery together (`full`).
 * Otherwise: explicit request wins; if omitted, existing Main → gallery, else main.
 */
export function resolveGalleryRunPhase(params: {
  originalImageColumn?: string | null;
  row: Pick<GalleryRow, "mainImagePath" | "mainImagePaths">;
  requested?: GalleryRunPhase | null;
}): GalleryRunPhase {
  if (params.originalImageColumn) return "full";
  if (
    params.requested === "main" ||
    params.requested === "gallery" ||
    params.requested === "full"
  ) {
    return params.requested;
  }
  return getRowMainImagePaths(params.row).length > 0 ? "gallery" : "main";
}

/**
 * Summarize phase intent for a multi-row selection (UI button label / client request).
 */
export function resolveSelectionRunPhase(params: {
  originalImageColumn?: string | null;
  rows: Array<Pick<GalleryRow, "mainImagePath" | "mainImagePaths">>;
}): { phase: GalleryRunPhase | "mixed"; label: string } {
  if (params.originalImageColumn) {
    return { phase: "full", label: "Generate" };
  }
  if (params.rows.length === 0) {
    return { phase: "main", label: "Generate main" };
  }
  const withMain = params.rows.filter(
    (row) => getRowMainImagePaths(row).length > 0
  ).length;
  if (withMain === params.rows.length) {
    return { phase: "gallery", label: "Generate gallery" };
  }
  if (withMain === 0) {
    return { phase: "main", label: "Generate main" };
  }
  return { phase: "mixed", label: "Generate selected" };
}

export type GalleryRunStatus =
  | "queued"
  | "running"
  | "cancelled"
  | "completed"
  | "failed";

export type GallerySearchDepth = "low" | "medium" | "high";

export interface GalleryMainSettings {
  imagesPerRow: number;
  instructions: string;
}

export interface GalleryScrapingSettings {
  /** Main-image sourcing settings; independent from Gallery images. */
  main: GalleryMainSettings;
  imagesPerRow: number;
  /** Mandatory free-text instructions for search + selection behavior. */
  instructions: string;
  /** How many extra image candidates to collect before filtering. */
  searchDepth: GallerySearchDepth;
  sourcePolicy: "any" | "prefer-official" | "official-only";
  excludeMarketplaces: boolean;
  timeRange?: string;
  minResolution: number;
  aspectRatio: string;
  duplicates: "avoid";
  /** Exact product/model matching is an invariant of the scraping pipeline. */
  matchStrictness: "strict";
}

/**
 * Legacy SerpApi settings shape kept so unused provider modules still typecheck.
 * Prefer GalleryScrapingSettings for the live Scraping path.
 */
export type GalleryGoogleSettings = GalleryScrapingSettings & {
  candidates?: number;
  country?: string;
  language?: string;
  autocorrect?: boolean;
};

export interface GalleryAiSettings {
  /** Main-image generation settings; independent from Gallery images. */
  main: GalleryMainSettings;
  tier: "standard" | "premium";
  imagesPerRow: number;
  aspectRatio: string;
  resolution: string;
  outputFormat: string;
  style: string;
  instructions: string;
  groundWithSearch: boolean;
  brandingEnabled: boolean;
  brandColors: string[];
  logoPath: string | null;
  brandGuidePath: string | null;
  sceneReferencePath: string | null;
}

export interface GalleryActiveRun {
  id: string;
  status: GalleryRunStatus;
  provider: GalleryProvider;
  selectedRowIds: string[];
  total: number;
  completed: number;
  failed: number;
  estimatedCredits: number;
  usedCredits: number;
  cancelRequested?: boolean;
  startedAt?: string;
  finishedAt?: string;
}

export interface GalleryImageProvenance {
  /** Current worksheet reference: internal path or external source URL. */
  ref: string;
  /** Legacy alias retained while old worksheets are migrated lazily. */
  url?: string;
  role: "main" | "gallery";
  persistence: "internal" | "external";
  sourceUrl?: string;
  pageUrl?: string;
  fallbackUrl?: string;
  title?: string;
}

export interface GalleryRowSourceMeta {
  provider?: GalleryProvider;
  images?: GalleryImageProvenance[];
  [key: string]: unknown;
}

export interface GalleryRow {
  id: string;
  rowIndex: number;
  status: GalleryRowStatus;
  generationStage?: GalleryGenerationStage;
  errorMessage?: string;
  originalData: Record<string, string>;
  /** All Main images. `mainImagePath` mirrors the first item for compatibility. */
  mainImagePaths?: string[];
  mainImagePath: string | null;
  galleryImagePaths: string[];
  sourceMeta?: GalleryRowSourceMeta;
  creditsUsed?: number;
}

export function getRowMainImagePaths(
  row: Pick<GalleryRow, "mainImagePath" | "mainImagePaths">
): string[] {
  // An explicit empty array means "cleared" — do not fall back to legacy mainImagePath.
  if (Array.isArray(row.mainImagePaths)) return [...row.mainImagePaths];
  return row.mainImagePath ? [row.mainImagePath] : [];
}

/**
 * User-editable project configuration persisted in gallery_sessions.settings.
 * Runtime worksheet rows/results remain in Storage and are never overwritten by
 * a settings save.
 */
export interface GalleryProjectSettings {
  provider: GalleryProvider;
  originalImageColumn: string | null;
  originalImageSelectionExplicit: boolean;
  selectedColumns: string[];
  scraping: GalleryScrapingSettings;
  ai: GalleryAiSettings;
}

export interface GalleryWorksheetJson {
  sessionId: string;
  columns: string[];
  originalImageColumn: string | null;
  /** True only after the user explicitly saves the image-column choice. */
  originalImageSelectionExplicit?: boolean;
  selectedColumns: string[];
  settings: {
    provider: GalleryProvider;
    scraping: GalleryScrapingSettings;
    ai: GalleryAiSettings;
    /** @deprecated Migrated into `scraping` on load. */
    google?: GalleryGoogleSettings;
  };
  activeRun: GalleryActiveRun | null;
  rows: GalleryRow[];
  /**
   * Mirrors `gallery_sessions.worksheet_revision`.
   * Used to detect stale Storage reads that would otherwise overwrite newer writes
   * (e.g. image deletes revived by a settings autosave).
   */
  revision?: number;
}

export interface GallerySession {
  id: string;
  workspace_id: string;
  name: string;
  status: GallerySessionStatus;
  source_file_name: string;
  storage_path: string | null;
  images_prefix: string | null;
  total_rows: number;
  ready_rows: number;
  failed_rows: number;
  total_cost: number;
  total_credits: number;
  error_message: string | null;
  cancel_requested: boolean;
  worksheet_revision: number;
  settings: GalleryProjectSettings;
  settings_revision: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export const DEFAULT_SCRAPING_SETTINGS: GalleryScrapingSettings = {
  main: {
    imagesPerRow: 1,
    instructions: "",
  },
  imagesPerRow: 4,
  instructions: "",
  searchDepth: "medium",
  sourcePolicy: "prefer-official",
  excludeMarketplaces: false,
  minResolution: 0,
  aspectRatio: "any",
  duplicates: "avoid",
  matchStrictness: "strict",
};

/** @deprecated Use DEFAULT_SCRAPING_SETTINGS */
export const DEFAULT_GOOGLE_SETTINGS: GalleryGoogleSettings = {
  ...DEFAULT_SCRAPING_SETTINGS,
  candidates: 25,
  country: "us",
  language: "en",
  autocorrect: true,
  timeRange: "",
};

export const DEFAULT_AI_SETTINGS: GalleryAiSettings = {
  main: {
    imagesPerRow: 1,
    instructions: "",
  },
  tier: "standard",
  imagesPerRow: 4,
  aspectRatio: "1:1",
  resolution: "1K",
  outputFormat: "image/jpeg",
  style: "studio",
  instructions: "",
  groundWithSearch: false,
  brandingEnabled: false,
  brandColors: ["#111827", "#2563EB", "#F59E0B"],
  logoPath: null,
  brandGuidePath: null,
  sceneReferencePath: null,
};

export function getGalleryProjectSettingsFromWorksheet(
  worksheet: GalleryWorksheetJson
): GalleryProjectSettings {
  return {
    provider: worksheet.settings.provider,
    originalImageColumn: worksheet.originalImageColumn ?? null,
    originalImageSelectionExplicit:
      worksheet.originalImageSelectionExplicit ?? false,
    selectedColumns: [...worksheet.selectedColumns],
    scraping: parseScrapingSettings({
      ...DEFAULT_SCRAPING_SETTINGS,
      ...worksheet.settings.scraping,
      main: {
        ...DEFAULT_SCRAPING_SETTINGS.main,
        ...worksheet.settings.scraping?.main,
      },
    }),
    ai: parseAiSettings({
      ...DEFAULT_AI_SETTINGS,
      ...worksheet.settings.ai,
      main: {
        ...DEFAULT_AI_SETTINGS.main,
        ...worksheet.settings.ai?.main,
      },
    }),
  };
}

export function applyGalleryProjectSettings(
  worksheet: GalleryWorksheetJson,
  settings: GalleryProjectSettings
): GalleryWorksheetJson {
  return {
    ...worksheet,
    originalImageColumn: settings.originalImageColumn,
    originalImageSelectionExplicit: settings.originalImageSelectionExplicit,
    selectedColumns: [...settings.selectedColumns],
    settings: {
      provider: settings.provider,
      scraping: settings.scraping,
      ai: settings.ai,
    },
  };
}

function asSearchDepth(value: unknown): GallerySearchDepth {
  if (value === "low" || value === "high" || value === "medium") return value;
  return "medium";
}

/**
 * Normalize worksheet settings after load (migrates legacy `google` → `scraping`).
 */
export function normalizeGalleryWorksheet(
  worksheet: GalleryWorksheetJson
): GalleryWorksheetJson {
  const raw = (worksheet.settings ?? {}) as Partial<
    GalleryWorksheetJson["settings"]
  > & {
    google?: Partial<GalleryGoogleSettings>;
    scraping?: Partial<GalleryScrapingSettings>;
  };
  const legacy: Partial<GalleryGoogleSettings> = raw.google ?? {};
  const current: Partial<GalleryScrapingSettings> = raw.scraping ?? {};
  const merged = parseScrapingSettings({
    ...DEFAULT_SCRAPING_SETTINGS,
    ...legacy,
    ...current,
    main: {
      ...DEFAULT_SCRAPING_SETTINGS.main,
      ...(current.main || {}),
    },
    instructions: String(
      current.instructions ?? legacy.instructions ?? ""
    ).slice(0, 2_000),
    searchDepth: asSearchDepth(
      current.searchDepth ??
        (typeof legacy.candidates === "number"
          ? legacy.candidates >= 50
            ? "high"
            : legacy.candidates <= 10
              ? "low"
              : "medium"
          : "medium")
    ),
    sourcePolicy:
      current.sourcePolicy === "any" ||
      current.sourcePolicy === "official-only" ||
      current.sourcePolicy === "prefer-official"
        ? current.sourcePolicy
        : legacy.sourcePolicy === "any" ||
            legacy.sourcePolicy === "official-only" ||
            legacy.sourcePolicy === "prefer-official"
          ? legacy.sourcePolicy
          : DEFAULT_SCRAPING_SETTINGS.sourcePolicy,
    matchStrictness: "strict",
    duplicates: "avoid",
    imagesPerRow: Math.min(
      12,
      Math.max(
        1,
        Number(current.imagesPerRow ?? legacy.imagesPerRow ?? 4) || 4
      )
    ),
    minResolution: Math.min(
      5000,
      Math.max(
        0,
        Number(current.minResolution ?? legacy.minResolution ?? 1200) || 0
      )
    ),
    excludeMarketplaces:
      current.excludeMarketplaces ??
      legacy.excludeMarketplaces ??
      DEFAULT_SCRAPING_SETTINGS.excludeMarketplaces,
    aspectRatio: ["any", "square", "landscape", "portrait"].includes(
      String(current.aspectRatio || legacy.aspectRatio || "any")
    )
      ? String(current.aspectRatio || legacy.aspectRatio || "any")
      : "any",
  });

  const providerRaw = raw.provider as string | undefined;
  const provider: GalleryProvider =
    providerRaw === "ai"
      ? "ai"
      : providerRaw === "scraping" ||
          providerRaw === "google" ||
          !providerRaw
        ? "scraping"
        : "scraping";

  const activeRun = worksheet.activeRun
    ? {
        ...worksheet.activeRun,
        provider:
          worksheet.activeRun.provider === "ai"
            ? ("ai" as const)
            : ("scraping" as const),
      }
    : null;

  return {
    ...worksheet,
    rows: worksheet.rows.map((row) => {
      // Prefer mainImagePaths when present (including []). Only fall back to
      // legacy mainImagePath when the array field was never written.
      const mainImagePaths = Array.from(
        new Set(
          (Array.isArray(row.mainImagePaths)
            ? row.mainImagePaths
            : row.mainImagePath
              ? [row.mainImagePath]
              : []
          ).filter(Boolean)
        )
      );
      return {
        ...row,
        mainImagePaths,
        mainImagePath: mainImagePaths[0] ?? null,
      };
    }),
    activeRun,
    settings: {
      provider,
      scraping: merged,
      ai: parseAiSettings({
        ...DEFAULT_AI_SETTINGS,
        ...(raw.ai || {}),
        main: {
          ...DEFAULT_AI_SETTINGS.main,
          ...(raw.ai?.main || {}),
        },
      }),
    },
  };
}

export function createEmptyWorksheet(
  sessionId: string,
  columns: string[],
  rows: Array<{ id: string; rowIndex: number; originalData: Record<string, string> }>
): GalleryWorksheetJson {
  return {
    sessionId,
    columns,
    originalImageColumn: null,
    originalImageSelectionExplicit: false,
    selectedColumns: [...columns],
    settings: {
      provider: "scraping",
      scraping: { ...DEFAULT_SCRAPING_SETTINGS },
      ai: { ...DEFAULT_AI_SETTINGS },
    },
    activeRun: null,
    rows: rows.map((row) => ({
      ...row,
      status: "not_started",
      mainImagePaths: [],
      mainImagePath: null,
      galleryImagePaths: [],
    })),
  };
}
