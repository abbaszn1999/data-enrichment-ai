import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { runRule } from "@/lib/growth-sync/engine";
import { claimDueRules, deferRule } from "@/lib/growth-sync/repo";

/**
 * Scheduler entry point, called by Supabase `pg_cron` through `pg_net`.
 *
 * `pg_net` is fire-and-forget: it does not retry, does not alert on a 5xx, and
 * only records the response in `net._http_response`. Resumability replaces
 * retries — each tick claims a few due rules, works within a wall-clock budget,
 * and leaves the rest due for the next tick.
 */

/** Rules claimed per tick. Bounded so one tick cannot outlive the request. */
const RULES_PER_TICK = 3;

/** Stop claiming new rules past this point, well inside the platform timeout. */
const TICK_BUDGET_MS = 45_000;

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const secret = process.env.GROWTH_SYNC_CRON_SECRET?.trim();
  if (!secret) {
    console.error("[growth-sync/tick] GROWTH_SYNC_CRON_SECRET is not configured");
    return NextResponse.json({ error: "Scheduler not configured" }, { status: 503 });
  }

  const presented = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (presented !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const startedAt = Date.now();

  let rules;
  try {
    rules = await claimDueRules(admin, RULES_PER_TICK);
  } catch (err) {
    console.error("[growth-sync/tick] claim failed:", err);
    return NextResponse.json({ error: "Could not claim rules" }, { status: 500 });
  }

  if (rules.length === 0) {
    return NextResponse.json({ ok: true, claimed: 0, processed: 0 });
  }

  const outcomes: Array<{ ruleId: string; status: string; error?: string }> = [];
  let deferred = 0;
  for (const rule of rules) {
    if (Date.now() - startedAt > TICK_BUDGET_MS) {
      // Out of budget. Handing the lease back leaves the rule due, so the next
      // tick takes it minutes from now instead of waiting out the lease.
      deferred = rules.length - outcomes.length;
      console.warn(`[growth-sync/tick] budget exhausted, deferring ${deferred} rule(s)`);
      for (const pending of rules.slice(outcomes.length)) {
        await deferRule(admin, pending.id).catch((err) => {
          console.error(`[growth-sync/tick] could not defer ${pending.id}:`, err);
        });
      }
      break;
    }
    const outcome = await runRule({ admin, rule, trigger: "cron" });
    outcomes.push({
      ruleId: rule.id,
      status: outcome.status,
      error: outcome.error,
    });
    if (outcome.error) {
      console.error(`[growth-sync/tick] rule ${rule.id} failed: ${outcome.error}`);
    }
  }

  return NextResponse.json({
    ok: true,
    claimed: rules.length,
    processed: outcomes.length,
    deferred,
    outcomes,
  });
}
