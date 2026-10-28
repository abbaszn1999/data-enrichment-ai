import { describe, expect, it, vi } from "vitest";
import { createResilientFetch } from "../../src/store-agent/resilient-fetch";

describe("resilient fetch", () => {
  it("retries network failures and then succeeds", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const base = (async () => {
      calls++;
      if (calls < 3) throw new TypeError("fetch failed");
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    const pending = createResilientFetch(base)("https://x.supabase.co/rest/v1/t", { method: "POST", body: "{}" });
    await vi.runAllTimersAsync();
    const res = await pending;
    expect(res.status).toBe(200);
    expect(calls).toBe(3);
    vi.useRealTimers();
  });

  it("returns HTTP errors without retrying", async () => {
    let calls = 0;
    const base = (async () => {
      calls++;
      return new Response("nope", { status: 500 });
    }) as typeof fetch;
    const res = await createResilientFetch(base)("https://x.supabase.co/rest/v1/t");
    expect(res.status).toBe(500);
    expect(calls).toBe(1);
  });

  it("gives up after the last retry", async () => {
    vi.useFakeTimers();
    const base = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const pending = createResilientFetch(base)("https://x.supabase.co/storage/v1/object/a");
    const assertion = expect(pending).rejects.toThrow("fetch failed");
    await vi.runAllTimersAsync();
    await assertion;
    vi.useRealTimers();
  });

  it("resends a streamed body on retry", async () => {
    const seen: string[] = [];
    let calls = 0;
    const base = (async (_input: unknown, init?: RequestInit) => {
      calls++;
      seen.push(new TextDecoder().decode(init?.body as ArrayBuffer));
      if (calls === 1) throw new TypeError("fetch failed");
      return new Response("ok");
    }) as typeof fetch;
    const body = new Blob(["hello"]).stream();
    // Real timers: reading the stream needs the event loop (one 400ms retry delay).
    await createResilientFetch(base)("https://x.supabase.co/storage/v1/object/a", { method: "POST", body, duplex: "half" } as RequestInit);
    expect(seen).toEqual(["hello", "hello"]);
  });
});
