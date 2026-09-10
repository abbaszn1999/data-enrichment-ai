import { describe, expect, it } from "vitest";
import {
  analyticsDateWindows,
  comparisonLabel,
  ga4DateToIso,
  parseAnalyticsDateRange,
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
