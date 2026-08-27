import type {
  AdminCreditOperation,
  AdminIntegrationProvider,
  AdminJobKind,
  AdminJobStatus,
  AdminMemberRole,
  AdminSubscriptionStatus,
  AdminUserStatus,
  AdminWalletModule,
  AdminWalletTxKind,
} from "./types";

export const CREDIT_OPERATION_LABELS: Record<AdminCreditOperation, string> = {
  ai_enrichment: "AI Enrichment",
  ai_image_search: "AI Image Search",
  ai_column_mapping: "Column Mapping",
  ai_category_suggest: "Category Suggest",
  ai_function: "AI Function",
  sync_agent: "Sync Agent",
  image_classification: "Image Classify",
  gallery_google: "Gallery · Google",
  gallery_ai: "Gallery · AI",
  visualizer_description: "Visualizer · Description",
  visualizer_images: "Visualizer · Images",
  credit_topup: "Credit Top-up",
  monthly_reset: "Monthly Reset",
};

export const WALLET_MODULE_LABELS: Record<AdminWalletModule, string> = {
  "market-research": "Market Research",
  "Market Research": "Market Research",
  "growth-sync": "Growth Sync",
  "website-restructure": "Website Restructure",
  topup: "Wallet Top-up",
  Sync: "Sync",
  Billing: "Billing",
};

export const WALLET_KIND_LABELS: Record<AdminWalletTxKind, string> = {
  topup: "Top-up",
  charge: "Charge",
  refund: "Refund",
};

export const JOB_KIND_LABELS: Record<AdminJobKind, string> = {
  catalog: "Catalog",
  gallery: "Gallery",
  visualizer: "Visualizer",
};

export const JOB_STATUS_LABELS: Record<AdminJobStatus, string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  paused_no_credits: "Paused · no credits",
};

export const SUBSCRIPTION_STATUS_LABELS: Record<AdminSubscriptionStatus, string> = {
  active: "Active",
  trialing: "Trialing",
  past_due: "Past due",
  cancelled: "Cancelled",
  expired: "Expired",
  incomplete: "Incomplete",
};

export const USER_STATUS_LABELS: Record<AdminUserStatus, string> = {
  active: "Active",
  invited: "Invited",
  disabled: "Disabled",
};

export const ROLE_LABELS: Record<AdminMemberRole, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

export const PROVIDER_LABELS: Record<AdminIntegrationProvider, string> = {
  shopify: "Shopify",
  woocommerce: "WooCommerce",
  wordpress: "WordPress",
};

export const RANGE_LABELS = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
} as const;

export function creditOperationLabel(operation: string): string {
  return CREDIT_OPERATION_LABELS[operation as AdminCreditOperation] ?? operation;
}

export function walletModuleLabel(module: string): string {
  if (!module) return "—";
  return WALLET_MODULE_LABELS[module as AdminWalletModule] ?? module;
}
