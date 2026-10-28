import dns from "node:dns";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cachedLookup } from "../../src/dns-cache";

const lookup = (host: string, options: { all?: boolean; family?: number } = {}) =>
  new Promise<{ error: unknown; address: unknown; family?: number }>((resolve) =>
    cachedLookup(host, options, (error, address, family) => resolve({ error, address, family }))
  );

describe("cached DNS lookup", () => {
  afterEach(() => vi.restoreAllMocks());

  it("answers from the last good lookup when the resolver fails", async () => {
    const spy = vi.spyOn(dns, "lookup");
    spy.mockImplementationOnce(((_h: string, _o: unknown, cb: (e: null, a: Array<{ address: string; family: number }>) => void) =>
      cb(null, [{ address: "1.2.3.4", family: 4 }])) as never);
    expect(await lookup("flaky.example")).toMatchObject({ error: null, address: "1.2.3.4", family: 4 });

    // Fresh answers are reused without asking the resolver again.
    expect(await lookup("flaky.example")).toMatchObject({ address: "1.2.3.4" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("falls back to a stale answer when a fresh lookup fails", async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(dns, "lookup");
    spy.mockImplementationOnce(((_h: string, _o: unknown, cb: (e: null, a: Array<{ address: string; family: number }>) => void) =>
      cb(null, [{ address: "5.6.7.8", family: 4 }])) as never);
    await lookup("stale.example");
    vi.advanceTimersByTime(10 * 60 * 1000);
    spy.mockImplementationOnce(((_h: string, _o: unknown, cb: (e: Error) => void) =>
      cb(Object.assign(new Error("getaddrinfo ENOTFOUND stale.example"), { code: "ENOTFOUND" }))) as never);
    expect(await lookup("stale.example", { all: true })).toMatchObject({ error: null, address: [{ address: "5.6.7.8", family: 4 }] });
    vi.useRealTimers();
  });

  it("reports the failure when nothing was ever resolved", async () => {
    vi.spyOn(dns, "lookup").mockImplementationOnce(((_h: string, _o: unknown, cb: (e: Error) => void) =>
      cb(Object.assign(new Error("getaddrinfo ENOTFOUND never.example"), { code: "ENOTFOUND" }))) as never);
    const res = await lookup("never.example");
    expect((res.error as { code?: string }).code).toBe("ENOTFOUND");
  });
});
