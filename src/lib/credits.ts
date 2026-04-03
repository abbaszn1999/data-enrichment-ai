// Client-side credit helpers — per-user model
// All credit operations now go through API routes that use getOwnerSubscription

export async function checkCredits(workspaceId: string, requiredAmount: number): Promise<{ hasEnough: boolean; remaining: number; total: number }> {
  const balance = await getBalance(workspaceId);
  return { hasEnough: balance.remaining >= requiredAmount, remaining: balance.remaining, total: balance.total };
}

export async function deductCredits(
  workspaceId: string,
  amount: number,
  operation: string,
  entityType?: string,
  entityId?: string,
  details?: Record<string, any>
): Promise<{ success: boolean; remaining: number }> {
  const res = await fetch("/api/credits/deduct", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, amount, operation, entityType, entityId, details }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || "Credit deduction failed");
  }

  return { success: true, remaining: data.remaining };
}

export async function getBalance(workspaceId: string): Promise<{ used: number; total: number; bonus: number; remaining: number }> {
  const res = await fetch(`/api/credits?workspaceId=${workspaceId}`);
  if (!res.ok) return { used: 0, total: 0, bonus: 0, remaining: 0 };
  const data = await res.json();
  return {
    used: data.balance?.used ?? 0,
    total: data.balance?.total ?? 0,
    bonus: data.balance?.bonus ?? 0,
    remaining: data.balance?.remaining ?? 0,
  };
}

export async function getCreditBalance(workspaceId: string) {
  return getBalance(workspaceId);
}
