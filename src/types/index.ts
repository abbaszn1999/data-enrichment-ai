export interface ProductRow {
  id: string;
  dbId?: string; // Supabase row id (UUID)
  rowIndex: number;
  selected: boolean;
  status: "pending" | "processing" | "done" | "error";
  errorMessage?: string;
  originalData: Record<string, string>;
  enrichedData: Record<string, any>;
  matchType?: "existing" | "new" | null; // from import_rows.match_type
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
  type: "text" | "list" | "imageUrls" | "sourceUrls" | "categories"; // The expected output type from AI
  enabled: boolean;
  isCustom?: boolean;
  imageCount?: number; // Number of images to fetch (1-10), only for imageUrls type
  sourceCount?: number; // Number of sources to fetch (1-10), only for sourceUrls type
  maxCategories?: number; // Max number of categories to assign (1-5), only for categories type
  customInstruction?: string; // Custom instruction for this column
  writingTone?: WritingTone; // Per-column writing tone (for text columns like Enhanced Title, Marketing Description)
  contentLength?: ContentLength; // Per-column content length (for text columns like Enhanced Title, Marketing Description)
}

export const DEFAULT_ENRICHMENT_COLUMNS: EnrichmentColumn[] = [
  {
    id: "enhancedTitle",
    label: "Enhanced Title",
    description: "Write an SEO-optimized and compelling product title.",
    type: "text",
    enabled: true,
    writingTone: "professional",
    contentLength: "short",
  },
  {
    id: "marketingDescription",
    label: "Marketing Description",
    description: "Write a full, engaging marketing description for this product.",
    type: "text",
    enabled: true,
    writingTone: "persuasive",
    contentLength: "medium",
  },
  {
    id: "categories",
    label: "Categories",
    description: "Assign product categories based on available store categories or AI suggestion.",
    type: "categories",
    enabled: true,
    maxCategories: 3,
    customInstruction: "Pick the most relevant product categories",
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
    type: "sourceUrls",
    enabled: true,
    sourceCount: 3,
    customInstruction: "Find authoritative product pages and reviews",
  },
];

export interface EnrichmentEvent {
  type: "progress" | "row_complete" | "row_error" | "done" | "error";
  rowId: string;
  rowIndex: number;
  data?: Record<string, any>;
  error?: string;
  totalRows: number;
  completedRows: number;
}

export type OutputLanguage = "English" | "Arabic" | "French" | "Spanish" | "Turkish" | "German" | "Chinese" | "Japanese" | "custom";

export type EnrichmentModel = "gemini-3.1-pro-preview" | "gemini-3-flash-preview";

export type ThinkingLevelOption = "none" | "low" | "medium" | "high";

export type WritingTone = "professional" | "persuasive" | "simple" | "technical" | "custom";

export type ContentLength = "short" | "medium" | "long";

export interface EnrichmentSettings {
  outputLanguage: OutputLanguage;
  customLanguage: string;
  enrichmentModel: EnrichmentModel;
  thinkingLevel: ThinkingLevelOption;
}

export const DEFAULT_ENRICHMENT_SETTINGS: EnrichmentSettings = {
  outputLanguage: "English",
  customLanguage: "",
  enrichmentModel: "gemini-3.1-pro-preview",
  thinkingLevel: "low",
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
  { value: "gemini-3.1-pro-preview", label: "Pro", description: "Highest quality, slower", icon: "✨" },
  { value: "gemini-3-flash-preview", label: "Fast", description: "Fastest, lower cost", icon: "⚡" },
];

export const TONE_OPTIONS: { value: WritingTone; label: string; description: string }[] = [
  { value: "professional", label: "Professional", description: "Formal and business-like" },
  { value: "persuasive", label: "Persuasive", description: "Sales-focused, compelling" },
  { value: "simple", label: "Simple", description: "Clear and straightforward" },
  { value: "technical", label: "Technical", description: "Detailed and precise" },
  { value: "custom", label: "Custom...", description: "Your own instructions" },
];

export interface CategoryItem {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  originalId?: string | null; // Original CMS category_id (e.g. BigCommerce numeric id)
  parentName?: string;
  fullPath: string; // e.g. "Electronics > Smartphones"
  children?: CategoryItem[];
}

// CMS-specific category formatting rules
export interface CmsCategoryConfig {
  columnName: string; // What the column is called in this CMS
  hierarchySeparator: string; // Separator between parent > child
  multiCategorySeparator: string; // Separator between multiple categories
  supportsMultiple: boolean; // Can assign multiple categories?
  supportsHierarchy: boolean; // Supports parent/child paths?
  notes: string; // Extra formatting notes for AI
}

