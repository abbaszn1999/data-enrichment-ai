import { describe, expect, it } from "vitest";
import { withVisualizerWorksheetLock } from "@/lib/visualizer/worksheet-lock";

describe("withVisualizerWorksheetLock", () => {
  it("serializes overlapping operations for the same session", async () => {
    const order: number[] = [];
    const first = withVisualizerWorksheetLock("ws", "s1", async () => {
      order.push(1);
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push(2);
      return "a";
    });
    const second = withVisualizerWorksheetLock("ws", "s1", async () => {
      order.push(3);
      return "b";
    });
    await expect(Promise.all([first, second])).resolves.toEqual(["a", "b"]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("allows different sessions to run without waiting on each other", async () => {
    let released = false;
    const slow = withVisualizerWorksheetLock("ws", "a", async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      released = true;
      return 1;
    });
    const other = withVisualizerWorksheetLock("ws", "b", async () => {
      expect(released).toBe(false);
      return 2;
    });
    await expect(Promise.all([slow, other])).resolves.toEqual([1, 2]);
  });
});
