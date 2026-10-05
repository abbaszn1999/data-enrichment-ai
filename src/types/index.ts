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

/**
 * What a Catalog Intelligence session enriches:
 * - "product": supplier catalog rows matched against master products
 * - "plp": category / collection listing pages
 */
export type SessionKind = "product" | "plp";

export const DEFAULT_SESSION_KIND: SessionKind = "product";

export type EnrichmentColumnType =
  | "text"
  | "list"
  | "imageUrls"
  | "sourceUrls"
  | "categories"
  | "faq"
  | "internalLinks"
  | "keywords";

export interface FaqItem {
  question: string;
  answer: string;
}

/**
 * How the agent writes categories when it suggests them (no store list, or
 * the user turned the store list off):
 * - collections: flat names, "A, B" (Shopify collections)
 * - flat: flat names, "A, B" (WooCommerce, no hierarchy)
 * - depth2: "Category > Sub category", up to 2 levels
 * - depth3: "Category > Sub > Sub sub", up to 3 levels
 */
export type CategoryFormat = "collections" | "flat" | "depth2" | "depth3";

/** Which Google Lens results fill the Lens founds column. */
export type LensMatchScope = "exact" | "exact_and_visual";

export interface EnrichmentColumn {
  id: string;
  label: string;
  description: string; // This will serve as the AI Prompt instruction
  type: EnrichmentColumnType; // The expected output type from AI
  enabled: boolean;
  isCustom?: boolean;
  imageCount?: number; // Number of images to fetch (1-10), only for imageUrls type
  sourceCount?: number; // Number of sources to fetch (1-10), only for sourceUrls type
  maxCategories?: number; // Max number of categories to assign (1-5), only for categories type
  categoryFormat?: CategoryFormat; // Categories mode, agent-suggested output format (see categoryFormatsFor)
  useStoreCategories?: boolean; // Categories mode: classify into the Categories tab list when it has entries (default true)
  itemCount?: number; // Number of items to return, for faq / internalLinks / keywords types
  maxChars?: number; // Hard character budget enforced server-side (SEO meta limits)
  customInstruction?: string; // Custom instruction for this column
  allowedDomains?: string[]; // Image Finder: only use these websites (max 100, subdomains included)
  blockedDomains?: string[]; // Image Finder: never use these websites (max 100)
  lensMatchScope?: LensMatchScope; // Lens founds: exact matches only (default) or exact plus visual matches
  writingTone?: WritingTone; // Per-column writing tone (for text columns)
  contentLength?: ContentLength; // Per-column content length (for text columns)
}

export const DEFAULT_ENRICHMENT_COLUMNS: EnrichmentColumn[] = [
  // A new sheet starts with every Enrichment column switched off; they are
  // listed and ready to enable. The five Enrich defaults carry no tone / length / limit knobs: the only
  // thing a user sets per column is a custom instruction. `description` is the
  // built-in brief the agent always receives. Each default also ships with a
  // starting `customInstruction`, shown in the column's settings so the user
  // can read it and change it. The wording stays consistent with the built-in
  // rules in lib/enrich/columns, which still apply on top.
  {
    id: "titleTag",
    label: "Title tag",
    description: "Write the SEO title tag (HTML <title>) for this product page.",
    type: "text",
    enabled: false,
    customInstruction:
      "Write a clear SEO title of 50-60 characters. Start with the main product keyword, then the brand and model when they are known. Plain text, no quotes or HTML.",
  },
  {
    // Id kept from before the rename so existing sessions keep their data.
    id: "marketingDescription",
    label: "Product description",
    description: "Write a full, engaging product description for this product.",
    type: "text",
    enabled: false,
    customInstruction:
      "Write 2-3 short paragraphs (about 120-180 words). Say what the product is, its key features and benefits, and who it is for. Use only facts from the row data, the images or search results.",
  },
  {
    id: "productSpecifications",
    label: "Product specifications",
    description: "List the product's technical specifications as Attribute: Value pairs.",
    type: "list",
    enabled: false,
    customInstruction:
      "List the key technical specifications as Attribute: Value, most important first. Use the manufacturer's units and wording. Leave out anything you cannot confirm.",
  },
  {
    id: "faq",
    label: "FAQ section",
    description: "Write frequently asked questions with answers about this product.",
    type: "faq",
    enabled: false,
    itemCount: 5,
    customInstruction:
      "Write 5 questions a shopper would really ask about this product (fit, compatibility, materials, care, use, what is included). Answer each in 1-3 sentences. No prices, stock or delivery claims.",
  },
  {
    id: "sourceUrls",
    label: "Source URLs",
    description: "The web pages for this exact product.",
    type: "sourceUrls",
    // Runs from the "Source & Image Finder" tab, not the Enrichment list; like
    // Image URLs, `enabled` only controls whether the column shows in the grid,
    // and it appears once it has been generated. See lib/enrich/source-urls.
    enabled: false,
    customInstruction:
      "Return the manufacturer's own product page first, then trusted retailers that sell this exact item. Only real, working product pages.",
  },
  {
    id: "categories",
    label: "Categories",
    description: "Assign product categories based on available store categories or AI suggestion.",
    type: "categories",
    enabled: false,
    maxCategories: 3,
    customInstruction: "Pick the most relevant product categories",
  },
  {
    id: "imageUrls",
    label: "Image URLs",
    description: "Find product images from the web using OpenAI web image search.",
    type: "imageUrls",
    enabled: false,
    imageCount: 3,
    customInstruction: "Find high-quality product images, preferably on white background",
  },
  {
    id: "imageSourceUrls",
    label: "Image sources",
    description: "The product pages the found images came from. Filled by Image Finder.",
    type: "sourceUrls",
    enabled: false,
    sourceCount: 10,
  },
  {
    id: "lensFounds",
    label: "Lens founds",
    description: "Pages Google Lens found for the product picture. Filled by the Lens finder.",
    type: "sourceUrls",
    enabled: false,
    sourceCount: 10,
    lensMatchScope: "exact",
  },
];

