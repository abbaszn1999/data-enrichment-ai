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
