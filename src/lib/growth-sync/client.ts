import type { RuleMode, SyncInterval, WatchedTaxonomy } from "./types";

/** Browser-side calls into the Growth Sync API. */

export const SYNC_INTERVALS: { id: SyncInterval; label: string }[] = [
  { id: "manual", label: "Manual only" },
  { id: "24h", label: "Every 24 hours" },
];

export function intervalLabel(id: SyncInterval): string {
  return SYNC_INTERVALS.find((row) => row.id === id)?.label ?? id;
}

export type RuleRow = {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  enabled: boolean;
  provider: string;
  run_interval: SyncInterval;
  watched_taxonomies: WatchedTaxonomy[];
  mode: RuleMode;
  next_run_at: string | null;
  last_run_at: string | null;
  last_error: string | null;
  created_at: string;
};

export type RunRow = {
  id: string;
  rule_id: string;
  trigger: "cron" | "manual";
  status: "running" | "succeeded" | "failed" | "skipped";
  detected_count: number;
  classified_count: number;
  assigned_count: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

export type ActivityRow = {
  id: string;
  rule_id: string;
  product_ref: string;
  product_title: string;
  product_url: string | null;
  product_image_url: string | null;
  taxonomy_ref: string | null;
  taxonomy_name: string;
  decision: "assigned" | "skipped" | "failed";
  score: number | null;
  reason: string;
  undone_at: string | null;
  created_at: string;
};

export type TaxonomyOption = {
  id: string;
  title: string;
  handle?: string;
  productCount: number;
  manual: boolean;
};

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function jsonPost(method: "POST" | "PATCH" | "DELETE", body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function fetchSyncOverview(workspaceId: string) {
  return call<{
    rules: RuleRow[];
    runs: RunRow[];
    activity: ActivityRow[];
  }>(`/api/growth-sync/rules?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function fetchStoreTaxonomies(workspaceId: string) {
  return call<{
    connected: boolean;
    provider?: string;
    taxonomyLabel: string;
    taxonomies: TaxonomyOption[];
    supportsUndo?: boolean;
    message?: string;
  }>(`/api/growth-sync/taxonomies?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function createSyncRule(input: {
  workspaceId: string;
  projectId: string;
  name: string;
  interval: SyncInterval;
  watchedTaxonomies: WatchedTaxonomy[];
}) {
  return call<{ rule: RuleRow }>("/api/growth-sync/rules", jsonPost("POST", input));
}

export function updateSyncRule(input: {
  workspaceId: string;
  ruleId: string;
  name?: string;
  enabled?: boolean;
  interval?: SyncInterval;
  watchedTaxonomies?: WatchedTaxonomy[];
}) {
  return call<{ rule: RuleRow }>("/api/growth-sync/rules", jsonPost("PATCH", input));
}

export function deleteSyncRule(workspaceId: string, ruleId: string) {
  return call<{ ok: boolean }>(
    "/api/growth-sync/rules",
    jsonPost("DELETE", { workspaceId, ruleId })
  );
}

export function runSyncRule(workspaceId: string, ruleId: string) {
  return call<{
    outcome: {
      status: "succeeded" | "failed" | "skipped";
      detectedCount: number;
      classifiedCount: number;
      assignedCount: number;
      error?: string;
      deferredCount?: number;
    };
  }>("/api/growth-sync/run", jsonPost("POST", { workspaceId, ruleId }));
}

export function undoAssignments(workspaceId: string, activityIds: string[]) {
  return call<{
    undoneCount: number;
    pending?: boolean;
    failures?: Array<{ taxonomyRef: string; error: string }>;
  }>("/api/growth-sync/undo", jsonPost("POST", { workspaceId, activityIds }));
}

