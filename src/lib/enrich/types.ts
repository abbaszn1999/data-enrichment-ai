import type {
  CategoryItem,
  EnrichmentColumn,
  EnrichmentModel,
  ImageUrl,
  SessionKind,
  SourceUrl,
} from "@/types";
import type { AiCallCost } from "@/lib/ai-pricing";

/** Settings sent from the Import AI sidebar / API body. */
export interface EnrichSettings {
  enrichmentModel: EnrichmentModel;
  outputLanguage: string;
  /** The owner's method for every column of the run; a column's own instruction wins on conflict. */
  globalInstruction?: string;
}

/** Column config accepted by the enrich agent (subset of EnrichmentColumn). */
export type EnrichColumnConfig = Pick<
  EnrichmentColumn,
  | "id"
  | "label"
  | "description"
  | "type"
  | "enabled"
  | "imageCount"
  | "sourceCount"
  | "maxCategories"
  | "categoryFormat"
  | "useStoreCategories"
  | "itemCount"
  | "maxChars"
  | "customInstruction"
  | "allowedDomains"
  | "blockedDomains"
  | "lensMatchScope"
  | "lensProductPagesOnly"
  | "writingTone"
  | "contentLength"
>;

/** A page already found for the row (Source URLs / Image sources column). */
export interface KnownPage {
  url: string;
  title?: string;
}

export interface EnrichAgentResult {
  data: Record<string, unknown>;
  costs: AiCallCost[];
  /** Image Finder: which tiers ran for this row and which one found the images (recorded with the charge). */
  meta?: { tiersRun: string[]; foundBy?: string };
}

export interface EnrichAgentParams {
  productData: Record<string, string>;
  enabledColumns: string[];
  enrichmentColumns?: EnrichColumnConfig[];
  settings?: EnrichSettings;
  /** Defaults to "product" for callers predating the PLP mode. */
  kind?: SessionKind;
  cmsType?: string;
  workspaceCategories?: CategoryItem[];
  categoriesRawRows?: Record<string, string>[];
  /** Polled during the OpenAI call; returning true aborts it immediately (Stop). */
  shouldCancel?: () => Promise<boolean>;
  /** Image Finder: websites where other rows of this sheet were verified. */
  learnedDomains?: string[];
  /** Image Finder: final re-check of a row that ended Not found. */
  recheck?: boolean;
  /** Image Finder: pages from a ticked Source URLs / Image sources column, to open first. */
  knownPages?: KnownPage[];
  /** Images from selected image columns (Image Finder output, image URL columns), attached as vision input. */
  sourceImageUrls?: string[];
  /**
   * Kept by the caller across the row's attempts. When Source URLs ran next to
   * OpenAI columns and only the OpenAI call failed, the next attempt reuses this
   * Google answer (already charged with the failed attempt) instead of paying
   * for the same search again.
   */
  sourceUrlsMemo?: { result?: EnrichAgentResult };
}

export type OpenAiImageResult = {
  type?: string;
  image_url?: string;
  thumbnail_url?: string;
  source_website_url?: string;
  caption?: string;
};

export type OpenAiUrlSource = {
  type?: string;
  url?: string;
  title?: string;
};

export type OpenAiResponseItem = {
  type?: string;
  status?: string;
  results?: OpenAiImageResult[];
  action?: {
    type?: string;
    /** The page an `open_page` / `find_in_page` action read. */
    url?: string;
    query?: string;
    queries?: string[];
    results?: OpenAiImageResult[];
    sources?: OpenAiUrlSource[];
  };
  content?: Array<{
    type?: string;
    text?: string;
    annotations?: Array<{
      type?: string;
      url?: string;
      title?: string;
    }>;
  }>;
};

export type OpenAiResponse = {
  id?: string;
  status?: string;
  /** Present when `status` is "incomplete", e.g. `{ reason: "max_output_tokens" }`. */
  incomplete_details?: { reason?: string } | null;
  output?: OpenAiResponseItem[];
  usage?: unknown;
  error?: { message?: string; code?: string | null; type?: string };
};

export type ParsedEnrichImages = ImageUrl[];
export type ParsedEnrichSources = SourceUrl[];
