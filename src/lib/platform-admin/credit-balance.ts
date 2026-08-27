import { roundCredits } from "@/lib/format-credits";

export function unwrapRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** Same rules as calculateCreditBalance: yearly allotment is monthly * 12, bonus is separate, cancelled/expired are unusable. */
export function adminCreditBalance(input: {
  status: string | null | undefined;
  billingCycle: string | null | undefined;
  creditsUsed: number;
  bonusCredits: number;
  monthlyAiCredits: number;
}): { periodCredits: number; remaining: number } {
  const active = input.status === "active" || input.status === "trialing";
  const monthly = roundCredits(Number(input.monthlyAiCredits || 0));
  const periodCredits = input.billingCycle === "yearly" ? roundCredits(monthly * 12) : monthly;
  const used = roundCredits(Number(input.creditsUsed || 0));
  const bonus = roundCredits(Number(input.bonusCredits || 0));
  const monthlyRemaining = active ? roundCredits(Math.max(0, periodCredits - used)) : 0;
  const bonusAvailable = active ? bonus : 0;
  return {
    periodCredits,
    remaining: roundCredits(monthlyRemaining + bonusAvailable),
  };
}
