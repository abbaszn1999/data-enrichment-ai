import { createClient } from "@/lib/supabase-browser";

export async function checkCredits(workspaceId: string, requiredAmount: number): Promise<{ hasEnough: boolean; remaining: number; total: number }> {
  const supabase = createClient();
  const { data: sub } = await supabase
    .from("workspace_subscriptions")
    .select("credits_used, subscription_plans(monthly_ai_credits)")
    .eq("workspace_id", workspaceId)
    .single();

  if (!sub) return { hasEnough: false, remaining: 0, total: 0 };

  const total = (sub.subscription_plans as any)?.monthly_ai_credits ?? 0;
  const used = sub.credits_used ?? 0;
  const remaining = Math.max(0, total - used);

  return { hasEnough: remaining >= requiredAmount, remaining, total };
}

export async function deductCredits(
  workspaceId: string,
  amount: number,
  operation: string,
  entityType?: string,
  entityId?: string,
  details?: Record<string, any>
): Promise<{ success: boolean; remaining: number }> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error("Not authenticated");

  // Atomic deduction via SQL function (prevents race conditions)
  const { data, error } = await supabase.rpc("deduct_credits", {
    ws_id: workspaceId,
    amount,
    op: operation,
    uid: user.id,
    e_type: entityType || null,
    e_id: entityId || null,
    e_details: details || {},
  });

  if (error) throw new Error(`Credit deduction failed: ${error.message}`);

  const result = data as { success: boolean; remaining: number; error?: string };
  if (!result.success) {
    throw new Error(result.error || `Insufficient credits.`);
  }

  return { success: true, remaining: result.remaining };
}

export async function getBalance(workspaceId: string): Promise<{ used: number; total: number; remaining: number }> {
  const supabase = createClient();
  const { data: sub } = await supabase
    .from("workspace_subscriptions")
    .select("credits_used, subscription_plans(monthly_ai_credits)")
    .eq("workspace_id", workspaceId)
    .single();

  if (!sub) return { used: 0, total: 0, remaining: 0 };

  const total = (sub.subscription_plans as any)?.monthly_ai_credits ?? 0;
  const used = sub.credits_used ?? 0;
  return { used, total, remaining: Math.max(0, total - used) };
}

export async function logTransaction(
  workspaceId: string,
  operation: string,
  creditsUsed: number,
  entityType?: string,
  entityId?: string,
  details?: Record<string, any>
) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return;

  await supabase.from("credit_transactions").insert({
    workspace_id: workspaceId,
    user_id: user.id,
    operation,
    credits_used: creditsUsed,
    entity_type: entityType,
    entity_id: entityId,
    details: details || {},
  });
}
