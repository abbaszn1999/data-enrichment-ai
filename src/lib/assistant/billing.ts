import { createAdminClient } from "@/lib/supabase-admin";
import { settleProviderUsage } from "@/lib/jobs/credits";
import { assistantBillingMode } from "./service-client";

export type AssistantSettlement = {
  /** The balance is spent, so the agent must stop before the next message. */
  balanceExhausted: boolean;
};

/**
 * Charge the assistant's own reasoning cost to the workspace credit balance,
 * through the same deduction the other tools use.
 *
 * `log` mode only records what would be charged. `charge` mode deducts it.
 */
export async function settleAssistantRun(params: {
  runId: string;
  workspaceId: string;
  ownerUserId: string;
  actorUserId: string;
  credits: number;
}): Promise<AssistantSettlement> {
  if (!(params.credits > 0)) return { balanceExhausted: false };
  if (assistantBillingMode() === "log") {
    console.log(`[assistant] billing (log only) run=${params.runId} workspace=${params.workspaceId} credits=${params.credits}`);
    return { balanceExhausted: false };
  }
  try {
    const result = await settleProviderUsage({
      admin: createAdminClient(),
      ownerUserId: params.ownerUserId,
      workspaceId: params.workspaceId,
      actorUserId: params.actorUserId,
      amount: params.credits,
      operation: "assistant",
      entityType: "assistant",
      idempotencyKey: `assistant:${params.runId}`,
      details: { runId: params.runId },
    });
    if (result.billingError) console.error("[assistant] billing failed:", result.billingError);
    return { balanceExhausted: result.balanceExhausted && !result.billingError };
  } catch (error) {
    console.error("[assistant] billing failed:", error instanceof Error ? error.message : error);
    return { balanceExhausted: false };
  }
}
