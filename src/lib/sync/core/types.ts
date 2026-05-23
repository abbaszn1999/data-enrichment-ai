// Provider-agnostic core types for Sync engine.
// All providers (Shopify, WooCommerce, future CMSes) implement these interfaces.

export type SyncSheetRow = Record<string, unknown>;

export type SyncSheet = {
  title: string;
  columns: string[];
  rows: SyncSheetRow[];
};

export type SyncProviderId = "shopify" | "woocommerce" | string;

export type IntegrationRecord = {
  provider: SyncProviderId;
  integration_name: string;
  base_url?: string | null;
  config?: Record<string, unknown> | null;
};

export type ProviderTestResult = {
  provider: SyncProviderId;
  accountLabel: string;
  baseUrl: string;
  metadata?: Record<string, unknown>;
};

export type ApplyUpdate = {
  productId: string;
  row: SyncSheetRow;
  changedColumns: string[];
};

export type ApplyChangesInput = {
  integration: IntegrationRecord;
  creates: SyncSheetRow[];
  updates: ApplyUpdate[];
};

export type ApplyChangesResult = {
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  errors: string[];
};

export type FetchProductsOptions = {
  limit?: number; // 0 or negative = load all
};

export type ProviderCapabilities = {
  hasVariants: boolean;
  hasInventoryLevels: boolean;
  supportsBatch: boolean;
  batchLimit: number;
  supportsBidirectionalSync: boolean;
};

export type ProviderConfigField = {
  key: string;
  label: string;
  type: "text" | "password" | "url";
  placeholder?: string;
  required?: boolean;
  helpText?: string;
};

