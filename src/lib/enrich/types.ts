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
  | "itemCount"
  | "maxChars"
  | "customInstruction"
  | "writingTone"
  | "contentLength"
>;

export interface EnrichAgentResult {
  data: Record<string, unknown>;
  costs: AiCallCost[];
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
  status?: string;
  output?: OpenAiResponseItem[];
  usage?: unknown;
  error?: { message?: string };
};

export type ParsedEnrichImages = ImageUrl[];
export type ParsedEnrichSources = SourceUrl[];
