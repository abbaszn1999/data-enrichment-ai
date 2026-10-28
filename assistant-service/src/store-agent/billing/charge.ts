import type { SupabaseClient } from "@supabase/supabase-js";

export type ChargeResult = { charged: number; remaining?: number; duplicate: boolean; error?: string };

const round = (v: number) => Math.round(v * 1000) / 1000;

async function deduct(
  db: SupabaseClient,
  params: { ownerUserId: string; workspaceId: string; actorUserId: string; runId: string; amount: number; key: string; details: Record<string, unknown> }
): Promise<{ success: boolean; duplicate?: boolean; remaining?: number; error?: string }> {
  const { data, error } = await db.rpc("deduct_user_credits", {
    p_user_id: params.ownerUserId,
    p_amount: params.amount,
    p_workspace_id: params.workspaceId,
    p_operation: "store_assistant",
    p_uid: params.actorUserId,
    p_entity_type: "store_assistant",
    p_entity_id: params.runId,
    p_details: { ...params.details, idempotencyKey: params.key },
  });
  if (error) return { success: false, error: error.message };
  if (!data?.success) return { success: false, remaining: data?.remaining, error: data?.error || "Deduction failed" };
  return { success: true, duplicate: !!data.duplicate, remaining: data.remaining };
}

/**
 * Charge a finished run, the platform's way: the work is delivered, so when
 * the balance cannot cover all of it the rest of the balance is charged.
 * Idempotent per run, so a retry never charges twice.
 */
export async function chargeRun(
  db: SupabaseClient,
  params: { ownerUserId: string; workspaceId: string; actorUserId: string; runId: string; credits: number; details: Record<string, unknown> }
): Promise<ChargeResult> {
  const amount = round(params.credits);
  if (!(amount > 0)) return { charged: 0, duplicate: false };
  const key = `store_agent:${params.runId}`;
  let full = await deduct(db, { ...params, amount, key });
  if (!full.success && !/insufficient credits/i.test(full.error ?? "")) {
    // One retry for a transient error; the idempotency key makes it safe.
    full = await deduct(db, { ...params, amount, key });
  }
  // The key belongs to this run alone, so "duplicate" means an earlier attempt
  // whose answer was lost already took this amount: report it as charged.
  if (full.success) return { charged: amount, remaining: full.remaining, duplicate: !!full.duplicate };
  const rest = round(Number(full.remaining ?? 0));
  if (!/insufficient credits/i.test(full.error ?? "") || !(rest > 0)) {
    return { charged: 0, remaining: full.remaining, duplicate: false, error: full.error };
  }
  const partial = await deduct(db, {
    ...params,
    amount: rest,
    key: `${key}:balance`,
    details: { ...params.details, requestedCredits: amount, partial: true },
  });
  return partial.success
    ? { charged: rest, remaining: partial.remaining, duplicate: !!partial.duplicate }
    : { charged: 0, remaining: partial.remaining, duplicate: false, error: partial.error };
}
