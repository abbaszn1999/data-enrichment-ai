import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnalyticsPageType, AnalyticsRuleConfig, AnalyticsRulesRecord } from "./types";

type AnalyticsRulesRow = {
  id: string;
  workspace_id: string;
  page_type: AnalyticsPageType;
  filter_mode: AnalyticsRuleConfig["filterMode"];
  pattern_type: AnalyticsRuleConfig["patternType"];
  patterns: unknown;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export function toAnalyticsRulesRecord(row: AnalyticsRulesRow): AnalyticsRulesRecord {
  const patterns =
    row.patterns && typeof row.patterns === "object"
      ? (row.patterns as AnalyticsRuleConfig["patterns"])
      : { logic: "OR" as const, rules: [] };
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    pageType: row.page_type,
    filterMode: row.filter_mode,
    patternType: row.pattern_type,
    isActive: row.is_active,
    patterns: {
      logic: patterns.logic === "AND" ? "AND" : "OR",
      rules: Array.isArray(patterns.rules)
        ? patterns.rules.map((rule) => ({
            value: String(rule?.value ?? ""),
            enabled: rule?.enabled !== false,
          }))
        : [],
    },
  };
}

export async function getAnalyticsRules(
  admin: SupabaseClient,
  workspaceId: string,
  pageType: AnalyticsPageType
): Promise<AnalyticsRulesRecord | null> {
  const { data, error } = await admin
    .from("workspace_analytics_rules")
    .select("id, workspace_id, page_type, filter_mode, pattern_type, patterns, is_active, created_at, updated_at")
    .eq("workspace_id", workspaceId)
    .eq("page_type", pageType)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return toAnalyticsRulesRecord(data as AnalyticsRulesRow);
}

export async function saveAnalyticsRules(
  admin: SupabaseClient,
  workspaceId: string,
  pageType: AnalyticsPageType,
  config: AnalyticsRuleConfig
): Promise<AnalyticsRulesRecord> {
  const { data, error } = await admin
    .from("workspace_analytics_rules")
    .upsert(
      {
        workspace_id: workspaceId,
        page_type: pageType,
        filter_mode: config.filterMode,
        pattern_type: config.patternType,
        patterns: config.patterns,
        is_active: config.isActive,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,page_type" }
    )
    .select("id, workspace_id, page_type, filter_mode, pattern_type, patterns, is_active, created_at, updated_at")
    .single();
  if (error) throw error;
  return toAnalyticsRulesRecord(data as AnalyticsRulesRow);
}
