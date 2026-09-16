import { afterEach, describe, expect, it, vi } from "vitest";
import {
  analyticsDateWindows,
  analyticsRangeStorageKey,
  comparisonLabel,
  ga4DateToIso,
  parseAnalyticsDateRange,
  peekAnalyticsDateRange,
  readStoredAnalyticsDateRange,
  storeAnalyticsDateRange,
} from "./dates";

describe("parseAnalyticsDateRange", () => {
  it("accepts the three supported windows", () => {
    expect(parseAnalyticsDateRange("7")).toBe("7");
    expect(parseAnalyticsDateRange("90")).toBe("90");
  });

  it("defaults to 28 days", () => {
    expect(parseAnalyticsDateRange(null)).toBe("28");
    expect(parseAnalyticsDateRange("14")).toBe("28");
  });
});

describe("analyticsDateWindows", () => {
  it("builds current and previous windows from a UTC day", () => {
    const now = new Date("2026-09-10T15:22:00.000Z");
    expect(analyticsDateWindows(28, now)).toEqual({
      startDate: "2026-08-13",
      endDate: "2026-09-10",
      prevStartDate: "2026-07-16",
      prevEndDate: "2026-08-12",
    });
  });
});

describe("ga4DateToIso", () => {
  it("normalizes compact GA4 dates", () => {
    expect(ga4DateToIso("20260910")).toBe("2026-09-10");
    expect(ga4DateToIso("2026-09-10")).toBe("2026-09-10");
  });
});

describe("comparisonLabel", () => {
  it("names the previous window", () => {
    expect(comparisonLabel(28)).toBe("vs. previous 28 days");
  });
});

describe("analytics date range persistence", () => {
  const memory: Record<string, string> = {};

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of Object.keys(memory)) delete memory[key];
  });

  function stubWindowStorage() {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => memory[key] ?? null,
        setItem: (key: string, value: string) => {
          memory[key] = value;
        },
        removeItem: (key: string) => {
          delete memory[key];
        },
      },
    });
  }

  it("round-trips a stored range per workspace", () => {
    stubWindowStorage();
    const workspaceId = "ws-analytics-range-store";
    storeAnalyticsDateRange(workspaceId, "90");
    expect(readStoredAnalyticsDateRange(workspaceId)).toBe("90");
    expect(peekAnalyticsDateRange(workspaceId)).toBe("90");
    expect(window.localStorage.getItem(analyticsRangeStorageKey(workspaceId))).toBe("90");
  });

  it("defaults to 28 when nothing is stored", () => {
    stubWindowStorage();
    const workspaceId = "ws-analytics-range-empty";
    expect(peekAnalyticsDateRange(workspaceId)).toBeNull();
    expect(readStoredAnalyticsDateRange(workspaceId)).toBe("28");
    expect(readStoredAnalyticsDateRange(undefined)).toBe("28");
  });
});
