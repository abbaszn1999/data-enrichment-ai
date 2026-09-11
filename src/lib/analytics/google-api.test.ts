import { describe, expect, it } from "vitest";
import { mapGscPages, mapGscTimeSeries, mapGscTotals } from "./google-api";

describe("GSC row mappers", () => {
  it("maps page rows", () => {
    expect(
      mapGscPages([
        { keys: ["https://example.com/a"], clicks: 10, impressions: 100, ctr: 0.1, position: 4.2 },
      ])
    ).toEqual([
      { page: "https://example.com/a", clicks: 10, impressions: 100, ctr: 0.1, position: 4.2 },
    ]);
  });

  it("uses a site-level totals row when keys are empty", () => {
    expect(mapGscTotals([{ clicks: 20, impressions: 200, ctr: 0.1, position: 3 }])).toEqual({
      clicks: 20,
      impressions: 200,
      ctr: 0.1,
      position: 3,
    });
  });

  it("sorts time series by date", () => {
    expect(
      mapGscTimeSeries([
        { keys: ["2026-09-10"], clicks: 2, impressions: 8 },
        { keys: ["2026-09-09"], clicks: 1, impressions: 5 },
      ]).map((row) => row.date)
    ).toEqual(["2026-09-09", "2026-09-10"]);
  });
});
