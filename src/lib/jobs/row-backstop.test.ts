import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withRowBackstop } from "./row-backstop";

describe("withRowBackstop", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns the row's result when it finishes in time", async () => {
    const work = new Promise<string>((resolve) => setTimeout(() => resolve("done"), 100));
    const pending = withRowBackstop(work, 1_000, () => "timed out");
    await vi.advanceTimersByTimeAsync(100);
    await expect(pending).resolves.toBe("done");
  });

  it("turns a row that never finishes into a failed row", async () => {
    const pending = withRowBackstop(new Promise<string>(() => undefined), 1_000, () => "timed out");
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toBe("timed out");
  });

  it("passes a row's own error through instead of masking it", async () => {
    const work = Promise.reject(new Error("boom"));
    await expect(withRowBackstop(work, 1_000, () => "timed out")).rejects.toThrow("boom");
  });

  it("leaves no timer behind once the row is done", async () => {
    await withRowBackstop(Promise.resolve("ok"), 1_000, () => "timed out");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not raise an unhandled rejection when an abandoned row fails later", async () => {
    let rejectLate: (error: Error) => void = () => undefined;
    const work = new Promise<string>((_, reject) => {
      rejectLate = reject;
    });
    const pending = withRowBackstop(work, 1_000, () => "timed out");
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toBe("timed out");
    rejectLate(new Error("late failure"));
    await vi.advanceTimersByTimeAsync(0);
  });
});
