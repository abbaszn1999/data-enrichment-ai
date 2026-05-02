// Public API for the sync engine. Consumers should import from here, not from
// individual provider folders.
export type {
  SyncSheet,
  SyncSheetRow,
  SyncProvider,
  SyncProviderId,
  IntegrationRecord,
  ApplyChangesInput,
  ApplyChangesResult,
  ApplyUpdate,
  FetchProductsOptions,
  ProviderTestResult,
  ProviderConfigField,
  ProviderCapabilities,
} from "./core/types";

export { getProvider, listProviders, isProviderSupported, PROVIDERS } from "./core/registry";
export { SyncError, AuthError, RateLimitError } from "./core/errors";
