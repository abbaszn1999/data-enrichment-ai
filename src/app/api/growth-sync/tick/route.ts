import { after, NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { runRule } from "@/lib/growth-sync/engine";
import { claimDueRules, deferRule } from "@/lib/growth-sync/repo";
import { cronSecretMatches } from "@/lib/auth/cron-secret";

/**
 * Scheduler entry point, called by Supabase `pg_cron` through `pg_net`.
 *
 * The tick only claims due rules and enqueues them. Execution continues after
 * the HTTP response so one slow tenant cannot starve the rest of the platform.
 */

/** Rules claimed per tick. Execution continues after the HTTP response. */
const RULES_PER_TICK = 12;

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const secret = process.env.GROWTH_SYNC_CRON_SECRET?.trim();
  if (!secret) {
    console.error("[growth-sync/tick] GROWTH_SYNC_CRON_SECRET is not configured");
    return NextResponse.json({ error: "Scheduler not configured" }, { status: 503 });
  }

  if (!cronSecretMatches(request, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  let rules;
  try {
    rules = await claimDueRules(admin, RULES_PER_TICK);
  } catch (err) {
    console.error("[growth-sync/tick] claim failed:", err);
    return NextResponse.json({ error: "Could not claim rules" }, { status: 500 });
  }

  if (rules.length === 0) {
    return NextResponse.json({ ok: true, claimed: 0, queued: 0 });
  }

  after(async () => {
    for (const rule of rules) {
      try {
        const outcome = await runRule({ admin, rule, trigger: "cron" });
        if (outcome.error) {
          console.error(`[growth-sync/tick] rule ${rule.id} failed: ${outcome.error}`);
        }
      } catch (err) {
        console.error(`[growth-sync/tick] rule ${rule.id} threw:`, err);
        await deferRule(admin, rule.id).catch((deferErr) => {
          console.error(`[growth-sync/tick] could not defer ${rule.id}:`, deferErr);
        });
      }
    }
  });

  return NextResponse.json({
    ok: true,
    claimed: rules.length,
    queued: rules.length,
  });
}
