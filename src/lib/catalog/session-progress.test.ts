import { describe, expect, it } from "vitest";
import { catalogSessionProgress } from "./session-progress";

describe("catalogSessionProgress", () => {
  it("is 100 only when every row is enriched", () => {
    expect(
      catalogSessionProgress({
        status: "completed",
        total_rows: 990,
        enriched_count: 990,
      })
    ).toBe(100);
  });

  it("does not treat a finished job as 100% if rows remain", () => {
    expect(
      catalogSessionProgress({
        status: "completed",
        total_rows: 990,
        enriched_count: 50,
      })
    ).toBe(5);
  });

  it("uses enriched / total while a run is in progress", () => {
    expect(
      catalogSessionProgress({
        status: "enriching",
        total_rows: 100,
        enriched_count: 25,
      })
    ).toBe(25);
  });

  it("does not round a nearly complete sheet up to 100", () => {
    expect(
      catalogSessionProgress({
        status: "completed",
        total_rows: 990,
        enriched_count: 989,
      })
    ).toBe(99);
  });

  it("is zero for a cancelled session", () => {
    expect(
      catalogSessionProgress({
        status: "cancelled",
        total_rows: 100,
        enriched_count: 40,
      })
    ).toBe(0);
  });
});