/**
 * PLP (category page) output columns. The first eight are on by default; the
 * rest are opt-in. There is deliberately no imageUrls column here — web image
 * search returns product packshots, which are wrong for a listing page banner.
 */
export const PLP_ENRICHMENT_COLUMNS: EnrichmentColumn[] = [
  {
    id: "seoTitle",
    label: "SEO Title",
    description:
      "Write the meta title (title tag) for this category listing page.",
    type: "text",
    enabled: true,
    maxChars: 60,
    writingTone: "professional",
    contentLength: "short",
  },
  {
    id: "metaDescription",
    label: "Meta Description",
    description:
      "Write the meta description for this category listing page, ending with a soft call to action.",
    type: "text",
    enabled: true,
    maxChars: 160,
    writingTone: "persuasive",
  },
  {
    id: "h1",
    label: "H1 Heading",
    description:
      "Write the on-page H1 heading. It should read naturally for shoppers and may differ from the meta title.",
    type: "text",
    enabled: true,
    maxChars: 70,
    writingTone: "professional",
  },
  {
    id: "introCopy",
    label: "Intro Copy",
    description:
      "Write the short introduction shown above the product grid (roughly 40-80 words).",
    type: "text",
    enabled: true,
    maxChars: 600,
    writingTone: "persuasive",
    contentLength: "short",
  },
  {
    id: "seoCopy",
    label: "SEO Copy",
    description:
      "Write the longer supporting copy shown below the product grid (roughly 300-600 words), organised into short paragraphs.",
    type: "text",
    enabled: true,
    writingTone: "professional",
    contentLength: "long",
  },
  {
    id: "targetKeyword",
    label: "Target Keyword",
    description:
      "Identify the single primary search keyword this category page should rank for.",
    type: "text",
    enabled: true,
    maxChars: 80,
  },
  {
    id: "secondaryKeywords",
    label: "Secondary Keywords",
    description:
      "List supporting keywords and close variants this page should also cover.",
    type: "keywords",
    enabled: true,
    itemCount: 5,
  },
  {
    id: "faq",
    label: "FAQ",
    description:
      "Write frequently asked questions with answers for this category, suitable for FAQPage structured data.",
    type: "faq",
    enabled: true,
    itemCount: 4,
  },
  {
    id: "parentCategory",
    label: "Parent Category",
    description:
      "Pick the parent category this page belongs under, from the store category list.",
    type: "categories",
    enabled: false,
    maxCategories: 1,
  },
  {
    id: "internalLinks",
    label: "Internal Links",
    description:
      "Suggest related sibling or child categories to link to from this page.",
    type: "internalLinks",
    enabled: false,
    itemCount: 5,
  },
  {
    id: "slug",
    label: "URL Slug",
    description:
      "Write the URL slug for this category page: lowercase words separated by hyphens, no spaces or punctuation.",
    type: "text",
    enabled: false,
    maxChars: 75,
  },
  {
    id: "breadcrumbLabel",
    label: "Breadcrumb Label",
    description:
      "Write a very short label for this category in breadcrumb navigation.",
    type: "text",
    enabled: false,
    maxChars: 30,
  },
  {
    id: "sourceUrls",
    label: "Source URLs",
    description: "Web sources used to research this category page.",
    type: "sourceUrls",
    enabled: false,
    sourceCount: 3,
    customInstruction:
      "Find competitor category pages and authoritative references",
  },
];

