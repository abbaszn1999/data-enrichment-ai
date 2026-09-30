import { describe, expect, it, vi } from "vitest";

vi.mock("./dispatch", () => ({ dispatchJob: vi.fn() }));
vi.mock("./repo", () => ({
  claimStaleJobRun: vi.fn(),
  finishJobRun: vi.fn(),
  mapJobRun: vi.fn(),
}));

const { growthRecoveryAction } = await import("./growth-recovery");
const { CATALOG_QUEUE_WAIT_MS, JOB_HEARTBEAT_STALE_MINUTES } = await import("./config");

const STALE_MS = JOB_HEARTBEAT_STALE_MINUTES * 60_000;
const now = Date.parse("2026-09-30T12:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

const run = (overrides: Record<string, unknown>) =>
  ({
    kind: "mr_classify",
    status: "queued",
    heartbeat_at: ago(0),
    cancel_requested: false,
    task_run_id: null,
    ...overrides,
  }) as never;

describe("growthRecoveryAction", () => {
  it("re-dispatches a queued run that never reached Render", () => {
    expect(growthRecoveryAction(run({ heartbeat_at: ago(STALE_MS) }), now)).toBe("redispatch");
    expect(growthRecoveryAction(run({ heartbeat_at: ago(STALE_MS - 1) }), now)).toBe("none");
  });

  it("gives a run waiting in Render's queue the longer wait", () => {
    const waiting = (ms: number) => run({ heartbeat_at: ago(ms), task_run_id: "trn-1" });
    expect(growthRecoveryAction(waiting(STALE_MS * 2), now)).toBe("none");
    expect(growthRecoveryAction(waiting(CATALOG_QUEUE_WAIT_MS), now)).toBe("redispatch");
  });

  it("leaves running runs to claim_stale_job_runs", () => {
    expect(
      growthRecoveryAction(run({ status: "running", heartbeat_at: ago(STALE_MS * 5) }), now)
    ).toBe("none");
  });

  it("closes a run whose worker died after Stop", () => {
    const stopped = (ms: number) =>
      run({ kind: "mr_stage1", status: "running", cancel_requested: true, heartbeat_at: ago(ms) });
    expect(growthRecoveryAction(stopped(STALE_MS), now)).toBe("finish_cancelled");
    expect(growthRecoveryAction(stopped(1_000), now)).toBe("none");
  });

  it("never touches a stopped extract; its cancel route settles the hold itself", () => {
    expect(
      growthRecoveryAction(
        run({ kind: "mr_extract", cancel_requested: true, heartbeat_at: ago(STALE_MS * 5) }),
        now
      )
    ).toBe("none");
  });

  it("ignores finished runs and other job kinds", () => {
    expect(
      growthRecoveryAction(run({ status: "completed", heartbeat_at: ago(STALE_MS * 5) }), now)
    ).toBe("none");
    expect(
      growthRecoveryAction(run({ kind: "catalog", heartbeat_at: ago(STALE_MS * 5) }), now)
    ).toBe("none");
  });
});
