import { describe, expect, it } from "vitest";
import {
  capacityContinueMessage,
  customerMessage,
  isCapacityError,
  isCorruptMemory,
  isNetworkFailure,
  isRateLimited,
  untilSaved,
} from "../../src/store-agent/runner";

describe("customerMessage", () => {
  it("hides problems with our model account behind a neutral message", () => {
    for (const internal of [
      "You have an unpaid invoice Pay your unpaid invoice at [cursor.com/dashboard/billing](https://cursor.com/dashboard/billing) to resume requests.",
      "Rate limit exceeded",
      "You have reached your usage limit",
    ]) {
      const shown = customerMessage(internal);
      expect(shown).toMatch(/temporarily unavailable/);
      expect(shown).not.toMatch(/invoice|cursor/i);
    }
  });

  it("tells the customer when the chat is too long for the model", () => {
    expect(customerMessage("prompt is too long: 1200000 tokens")).toMatch(/new chat/);
  });

  it("tells the customer to continue after the agent was exhausted", () => {
    expect(customerMessage("[resource_exhausted] Error")).toMatch(/continue/);
  });

  it("asks the customer to resend after a dropped connection", () => {
    expect(customerMessage("Network request failed")).toMatch(/send your message again/);
  });

  it("falls back to a generic message", () => {
    expect(customerMessage("something odd")).toBe("The agent ran into a problem. Please try again.");
  });
});

describe("isNetworkFailure", () => {
  it("recognises requests that never reached Cursor", () => {
    expect(isNetworkFailure(Object.assign(new Error("Network request failed"), { name: "NetworkError", isRetryable: true }))).toBe(true);
    expect(isNetworkFailure(new Error("fetch failed", { cause: new Error("UND_ERR_CONNECT_TIMEOUT") }))).toBe(true);
    expect(isNetworkFailure(new Error("You have an unpaid invoice"))).toBe(false);
  });
});

describe("model capacity and rate limits", () => {
  it("recognises a model at capacity by code or text", () => {
    expect(isCapacityError({ message: "Error", code: "resource_exhausted" })).toBe(true);
    expect(isCapacityError({ message: "[resource_exhausted] Error" })).toBe(true);
    expect(isCapacityError({ message: "You have an unpaid invoice" })).toBe(false);
    expect(isCapacityError(undefined)).toBe(false);
  });

  it("tells the agent what was already applied when it continues", () => {
    expect(capacityContinueMessage(["Set 3 prices"])).toContain('"Set 3 prices"');
    expect(capacityContinueMessage([])).toContain("No store change");
  });

  it("recognises Cursor's per-minute limits", () => {
    const limited = Object.assign(new Error("You have exceeded the rate limit of 30 requests per minute for the get_models endpoint."), { name: "RateLimitError" });
    expect(isRateLimited(limited)).toBe(true);
    expect(isRateLimited(new Error("fetch failed"))).toBe(false);
  });
});

describe("untilSaved", () => {
  it("waits out a dropped connection and stops on other errors", async () => {
    const logs: string[] = [];
    let calls = 0;
    const saved = await untilSaved("reply", (m) => logs.push(m), async () => (++calls < 3 ? { message: "TypeError: fetch failed" } : null), [1, 1, 1]);
    expect(saved).toBe(true);
    expect(calls).toBe(3);

    calls = 0;
    const refused = await untilSaved("reply", (m) => logs.push(m), async () => (++calls, { message: "permission denied" }), [1, 1, 1]);
    expect(refused).toBe(false);
    expect(calls).toBe(1);

    calls = 0;
    const down = await untilSaved("reply", (m) => logs.push(m), async () => (++calls, new Error("fetch failed")), [1, 1]);
    expect(down).toBe(false);
    expect(calls).toBe(3);
  });
});

describe("isCorruptMemory", () => {
  it("recognises a checkpoint that cannot be loaded", () => {
    expect(isCorruptMemory(new Error("Corrupt local agent checkpoint: missing root blob"))).toBe(true);
    expect(isCorruptMemory(new Error("network down"))).toBe(false);
    expect(isCorruptMemory("missing root blob")).toBe(false);
  });
});
