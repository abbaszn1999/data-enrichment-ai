export type AdminPlanId = "free" | "starter" | "growth" | "pro";

export type AdminBillingCycle = "monthly" | "yearly";

export type AdminSubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "cancelled"
  | "expired"
  | "incomplete";

export type AdminMemberRole = "owner" | "admin" | "editor" | "viewer";

export type AdminUserStatus = "active" | "invited" | "disabled";

export type AdminCreditOperation =
  | "ai_enrichment"
  | "ai_image_search"
  | "ai_column_mapping"
  | "ai_category_suggest"
  | "ai_function"
  | "sync_agent"
  | "image_classification"
  | "gallery_google"
  | "gallery_ai"
  | "visualizer_description"
  | "visualizer_images"
  | "credit_topup"
  | "monthly_reset";

export type AdminWalletTxKind = "topup" | "charge" | "refund";

export type AdminWalletModule =
  | "market-research"
  | "Market Research"
  | "growth-sync"
  | "website-restructure"
  | "topup"
  | "Sync"
  | "Billing";

export type AdminJobKind = "catalog" | "gallery" | "visualizer";

export type AdminJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "paused_no_credits";

export type AdminIntegrationProvider = "shopify" | "woocommerce" | "wordpress";

export type AdminIntegrationStatus = "connected" | "error" | "disconnected";

export type AdminPlan = {
  id: AdminPlanId;
  displayName: string;
  monthlyCredits: number;
  priceMonthly: number;
  priceYearly: number;
};

export type AdminUser = {
  id: string;
  fullName: string;
  email: string;
  createdAt: string;
  lastSeenAt: string;
  status: AdminUserStatus;
};

export type AdminWorkspace = {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  createdAt: string;
  productCount: number;
};

export type AdminMember = {
  workspaceId: string;
  userId: string;
  role: AdminMemberRole;
  joinedAt: string;
};

export type AdminSubscription = {
  id: string;
  userId: string;
  planId: AdminPlanId;
  billingCycle: AdminBillingCycle;
  status: AdminSubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  creditsUsed: number;
  bonusCredits: number;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
};

export type AdminCreditTx = {
  id: string;
  createdAt: string;
  workspaceId: string;
  userId: string;
  operation: AdminCreditOperation;
  credits: number;
  remainingAfter: number;
};

export type AdminWallet = {
  workspaceId: string;
  balanceUsd: number;
};

export type AdminWalletTx = {
  id: string;
  createdAt: string;
  workspaceId: string;
  userId: string;
  kind: AdminWalletTxKind;
  module: AdminWalletModule;
  amountUsd: number;
  balanceAfter: number;
  description: string;
};

export type AdminJob = {
  id: string;
  createdAt: string;
  workspaceId: string;
  createdBy: string;
  kind: AdminJobKind;
  status: AdminJobStatus;
  completedCount: number;
  failedCount: number;
  total: number;
  lastError: string | null;
  durationMs: number | null;
};

export type AdminIntegration = {
  id: string;
  workspaceId: string;
  provider: AdminIntegrationProvider;
  storeName: string;
  baseUrl: string;
  status: AdminIntegrationStatus;
  lastSyncAt: string | null;
};

export type AdminAttentionKind =
  | "past_due"
  | "failed_job"
  | "low_credits"
  | "low_wallet"
  | "integration_error";

export type AdminAttentionItem = {
  id: string;
  kind: AdminAttentionKind;
  title: string;
  detail: string;
  href: string;
};

export type AdminOverviewRange = "7d" | "30d" | "90d";

export type AdminKpi = {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "warn" | "danger" | "ok";
};

export type AdminSpendSlice = {
  key: string;
  label: string;
  value: number;
};
