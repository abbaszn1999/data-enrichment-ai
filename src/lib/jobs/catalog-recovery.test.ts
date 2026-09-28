import { describe, expect, it, vi } from "vitest";

vi.mock("./dispatch", () => ({ dispatchJob: vi.fn() }));
vi.mock("./project-json", () => ({ loadProjectJsonAdmin: vi.fn() }));
vi.mock("./repo", () => ({ claimStaleJobRun: vi.fn(), finishJobRun: vi.fn(), loadJobRun: vi.fn() }));

const { isCatalogWorkerStale } = await import("./catalog-recovery");
const { CATALOG_HEARTBEAT_INTERVAL_MS, CATALOG_WORKER_STALE_MS } = await import("./config");

const run = (status: string, heartbeatAt: string | null) =>
  ({ status, heartbeat_at: heartbeatAt }) as never;

describe("isCatalogWorkerStale", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("treats a run whose heartbeat stopped as dead", () => {
    expect(isCatalogWorkerStale(run("running", ago(CATALOG_WORKER_STALE_MS)), now)).toBe(true);
    expect(isCatalogWorkerStale(run("queued", ago(CATALOG_WORKER_STALE_MS + 1)), now)).toBe(true);
    expect(isCatalogWorkerStale(run("running", null), now)).toBe(true);
  });

  it("never treats a live worker as dead, however slow its current row is", () => {
    // A live orchestrator pings every interval regardless of row duration.
    expect(isCatalogWorkerStale(run("running", ago(CATALOG_HEARTBEAT_INTERVAL_MS * 2)), now)).toBe(false);
  });

  it("ignores finished runs", () => {
    expect(isCatalogWorkerStale(run("cancelled", ago(CATALOG_WORKER_STALE_MS * 10)), now)).toBe(false);
  });

  it("requires several missed pings before declaring a worker dead", () => {
    expect(CATALOG_WORKER_STALE_MS).toBeGreaterThanOrEqual(CATALOG_HEARTBEAT_INTERVAL_MS * 4);
  });
});
