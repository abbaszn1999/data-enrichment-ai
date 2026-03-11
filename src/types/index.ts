export interface ProductRow {
  id: string;
  rowIndex: number;
  selected: boolean;
  status: "pending" | "processing" | "done" | "error";
  errorMessage?: string;
  originalData: Record<string, string>;
  enrichedData: Record<string, any>;
}

export interface EnrichedData {
  [key: string]: any;
}

export interface SourceUrl {
  title: string;
  uri: string;
}

export interface ImageUrl {
  imageUrl: string;
  pageUrl: string;
  title: string;
}

export interface ColumnMapping {
  original: string[];
  enriched: EnrichmentColumn[];
}

export interface EnrichmentColumn {
  id: string;
  label: string;
  description: string; // This will serve as the AI Prompt instruction
  type: "text" | "list" | "imageUrls"; // The expected output type from AI
  enabled: boolean;
  isCustom?: boolean;
  imageCount?: number; // Number of images to fetch (1-10), only for imageUrls type
  customInstruction?: string; // Custom search instruction for image search
}

export const DEFAULT_ENRICHMENT_COLUMNS: EnrichmentColumn[] = [
  {
    id: "enhancedTitle",
    label: "Enhanced Title",
    description: "Write an SEO-optimized and compelling product title.",
    type: "text",
    enabled: true,
  },
  {
    id: "marketingDescription",
    label: "Marketing Description",
    description: "Write a full, engaging marketing description for this product.",
    type: "text",
    enabled: true,
  },
  {
    id: "imageUrls",
    label: "Image URLs",
    description: "Find product images from the web using Google Image Search.",
    type: "imageUrls",
    enabled: true,
    imageCount: 3,
    customInstruction: "Find high-quality product images, preferably on white background",
  },
  {
    id: "sourceUrls",
    label: "Source URLs",
    description: "Web sources used to research this product.",
    type: "list",
    enabled: true,
  },
];

export interface EnrichmentEvent {
  type: "progress" | "row_complete" | "row_error" | "done";
  rowId: string;
  rowIndex: number;
  data?: Record<string, any>;
  error?: string;
  totalRows: number;
  completedRows: number;
}

export type OutputLanguage = "English" | "Arabic" | "French" | "Spanish" | "Turkish" | "German" | "Chinese" | "Japanese" | "custom";

export type EnrichmentModel = "gemini-3-flash-preview" | "gemini-3.1-pro-preview" | "gemini-3.1-flash-lite-preview";

export type ThinkingLevelOption = "none" | "low" | "medium" | "high";

export type WritingTone = "professional" | "persuasive" | "simple" | "technical" | "custom";

export type ContentLength = "short" | "medium" | "long";

export interface EnrichmentSettings {
  outputLanguage: OutputLanguage;
  customLanguage: string;
  enrichmentModel: EnrichmentModel;
  thinkingLevel: ThinkingLevelOption;
  writingTone: WritingTone;
  customTone: string;
  contentLength: ContentLength;
  maxRetries: number;
}

export const DEFAULT_ENRICHMENT_SETTINGS: EnrichmentSettings = {
  outputLanguage: "English",
  customLanguage: "",
  enrichmentModel: "gemini-3-flash-preview",
  thinkingLevel: "low",
  writingTone: "professional",
  customTone: "",
  contentLength: "medium",
  maxRetries: 2,
};

export const LANGUAGE_OPTIONS: { value: OutputLanguage; label: string; flag: string }[] = [
  { value: "English", label: "English", flag: "🇬🇧" },
  { value: "Arabic", label: "العربية", flag: "🇸🇦" },
  { value: "French", label: "Français", flag: "🇫🇷" },
  { value: "Spanish", label: "Español", flag: "🇪🇸" },
  { value: "Turkish", label: "Türkçe", flag: "🇹🇷" },
  { value: "German", label: "Deutsch", flag: "🇩🇪" },
  { value: "Chinese", label: "中文", flag: "🇨🇳" },
  { value: "Japanese", label: "日本語", flag: "🇯🇵" },
  { value: "custom", label: "Custom...", flag: "🌐" },
];

export const MODEL_OPTIONS: { value: EnrichmentModel; label: string; description: string; icon: string }[] = [
  { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", description: "Highest quality, slower", icon: "✨" },
  { value: "gemini-3-flash-preview", label: "Gemini 3 Flash", description: "Balanced speed & quality", icon: "⚡" },
  { value: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash-Lite", description: "Fastest, lower cost", icon: "💨" },
];

export const TONE_OPTIONS: { value: WritingTone; label: string; description: string }[] = [
  { value: "professional", label: "Professional", description: "Formal and business-like" },
  { value: "persuasive", label: "Persuasive", description: "Sales-focused, compelling" },
  { value: "simple", label: "Simple", description: "Clear and straightforward" },
  { value: "technical", label: "Technical", description: "Detailed and precise" },
  { value: "custom", label: "Custom...", description: "Your own instructions" },
];

export interface SheetState {
  fileName: string | null;
  rows: ProductRow[];
  originalColumns: string[];
  sourceColumns: string[];
  enrichmentColumns: EnrichmentColumn[];
  enrichmentSettings: EnrichmentSettings;
  columnVisibility: Record<string, boolean>;
  selectedRowIds: Set<string>;
  isEnriching: boolean;
  isPaused: boolean;
  enrichProgress: number;
  totalToEnrich: number;
  completedEnrich: number;
  errorCount: number;
  sidebarOpen: boolean;
  undoVersion: number;
}
