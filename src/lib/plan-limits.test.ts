import { describe, expect, it } from "vitest";
import {
  assertWithinLimit,
  PlanLimitError,
  projectedTotal,
  startOfUtcMonth,
} from "./plan-limits";

describe("plan limits", () => {
  it("allows unlimited when limit is null", () => {
    expect(
      assertWithinLimit({
        resource: "products",
        current: 10_000,
        incoming: 5_000,
        limit: null,
      }).projected
    ).toBe(15_000);
  });

  it("caps a job at the product ceiling without counting the catalog", () => {
    expect(() =>
      assertWithinLimit({
        resource: "products",
        current: 0,
        incoming: 120,
        limit: 100,
      })
    ).toThrow(PlanLimitError);
    expect(
      assertWithinLimit({
        resource: "products",
        current: 0,
        incoming: 80,
        limit: 100,
      }).projected
    ).toBe(80);
  });

  it("allows filling exactly to the cap", () => {
    const result = assertWithinLimit({
      resource: "imports",
      current: 9,
      incoming: 1,
      limit: 10,
    });
    expect(result.projected).toBe(10);
    expect(result.warning).toBe(true);
  });

  it("names Catalog Intelligence in the monthly project cap", () => {
    expect(() =>
      assertWithinLimit({
        resource: "imports",
        current: 10,
        incoming: 1,
        limit: 10,
      })
    ).toThrow(/Catalog Intelligence projects/);
  });

  it("warns at 80 percent", () => {
    const result = assertWithinLimit({
      resource: "products",
      current: 80,
      incoming: 0,
      limit: 100,
    });
    expect(result.warning).toBe(true);
  });

  it("projects additions without going negative", () => {
    expect(projectedTotal(10, -4)).toBe(10);
  });

  it("anchors monthly import windows to UTC month start", () => {
    expect(startOfUtcMonth(new Date("2026-09-15T23:00:00.000Z"))).toBe(
      "2026-09-01T00:00:00.000Z"
    );
  });
});
