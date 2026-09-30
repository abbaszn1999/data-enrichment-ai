import { beforeEach, describe, expect, it, vi } from "vitest";

const { finishJobRun, loadJobRun, notifyJobEvent } = vi.hoisted(() => ({
  finishJobRun: vi.fn(),
  loadJobRun: vi.fn(),
  notifyJobEvent: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/observability/metrics", () => ({ recordWorkerHeapBytes: vi.fn() }));
vi.mock("./notify", () => ({ notifyJobEvent }));
vi.mock("./repo", () => ({ finishJobRun, loadJobRun, touchJobHeartbeat: vi.fn() }));

const { JobCancelledError, runJobWithFailureGuard } = await import("./guard");

const activeRun = { id: "run-1", status: "running", completed_count: 3, failed_count: 0 };

describe("runJobWithFailureGuard", () => {
  beforeEach(() => {
    finishJobRun.mockReset().mockResolvedValue({ ...activeRun, status: "done" });
    loadJobRun.mockReset().mockResolvedValue(activeRun);
    notifyJobEvent.mockReset();
  });

  it("records Stop as cancelled, without a failure notification", async () => {
    await runJobWithFailureGuard("run-1", async () => {
      throw new JobCancelledError();
    });
    expect(finishJobRun).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      { status: "cancelled", completedCount: 3, failedCount: 0 },
      { onlyIfActive: true }
    );
    expect(notifyJobEvent).not.toHaveBeenCalled();
  });

  it("still records a crash as failed", async () => {
    await runJobWithFailureGuard("run-1", async () => {
      throw new Error("boom");
    });
    expect(finishJobRun).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ status: "failed", lastError: "boom" }),
      undefined
    );
    expect(notifyJobEvent).toHaveBeenCalledWith(expect.anything(), "failed", expect.anything());
  });
});
