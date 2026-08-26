import { describe, expect, it } from "vitest";
import { isInsufficientCredits } from "./credits";

describe("isInsufficientCredits", () => {
  it("matches the deduct_user_credits error", () => {
    expect(isInsufficientCredits("Insufficient credits")).toBe(true);
    expect(isInsufficientCredits("NO_CREDITS")).toBe(true);
    expect(isInsufficientCredits("no active subscription")).toBe(true);
    expect(isInsufficientCredits("Row not found")).toBe(false);
    expect(isInsufficientCredits(undefined)).toBe(false);
  });
});