export const CMS_CATEGORY_CONFIG: Record<string, CmsCategoryConfig> = {
  shopify: {
    columnName: "Collection",
    hierarchySeparator: " > ",
    multiCategorySeparator: ", ",
    supportsMultiple: false, // Shopify CSV supports only 1 collection per row
    supportsHierarchy: true, // Product Category uses hierarchy
    notes: "Shopify uses 'Collection' for grouping products. Only ONE collection per product row in CSV. Product Category uses Shopify Standard Taxonomy with ' > ' separator (e.g. 'Home & Garden > Kitchen').",
  },
  woocommerce: {
    columnName: "Categories",
    hierarchySeparator: " > ",
    multiCategorySeparator: ", ",
    supportsMultiple: true,
    supportsHierarchy: true,
    notes: "WooCommerce uses comma to separate multiple categories and ' > ' for hierarchy. Example: 'Electronics, Electronics > Smartphones, Sale'.",
  },
  magento: {
    columnName: "categories",
    hierarchySeparator: "/",
    multiCategorySeparator: ",",
    supportsMultiple: true,
    supportsHierarchy: true,
    notes: "Magento uses '/' for hierarchy path and comma for multiple categories. Always start with 'Default Category/'. Example: 'Default Category/Electronics/Phones, Default Category/Sale'.",
  },
  bigcommerce: {
    columnName: "Category",
    hierarchySeparator: "/",
    multiCategorySeparator: "; ",
    supportsMultiple: true,
    supportsHierarchy: true,
    notes: "BigCommerce uses '/' for hierarchy and ';' to separate multiple categories. Example: 'Electronics/Phones; Sale Items'.",
  },
  prestashop: {
    columnName: "Categories (x,y,z...)",
    hierarchySeparator: " > ",
    multiCategorySeparator: ", ",
    supportsMultiple: true,
    supportsHierarchy: false, // PrestaShop CSV uses category names/IDs, not paths
    notes: "PrestaShop uses comma-separated category names. Example: 'Home, Electronics, Phones'.",
  },
  opencart: {
    columnName: "Categories",
    hierarchySeparator: " > ",
    multiCategorySeparator: ", ",
    supportsMultiple: true,
    supportsHierarchy: true,
    notes: "OpenCart uses ' > ' for hierarchy and comma for multiple categories. Example: 'Electronics > Phones, Sale'.",
  },
  salla: {
    columnName: "التصنيفات",
    hierarchySeparator: " > ",
    multiCategorySeparator: ", ",
    supportsMultiple: true,
    supportsHierarchy: true,
    notes: "Salla uses ' > ' for hierarchy and comma for multiple. Categories can be in Arabic. Example: 'إلكترونيات > هواتف ذكية, تخفيضات'.",
  },
  zid: {
    columnName: "التصنيف",
    hierarchySeparator: " > ",
    multiCategorySeparator: ", ",
    supportsMultiple: true,
    supportsHierarchy: true,
    notes: "Zid uses ' > ' for hierarchy and comma for multiple. Example: 'أجهزة > هواتف ذكية'.",
  },
  amazon: {
    columnName: "browse_nodes",
    hierarchySeparator: " > ",
    multiCategorySeparator: ", ",
    supportsMultiple: true,
    supportsHierarchy: true,
    notes: "Amazon uses browse node paths. Example: 'Electronics > Cell Phones & Accessories > Cell Phones'.",
  },
  noon: {
    columnName: "categories",
    hierarchySeparator: " > ",
    multiCategorySeparator: ", ",
    supportsMultiple: false,
    supportsHierarchy: true,
    notes: "Noon uses ' > ' for hierarchy path. Example: 'Electronics > Mobile Phones'.",
  },
};

// CMS-specific category sheet column names (for upload/import detection)
export interface CmsCategoryColumns {
  nameColumns: string[];    // Possible column names for category name
  parentColumns: string[];  // Possible column names for parent reference
  descColumns: string[];    // Possible column names for description
  idColumns: string[];      // Possible column names for category ID
  hint: string;             // Shown in upload dialog Step 1
}

export const CMS_CATEGORY_COLUMNS: Record<string, CmsCategoryColumns> = {
  bigcommerce: {
    nameColumns: ["name", "category_name"],
    parentColumns: ["parent_id", "parent_category_id"],
    descColumns: ["description", "page_description"],
    idColumns: ["category_id", "id"],
    hint: "BigCommerce: name, parent_id, description",
  },
  shopify: {
    nameColumns: ["title", "name", "collection"],
    parentColumns: ["parent_id", "handle"],
    descColumns: ["body_html", "description"],
    idColumns: ["id"],
    hint: "Shopify: title, parent_id, body_html",
  },
  woocommerce: {
    nameColumns: ["name", "category_name"],
    parentColumns: ["parent_id", "parent"],
    descColumns: ["description"],
    idColumns: ["id", "category_id"],
    hint: "WooCommerce: name, parent_id, description",
  },
  salla: {
    nameColumns: ["name", "الاسم", "اسم التصنيف"],
    parentColumns: ["parent_id"],
    descColumns: ["description", "الوصف"],
    idColumns: ["id"],
    hint: "Salla: name (أو الاسم), parent_id",
  },
  zid: {
    nameColumns: ["name", "الاسم", "اسم التصنيف"],
    parentColumns: ["parent_id"],
    descColumns: ["description", "الوصف"],
    idColumns: ["id"],
    hint: "Zid: name (أو الاسم), parent_id",
  },
  magento: {
    nameColumns: ["name", "category_name"],
    parentColumns: ["parent_id", "parent"],
    descColumns: ["description"],
    idColumns: ["entity_id", "id"],
    hint: "Magento: name, parent_id, entity_id",
  },
  custom: {
    nameColumns: ["name", "category_name", "title", "الاسم"],
    parentColumns: ["parent_id", "parent"],
    descColumns: ["description", "desc", "الوصف"],
    idColumns: ["id", "category_id", "entity_id"],
    hint: "يجب أن تحتوي الورقة على عمود name أو category_name",
  },
};

// Default config for unknown/custom CMS
export const DEFAULT_CMS_CATEGORY_CONFIG: CmsCategoryConfig = {
  columnName: "Categories",
  hierarchySeparator: " > ",
  multiCategorySeparator: ", ",
  supportsMultiple: true,
  supportsHierarchy: true,
  notes: "Use ' > ' for parent/child hierarchy and comma for multiple categories. Example: 'Electronics > Phones, Sale'.",
};

export interface SheetState {
  workspaceId: string | null;
  projectId: string | null;
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
  activeSheet: "existing" | "new";
  existingColumnsToEnrich: string[];
  existingColumnInstructions: Record<string, string>;
  undoVersion: number;
  saveStatus: "saved" | "saving" | "unsaved" | "error";
  lastSavedAt: number | null;
}
