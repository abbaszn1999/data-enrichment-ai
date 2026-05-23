// Agent policy — server-enforced scope caps + confirmation tiers.
// The LLM cannot exceed these limits. All numbers are server-side truth.

import type { AgentStrategy } from "@/lib/sync/core/types";

/** Default scope cap per operation class. */
export const DEFAULT_SCOPE_CAP: Record<AgentStrategy, number> = {
  read: Number.POSITIVE_INFINITY,
  light_write: 25,
  medium_write: 10,
  heavy_ai_write: 3,
  delete: 3,
  apply_to_shopify: Number.POSITIVE_INFINITY,
  reply: 0,
};

/**
 * Absolute maximum per operation class — even when the user says "all",
 * the agent may not exceed these. Protects token budget + Shopify cost.
 */
export const ABSOLUTE_MAX_SCOPE_CAP: Record<AgentStrategy, number> = {
  read: Number.POSITIVE_INFINITY,
  light_write: 100,
  medium_write: 50,
  heavy_ai_write: 25,
  delete: 10,
  apply_to_shopify: Number.POSITIVE_INFINITY,
  reply: 0,
};

/** Regex patterns that unlock "all" mode up to ABSOLUTE_MAX for a request. */
const EXPLICIT_ALL_PATTERNS: RegExp[] = [
  /\ball\b/i,
  /\bevery\b/i,
  /\bentire\b/i,
  /\bwhole\b/i,
  /\bwithout limit\b/i,
  /\bno limit\b/i,
  /كل\s*المنتجات/,
  /جميع\s*المنتجات/,
  /الكل\b/,
  /كلها\b/,
];

export function userMessageRequestsAll(userMessage: string): boolean {
  const trimmed = userMessage.trim();
  if (!trimmed) return false;
  return EXPLICIT_ALL_PATTERNS.some((re) => re.test(trimmed));
}

/**
 * Clamp scopeCap server-side. Called on every planner output.
 * - LLM-provided cap is first clamped to DEFAULT.
 * - If user explicitly said "all"/"كل"/"جميع", cap is raised to ABSOLUTE_MAX.
 */
export function clampScopeCap(
  requested: number,
  strategy: AgentStrategy,
  userMessage: string
): number {
  if (!Number.isFinite(requested) || requested < 0) {
    return DEFAULT_SCOPE_CAP[strategy] === Number.POSITIVE_INFINITY
      ? 1_000_000
      : DEFAULT_SCOPE_CAP[strategy];
  }
  const allowAll = userMessageRequestsAll(userMessage);
  const ceiling = allowAll
    ? ABSOLUTE_MAX_SCOPE_CAP[strategy]
    : DEFAULT_SCOPE_CAP[strategy];
  if (ceiling === Number.POSITIVE_INFINITY) {
    return Math.min(requested, 1_000_000);
  }
  return Math.min(requested, ceiling);
}

// ─────────────────────────────────────────────────────────────────────────────
// Confirmation tiers (three-tier model, server-enforced)
// ─────────────────────────────────────────────────────────────────────────────

export type ConfirmationTier = "allow" | "grey" | "deny";

/**
 * Tool → tier mapping. Tier is constant; LLM cannot change it.
 * - allow  : always auto-execute (ignore LLM's requiresConfirmation)
 * - grey   : respect LLM's requiresConfirmation; auto-confirm if rows > 3
 * - deny   : ALWAYS show confirmation dialog
 */
export const TOOL_TIERS: Record<string, ConfirmationTier> = {
  // Allow (read-only + reply)
  sync_products_load: "allow",
  sync_products_filter_client: "allow",
  sync_collections_load: "allow",
  sync_collections_resolve: "allow",
  sync_sheet_program: "allow",
  sync_answer_question: "allow",
  sync_research_web: "allow",
  sync_attachments_analyze: "allow",
  sync_reply_only: "allow",

  // Grey (write-ish — agent decides, with row cap)
  sync_columns_write_with_ai: "grey",
  sync_images_search: "grey",
  sync_row_append: "grey",
  sync_collections_create: "grey",
  sync_collections_assign: "grey",

  // Deny (destructive — always confirm)
  sync_apply_to_shopify: "deny",
  sync_column_delete: "deny",
};

/**
 * Decide whether a tool step requires confirmation.
 * Called server-side; overrides the LLM's requiresConfirmation flag.
 */
export function resolveConfirmation(params: {
  tool: string;
  llmRequiresConfirmation: boolean;
  affectedRowCount: number;
}): boolean {
  const tier = TOOL_TIERS[params.tool] ?? "grey";
  if (tier === "allow") return false;
  if (tier === "deny") return true;
  // grey: force confirmation if rows > 3
  if (params.affectedRowCount > 3) return true;
  return params.llmRequiresConfirmation === true;
}

/** Which tools are write operations (for advisory lock + apply routing). */
export const WRITE_TOOLS = new Set<string>([
  "sync_columns_write_with_ai",
  "sync_images_search",
  "sync_row_append",
  "sync_collections_create",
  "sync_collections_assign",
  "sync_apply_to_shopify",
  "sync_column_delete",
]);

export function isWriteTool(tool: string): boolean {
  return WRITE_TOOLS.has(tool);
}
