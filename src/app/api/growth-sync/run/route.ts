import { NextRequest, NextResponse } from "next/server";
import { jsonError, requireMrWrite } from "@/lib/market-research/api-schema";
import { runRuleBodySchema } from "@/lib/growth-sync/api-schema";
import { runRule } from "@/lib/growth-sync/engine";
import { leaseRule, loadRule } from "@/lib/growth-sync/repo";

/**
 * "Run now" from the dashboard. Same pipeline as the scheduled tick, but
 * authorised by the user's session instead of the cron secret, and it ignores
 * `next_run_at` since the user is asking explicitly.
 */
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = runRuleBodySchema.safeParse(json);
  if (!parsed.success) return jsonError("Invalid payload", 400);

  const auth = await requireMrWrite(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  try {
    // Ownership is checked before the lease so a caller cannot probe another
    // workspace's rules by watching which ids come back busy.
    const existing = await loadRule(auth.admin, parsed.data.ruleId);
    if (!existing || existing.workspace_id !== parsed.data.workspaceId) {
      return jsonError("Rule not found", 404);
    }

    // Taking the lease is what makes this safe, not checking it: two clicks, or
    // a click landing on top of a tick, would otherwise both enter the same rule
    // and classify — and charge for — the same products twice.
    const rule = await leaseRule(auth.admin, parsed.data.ruleId);
    if (!rule) {
      return jsonError("This rule is already running", 409);
    }

    const outcome = await runRule({ admin: auth.admin, rule, trigger: "manual" });
    return NextResponse.json({ ok: outcome.status !== "failed", outcome });
  } catch (err) {
    console.error("[growth-sync/run] failed:", err);
    const message = err instanceof Error ? err.message : "Could not run the rule";
    return jsonError(message, 500);
  }
}
