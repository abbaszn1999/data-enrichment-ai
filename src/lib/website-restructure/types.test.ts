import { describe, expect, it } from "vitest";
import {
  WR_DEFAULT_PROJECT_LIMIT,
  canAdvanceWrPhase,
  getWrProjectLimit,
  isAtWrProjectCap,
} from "./types";

describe("getWrProjectLimit", () => {
  it("maps each known plan to its limit", () => {
    expect(getWrProjectLimit("starter")).toBe(2);
    expect(getWrProjectLimit("growth")).toBe(3);
    expect(getWrProjectLimit("pro")).toBe(5);
  });

  it("is case-insensitive", () => {
    expect(getWrProjectLimit("Growth")).toBe(3);
  });

  it("falls back to the default for an unknown or missing plan", () => {
    expect(getWrProjectLimit(null)).toBe(WR_DEFAULT_PROJECT_LIMIT);
    expect(getWrProjectLimit("enterprise")).toBe(WR_DEFAULT_PROJECT_LIMIT);
  });
});

describe("isAtWrProjectCap", () => {
  it("allows creating a project below the cap", () => {
    expect(isAtWrProjectCap(1, 3)).toBe(false);
  });

  it("blocks creating a project at or above the cap", () => {
    expect(isAtWrProjectCap(3, 3)).toBe(true);
    expect(isAtWrProjectCap(4, 3)).toBe(true);
  });

  it("never decreases as projects are deleted — caller passes the lifetime total", () => {
    // Simulates: created 3, deleted 1 (lifetime total stays 3, not 2).
    expect(isAtWrProjectCap(3, 3)).toBe(true);
  });
});

describe("canAdvanceWrPhase", () => {
  it("allows moving forward through the wizard", () => {
    expect(canAdvanceWrPhase("collecting", "awaiting_images")).toBe(true);
    expect(canAdvanceWrPhase("awaiting_images", "awaiting_competitors")).toBe(true);
  });

  it("allows staying on the same phase (idempotent request)", () => {
    expect(canAdvanceWrPhase("awaiting_logo", "awaiting_logo")).toBe(true);
  });

  it("rejects moving backward", () => {
    expect(canAdvanceWrPhase("awaiting_competitors", "collecting")).toBe(false);
  });

  it("rejects moving into a machine-controlled phase", () => {
    expect(canAdvanceWrPhase("collecting", "building")).toBe(false);
    expect(canAdvanceWrPhase("collecting", "locked")).toBe(false);
  });

  it("rejects moving out of a machine-controlled phase via the client", () => {
    expect(canAdvanceWrPhase("editing", "awaiting_images")).toBe(false);
  });
});
