import type {
  AdminAttentionItem,
  AdminBillingCycle,
  AdminIntegrationProvider,
  AdminIntegrationStatus,
  AdminJobKind,
  AdminJobStatus,
  AdminKpi,
  AdminMemberRole,
  AdminOverviewRange,
  AdminSpendSlice,
  AdminSubscriptionStatus,
  AdminWalletTxKind,
} from "./types";

export type LiveUserListRow = {
  id: string;
  fullName: string;
  email: string;
  createdAt: string;
  lastSeenAt: string | null;
  workspaceCount: number;
  planName: string | null;
  planId: string | null;
  subscriptionStatus: AdminSubscriptionStatus | null;
  status: "active" | "invited" | "disabled";
};

export type LiveWorkspaceListRow = {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  createdAt: string;
  memberCount: number;
  planName: string | null;
  planId: string | null;
  creditsRemaining: number | null;
  walletUsd: number;
  integrationProvider: string | null;
  integrationStatus: "connected" | "error" | "disconnected" | null;
};

export type LiveMember = {
  workspaceId: string;
  workspaceName: string;
  userId: string;
  fullName: string;
  email: string;
  role: AdminMemberRole;
  joinedAt: string;
};

export type LiveUserDetail = LiveUserListRow & {
  ownedWorkspaces: LiveWorkspaceListRow[];
  memberships: LiveMember[];
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  creditsUsed: number | null;
  bonusCredits: number | null;
  creditsRemaining: number | null;
  periodCredits: number | null;
  billingCycle: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export type LiveWorkspaceDetail = LiveWorkspaceListRow & {
  members: LiveMember[];
};

export type LiveOverviewPayload = {
  range: AdminOverviewRange;
  kpis: AdminKpi[];
  creditSlices: AdminSpendSlice[];
  walletSlices: AdminSpendSlice[];
  attention: AdminAttentionItem[];
};

export type LiveSubscriptionRow = {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  planId: string;
  planName: string;
  billingCycle: AdminBillingCycle;
  status: AdminSubscriptionStatus;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  creditsUsed: number;
  bonusCredits: number;
  monthlyCredits: number;
  periodCredits: number;
  remaining: number;
  mrr: number;
};

export type LiveCreditTxRow = {
  id: string;
  createdAt: string;
  userId: string;
  userName: string;
  workspaceId: string;
  workspaceName: string;
  operation: string;
  credits: number;
};

export type LiveWalletTxRow = {
  id: string;
  createdAt: string;
  workspaceId: string;
  workspaceName: string;
  userId: string | null;
  userName: string;
  kind: AdminWalletTxKind;
  module: string;
  amountUsd: number;
  description: string;
  status: string;
};

export type LiveJobRow = {
  id: string;
  createdAt: string;
  workspaceId: string;
  workspaceName: string;
  createdBy: string;
  actorName: string;
  kind: AdminJobKind;
  status: AdminJobStatus;
  completedCount: number;
  failedCount: number;
  total: number;
  lastError: string | null;
  durationMs: number | null;
};

export type LiveIntegrationRow = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  provider: AdminIntegrationProvider;
  storeName: string;
  baseUrl: string;
  status: AdminIntegrationStatus;
  lastSyncAt: string | null;
};

export type LiveIntegrationsPayload = {
  integrations: LiveIntegrationRow[];
  unconnected: { id: string; name: string }[];
};

export type LiveAuditRow = {
  id: string;
  createdAt: string;
  workspaceId: string;
  workspaceName: string;
  userId: string;
  userName: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
};
