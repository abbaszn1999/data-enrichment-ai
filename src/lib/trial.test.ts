import { describe, expect, it } from "vitest";
import {
  isEligibleForTrial,
  isTrialPlanName,
  trialDaysRemaining,
  TRIAL_CREDITS,
  TRIAL_DAYS,
} from "./trial";

describe("isEligibleForTrial", () => {
  it("allows a user with no subscription row", () => {
    expect(isEligibleForTrial(null)).toBe(true);
  });

  it("rejects anyone who already used a trial", () => {
    expect(
      isEligibleForTrial({
        has_used_trial: true,
        status: "expired",
        stripe_subscription_id: null,
      })
    ).toBe(false);
  });

  it("rejects anyone with a Stripe subscription id", () => {
    expect(
      isEligibleForTrial({
        has_used_trial: false,
        status: "cancelled",
        stripe_subscription_id: "sub_123",
      })
    ).toBe(false);
  });

  it("rejects active, trialing, past_due, cancelled, and expired rows", () => {
    expect(isEligibleForTrial({ status: "active" })).toBe(false);
    expect(isEligibleForTrial({ status: "trialing" })).toBe(false);
    expect(isEligibleForTrial({ status: "past_due" })).toBe(false);
    expect(isEligibleForTrial({ status: "cancelled" })).toBe(false);
    expect(isEligibleForTrial({ status: "expired" })).toBe(false);
  });

  it("does not re-grant after an expired trial", () => {
    expect(
      isEligibleForTrial({
        has_used_trial: true,
        status: "expired",
        stripe_subscription_id: null,
      })
    ).toBe(false);
  });

  it("does not grant a trial to a cancelled paid subscriber", () => {
    expect(
      isEligibleForTrial({
        has_used_trial: false,
        status: "cancelled",
        stripe_subscription_id: null,
      })
    ).toBe(false);
  });
});

describe("trial helpers", () => {
  it("exposes 14 days and 100 credits", () => {
    expect(TRIAL_DAYS).toBe(14);
    expect(TRIAL_CREDITS).toBe(100);
    expect(isTrialPlanName("trial")).toBe(true);
    expect(isTrialPlanName("starter")).toBe(false);
  });

  it("counts remaining calendar days and clamps expired trials at 0", () => {
    const now = new Date("2026-09-09T12:00:00.000Z");
    expect(trialDaysRemaining("2026-09-23T12:00:00.000Z", now)).toBe(14);
    expect(trialDaysRemaining("2026-09-10T12:00:00.000Z", now)).toBe(1);
    expect(trialDaysRemaining("2026-09-01T12:00:00.000Z", now)).toBe(0);
    expect(trialDaysRemaining(null, now)).toBe(0);
  });
});
