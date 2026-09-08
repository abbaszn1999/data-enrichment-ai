import { CREDIT_TOPUP_USD_PER_CREDIT } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase-admin";
import { adminCreditBalance, unwrapRelation } from "./credit-balance";
import { creditOperationLabel, CREDIT_OPERATION_LABELS, JOB_KIND_LABELS, JOB_STATUS_LABELS, WALLET_KIND_LABELS, WALLET_MODULE_LABELS, walletModuleLabel, ACTIVITY_ENTITY_LABELS } from "./labels";
import {
  dateWindowSinceIso,
  keysMatchingLabel,
  lookupNames,
  pageRange,
  postgrestIlike,
  postgrestIn,
  postgrestOr,
  searchIdentityIds,
  looksLikeUuid,
  type LedgerPage,
  type LedgerParams,
} from "./ledger";
import { loadLiveDirectory } from "./live";
import { fetchAllRows } from "./live-query";
import type {
  LiveAuditRow,
  LiveCreditTxRow,
  LiveIntegrationRow,
  LiveIntegrationsPayload,
  LiveJobRow,
  LiveOverviewPayload,
  LiveSubscriptionRow,
  LiveWalletTxRow,
} from "./live-types";
import { adminRoutes } from "./paths";
import { buildOverviewSeries } from "./overview-series";
import type {
  AdminAttentionItem,
  AdminBillingCycle,
  AdminIntegrationProvider,
  AdminIntegrationStatus,
  AdminJobKind,
  AdminJobStatus,
  AdminKpi,
  AdminOverviewRange,
  AdminSpendSlice,
  AdminSubscriptionStatus,
  AdminWalletTxKind,
} from "./types";

const RANGE_DAYS: Record<AdminOverviewRange, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

const LOW_CREDIT_RATIO = 0.1;
const LOW_WALLET_USD = 5;

type PlanJoin = {
  name?: string;
  display_name?: string;
  monthly_ai_credits?: number;
  price_monthly?: number;
  price_yearly?: number;
};

type SubscriptionRow = {
  id: string;
  user_id: string;
  billing_cycle: string;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  credits_used: number | null;
  bonus_credits: number | null;
  subscription_plans: PlanJoin | PlanJoin[] | null;
};

type CreditRow = {
  id: string;
  created_at: string;
  workspace_id: string;
  user_id: string;
  operation: string;
  credits_used: number;
};

type WalletRow = {
  id: string;
  created_at: string;
  workspace_id: string;
  user_id: string | null;
  kind: string;
  amount_usd: number | string;
  description: string | null;
  module: string | null;
  status: string | null;
};

type JobRow = {
  id: string;
  created_at: string;
  updated_at: string | null;
  workspace_id: string;
  created_by: string;
  kind: string;
  status: string;
  target_ids: string[] | null;
  completed_count: number | null;
  failed_count: number | null;
  last_error: string | null;
};

type IntegrationRow = {
  id: string;
  workspace_id: string;
  provider: string;
  integration_name: string;
  base_url: string;
  status: string;
  updated_at: string | null;
};

type WalletBalanceRow = {
  workspace_id: string;
  balance_usd: number | string | null;
};

type AuditRow = {
  id: string;
  created_at: string;
  workspace_id: string;
  user_id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
};

function planOf(row: SubscriptionRow): PlanJoin {
  return unwrapRelation(row.subscription_plans) ?? {};
}

function subscriptionMrr(status: AdminSubscriptionStatus, cycle: string, monthly: number, yearly: number): number {
  if (status === "cancelled" || status === "expired" || status === "incomplete") return 0;
  return cycle === "yearly" ? yearly / 12 : monthly;
}

