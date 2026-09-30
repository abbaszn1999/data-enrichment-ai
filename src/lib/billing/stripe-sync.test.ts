import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { invoiceSubscriptionId, shouldResetForPaidPeriod, toStoredStatus } from "./stripe-sync";

const invoice = (value: Record<string, unknown>) => value as unknown as Stripe.Invoice;

describe("invoiceSubscriptionId", () => {
  it("reads the basil parent.subscription_details location", () => {
    expect(
      invoiceSubscriptionId(invoice({ parent: { subscription_details: { subscription: "sub_1" } } }))
    ).toBe("sub_1");
  });

  it("falls back to the legacy field and expanded objects", () => {
    expect(invoiceSubscriptionId(invoice({ subscription: "sub_2" }))).toBe("sub_2");
    expect(invoiceSubscriptionId(invoice({ subscription: { id: "sub_3" } }))).toBe("sub_3");
    expect(invoiceSubscriptionId(invoice({}))).toBeNull();
  });
});

describe("shouldResetForPaidPeriod", () => {
  const periodStartIso = "2026-10-01T00:00:00.000Z";

  it("resets once when a new paid period starts", () => {
    expect(
      shouldResetForPaidPeriod({ status: "active", periodStartIso, creditsResetAt: "2026-09-01T00:00:05.000Z" })
    ).toBe(true);
  });

  it("does not reset again for the same period or mid-period invoices", () => {
    expect(
      shouldResetForPaidPeriod({ status: "active", periodStartIso, creditsResetAt: "2026-10-01T00:00:03.000Z" })
    ).toBe(false);
    expect(
      shouldResetForPaidPeriod({ status: "active", periodStartIso, creditsResetAt: "2026-10-12T09:00:00.000Z" })
    ).toBe(false);
  });

  it("never resets for a subscription that is not active", () => {
    expect(shouldResetForPaidPeriod({ status: "past_due", periodStartIso, creditsResetAt: null })).toBe(false);
    expect(shouldResetForPaidPeriod({ status: "cancelled", periodStartIso, creditsResetAt: null })).toBe(false);
  });
});

describe("toStoredStatus", () => {
  it("maps Stripe spellings to stored statuses", () => {
    expect(toStoredStatus("canceled")).toBe("cancelled");
    expect(toStoredStatus("incomplete_expired")).toBe("expired");
    expect(toStoredStatus("unpaid")).toBe("unpaid");
  });
});
