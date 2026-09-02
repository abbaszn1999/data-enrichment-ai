import type { SupabaseClient } from "@supabase/supabase-js";
import type { Decision, SyncRuleRecord, WatchedTaxonomy } from "./types";
import { decryptedIntegrationConfig } from "@/lib/integrations/load";

/**
 * Every Supabase read and write the engine performs. Keeping them here means
 * the pipeline in `engine.ts` reads as pipeline logic rather than as a chain of
 * query builders, and a schema change lands in one file.
 */

type Admin = SupabaseClient;

const RULE_COLUMNS =
  "id, workspace_id, project_id, created_by, name, enabled, provider, run_interval, watched_taxonomies, mode, next_run_at, lease_until, last_run_at, last_error, created_at, updated_at";

function normalizeRule(row: Record<string, unknown>): SyncRuleRecord {
  const watched = row.watched_taxonomies;
  return {
    ...(row as unknown as SyncRuleRecord),
    watched_taxonomies: Array.isArray(watched) ? (watched as WatchedTaxonomy[]) : [],
  };
}

/** Rules that are due, leased in the same statement so parallel ticks can't
 *  pick up the same one. */
export async function claimDueRules(
  admin: Admin,
  limit: number
): Promise<SyncRuleRecord[]> {
  const { data, error } = await admin.rpc("claim_gs_rules", {
    p_limit: limit,
    p_lease_minutes: 10,
  });
  if (error) throw new Error(`claim_gs_rules: ${error.message}`);
  return (Array.isArray(data) ? data : []).map(normalizeRule);
}

export async function loadRule(
  admin: Admin,
  ruleId: string
): Promise<SyncRuleRecord | null> {
  const { data, error } = await admin
    .from("gs_rules")
    .select(RULE_COLUMNS)
    .eq("id", ruleId)
    .maybeSingle();
  if (error) throw new Error(`loadRule: ${error.message}`);
  return data ? normalizeRule(data) : null;
}

/**
 * Take the lease for one rule, for "Run now". Returns null when the lease is
 * already held, which is the same guard the scheduler gets from `claim_gs_rules`
 * — without it two clicks could classify and charge for the same products twice.
 */
export async function leaseRule(
  admin: Admin,
  ruleId: string
): Promise<SyncRuleRecord | null> {
  const { data, error } = await admin.rpc("lease_gs_rule", {
    p_rule_id: ruleId,
    p_lease_minutes: 10,
  });
  if (error) throw new Error(`lease_gs_rule: ${error.message}`);
  const rows = Array.isArray(data) ? data : [];
  return rows.length > 0 ? normalizeRule(rows[0]) : null;
}

/** Hand a claimed rule back without consuming its turn: the lease drops but the
 *  rule stays due, so the next tick picks it up instead of waiting out the
 *  lease. */
export async function deferRule(admin: Admin, ruleId: string): Promise<void> {
  const { error } = await admin.rpc("defer_gs_rule", { p_rule_id: ruleId });
  if (error) throw new Error(`defer_gs_rule: ${error.message}`);
}

/** Clear the lease and schedule the next run. Always called, success or not,
 *  so a failure can't strand a rule until its lease expires. */
export async function releaseRule(
  admin: Admin,
  ruleId: string,
  params: { error?: string; disable?: boolean; dueNow?: boolean } = {}
): Promise<void> {
  const { error } = await admin.rpc("release_gs_rule", {
    p_rule_id: ruleId,
    p_error: params.error ?? null,
    p_disable: params.disable ?? false,
    p_due_now: params.dueNow ?? false,
  });
  if (error) throw new Error(`release_gs_rule: ${error.message}`);
}

export type WatermarkMap = Map<string, string>;

export async function loadWatermarks(
  admin: Admin,
  ruleId: string
): Promise<WatermarkMap> {
  const { data, error } = await admin
    .from("gs_watermarks")
    .select("taxonomy_ref, last_product_created_at")
    .eq("rule_id", ruleId);
  if (error) throw new Error(`loadWatermarks: ${error.message}`);
  const map: WatermarkMap = new Map();
  for (const row of data ?? []) {
    map.set(String(row.taxonomy_ref), String(row.last_product_created_at));
  }
  return map;
}