function formatKpiUsd(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function rangeStartIso(range: AdminOverviewRange): string {
  return new Date(Date.now() - RANGE_DAYS[range] * 86_400_000).toISOString();
}

export function parseOverviewRange(value: string | null): AdminOverviewRange {
  if (value === "7d" || value === "90d") return value;
  return "30d";
}

function mapSubscription(row: SubscriptionRow, nameById: Map<string, string>, emailById: Map<string, string>): LiveSubscriptionRow {
  const plan = planOf(row);
  const monthlyCredits = Number(plan.monthly_ai_credits ?? 0);
  const bonusCredits = Number(row.bonus_credits ?? 0);
  const creditsUsed = Number(row.credits_used ?? 0);
  const status = row.status as AdminSubscriptionStatus;
  const billingCycle = (row.billing_cycle === "yearly" ? "yearly" : "monthly") as AdminBillingCycle;
  const balance = adminCreditBalance({
    status,
    billingCycle,
    creditsUsed,
    bonusCredits,
    monthlyAiCredits: monthlyCredits,
  });
  return {
    id: row.id,
    userId: row.user_id,
    fullName: nameById.get(row.user_id) || row.user_id,
    email: emailById.get(row.user_id) || "",
    planId: plan.name || "unknown",
    planName: plan.display_name || plan.name || "Unknown",
    billingCycle,
    status,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    creditsUsed,
    bonusCredits,
    monthlyCredits,
    periodCredits: balance.periodCredits,
    remaining: balance.remaining,
    mrr: subscriptionMrr(status, billingCycle, Number(plan.price_monthly ?? 0), Number(plan.price_yearly ?? 0)),
  };
}

function mapCredit(row: CreditRow, nameById: Map<string, string>, workspaceNameById: Map<string, string>): LiveCreditTxRow {
  return {
    id: row.id,
    createdAt: row.created_at,
    userId: row.user_id,
    userName: nameById.get(row.user_id) || row.user_id,
    workspaceId: row.workspace_id,
    workspaceName: workspaceNameById.get(row.workspace_id) || row.workspace_id,
    operation: row.operation,
    credits: Number(row.credits_used ?? 0),
  };
}

function mapWallet(row: WalletRow, nameById: Map<string, string>, workspaceNameById: Map<string, string>): LiveWalletTxRow {
  const module = row.module || (row.kind === "topup" ? "topup" : "");
  return {
    id: row.id,
    createdAt: row.created_at,
    workspaceId: row.workspace_id,
    workspaceName: workspaceNameById.get(row.workspace_id) || row.workspace_id,
    userId: row.user_id,
    userName: row.user_id ? nameById.get(row.user_id) || row.user_id : "—",
    kind: row.kind as AdminWalletTxKind,
    module,
    amountUsd: Number(row.amount_usd ?? 0),
    description: row.description || "",
    status: row.status || "completed",
  };
}

function jobDurationMs(row: JobRow): number | null {
  const start = new Date(row.created_at).getTime();
  if (!Number.isFinite(start)) return null;
  const live = row.status === "queued" || row.status === "running";
  const end = live ? Date.now() : new Date(row.updated_at || row.created_at).getTime();
  if (!Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

function mapJob(row: JobRow, nameById: Map<string, string>, workspaceNameById: Map<string, string>): LiveJobRow {
  const completedCount = Number(row.completed_count ?? 0);
  const failedCount = Number(row.failed_count ?? 0);
  const total = Array.isArray(row.target_ids) ? row.target_ids.length : completedCount + failedCount;
  return {
    id: row.id,
    createdAt: row.created_at,
    workspaceId: row.workspace_id,
    workspaceName: workspaceNameById.get(row.workspace_id) || row.workspace_id,
    createdBy: row.created_by,
    actorName: nameById.get(row.created_by) || row.created_by,
    kind: row.kind as AdminJobKind,
    status: row.status as AdminJobStatus,
    completedCount,
    failedCount,
    total,
    lastError: row.last_error,
    durationMs: jobDurationMs(row),
  };
}

function mapIntegration(row: IntegrationRow, workspaceNameById: Map<string, string>): LiveIntegrationRow {
  const status = (row.status === "error" || row.status === "disconnected" ? row.status : "connected") as AdminIntegrationStatus;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: workspaceNameById.get(row.workspace_id) || row.workspace_id,
    provider: row.provider as AdminIntegrationProvider,
    storeName: row.integration_name,
    baseUrl: row.base_url,
    status,
    lastSyncAt: row.updated_at,
  };
}

async function loadSubscriptionsRaw() {
  const admin = createAdminClient();
  return fetchAllRows<SubscriptionRow>((from, to) =>
    admin
      .from("user_subscriptions")
      .select(
        "id, user_id, billing_cycle, status, current_period_end, cancel_at_period_end, credits_used, bonus_credits, created_at, subscription_plans(name, display_name, monthly_ai_credits, price_monthly, price_yearly)"
      )
      .order("created_at", { ascending: false })
      .range(from, to)
  );
}

async function loadCreditRows(sinceIso?: string) {
  const admin = createAdminClient();
  return fetchAllRows<CreditRow>((from, to) => {
    let query = admin
      .from("credit_transactions")
      .select("id, created_at, workspace_id, user_id, operation, credits_used")
      .order("created_at", { ascending: false });
    if (sinceIso) query = query.gte("created_at", sinceIso);
    return query.range(from, to);
  });
}

async function loadWalletRows(sinceIso?: string) {
  const admin = createAdminClient();
  return fetchAllRows<WalletRow>((from, to) => {
    let query = admin
      .from("wallet_transactions")
      .select("id, created_at, workspace_id, user_id, kind, amount_usd, description, module, status")
      .order("created_at", { ascending: false });
    if (sinceIso) query = query.gte("created_at", sinceIso);
    return query.range(from, to);
  });
}

async function loadJobRows(sinceIso?: string) {
  const admin = createAdminClient();
  return fetchAllRows<JobRow>((from, to) => {
    let query = admin
      .from("job_runs")
      .select(
        "id, created_at, updated_at, workspace_id, created_by, kind, status, target_ids, completed_count, failed_count, last_error"
      )
      .order("created_at", { ascending: false });
    if (sinceIso) query = query.gte("created_at", sinceIso);
    return query.range(from, to);
  });
}

const CREDIT_SORT: Record<string, string> = {
  when: "created_at",
  user: "user_id",
  workspace: "workspace_id",
  operation: "operation",
  credits: "credits_used",
};

const WALLET_SORT: Record<string, string> = {
  when: "created_at",
  workspace: "workspace_id",
  kind: "kind",
  module: "module",
  description: "description",
  amount: "amount_usd",
};

const JOB_SORT: Record<string, string> = {
  when: "created_at",
  workspace: "workspace_id",
  kind: "kind",
  status: "status",
  progress: "completed_count",
  duration: "updated_at",
  actor: "created_by",
  error: "last_error",
};

const AUDIT_SORT: Record<string, string> = {
  when: "created_at",
  user: "user_id",
  workspace: "workspace_id",
  action: "action",
  entity: "entity_type",
};

export type CreditLedgerQuery = LedgerParams & {
  operation: string;
  direction: string;
};

export type WalletLedgerQuery = LedgerParams & {
  kind: string;
  module: string;
};

export type JobLedgerQuery = LedgerParams & {
  status: string;
  kind: string;
  errorFilter: string;
};

export type AuditLedgerQuery = LedgerParams & {
  entity: string;
};

export async function loadLiveSubscriptions(): Promise<LiveSubscriptionRow[]> {
  const [directory, rows] = await Promise.all([loadLiveDirectory(), loadSubscriptionsRaw()]);
  return rows.map((row) => mapSubscription(row, directory.nameById, directory.emailById));
}

export async function loadLiveCredits(input: CreditLedgerQuery): Promise<LedgerPage<LiveCreditTxRow>> {
  const { page, pageSize, q, dateWindow, sort, operation, direction } = input;
  const { from, to } = pageRange(page, pageSize);
  const sinceIso = dateWindowSinceIso(dateWindow);
  const admin = createAdminClient();

  let searchOr: string | null = null;
  if (q) {
    const identities = await searchIdentityIds(q);
    const ops = keysMatchingLabel(q, CREDIT_OPERATION_LABELS);
    searchOr = postgrestOr([
      postgrestIn("user_id", identities.userIds),
      postgrestIn("workspace_id", identities.workspaceIds),
      postgrestIn("operation", ops),
      looksLikeUuid(q) ? `user_id.eq.${q}` : null,
    ]);
    if (!searchOr) return { rows: [], total: 0, page, pageSize };
  }

  let query = admin
    .from("credit_transactions")
    .select("id, created_at, workspace_id, user_id, operation, credits_used", { count: "exact" });
  if (operation !== "all") query = query.eq("operation", operation);
  if (direction === "spend") query = query.gt("credits_used", 0);
  if (direction === "credit") query = query.lt("credits_used", 0);
  if (sinceIso) query = query.gte("created_at", sinceIso);
  if (searchOr) query = query.or(searchOr);

  const column = CREDIT_SORT[sort.key] ?? "created_at";
  const ascending = sort.dir === "asc";
  const { data, error, count } = await query
    .order(column, { ascending })
    .order("id", { ascending })
    .range(from, to);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as CreditRow[];
  const names = await lookupNames(
    rows.map((row) => row.user_id),
    rows.map((row) => row.workspace_id)
  );
  return {
    rows: rows.map((row) => mapCredit(row, names.nameById, names.workspaceNameById)),
    total: count ?? rows.length,
    page,
    pageSize,
  };
}

export async function loadLiveWalletTransactions(input: WalletLedgerQuery): Promise<LedgerPage<LiveWalletTxRow>> {
  const { page, pageSize, q, dateWindow, sort, kind, module } = input;
  const { from, to } = pageRange(page, pageSize);
  const sinceIso = dateWindowSinceIso(dateWindow);
  const admin = createAdminClient();

  let searchOr: string | null = null;
  if (q) {
    const identities = await searchIdentityIds(q);
    searchOr = postgrestOr([
      postgrestIn("user_id", identities.userIds),
      postgrestIn("workspace_id", identities.workspaceIds),
      postgrestIn("kind", keysMatchingLabel(q, WALLET_KIND_LABELS)),
      postgrestIn("module", keysMatchingLabel(q, WALLET_MODULE_LABELS)),
      postgrestIlike("description", q),
      looksLikeUuid(q) ? `user_id.eq.${q}` : null,
    ]);
    if (!searchOr) return { rows: [], total: 0, page, pageSize };
  }

  let query = admin
    .from("wallet_transactions")
    .select("id, created_at, workspace_id, user_id, kind, amount_usd, description, module, status", { count: "exact" });
  if (kind !== "all") query = query.eq("kind", kind);
  if (module !== "all") query = query.eq("module", module);
  if (sinceIso) query = query.gte("created_at", sinceIso);
  if (searchOr) query = query.or(searchOr);

  const column = WALLET_SORT[sort.key] ?? "created_at";
  const ascending = sort.dir === "asc";
  const { data, error, count } = await query
    .order(column, { ascending })
    .order("id", { ascending })
    .range(from, to);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as WalletRow[];
  const names = await lookupNames(
    rows.map((row) => row.user_id).filter((id): id is string => Boolean(id)),
    rows.map((row) => row.workspace_id)
  );
  return {
    rows: rows.map((row) => mapWallet(row, names.nameById, names.workspaceNameById)),
    total: count ?? rows.length,
    page,
    pageSize,
  };
}

export async function loadLiveJobs(input: JobLedgerQuery): Promise<LedgerPage<LiveJobRow>> {
  const { page, pageSize, q, dateWindow, sort, status, kind, errorFilter } = input;
  const { from, to } = pageRange(page, pageSize);
  const sinceIso = dateWindowSinceIso(dateWindow);
  const admin = createAdminClient();

  let searchOr: string | null = null;
  if (q) {
    const identities = await searchIdentityIds(q);
    searchOr = postgrestOr([
      postgrestIn("created_by", identities.userIds),
      postgrestIn("workspace_id", identities.workspaceIds),
      postgrestIn("kind", keysMatchingLabel(q, JOB_KIND_LABELS)),
      postgrestIn("status", keysMatchingLabel(q, JOB_STATUS_LABELS)),
      postgrestIlike("last_error", q),
    ]);
    if (!searchOr) return { rows: [], total: 0, page, pageSize };
  }

  let query = admin
    .from("job_runs")
    .select(
      "id, created_at, updated_at, workspace_id, created_by, kind, status, target_ids, completed_count, failed_count, last_error",
      { count: "exact" }
    );
  if (status !== "all") query = query.eq("status", status);
  if (kind !== "all") query = query.eq("kind", kind);
  if (errorFilter === "yes") query = query.not("last_error", "is", null);
  if (errorFilter === "no") query = query.is("last_error", null);
  if (sinceIso) query = query.gte("created_at", sinceIso);
  if (searchOr) query = query.or(searchOr);

  const column = JOB_SORT[sort.key] ?? "created_at";
  const ascending = sort.dir === "asc";
  const { data, error, count } = await query
    .order(column, { ascending })
    .order("id", { ascending })
    .range(from, to);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as JobRow[];
  const names = await lookupNames(
    rows.map((row) => row.created_by),
    rows.map((row) => row.workspace_id)
  );
  return {
    rows: rows.map((row) => mapJob(row, names.nameById, names.workspaceNameById)),
    total: count ?? rows.length,
    page,
    pageSize,
  };
}

export async function loadLiveIntegrations(): Promise<LiveIntegrationsPayload> {
  const admin = createAdminClient();
  const [directory, rows] = await Promise.all([
    loadLiveDirectory(),
    fetchAllRows<IntegrationRow>((from, to) =>
      admin
        .from("workspace_integrations")
        .select("id, workspace_id, provider, integration_name, base_url, status, updated_at")
        .order("updated_at", { ascending: false })
        .range(from, to)
    ),
  ]);
  const integrations = rows.map((row) => mapIntegration(row, directory.workspaceNameById));
  const connected = new Set(integrations.map((item) => item.workspaceId));
  const unconnected = [...directory.workspaceNameById.entries()]
    .filter(([id]) => !connected.has(id))
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { integrations, unconnected };
}

export async function loadLiveAudit(input: AuditLedgerQuery): Promise<LedgerPage<LiveAuditRow> & { entityTypes: string[] }> {
  const { page, pageSize, q, dateWindow, sort, entity } = input;
  const { from, to } = pageRange(page, pageSize);
  const sinceIso = dateWindowSinceIso(dateWindow);
  const admin = createAdminClient();

  let searchOr: string | null = null;
  if (q) {
    const identities = await searchIdentityIds(q);
    searchOr = postgrestOr([
      postgrestIn("user_id", identities.userIds),
      postgrestIn("workspace_id", identities.workspaceIds),
      postgrestIlike("action", q),
      postgrestIlike("entity_type", q),
      postgrestIn("entity_type", keysMatchingLabel(q, ACTIVITY_ENTITY_LABELS)),
      looksLikeUuid(q) ? `user_id.eq.${q}` : null,
      looksLikeUuid(q) ? `entity_id.eq.${q}` : null,
    ]);
    if (!searchOr) return { rows: [], total: 0, page, pageSize, entityTypes: [] };
  }

  let query = admin
    .from("activity_log")
    .select("id, created_at, workspace_id, user_id, action, entity_type, entity_id", { count: "exact" });
  if (entity !== "all") query = query.eq("entity_type", entity);
  if (sinceIso) query = query.gte("created_at", sinceIso);
  if (searchOr) query = query.or(searchOr);

  const column = AUDIT_SORT[sort.key] ?? "created_at";
  const ascending = sort.dir === "asc";
  const [{ data, error, count }, typesResult] = await Promise.all([
    query.order(column, { ascending }).order("id", { ascending }).range(from, to),
    admin.from("activity_log").select("entity_type").not("entity_type", "is", null).limit(500),
  ]);
  if (error) throw new Error(error.message);
  if (typesResult.error) throw new Error(typesResult.error.message);
  const rows = (data ?? []) as AuditRow[];
  const names = await lookupNames(
    rows.map((row) => row.user_id),
    rows.map((row) => row.workspace_id)
  );
  const entityTypes = [...new Set((typesResult.data ?? []).map((row) => row.entity_type).filter(Boolean))] as string[];
  entityTypes.sort();
  return {
    rows: rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      workspaceId: row.workspace_id,
      workspaceName: names.workspaceNameById.get(row.workspace_id) || row.workspace_id,
      userId: row.user_id,
      userName: names.nameById.get(row.user_id) || row.user_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
    })),
    total: count ?? rows.length,
    page,
    pageSize,
    entityTypes,
  };
}

