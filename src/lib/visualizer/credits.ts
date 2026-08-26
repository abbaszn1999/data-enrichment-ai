import { createAdminClient } from "@/lib/supabase-admin";
import { updateCachedCredits } from "@/lib/workspace-context";

type Admin = ReturnType<typeof createAdminClient>;

export async function deductVisualizerCredits(params: {
  admin: Admin;
  ownerUserId: string;
  workspaceId: string;
  actorUserId: string;
  amount: number;
  sessionId: string;
  rowId: string;
  operation: "visualizer_description" | "visualizer_images";
  details: Record<string, unknown>;
}): Promise<{
  success: boolean;
  duplicate?: boolean;
  remaining?: number;
  error?: string;
}> {
  const { data, error } = await params.admin.rpc("deduct_user_credits", {
    p_user_id: params.ownerUserId,
    p_amount: params.amount,
    p_workspace_id: params.workspaceId,
    p_operation: params.operation,
    p_uid: params.actorUserId,
    p_entity_type: "visualizer_session",
    p_entity_id: params.sessionId,
    p_details: {
      ...params.details,
      rowId: params.rowId,
      idempotencyKey:
        typeof params.details.idempotencyKey === "string"
          ? params.details.idempotencyKey
          : `${params.operation}:${params.sessionId}:${params.rowId}`,
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
    duplicate: !!data?.duplicate,
    remaining: data?.remaining,
  };
}
