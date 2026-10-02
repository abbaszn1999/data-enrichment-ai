import { createAdminClient } from "@/lib/supabase-admin";
import { updateCachedCredits } from "@/lib/workspace-context";

type Admin = ReturnType<typeof createAdminClient>;

export async function deductCreditsIdempotent(params: {
  admin?: Admin;
  ownerUserId: string;
  workspaceId: string;
  actorUserId: string;
  amount: number;
  operation: string;
  entityType: string;
  entityId?: string | null;
  idempotencyKey: string;
  details?: Record<string, unknown>;
}): Promise<{
  success: boolean;
  duplicate?: boolean;
  remaining?: number;
  error?: string;
}> {
  if (params.amount <= 0) {
    return { success: true, remaining: undefined };
  }
  const admin = params.admin ?? createAdminClient();
  const entityId =
    params.entityId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      params.entityId
    )
      ? params.entityId
      : null;

  const { data, error } = await admin.rpc("deduct_user_credits", {
    p_user_id: params.ownerUserId,
    p_amount: params.amount,
    p_workspace_id: params.workspaceId,
    p_operation: params.operation,
    p_uid: params.actorUserId,
    p_entity_type: params.entityType,
    p_entity_id: entityId,
    p_details: {
      ...(params.details ?? {}),
      idempotencyKey: params.idempotencyKey,
    },
  });
  if (error) return { success: false, error: error.message };
  if (!data?.success) {
    return {
      success: false,
      remaining: data?.remaining,
      error: data?.error || "Deduction failed",
    };
  }
  if (!data?.duplicate && typeof data.remaining === "number") {
    updateCachedCredits(params.workspaceId, data.remaining);
  }
  return {
    success: true,
    duplicate: !!data.duplicate,
    remaining: data.remaining,
  };
}

/**
 * Charges a call whose AI work has already been done and delivered. When the
 * balance cannot cover the full amount, the rest of the balance is charged,
 * so usage never continues past zero for free. `charged` is what was billed.
 */
export async function chargeCompletedCall(
  params: Parameters<typeof deductCreditsIdempotent>[0]
): Promise<Awaited<ReturnType<typeof deductCreditsIdempotent>> & { charged: number }> {
  const full = await deductCreditsIdempotent(params);
  if (full.success) return { ...full, charged: full.duplicate ? 0 : params.amount };
  const rest = Number(full.remaining ?? 0);
  if (!/insufficient credits/i.test(full.error ?? "") || !(rest > 0)) {
    return { ...full, charged: 0 };
  }
  const partial = await deductCreditsIdempotent({
    ...params,
    amount: rest,
    idempotencyKey: `${params.idempotencyKey}:balance`,
    details: { ...(params.details ?? {}), requestedCredits: params.amount, partial: true },
  });
  return { ...partial, charged: partial.success && !partial.duplicate ? rest : 0 };
}

export type UsageSettlement = {
  /** Credits actually taken from the balance for this usage. */
  charged: number;
  /** Credits of real provider usage the balance could not cover (0 when fully charged). */
  shortfall: number;
  remaining?: number;
  /** The same usage was already charged earlier (a retried call). */
  duplicate: boolean;
  /** The balance is spent, or billing failed: the run must stop before spending more. */
  balanceExhausted: boolean;
  billingError?: string;
};

const roundCredits = (value: number) => Math.round(value * 1000) / 1000;

/**
 * The one billing rule for generation: whatever the AI providers answered (and
 * billed us for) is charged to the user, whether or not the row succeeded.
 * The delivered work is never thrown away because the balance ran short: the
 * rest of the balance is charged, and `balanceExhausted` tells the run to stop.
 */
export async function settleProviderUsage(
  params: Parameters<typeof deductCreditsIdempotent>[0]
): Promise<UsageSettlement> {
  const amount = roundCredits(params.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { charged: 0, shortfall: 0, duplicate: false, balanceExhausted: false };
  }
  let result = await chargeCompletedCall({ ...params, amount });
  if (!result.success && !isInsufficientCredits(result.error)) {
    // One retry for a transient database error; the idempotency key makes it safe.
    result = await chargeCompletedCall({ ...params, amount });
  }
  if (!result.success) {
    return {
      charged: 0,
      shortfall: amount,
      remaining: result.remaining,
      duplicate: false,
      balanceExhausted: true,
      billingError: result.error || "Credit deduction failed",
    };
  }
  if (result.duplicate) {
    return { charged: 0, shortfall: 0, remaining: result.remaining, duplicate: true, balanceExhausted: false };
  }
  const charged = roundCredits(result.charged);
  const shortfall = roundCredits(Math.max(0, amount - charged));
  return {
    charged,
    shortfall,
    remaining: result.remaining,
    duplicate: false,
    balanceExhausted:
      shortfall > 0 || (typeof result.remaining === "number" && result.remaining <= 0),
  };
}

export function isInsufficientCredits(error?: string | null): boolean {
  if (!error) return false;
  return /insufficient credits|insufficient_credits|no_credits|no active subscription/i.test(
    error
  );
}