function creditSpendSlices(rows: LiveCreditTxRow[]): AdminSpendSlice[] {
  const totals = new Map<string, number>();
  for (const tx of rows) {
    if (tx.credits <= 0) continue;
    const label = creditOperationLabel(tx.operation);
    totals.set(label, (totals.get(label) ?? 0) + tx.credits);
  }
  return [...totals.entries()]
    .map(([label, value]) => ({ key: label, label, value }))
    .sort((a, b) => b.value - a.value);
}

function walletSpendSlices(rows: LiveWalletTxRow[]): AdminSpendSlice[] {
  const totals = new Map<string, number>();
  for (const tx of rows) {
    if (tx.status && tx.status !== "completed") continue;
    if (tx.amountUsd >= 0) continue;
    const label = walletModuleLabel(tx.module);
    totals.set(label, (totals.get(label) ?? 0) + Math.abs(tx.amountUsd));
  }
  return [...totals.entries()]
    .map(([label, value]) => ({ key: label, label, value }))
    .sort((a, b) => b.value - a.value);
}

function attentionItems(input: {
  subscriptions: LiveSubscriptionRow[];
  jobs: LiveJobRow[];
  wallets: WalletBalanceRow[];
  walletTxWorkspaceIds: Set<string>;
  integrations: LiveIntegrationRow[];
  workspaceNameById: Map<string, string>;
}): AdminAttentionItem[] {
  const items: AdminAttentionItem[] = [];

  for (const sub of input.subscriptions.filter((item) => item.status === "past_due")) {
    items.push({
      id: `attn_sub_${sub.id}`,
      kind: "past_due",
      title: `${sub.fullName} is past due`,
      detail: `${sub.planName} · ${sub.billingCycle}`,
      href: adminRoutes.user(sub.userId),
    });
  }

  for (const job of input.jobs.filter((item) => item.status === "failed")) {
    items.push({
      id: `attn_job_${job.id}`,
      kind: "failed_job",
      title: `${job.workspaceName} job failed`,
      detail: job.lastError ?? "Unknown error",
      href: adminRoutes.jobs(),
    });
  }

  for (const sub of input.subscriptions) {
    const included = sub.periodCredits + sub.bonusCredits;
    if (included <= 0 || sub.status === "cancelled" || sub.status === "expired") continue;
    if (sub.status !== "active" && sub.status !== "trialing") continue;
    if (sub.remaining / included >= LOW_CREDIT_RATIO) continue;
    items.push({
      id: `attn_cred_${sub.id}`,
      kind: "low_credits",
      title: `${sub.fullName} is low on credits`,
      detail: `${sub.remaining.toLocaleString()} remaining of ${included.toLocaleString()}`,
      href: adminRoutes.user(sub.userId),
    });
  }

  for (const wallet of input.wallets) {
    const balance = Number(wallet.balance_usd ?? 0);
    if (balance >= LOW_WALLET_USD) continue;
    if (!input.walletTxWorkspaceIds.has(wallet.workspace_id)) continue;
    const name = input.workspaceNameById.get(wallet.workspace_id) || wallet.workspace_id;
    items.push({
      id: `attn_wal_${wallet.workspace_id}`,
      kind: "low_wallet",
      title: `${name} wallet is low`,
      detail: `$${balance.toFixed(2)} USD remaining`,
      href: adminRoutes.workspace(wallet.workspace_id),
    });
  }

  for (const integration of input.integrations.filter((item) => item.status === "error")) {
    items.push({
      id: `attn_int_${integration.id}`,
      kind: "integration_error",
      title: `${integration.storeName} integration error`,
      detail: integration.provider,
      href: adminRoutes.integrations(),
    });
  }

  return items;
}

