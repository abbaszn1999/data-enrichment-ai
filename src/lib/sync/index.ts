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
  ProviderSchema,
} from "./core/types";

export {
  getProvider,
  listProviders,
  isProviderSupported,
  getProviderSchema,
  getAllWritableColumns,
  PROVIDERS,
} from "./core/registry";
export { SyncError, AuthError, RateLimitError, ValidationError, TransientError } from "./core/errors";
