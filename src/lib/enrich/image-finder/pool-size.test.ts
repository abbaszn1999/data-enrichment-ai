import { describe, expect, it } from "vitest";
import { imageFinderCandidatePoolSize } from "./pool-size";

describe("imageFinderCandidatePoolSize", () => {
  it("over-fetches well beyond the requested count, never exactly matching it", () => {
    expect(imageFinderCandidatePoolSize(1)).toBeGreaterThan(1);
    expect(imageFinderCandidatePoolSize(3)).toBeGreaterThan(3);
    expect(imageFinderCandidatePoolSize(10)).toBeGreaterThan(10);
  });

  it("stays within a sane, bounded range regardless of input", () => {
    expect(imageFinderCandidatePoolSize(0)).toBeGreaterThanOrEqual(20);
    expect(imageFinderCandidatePoolSize(-5)).toBeGreaterThanOrEqual(20);
    expect(imageFinderCandidatePoolSize(1_000)).toBeLessThanOrEqual(50);
  });

  it("grows with the requested count up to the cap", () => {
    expect(imageFinderCandidatePoolSize(3)).toBeLessThan(imageFinderCandidatePoolSize(10));
  });
});