export async function loadLiveOverview(range: AdminOverviewRange): Promise<LiveOverviewPayload> {
  const admin = createAdminClient();
  const since = rangeStartIso(range);

  const [
    directory,
    subscriptionsRaw,
    creditRows,
    walletRows,
    jobRows,
    wallets,
    integrationsRaw,
    purchases,
    runningJobs,
    walletTxWorkspaceRows,
    failedJobRows,
  ] = await Promise.all([
    loadLiveDirectory(),
    loadSubscriptionsRaw(),
    loadCreditRows(since),
    loadWalletRows(since),
    loadJobRows(since),
    fetchAllRows<WalletBalanceRow>((from, to) =>
      admin.from("workspace_wallets").select("workspace_id, balance_usd").range(from, to)
    ),
    fetchAllRows<IntegrationRow>((from, to) =>
      admin
        .from("workspace_integrations")
        .select("id, workspace_id, provider, integration_name, base_url, status, updated_at")
        .range(from, to)
    ),
    fetchAllRows<{ amount_paid: number | string; status: string }>((from, to) =>
      admin
        .from("credit_purchases")
        .select("amount_paid, status, created_at")
        .eq("status", "completed")
        .gte("created_at", since)
        .range(from, to)
    ),
    admin.from("job_runs").select("id", { count: "exact", head: true }).in("status", ["running", "queued"]),
    fetchAllRows<{ workspace_id: string }>((from, to) =>
      admin.from("wallet_transactions").select("workspace_id").range(from, to)
    ),
    admin
      .from("job_runs")
      .select(
        "id, created_at, updated_at, workspace_id, created_by, kind, status, target_ids, completed_count, failed_count, last_error"
      )
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  if (failedJobRows.error) throw new Error(failedJobRows.error.message);
  if (runningJobs.error) throw new Error(runningJobs.error.message);

  const subscriptions = subscriptionsRaw.map((row) =>
    mapSubscription(row, directory.nameById, directory.emailById)
  );
  const credits = creditRows.map((row) => mapCredit(row, directory.nameById, directory.workspaceNameById));
  const walletTxs = walletRows.map((row) => mapWallet(row, directory.nameById, directory.workspaceNameById));
  const jobs = jobRows.map((row) => mapJob(row, directory.nameById, directory.workspaceNameById));
  const failedJobsForAttention = (failedJobRows.data ?? []).map((row) =>
    mapJob(row as JobRow, directory.nameById, directory.workspaceNameById)
  );
  const integrations = integrationsRaw.map((row) => mapIntegration(row, directory.workspaceNameById));

  const newUsers = directory.authUsers.filter((user) => user.created_at >= since).length;
  const activeSubs = subscriptions.filter((sub) => sub.status === "active" || sub.status === "trialing");
  const pastDue = subscriptions.filter((sub) => sub.status === "past_due").length;
  const mrr = subscriptions.reduce((sum, sub) => sum + sub.mrr, 0);
  const purchaseUsd = purchases.reduce((sum, row) => sum + Number(row.amount_paid ?? 0), 0);
  const estimatedTopupUsd = credits
    .filter((tx) => tx.operation === "credit_topup")
    .reduce((sum, tx) => sum + Math.abs(tx.credits) * CREDIT_TOPUP_USD_PER_CREDIT, 0);
  const creditTopupUsd = purchaseUsd > 0 ? purchaseUsd : estimatedTopupUsd;
  const completedWallet = walletTxs.filter((tx) => tx.status === "completed");
  const walletTopupUsd = completedWallet
    .filter((tx) => tx.kind === "topup")
    .reduce((sum, tx) => sum + tx.amountUsd, 0);
  const creditsSpent = credits.filter((tx) => tx.credits > 0).reduce((sum, tx) => sum + tx.credits, 0);
  const walletSpent = completedWallet
    .filter((tx) => tx.amountUsd < 0)
    .reduce((sum, tx) => sum + Math.abs(tx.amountUsd), 0);
  const failedJobs = jobs.filter((job) => job.status === "failed").length;
  const runningCount = runningJobs.count ?? 0;
  const walletsWithBalance = wallets.filter((row) => Number(row.balance_usd ?? 0) > 0).length;

  const kpis: AdminKpi[] = [
    { label: "Users", value: String(directory.authUsers.length), hint: `${newUsers} new in range` },
    {
      label: "Workspaces",
      value: String(directory.workspaceNameById.size),
      hint: `${walletsWithBalance} with wallet balance`,
    },
    {
      label: "Active plans",
      value: String(activeSubs.length),
      hint: pastDue ? `${pastDue} past due` : "No past due",
      tone: pastDue ? "warn" : "ok",
    },
    { label: "MRR (plans)", value: formatKpiUsd(mrr), hint: "Subscriptions only" },
    { label: "Credit top-up", value: formatKpiUsd(creditTopupUsd), hint: "$0.30 / credit" },
    { label: "Wallet top-up", value: formatKpiUsd(walletTopupUsd), hint: "USD wallet in" },
    { label: "Credits spent", value: creditsSpent.toLocaleString("en-US"), hint: "AI credits out" },
    { label: "Wallet spent", value: formatKpiUsd(walletSpent), hint: "USD wallet out" },
    {
      label: "Jobs failed",
      value: String(failedJobs),
      hint: `${runningCount} running / queued`,
      tone: failedJobs ? "danger" : "ok",
    },
  ];

  const walletTxWorkspaceIds = new Set(walletTxWorkspaceRows.map((row) => row.workspace_id));
  const completedJobs = jobs.filter((job) => job.status === "completed").length;

  return {
    range,
    kpis,
    creditSlices: creditSpendSlices(credits),
    walletSlices: walletSpendSlices(walletTxs),
    attention: attentionItems({
      subscriptions,
      jobs: failedJobsForAttention,
      wallets,
      walletTxWorkspaceIds,
      integrations,
      workspaceNameById: directory.workspaceNameById,
    }),
    series: buildOverviewSeries(range, credits, walletTxs),
    jobHealth: {
      completed: completedJobs,
      failed: failedJobs,
      running: runningCount,
    },
  };
}
