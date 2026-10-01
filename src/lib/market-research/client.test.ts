import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PUSH_CHUNK_SIZE,
  pushCollectionsApi,
  SYNC_SEO_CHUNK_SIZE,
  syncSeoApi,
} from "./client";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `c${i}`);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A push endpoint that publishes every id it is sent, for $5 each. */
function pushEndpoint() {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const { collectionIds } = JSON.parse(String(init.body)) as { collectionIds: string[] };
    return json({
      ok: true,
      chargedUsd: collectionIds.length * 5,
      refundedUsd: 0,
      pushedCount: collectionIds.length,
      failedCount: 0,
      pushedIds: collectionIds,
      storeResults: collectionIds.map((id) => ({ id, name: id, success: true, handle: `h-${id}` })),
    });
  });
}

describe("pushCollectionsApi", () => {
  it("sends a small push as one request", async () => {
    const fetchMock = pushEndpoint();
    vi.stubGlobal("fetch", fetchMock);
    const result = await pushCollectionsApi("w", "p", ids(PUSH_CHUNK_SIZE));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.pushedIds).toHaveLength(PUSH_CHUNK_SIZE);
  });

  it("splits a large push into short requests and totals the result", async () => {
    const fetchMock = pushEndpoint();
    vi.stubGlobal("fetch", fetchMock);
    const progress: number[] = [];
    const total = PUSH_CHUNK_SIZE * 3 + 7;
    const result = await pushCollectionsApi("w", "p", ids(total), (p) => progress.push(p.done));

    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const call of fetchMock.mock.calls) {
      const sent = JSON.parse(String(call[1].body)).collectionIds as string[];
      expect(sent.length).toBeLessThanOrEqual(PUSH_CHUNK_SIZE);
    }
    expect(result.pushedCount).toBe(total);
    expect(result.failedCount).toBe(0);
    expect(result.chargedUsd).toBe(total * 5);
    expect(result.pushedIds).toEqual(ids(total));
    expect(result.storeResults).toHaveLength(total);
    expect(progress).toEqual([25, 50, 75, total]);
  });

  it("keeps what was published and reports the rest when the wallet runs out", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      calls += 1;
      const { collectionIds } = JSON.parse(String(init.body)) as { collectionIds: string[] };
      if (calls === 3) return json({ error: "Not enough wallet balance" }, 402);
      return json({
        ok: true,
        chargedUsd: collectionIds.length * 5,
        pushedCount: collectionIds.length,
        failedCount: 0,
        pushedIds: collectionIds,
        storeResults: [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const total = PUSH_CHUNK_SIZE * 4;
    const result = await pushCollectionsApi("w", "p", ids(total));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.pushedCount).toBe(PUSH_CHUNK_SIZE * 2);
    expect(result.failedCount).toBe(PUSH_CHUNK_SIZE * 2);
    expect(result.chargedUsd).toBe(PUSH_CHUNK_SIZE * 2 * 5);
    expect(result.stoppedReason).toBe("Not enough wallet balance");
    expect(result.pushedIds).toHaveLength(PUSH_CHUNK_SIZE * 2);
  });

  it("throws when the very first request is refused, as a single push does", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: "Not enough wallet balance" }, 402))
    );
    await expect(pushCollectionsApi("w", "p", ids(PUSH_CHUNK_SIZE * 2))).rejects.toThrow(
      "Not enough wallet balance"
    );
  });
});

describe("syncSeoApi", () => {
  const endpoint = (failOn?: number) => {
    let calls = 0;
    return vi.fn(async (_url: string, init: RequestInit) => {
      calls += 1;
      const { collectionIds } = JSON.parse(String(init.body)) as { collectionIds?: string[] };
      if (failOn === calls) return json({ error: "store timeout" }, 502);
      const list = collectionIds ?? [];
      return json({
        ok: true,
        syncedCount: list.length,
        results: list.map((collectionId) => ({ collectionId, ok: true })),
      });
    });
  };

  it("sends no ids through untouched so the server picks its own targets", async () => {
    const fetchMock = endpoint();
    vi.stubGlobal("fetch", fetchMock);
    await syncSeoApi("w", "p");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).collectionIds).toBeUndefined();
  });

  it("chunks many ids and merges the per-collection results", async () => {
    const fetchMock = endpoint();
    vi.stubGlobal("fetch", fetchMock);
    const total = SYNC_SEO_CHUNK_SIZE * 2 + 3;
    const result = await syncSeoApi("w", "p", ids(total));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.ok).toBe(true);
    expect(result.syncedCount).toBe(total);
    expect(result.results).toHaveLength(total);
  });

  it("marks a failed chunk's collections failed and still syncs the rest", async () => {
    const fetchMock = endpoint(2);
    vi.stubGlobal("fetch", fetchMock);
    const total = SYNC_SEO_CHUNK_SIZE * 3;
    const result = await syncSeoApi("w", "p", ids(total));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.ok).toBe(false);
    expect(result.syncedCount).toBe(SYNC_SEO_CHUNK_SIZE * 2);
    const failed = (result.results ?? []).filter((r) => !r.ok);
    expect(failed).toHaveLength(SYNC_SEO_CHUNK_SIZE);
    expect(failed[0].error).toBe("store timeout");
  });
});