/** Default output columns for a session, by kind. */
export function getDefaultEnrichmentColumns(
  kind: SessionKind | null | undefined
): EnrichmentColumn[] {
  const source =
    kind === "plp" ? PLP_ENRICHMENT_COLUMNS : DEFAULT_ENRICHMENT_COLUMNS;
  return source.map((col) => ({ ...col }));
}

/**
 * Product columns that run from their own Catalog Intelligence mode rather
 * than the Enrichment list. Their `enabled` flag only controls grid visibility.
 */
export const PRODUCT_MODE_COLUMN_IDS = {
  categories: "categories",
  images: "imageUrls",
} as const;

/**
 * Image Finder always writes a second column next to Image URLs: the product
 * pages the images came from (clickable links). It is filled by the Image
 * Finder run itself, never selected in the Enrichment list, and its id is
 * distinct from the Enrichment-mode `sourceUrls` column.
 */
export const IMAGE_SOURCES_COLUMN_ID = "imageSourceUrls";

export type CatalogSidebarMode = "enrich" | keyof typeof PRODUCT_MODE_COLUMN_IDS;

export function isProductModeColumn(
  id: string,
  kind: SessionKind | null | undefined
): boolean {
  return (
    kind !== "plp" &&
    (id === PRODUCT_MODE_COLUMN_IDS.categories ||
      id === PRODUCT_MODE_COLUMN_IDS.images ||
      id === IMAGE_SOURCES_COLUMN_ID ||
      id === LENS_FOUNDS_COLUMN_ID ||
      // Source URLs runs from the "Source & Image Finder" tab, not the Enrichment list.
      id === SOURCE_URLS_COLUMN_ID)
  );
}

/**
 * The "Lens founds" column of the Source & Image Finder tab: the pages Google
 * Lens matched to a sheet picture. Same `{uri, title}` shape as Source URLs,
 * matched by this id.
 */
export const LENS_FOUNDS_COLUMN_ID = "lensFounds";

/**
 * Sessions saved before the Lens finder existed lack the column. Adds it,
 * switched OFF, right after Image sources (or at the end); leaves PLP sessions
 * and sheets that already have it alone.
 */
export function ensureLensFoundsColumn(
  columns: EnrichmentColumn[],
  kind: SessionKind | null | undefined
): EnrichmentColumn[] {
  if (kind === "plp" || columns.some((col) => col.id === LENS_FOUNDS_COLUMN_ID)) return columns;
  const template = DEFAULT_ENRICHMENT_COLUMNS.find((col) => col.id === LENS_FOUNDS_COLUMN_ID);
  if (!template) return columns;
  const after = columns.findIndex((col) => col.id === IMAGE_SOURCES_COLUMN_ID);
  const entry = { ...template, enabled: false };
  if (after < 0) return [...columns, entry];
  return [...columns.slice(0, after + 1), entry, ...columns.slice(after + 1)];
}

/**
 * Sessions saved before the Image sources column existed (and presets that
 * predate it) lack it. Adds it right after Image URLs so Image Finder always
 * has a place to write; leaves PLP sessions and columns already present alone.
 */
export function ensureImageSourcesColumn(
  columns: EnrichmentColumn[],
  kind: SessionKind | null | undefined
): EnrichmentColumn[] {
  if (kind === "plp" || columns.some((col) => col.id === IMAGE_SOURCES_COLUMN_ID)) return columns;
  const template = DEFAULT_ENRICHMENT_COLUMNS.find((col) => col.id === IMAGE_SOURCES_COLUMN_ID);
  if (!template) return columns;
  const at = columns.findIndex((col) => col.id === PRODUCT_MODE_COLUMN_IDS.images);
  if (at < 0) return columns;
  return [...columns.slice(0, at + 1), { ...template }, ...columns.slice(at + 1)];
}

/**
 * The "Source URLs" column of the Source & Image Finder tab (found with Google
 * AI Mode). Matched by this id, never by the `sourceUrls` type, which Image
 * sources shares.
 */
export const SOURCE_URLS_COLUMN_ID = "sourceUrls";

/**
 * Sessions saved before the Source URLs column existed (and presets that
 * predate it) lack the column. Adds it, switched OFF so nothing changes
 * for that session, next to the other content columns; leaves PLP sessions and
 * sheets that already have it alone.
 */
