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

export function isInsufficientCredits(error?: string | null): boolean {
  if (!error) return false;
  return /insufficient credits|insufficient_credits|no_credits|no active subscription/i.test(
    error
  );
}
