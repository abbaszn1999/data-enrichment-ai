import { describe, it, expect, beforeEach } from "vitest";
import { fetchWithServerCache, invalidateServerAnalyticsCache, analyticsPropertiesCacheKey } from "./cache";

describe("analytics server cache", () => {
  beforeEach(() => {
    invalidateServerAnalyticsCache();
  });

  it("returns cached data within TTL without re-fetching", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return { value: 42 };
    };

    const first = await fetchWithServerCache("key1", fetcher, 1000);
    const second = await fetchWithServerCache("key1", fetcher, 1000);

    expect(first).toEqual({ value: 42 });
    expect(second).toEqual({ value: 42 });
    expect(calls).toBe(1);
  });

  it("bypasses cache when forceRefresh is true", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return { count: calls };
    };

    const first = await fetchWithServerCache("key2", fetcher, 1000);
    expect(first).toEqual({ count: 1 });

    const second = await fetchWithServerCache("key2", fetcher, 1000, true);
    expect(second).toEqual({ count: 2 });
    expect(calls).toBe(2);
  });

  it("invalidates cache entries by workspace id", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return { ok: true };
    };

    await fetchWithServerCache("gsc:ws-123:pages", fetcher, 1000);
    await fetchWithServerCache("gsc:ws-999:pages", fetcher, 1000);

    invalidateServerAnalyticsCache("ws-123");

    await fetchWithServerCache("gsc:ws-123:pages", fetcher, 1000);
    await fetchWithServerCache("gsc:ws-999:pages", fetcher, 1000);

    // ws-123 called twice, ws-999 called once
    expect(calls).toBe(3);
  });

  it("keys property listings by workspace and connection type", () => {
    expect(analyticsPropertiesCacheKey("ws-1", "google-analytics")).toBe(
      "properties:ws-1:google-analytics"
    );
  });
});