export function ensureSourceUrlsColumn(
  columns: EnrichmentColumn[],
  kind: SessionKind | null | undefined
): EnrichmentColumn[] {
  if (kind === "plp" || columns.some((col) => col.id === SOURCE_URLS_COLUMN_ID)) return columns;
  const template = DEFAULT_ENRICHMENT_COLUMNS.find((col) => col.id === SOURCE_URLS_COLUMN_ID);
  if (!template) return columns;
  const after = columns.findIndex((col) => col.id === "faq");
  const at = after >= 0 ? after + 1 : columns.findIndex((col) => col.id === PRODUCT_MODE_COLUMN_IDS.categories);
  const entry = { ...template, enabled: false };
  if (at < 0) return [...columns, entry];
  return [...columns.slice(0, at), entry, ...columns.slice(at)];
}

/** Which sidebar mode a run belongs to, from the column ids it generates. */
export function catalogModeForRunColumns(
  tab: "existing" | "new" | null,
  columnIds: string[]
): CatalogSidebarMode {
  if (tab === "new" && columnIds.length === 1 && columnIds[0] === PRODUCT_MODE_COLUMN_IDS.categories) {
    return "categories";
  }
  // The "Source & Image Finder" tab: Images (with its Image sources column),
  // Source URLs, or Lens founds. Runs made before the three became exclusive
  // may hold Images and Source URLs together; they still belong to this tab.
  if (
    tab === "new" &&
    columnIds.some(
      (id) =>
        id === PRODUCT_MODE_COLUMN_IDS.images || id === SOURCE_URLS_COLUMN_ID || id === LENS_FOUNDS_COLUMN_ID
    ) &&
    columnIds.every(
      (id) =>
        id === PRODUCT_MODE_COLUMN_IDS.images ||
        id === IMAGE_SOURCES_COLUMN_ID ||
        id === SOURCE_URLS_COLUMN_ID ||
        id === LENS_FOUNDS_COLUMN_ID
    )
  ) {
    return "images";
  }
  return "enrich";
}

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

/**
 * Tier label kept for saved settings. Image Finder has a single agent and no
 * depth choice; "exact" and "premium" only survive as labels on rows found
 * before that.
 */
export type EnrichmentModel = "standard" | "premium" | "exact";

/**
 * Map legacy Gemini / OpenAI ids saved in presets to current tiers.
 * Pro / Sol → premium; Fast / Terra / unknown (including a leftover "exact"
 * from before Image Finder became automatic) → standard.
 */
export function resolveEnrichmentModel(
  model: string | null | undefined
): EnrichmentModel {
  if (
    model === "premium" ||
    model === "gemini-3.1-pro-preview" ||
    model === "gpt-5.6-sol"
  ) {
    return "premium";
  }
  // standard | gemini flash | terra | unknown → standard
  return "standard";
}

/** @deprecated Kept for preset backward compatibility; Import AI ignores this. */
export type ThinkingLevelOption = "none" | "low" | "medium" | "high";

export type WritingTone = "professional" | "persuasive" | "simple" | "technical" | "custom";

export type ContentLength = "short" | "medium" | "long";

/** The outputs the "Source & Image Finder" tab can fill. */
export type FinderOutput = "sourceUrls" | "images" | "lens";

/** What a new sheet's Source & Image Finder tab runs until the user switches something on or off. */
export const DEFAULT_FINDER_OUTPUTS: FinderOutput[] = ["images"];

const FINDER_OUTPUT_VALUES: readonly FinderOutput[] = ["sourceUrls", "images", "lens"];

/**
 * Images, Source URLs and Lens never run together. Keeps exactly one: a single
 * saved value as is; an old Images + Source URLs combination becomes Images;
 * nothing valid falls back to the default. An empty list stays empty (all off).
 */
export function normalizeFinderOutputs(outputs: readonly unknown[] | null | undefined): FinderOutput[] {
  if (!Array.isArray(outputs)) return [...DEFAULT_FINDER_OUTPUTS];
  const valid = outputs.filter((o): o is FinderOutput => FINDER_OUTPUT_VALUES.includes(o as FinderOutput));
  if (valid.length === 0) return outputs.length === 0 ? [] : [...DEFAULT_FINDER_OUTPUTS];
  if (valid.length === 1) return valid;
  if (valid.includes("images")) return ["images"];
  return [valid[0]];
}

