import { describe, expect, it } from "vitest";
import { nextRowsReturned } from "./extract-progress";

describe("extract row accounting", () => {
  it("uses the page offset instead of incrementing", () => {
    expect(nextRowsReturned(0, "0", 250)).toBe(250);
    expect(nextRowsReturned(250, "250", 250)).toBe(500);
  });

  it("does not double-count a retried cursor", () => {
    expect(nextRowsReturned(250, "0", 250)).toBe(250);
    expect(nextRowsReturned(500, "250", 250)).toBe(500);
  });

  it("keeps a higher existing count if a stale page is replayed", () => {
    expect(nextRowsReturned(1000, "0", 250)).toBe(1000);
  });
});
