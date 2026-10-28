import { describe, expect, it } from "vitest";
import { contextWindowFor, effectiveRates, estimateUsd, priceSheet, usdToCredits } from "../../../src/lib/store-agent/pricing";

const M = 1_000_000;
const usage = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({
  inputTokens: input,
  outputTokens: output,
  cacheReadTokens: cacheRead,
  cacheWriteTokens: cacheWrite,
});

describe("Store Agent pricing (Cursor rates)", () => {
  it("prices Composer 2.5 standard and Fast", () => {
    expect(estimateUsd("composer-2.5", [{ id: "fast", value: "false" }], usage(M, M))).toBeCloseTo(0.5 + 2.5);
    expect(estimateUsd("composer-2.5", [{ id: "fast", value: "true" }], usage(M, M))).toBeCloseTo(3 + 15);
    // Cursor lists Composer Fast outright: cache reads are $0.5, not a multiple of $0.2.
    expect(effectiveRates("composer-2.5", [{ id: "fast", value: "true" }]).cacheRead).toBe(0.5);
  });

  it("prices Grok 4.7 with Fast and long context", () => {
    const std = [{ id: "context", value: "256k" }, { id: "fast", value: "false" }];
    const fast = [{ id: "context", value: "256k" }, { id: "fast", value: "true" }];
    expect(effectiveRates("grok-4.7", std)).toEqual({ input: 2, cacheWrite: 2, cacheRead: 0.5, output: 6 });
    expect(effectiveRates("grok-4.7", fast)).toEqual({ input: 4, cacheWrite: 4, cacheRead: 1, output: 12 });
    // Above 256K per call: 2x standard, 3x with Fast (Cursor: $4/$1/$12 and $6/$1.5/$18).
    expect(effectiveRates("grok-4.7", std, 300_000)).toEqual({ input: 4, cacheWrite: 4, cacheRead: 1, output: 12 });
    expect(effectiveRates("grok-4.7", fast, 300_000)).toEqual({ input: 6, cacheWrite: 6, cacheRead: 1.5, output: 18 });
  });

  it("prices Gemini 4 Argon and Claude Sonnet 5.5 (no long-context surcharge)", () => {
    expect(estimateUsd("gemini-4-argon", [], usage(M, M, 0.5 * M))).toBeCloseTo(0.5 * 2 + 0.5 * 0.1 + 10);
    expect(estimateUsd("claude-sonnet-5-5", [{ id: "context", value: "1m" }], usage(M, 0, 0, M), 1)).toBeCloseTo(2.5);
  });

  it("prices GPT-5.6 Sol: Fast doubles, long context doubles input only", () => {
    const std = [{ id: "context", value: "1m" }, { id: "fast", value: "false" }];
    const fast = [{ id: "context", value: "1m" }, { id: "fast", value: "true" }];
    expect(effectiveRates("gpt-5.6-sol", std)).toEqual({ input: 4, cacheWrite: 5, cacheRead: 0.4, output: 20 });
    expect(effectiveRates("gpt-5.6-sol", fast)).toEqual({ input: 8, cacheWrite: 10, cacheRead: 0.8, output: 40 });
    expect(effectiveRates("gpt-5.6-sol", std, 400_000)).toEqual({ input: 8, cacheWrite: 10, cacheRead: 0.8, output: 20 });
    expect(effectiveRates("gpt-5.6-sol", fast, 400_000)).toEqual({ input: 16, cacheWrite: 20, cacheRead: 1.6, output: 40 });
  });

  it("decides long context per model call, not per run total", () => {
    const std = [{ id: "context", value: "500k" }, { id: "fast", value: "false" }];
    // 3 calls of 150K each: no call is above 256K.
    expect(estimateUsd("grok-4.7", std, usage(450_000, 0), 3)).toBeCloseTo(0.45 * 2);
    expect(estimateUsd("grok-4.7", std, usage(450_000, 0), 1)).toBeCloseTo(0.45 * 4);
  });

  it("matches the worked example: Sonnet 5.5, 200K prompt with 150K cached, 5K output", () => {
    const usd = estimateUsd("claude-sonnet-5-5", [], usage(200_000, 5_000, 150_000));
    expect(usd).toBeCloseTo(0.1 + 0.015 + 0.05);
    expect(usdToCredits(usd)).toBe(1.65);
  });

  it("converts at 10 credits per dollar, rounding up to 0.001", () => {
    expect(usdToCredits(1)).toBe(10);
    expect(usdToCredits(0.0001)).toBe(0.001);
    expect(usdToCredits(0.07)).toBe(0.7);
    expect(usdToCredits(0)).toBe(0);
  });

  it("reports context windows from the params", () => {
    expect(contextWindowFor("gpt-5.6-sol", [{ id: "context", value: "1m" }])).toBe(1_000_000);
    expect(contextWindowFor("gpt-5.6-sol", [])).toBe(272_000);
    expect(contextWindowFor("composer-2.5", [])).toBe(200_000);
    expect(priceSheet("gpt-5.6-sol", [])?.note).toMatch(/November 21, 2026/);
  });
});