/**
 * Seed a watermark at the current moment for every watched taxonomy. This is
 * what confines a new rule to future products: without it the first tick would
 * treat the entire existing catalogue as new.
 */
export async function seedWatermarks(
  admin: Admin,
  ruleId: string,
  taxonomyRefs: string[]
): Promise<void> {
  if (taxonomyRefs.length === 0) return;
  const now = new Date().toISOString();
  const { error } = await admin.from("gs_watermarks").upsert(
    taxonomyRefs.map((ref) => ({
      rule_id: ruleId,
      taxonomy_ref: ref,
      last_product_created_at: now,
    })),
    { onConflict: "rule_id,taxonomy_ref", ignoreDuplicates: true }
  );
  if (error) throw new Error(`seedWatermarks: ${error.message}`);
}

/** Move a watermark forward. Never backward: an earlier timestamp would make
 *  the engine re-detect products it has already decided on. */
export async function advanceWatermark(
  admin: Admin,
  params: {
    ruleId: string;
    taxonomyRef: string;
    createdAt: string;
    productRef?: string;
  }
): Promise<void> {
  const { error } = await admin
    .from("gs_watermarks")
    .update({
      last_product_created_at: params.createdAt,
      last_product_ref: params.productRef ?? null,
    })
    .eq("rule_id", params.ruleId)
    .eq("taxonomy_ref", params.taxonomyRef)
    .lt("last_product_created_at", params.createdAt);
  if (error) throw new Error(`advanceWatermark: ${error.message}`);
}

export async function startRun(
  admin: Admin,
  params: {
    workspaceId: string;
    ruleId: string;
    trigger: "cron" | "manual";
  }
): Promise<string> {
  const { data, error } = await admin
    .from("gs_runs")
    .insert({
      workspace_id: params.workspaceId,
      rule_id: params.ruleId,
      trigger: params.trigger,
    })
    .select("id")
    .single();
  if (error) throw new Error(`startRun: ${error.message}`);
  return String(data.id);
}

export async function finishRun(
  admin: Admin,
  runId: string,
  params: {
    status: "succeeded" | "failed" | "skipped";
    detectedCount: number;
    classifiedCount: number;
    assignedCount: number;
    error?: string;
  }
): Promise<void> {
  const { error } = await admin
    .from("gs_runs")
    .update({
      status: params.status,
      detected_count: params.detectedCount,
      classified_count: params.classifiedCount,
      assigned_count: params.assignedCount,
      error: params.error ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);
  if (error) throw new Error(`finishRun: ${error.message}`);
}

/** Record every decision, including the rejections. A skip with a reason is
 *  what makes the run auditable rather than a black box. */
export async function recordDecisions(
  admin: Admin,
  params: {
    workspaceId: string;
    ruleId: string;
    runId: string;
    decisions: Decision[];
  }
): Promise<void> {
  if (params.decisions.length === 0) return;
  const { error } = await admin.from("gs_activity").insert(
    params.decisions.map((d) => ({
      workspace_id: params.workspaceId,
      rule_id: params.ruleId,
      run_id: params.runId,
      product_ref: d.product.id,
      product_title: d.product.title,
      product_url: d.product.url ?? null,
      product_image_url: d.product.imageUrl ?? null,
      source_taxonomy_ref: d.sourceTaxonomyRef,
      taxonomy_ref: d.target?.taxonomyRef ?? null,
      taxonomy_name: d.target?.name ?? "",
      decision: d.decision,
      score: typeof d.score === "number" ? Number(d.score.toFixed(4)) : null,
      reason: d.reason,
    }))
  );
  if (error) throw new Error(`recordDecisions: ${error.message}`);
}

export async function loadIntegration(
  admin: Admin,
  workspaceId: string
): Promise<{
  provider: string;
  integration_name: string;
  base_url: string | null;
  config: Record<string, unknown> | null;
} | null> {
  const { data, error } = await admin
    .from("workspace_integrations")
    .select("provider, integration_name, base_url, config")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(`loadIntegration: ${error.message}`);
  if (!data?.provider) return null;
  return {
    provider: String(data.provider),
    integration_name: String(data.integration_name ?? ""),
    base_url: (data.base_url as string | null) ?? null,
    config: decryptedIntegrationConfig(data.config),
  };
}
