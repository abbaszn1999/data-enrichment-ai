import { describe, expect, it } from "vitest";
import {
  isNewerRevision,
  isStaleRevision,
  maxRevision,
  snapshotRevision,
} from "@/lib/jobs/snapshot-clock";

describe("snapshot clock", () => {
  it("treats missing revisions as zero", () => {
    expect(snapshotRevision(undefined)).toBe(0);
    expect(snapshotRevision(null)).toBe(0);
    expect(snapshotRevision("4")).toBe(4);
  });

  it("never lets an older snapshot win", () => {
    expect(isStaleRevision(3, 5)).toBe(true);
    expect(isNewerRevision(5, 3)).toBe(true);
    expect(isStaleRevision(5, 5)).toBe(false);
    expect(maxRevision(4, 2, 9, undefined)).toBe(9);
  });
});
