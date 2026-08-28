import { describe, expect, it } from "vitest";
import { buildOverviewSeries, halfPeriodDeltaPercent } from "./overview-series";

describe("overview series", () => {
  it("fills every UTC day and converts credit spend at $0.30", () => {
    const now = new Date("2026-08-28T15:00:00.000Z");
    const series = buildOverviewSeries(
      "7d",
      [{ createdAt: "2026-08-28T12:00:00.000Z", credits: 10 }],
      [{ createdAt: "2026-08-27T08:00:00.000Z", amountUsd: -4.5, status: "completed" }],
      now
    );
    expect(series).toHaveLength(7);
    expect(series[0]?.date).toBe("2026-08-22");
    expect(series[6]?.date).toBe("2026-08-28");
    expect(series[6]?.credits).toBe(10);
    expect(series[6]?.creditUsd).toBe(3);
    expect(series[5]?.walletUsd).toBe(4.5);
  });

  it("ignores top-ups and incomplete wallet rows", () => {
    const now = new Date("2026-08-28T00:00:00.000Z");
    const series = buildOverviewSeries(
      "7d",
      [{ createdAt: "2026-08-28T00:00:00.000Z", credits: -20 }],
      [{ createdAt: "2026-08-28T00:00:00.000Z", amountUsd: 12, status: "completed" }],
      now
    );
    expect(series[6]?.creditUsd).toBe(0);
    expect(series[6]?.walletUsd).toBe(0);
  });

  it("computes second-half vs first-half change", () => {
    expect(halfPeriodDeltaPercent([1, 1, 3, 3])).toBe(200);
    expect(halfPeriodDeltaPercent([0, 0, 0, 0])).toBeNull();
  });
});
