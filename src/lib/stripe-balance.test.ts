import { describe, expect, it } from "vitest";
import { calculateCreditBalance, isSubscriptionActive } from "./stripe";

describe("isSubscriptionActive", () => {
  it("treats paid active as active", () => {
    expect(isSubscriptionActive("active")).toBe(true);
  });

  it("treats a future trial as active", () => {
    const trialEnd = new Date(Date.now() + 86_400_000).toISOString();
    expect(isSubscriptionActive("trialing", trialEnd)).toBe(true);
  });

  it("treats an elapsed trial as inactive even if status is still trialing", () => {
    const trialEnd = new Date(Date.now() - 1000).toISOString();
    expect(isSubscriptionActive("trialing", trialEnd)).toBe(false);
  });
});

describe("calculateCreditBalance", () => {
  it("uses the plan monthly allotment for remaining credits", () => {
    const bal = calculateCreditBalance({
      status: "active",
      billing_cycle: "monthly",
      credits_used: 291.05,
      bonus_credits: 1000,
      subscription_plans: { monthly_ai_credits: 7000 },
    });
    expect(bal.monthlyTotal).toBe(7000);
    expect(bal.used).toBe(291.05);
    expect(bal.monthlyRemaining).toBe(6708.95);
    expect(bal.bonus).toBe(1000);
    expect(bal.total).toBe(7708.95);
    expect(bal.canUseCredits).toBe(true);
  });

  it("multiplies yearly billing by 12", () => {
    const bal = calculateCreditBalance({
      status: "active",
      billing_cycle: "yearly",
      credits_used: 0,
      bonus_credits: 0,
      subscription_plans: { monthly_ai_credits: 3200 },
    });
    expect(bal.monthlyTotal).toBe(38400);
    expect(bal.total).toBe(38400);
  });

  it("caps a live trial at 100 credits minus usage", () => {
    const trialEnd = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const bal = calculateCreditBalance({
      status: "trialing",
      billing_cycle: "monthly",
      credits_used: 12.5,
      bonus_credits: 0,
      trial_end: trialEnd,
      subscription_plans: { monthly_ai_credits: 100 },
    });
    expect(bal.monthlyTotal).toBe(100);
    expect(bal.monthlyRemaining).toBe(87.5);
    expect(bal.total).toBe(87.5);
    expect(bal.canUseCredits).toBe(true);
  });

  it("zeros spendable credits when the trial window has ended", () => {
    const bal = calculateCreditBalance({
      status: "trialing",
      billing_cycle: "monthly",
      credits_used: 12.5,
      bonus_credits: 0,
      trial_end: new Date(Date.now() - 1000).toISOString(),
      subscription_plans: { monthly_ai_credits: 100 },
    });
    expect(bal.canUseCredits).toBe(false);
    expect(bal.total).toBe(0);
    expect(bal.monthlyRemaining).toBe(0);
  });
});