export interface EnrichmentSettings {
  /** Source & Image Finder tab: which outputs to run. Missing means DEFAULT_FINDER_OUTPUTS. */
  finderOutputs?: FinderOutput[];
  /**
   * Lens finder: the one column that holds the product pictures. Kept apart
   * from the multi-select source columns so switching Lens off leaves those
   * choices as they were.
   */
  lensImageColumn?: string;
  outputLanguage: OutputLanguage;
  customLanguage: string;
  /** Enrichment: the owner's method for every column (how to research, what to trust). A column's own instruction wins on conflict. */
  globalInstruction?: string;
  enrichmentModel: EnrichmentModel;
  /** @deprecated Ignored by OpenAI enrich agent; tier drives reasoning effort. */
  thinkingLevel: ThinkingLevelOption;
}

export interface EnrichmentPresetSettings {
  sourceColumns: string[];
  enrichmentColumns: EnrichmentColumn[];
  enrichmentSettings: EnrichmentSettings;
}

export interface EnrichmentPreset {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Presets saved before the product/plp split have no kind and count as product. */
  kind?: SessionKind;
  settings: EnrichmentPresetSettings;
}

export const DEFAULT_ENRICHMENT_SETTINGS: EnrichmentSettings = {
  outputLanguage: "English",
  customLanguage: "",
  enrichmentModel: "standard",
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
  { value: "standard", label: "Standard", description: "Balanced quality and cost", icon: "⚡" },
  { value: "premium", label: "Premium", description: "Highest quality, deeper search", icon: "✨" },
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
    supportsMultiple: true, // A product can belong to many collections
    supportsHierarchy: false, // Collections are a flat list; there are no parent collections
    notes: "Shopify groups products into flat collections (no parents, no ' > ' paths). A product can be in several collections; write them as a comma-separated list of collection names.",
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
    parentColumns: [], // Shopify collections are flat: there are no parents
    descColumns: ["body (html)", "body_html", "description"],
    idColumns: ["handle", "id"],
    hint: "Shopify collections, one per row: Title (required), Handle, Description. Collections are flat, so there is no parent column.",
  },
  woocommerce: {
    nameColumns: ["name", "category_name", "path", "category path", "full path"],
    parentColumns: ["parent", "parent_id", "parent category"],
    descColumns: ["description"],
    idColumns: ["id", "slug", "category_id"],
    hint: "WooCommerce: either Name, Slug, Parent, Description (Parent can be a name, slug or full path like A > B) or a single Path column like A > B > C (missing parents are created).",
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

/** Mirrors lib/sheet/column-layout.ts's ColumnLayout (kept local to avoid a cross-import). */
export interface ColumnLayout {
  order: string[];
  hidden: string[];
}

export interface SheetState {
  workspaceId: string | null;
  projectId: string | null;
  /** What this session enriches; drives columns, prompts and table labels. */
  sessionKind: SessionKind;
  /** Step 2 was skipped, so autosave must not drop that decision. */
  matchingSkipped: boolean;
  /**
   * When set, the enrich sheet shows one row per product and hides variant
   * siblings. `null` means grouping is off.
   */
  productGroupColumn: string | null;
  fileName: string | null;
  rows: ProductRow[];
  originalColumns: string[];
  sourceColumns: string[];
  enrichmentColumns: EnrichmentColumn[];
  enrichmentSettings: EnrichmentSettings;
  columnVisibility: Record<string, boolean>;
  /**
   * Full sheet layout across source AND AI columns, keyed `orig:<name>` /
   * `enrich:<id>`. Missing/new keys append in their natural position; see
   * lib/sheet/column-layout.ts. Hiding an AI column here never disables it
   * for enrichment — that stays in `enrichmentColumns[].enabled`.
   */
  columnLayout: ColumnLayout;
  selectedRowIds: Set<string>;
  isEnriching: boolean;
  isPaused: boolean;
  /** Stop was requested; in-flight AI rows are draining and must not be autosaved over. */
  isStoppingEnrich: boolean;
  enrichProgress: number;
  totalToEnrich: number;
  completedEnrich: number;
  errorCount: number;
  sidebarOpen: boolean;
  activeSheet: "existing" | "new";
  /** Which sidebar tool is open; saved with the sheet so it reopens as left. */
  sidebarMode: CatalogSidebarMode;
  existingColumnsToEnrich: string[];
  existingColumnInstructions: Record<string, string>;
  enrichingTab: "existing" | "new" | null;
  enrichingExistingColumns: string[];
  /** AI column ids the active "new" run is generating; other columns keep their values on screen. */
  enrichingNewColumns: string[];
  undoVersion: number;
  saveStatus: "saved" | "saving" | "unsaved" | "error";
  lastSavedAt: number | null;
}
