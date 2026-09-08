import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCheckpointGate } from "./checkpoint";

describe("createCheckpointGate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not flush until a row has been noted", () => {
    const gate = createCheckpointGate({ everyRows: 2, everyMs: 1_000 });
    expect(gate.shouldFlush()).toBe(false);
    expect(gate.shouldFlush(true)).toBe(false);
  });

  it("flushes after the row budget", () => {
    const gate = createCheckpointGate({ everyRows: 2, everyMs: 60_000 });
    gate.noteCompletedRow();
    expect(gate.shouldFlush()).toBe(false);
    gate.noteCompletedRow();
    expect(gate.shouldFlush()).toBe(true);
  });

  it("flushes after the time budget once dirty", () => {
    const gate = createCheckpointGate({ everyRows: 50, everyMs: 1_000 });
    gate.noteCompletedRow();
    expect(gate.shouldFlush()).toBe(false);
    vi.advanceTimersByTime(1_000);
    expect(gate.shouldFlush()).toBe(true);
  });

  it("force-flushes dirty state even under both budgets", () => {
    const gate = createCheckpointGate({ everyRows: 50, everyMs: 60_000 });
    gate.noteCompletedRow();
    expect(gate.shouldFlush(true)).toBe(true);
  });

  it("resets after markFlushed", () => {
    const gate = createCheckpointGate({ everyRows: 1, everyMs: 60_000 });
    gate.noteCompletedRow();
    expect(gate.shouldFlush()).toBe(true);
    gate.markFlushed();
    expect(gate.shouldFlush()).toBe(false);
    expect(gate.shouldFlush(true)).toBe(false);
  });
});