export interface SyncProvider {
  id: SyncProviderId;
  label: string;
  capabilities: ProviderCapabilities;
  /** Fields the user enters when connecting this provider. */
  configFields: ProviderConfigField[];
  /** Save: returns `{ baseUrl, config }` to persist after a successful test. */
  buildSavePayload(input: {
    config: Record<string, any>;
    testResult: ProviderTestResult;
  }): { baseUrl: string; config: Record<string, unknown> };
  /** Test connection. Throws on failure with a user-friendly message. */
  testConnection(config: Record<string, any>): Promise<ProviderTestResult>;
  /** Fetch products into a normalized SyncSheet. */
  fetchProductsSheet(
    integration: IntegrationRecord,
    options?: FetchProductsOptions
  ): Promise<SyncSheet>;
  /** Apply create/update changes back to the provider. */
  applyChanges(input: ApplyChangesInput): Promise<ApplyChangesResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// v3 Agent types (orchestrator + workers + evaluator)
// ─────────────────────────────────────────────────────────────────────────────

/** Operation class — decides scope cap and confirmation tier. */
export type AgentStrategy =
  | "read"
  | "light_write"
  | "medium_write"
  | "heavy_ai_write"
  | "delete"
  | "apply_to_shopify"
  | "reply";

/** Dynamic column profile — replaces static SHEET_VIEWS. */
export type ColumnProfileKey =
  | "core"
  | "pricing"
  | "seo"
  | "content"
  | "imagery"
  | "inventory"
  | "collections"
  | "publishing"
  | "taxonomy"
  | "translations"
  | "variants"
  | "metafields"
  | "all";

/** Server-side Shopify filter — only fields Shopify supports natively. */
export type ShopifyServerFilter = {
  status?: "ACTIVE" | "ARCHIVED" | "DRAFT";
  vendor?: string;
  productType?: string;
  tag?: string | string[];
  collectionId?: string;
  priceRange?: { min?: number; max?: number };
  inventoryRange?: { min?: number; max?: number };
  outOfStockSomewhere?: boolean;
  isPriceReduced?: boolean;
  giftCard?: boolean;
  createdAfter?: string;
  updatedAfter?: string;
  handle?: string;
  sku?: string;
  barcode?: string;
  metafield?: { namespace: string; key: string; value: string };
  publishedStatus?: "published" | "unpublished" | "any";
  freeText?: string;
};

/** Client-side predicate — applied after fetch. */
export type ClientPredicate =
  | { kind: "missing_image" }
  | { kind: "image_count_lt"; n: number }
  | { kind: "description_shorter_than"; chars: number }
  | { kind: "missing_seo_title" }
  | { kind: "missing_seo_description" }
  | { kind: "missing_alt_text" }
  | { kind: "title_matches"; regex: string }
  | { kind: "no_collections" }
  | { kind: "body_html_empty" };

/** Working memory — persists between messages in a sync session. */
export type SyncWorkingMemoryV2 = {
  lastTargetedRowIndexes: number[];
  lastCreatedRowIndexes: number[];
  lastTargetedProductIds: string[];
  lastServerFilter: ShopifyServerFilter | null;
  lastClientPredicates: ClientPredicate[] | null;
  lastCursor: string | null;
  lastBulkOperationId: string | null;
  totalMatchCount: number | null;
  remainingCount: number | null;
  lastColumnProfile: ColumnProfileKey | null;
  /** Current sheet entity — drives which tab set the UI renders. */
  lastEntity: "products" | "collections" | null;
  /** Tabs the UI should expose this turn (subset of COLUMN_PROFILES keys). */
  lastRelevantProfiles: ColumnProfileKey[] | null;
  lastTouchedColumns: string[];
  lastResearchSummary: string | null;
  lastResearchSubject: string | null;
  collectionsByName: Record<string, { id: string; handle: string }>;
  lastApplyStats: { created: number; updated: number; failed: number } | null;
  lastErrorRows: Array<{ rowIndex: number; reason: string }>;
  lastFilterDescription: string | null;
  lastActionType:
    | "append_row"
    | "target_rows"
    | "write_column"
    | "research_web"
    | "load_sheet"
    | "apply_to_shopify"
    | null;
  updatedAt: number | null;
};

export const EMPTY_SYNC_WORKING_MEMORY_V2: SyncWorkingMemoryV2 = {
  lastTargetedRowIndexes: [],
  lastCreatedRowIndexes: [],
  lastTargetedProductIds: [],
  lastServerFilter: null,
  lastClientPredicates: null,
  lastCursor: null,
  lastBulkOperationId: null,
  totalMatchCount: null,
  remainingCount: null,
  lastColumnProfile: null,
  lastEntity: null,
  lastRelevantProfiles: null,
  lastTouchedColumns: [],
  lastResearchSummary: null,
  lastResearchSubject: null,
  collectionsByName: {},
  lastApplyStats: null,
  lastErrorRows: [],
  lastFilterDescription: null,
  lastActionType: null,
  updatedAt: null,
};

/** A single step in the plan — tool name + args. */
export type AgentPlanStep = {
  tool: string;
  args: Record<string, unknown>;
};

/** Structured output of the supervisor planner. */
export type AgentPlanV2 = {
  strategy: AgentStrategy;
  scopeCap: number;
  columnProfile: ColumnProfileKey;
  relevantProfiles: ColumnProfileKey[] | null;
  serverFilter: ShopifyServerFilter | null;
  clientPredicates: ClientPredicate[] | null;
  steps: AgentPlanStep[];
  requiresConfirmation: boolean;
  costEstimate: number | null;
  scopeRationale: string;
  assistantMessage: string;
};

/** Decision returned by the reflection/evaluator step. */
export type ReflectionDecision =
  | { decision: "done"; rationale: string }
  | { decision: "retry"; rationale: string; delayMs?: number }
  | { decision: "narrow"; rationale: string; nextScopeCap: number }
  | { decision: "split"; rationale: string; batchSize: number }
  | { decision: "ask"; rationale: string; question: string }
  | { decision: "stop"; rationale: string };

/** Shopify GraphQL cost info parsed from response extensions. */
export type ShopifyCostInfo = {
  requestedQueryCost: number;
  actualQueryCost: number | null;
  throttleStatus: {
    maximumAvailable: number;
    currentlyAvailable: number;
    restoreRate: number;
  };
};

/** Result of a single Shopify GraphQL call. */
export type ShopifyGraphQLResult<T> = {
  data: T | null;
  errors: Array<{ message: string; extensions?: Record<string, unknown> }>;
  userErrors: Array<{ field: string[] | null; message: string; code?: string }>;
  cost: ShopifyCostInfo | null;
};

/** Tracer event shape (what we write to sync_agent_traces). */
export type AgentTraceEvent = {
  workspaceId: string;
  userId: string | null;
  runId: string;
  stepIndex: number;
  stepKind: "planner" | "tool" | "reflection";
  toolName: string | null;
  input: unknown;
  output: unknown;
  error: string | null;
  shopifyCostRequested: number | null;
  shopifyCostActual: number | null;
  shopifyThrottleAvailable: number | null;
  durationMs: number;
};
