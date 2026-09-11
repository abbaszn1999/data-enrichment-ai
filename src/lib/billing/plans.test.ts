import { describe, expect, it } from "vitest";
import {
  ENTERPRISE_CONTACT_URL,
  LIVE_STRIPE_CATALOG,
  PLAN_CATALOG,
  buildPublicCheckoutPlans,
  checkoutBlockedReason,
  isContactPlanName,
  isGrandfatheredPlanName,
  isSelfServePlanName,
} from "./plans";

describe("OS billing catalog", () => {
  it("keeps Growth and Pro as Stripe self-serve at marketing prices", () => {
    expect(PLAN_CATALOG.growth.priceMonthly).toBe(1500);
    expect(PLAN_CATALOG.growth.monthlyCredits).toBe(3200);
    expect(PLAN_CATALOG.growth.maxWorkspaces).toBe(2);
    expect(PLAN_CATALOG.growth.maxMembers).toBe(10);
    expect(PLAN_CATALOG.growth.checkout).toBe("stripe");
    expect(PLAN_CATALOG.pro.priceMonthly).toBe(2500);
    expect(PLAN_CATALOG.pro.monthlyCredits).toBe(7000);
    expect(PLAN_CATALOG.pro.maxWorkspaces).toBe(5);
    expect(PLAN_CATALOG.pro.maxMembers).toBe(20);
    expect(PLAN_CATALOG.pro.checkout).toBe("stripe");
  });

  it("treats Enterprise as a marketing-quote CTA, not a Stripe product", () => {
    expect(PLAN_CATALOG.enterprise.checkout).toBe("contact");
    expect(PLAN_CATALOG.enterprise.priceMonthly).toBeNull();
    expect(ENTERPRISE_CONTACT_URL).toBe("https://autommerce.com/contact?plan=enterprise");
    expect(isContactPlanName("enterprise")).toBe(true);
    expect(isSelfServePlanName("enterprise")).toBe(false);
  });

  it("hides Starter from new checkout while keeping it recognizable internally", () => {
    expect(isGrandfatheredPlanName("starter")).toBe(true);
    expect(isSelfServePlanName("starter")).toBe(false);
    expect(
      checkoutBlockedReason(
        { name: "starter", stripe_price_monthly_id: "price_legacy" },
        "monthly"
      )
    ).toMatch(/no longer offered/i);
  });

  it("blocks Enterprise and trial from Stripe checkout", () => {
    expect(checkoutBlockedReason({ name: "enterprise" }, "monthly")).toMatch(/quote-only/i);
    expect(checkoutBlockedReason({ name: "trial" }, "monthly")).toMatch(/cannot be purchased/i);
    expect(
      checkoutBlockedReason(
        { name: "growth", stripe_price_monthly_id: null, stripe_price_yearly_id: null },
        "monthly"
      )
    ).toMatch(/not configured/i);
    expect(
      checkoutBlockedReason(
        {
          name: "growth",
          stripe_price_monthly_id: LIVE_STRIPE_CATALOG.growth.priceMonthlyId,
        },
        "monthly"
      )
    ).toBeNull();
  });

  it("builds three public cards and never includes Starter", () => {
    const cards = buildPublicCheckoutPlans([
      {
        id: "g1",
        name: "starter",
        stripe_price_monthly_id: "price_starter",
      },
      {
        id: "g2",
        name: "growth",
        stripe_price_monthly_id: LIVE_STRIPE_CATALOG.growth.priceMonthlyId,
      },
    ]);
    expect(cards.map((card) => card.name)).toEqual(["growth", "pro", "enterprise"]);
    expect(cards[0].id).toBe("g2");
    expect(cards[0].monthly_ai_credits).toBe(3200);
    expect(cards[0].price_monthly).toBe(1500);
    expect(cards[2].checkout).toBe("contact");
    expect(cards[2].id).toBe("catalog:enterprise");
    expect(cards[2].price_monthly).toBeNull();
  });
});
