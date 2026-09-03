import { CATALOG_INTELLIGENCE, STORE_ASSISTANT } from "@/lib/product-modules";
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
  catalog_intelligence: CATALOG_INTELLIGENCE.label,
  ai_image_search: "AI Image Search",
  ai_column_mapping: "Column Mapping",
  ai_category_suggest: "Category Suggest",
  ai_function: "AI Function",
  store_assistant: STORE_ASSISTANT.label,
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
  "growth-sync": "Growth Sync",
  "website-restructure": "Website Restructure",
  topup: "Wallet Top-up",
  Billing: "Billing",
};

export const WALLET_KIND_LABELS: Record<AdminWalletTxKind, string> = {
  topup: "Top-up",
  charge: "Charge",
  refund: "Refund",
};

export const JOB_KIND_LABELS: Record<AdminJobKind, string> = {
  catalog: CATALOG_INTELLIGENCE.label,
  gallery: "Gallery",
  visualizer: "Visualizer",
  mr_extract: "Market Research",
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

export const ACTIVITY_ENTITY_LABELS: Record<string, string> = {
  catalog_intelligence: CATALOG_INTELLIGENCE.label,
  store_assistant: STORE_ASSISTANT.label,
  gallery_session: "Gallery",
  visualizer_session: "Visualizer",
  image_classification_session: "Image Classify",
};

export function creditOperationLabel(operation: string): string {
  return CREDIT_OPERATION_LABELS[operation as AdminCreditOperation] ?? operation;
}

export function walletModuleLabel(module: string): string {
  if (!module) return "—";
  return WALLET_MODULE_LABELS[module as AdminWalletModule] ?? module;
}

export function activityEntityLabel(entityType: string | null | undefined): string {
  if (!entityType) return "—";
  return ACTIVITY_ENTITY_LABELS[entityType] ?? entityType;
}
