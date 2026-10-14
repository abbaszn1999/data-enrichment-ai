import { createAdminClient } from "@/lib/supabase-admin";
import { settleProviderUsage } from "@/lib/jobs/credits";
import { assistantBillingMode } from "./service-client";

/**
 * Charge the assistant's own reasoning cost to the workspace, at cost.
 *
 * `log` mode (the default, used on localhost) only records what would be
 * charged. `charge` mode deducts it; it needs the `assistant` credit operation
 * to exist in the database, so it stays off until that migration is applied.
 */
export async function settleAssistantRun(params: {
  runId: string;
  workspaceId: string;
  ownerUserId: string;
  actorUserId: string;
  credits: number;
}): Promise<void> {
  if (!(params.credits > 0)) return;
  if (assistantBillingMode() === "log") {
    console.log(`[assistant] billing (log only) run=${params.runId} workspace=${params.workspaceId} credits=${params.credits}`);
    return;
  }
  try {
    const result = await settleProviderUsage({
      admin: createAdminClient(),
      ownerUserId: params.ownerUserId,
      workspaceId: params.workspaceId,
      actorUserId: params.actorUserId,
      amount: params.credits,
      // The typed operation list is extended by the assistant migration.
      operation: "assistant" as never,
      entityType: "assistant",
      idempotencyKey: `assistant:${params.runId}`,
      details: { runId: params.runId },
    });
    if (result.billingError) console.error("[assistant] billing failed:", result.billingError);
  } catch (error) {
    console.error("[assistant] billing failed:", error instanceof Error ? error.message : error);
  }
}
