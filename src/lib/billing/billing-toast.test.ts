import { describe, expect, it } from "vitest";
import { billingBlockReason } from "./billing-toast";

describe("billingBlockReason", () => {
  it("recognises subscription blocks", () => {
    expect(billingBlockReason(402, "NO_SUBSCRIPTION")).toBe("no_subscription");
    expect(billingBlockReason(402, "INACTIVE_SUBSCRIPTION")).toBe("no_subscription");
    expect(billingBlockReason(402, "An active subscription is required")).toBe("no_subscription");
  });

  it("recognises credit blocks", () => {
    expect(billingBlockReason(402, "NO_CREDITS")).toBe("no_credits");
    expect(billingBlockReason(402, "INSUFFICIENT_CREDITS")).toBe("no_credits");
    expect(billingBlockReason(500, "Credit deduction rejected: Insufficient credits")).toBe("no_credits");
    expect(billingBlockReason(402, undefined)).toBe("no_credits");
  });

  it("ignores unrelated errors", () => {
    expect(billingBlockReason(500, "Generation failed")).toBeNull();
    expect(billingBlockReason(409, "Settings changed")).toBeNull();
  });
});
