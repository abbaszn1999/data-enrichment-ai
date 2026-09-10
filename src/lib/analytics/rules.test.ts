import { describe, expect, it } from "vitest";
import { aggregateGscTimeSeriesByDate, totalsFromGscPages } from "./aggregate";
import {
  analyticsPageCandidates,
  buildGa4FilterExpression,
  describeAnalyticsRules,
  filterPagesByRules,
  pageMatchesRules,
  parseAnalyticsRuleConfig,
  validateAnalyticsRulePatterns,
} from "./rules";
import type { AnalyticsRuleConfig } from "./types";

function config(overrides: Partial<AnalyticsRuleConfig> = {}): AnalyticsRuleConfig {
  return {
    filterMode: "include",
    patternType: "simple",
    isActive: true,
    patterns: {
      logic: "OR",
      rules: [{ value: "/collections/", enabled: true }],
    },
    ...overrides,
  };
}

describe("analyticsPageCandidates", () => {
  it("adds the pathname for full Search Console URLs", () => {
    expect(analyticsPageCandidates("https://shop.example/collections/hats?page=2")).toEqual([
      "https://shop.example/collections/hats?page=2",
      "/collections/hats?page=2",
      "/collections/hats",
    ]);
  });
});

describe("pageMatchesRules", () => {
  it("includes collection URLs with simple contains matching", () => {
    const rules = config();
    expect(pageMatchesRules("https://shop.example/collections/summer", rules)).toBe(true);
    expect(pageMatchesRules("/products/sku-1", rules)).toBe(false);
  });

  it("supports AND logic across patterns", () => {
    const rules = config({
      patterns: {
        logic: "AND",
        rules: [
          { value: "/collections/", enabled: true },
          { value: "summer", enabled: true },
        ],
      },
    });
    expect(pageMatchesRules("/collections/summer", rules)).toBe(true);
    expect(pageMatchesRules("/collections/winter", rules)).toBe(false);
  });

  it("excludes matching pages", () => {
    const rules = config({ filterMode: "exclude" });
    expect(pageMatchesRules("/collections/hats", rules)).toBe(false);
    expect(pageMatchesRules("/products/sku-1", rules)).toBe(true);
  });

  it("applies regex against the pathname of a full URL", () => {
    const rules = config({
      patternType: "regex",
      patterns: { logic: "OR", rules: [{ value: "^/collections/[^/]+$", enabled: true }] },
    });
    expect(pageMatchesRules("https://shop.example/collections/hats", rules)).toBe(true);
    expect(pageMatchesRules("https://shop.example/collections/hats/all", rules)).toBe(false);
  });

  it("ignores disabled patterns and inactive rules", () => {
    expect(
      pageMatchesRules(
        "/products/sku-1",
        config({
          patterns: {
            logic: "OR",
            rules: [
              { value: "/collections/", enabled: false },
              { value: "/products/", enabled: true },
            ],
          },
        })
      )
    ).toBe(true);
    expect(pageMatchesRules("/products/sku-1", config({ isActive: false }))).toBe(true);
  });
});

describe("filterPagesByRules", () => {
  it("keeps matching GSC/GA4 page rows", () => {
    const rows = filterPagesByRules(
      [
        { page: "/collections/a", clicks: 2 },
        { page: "/products/a", clicks: 9 },
      ],
      config()
    );
    expect(rows).toEqual([{ page: "/collections/a", clicks: 2 }]);
  });
});

describe("buildGa4FilterExpression", () => {
  it("builds a contains filter for a single include pattern", () => {
    expect(buildGa4FilterExpression(config())).toEqual({
      filter: {
        fieldName: "pagePath",
        stringFilter: { matchType: "CONTAINS", value: "/collections/", caseSensitive: false },
      },
    });
  });

  it("wraps OR groups in notExpression for exclude mode", () => {
    const expression = buildGa4FilterExpression(
      config({
        filterMode: "exclude",
        patterns: {
          logic: "OR",
          rules: [
            { value: "/collections/", enabled: true },
            { value: "/category/", enabled: true },
          ],
        },
      })
    );
    expect(expression?.notExpression?.orGroup?.expressions).toHaveLength(2);
  });
});

describe("parseAnalyticsRuleConfig", () => {
  it("rejects empty patterns and invalid regex", () => {
    expect(parseAnalyticsRuleConfig({ filterMode: "include", patternType: "simple", patterns: { logic: "OR", rules: [] } }).errors).toContain(
      "At least one pattern is required"
    );
    expect(
      parseAnalyticsRuleConfig({
        filterMode: "include",
        patternType: "regex",
        patterns: { logic: "OR", rules: [{ value: "(", enabled: true }] },
      }).errors[0]
    ).toMatch(/Invalid regex/);
  });

  it("accepts a valid include config", () => {
    const parsed = parseAnalyticsRuleConfig({
      filterMode: "include",
      patternType: "simple",
      patterns: { logic: "OR", rules: [{ value: " /collections/ ", enabled: true }] },
    });
    expect(parsed.errors).toEqual([]);
    expect(parsed.config?.patterns.rules[0].value).toBe("/collections/");
  });
});

describe("validateAnalyticsRulePatterns", () => {
  it("requires at least one enabled value", () => {
    expect(
      validateAnalyticsRulePatterns(
        config({ patterns: { logic: "OR", rules: [{ value: "  ", enabled: true }] } })
      )
    ).toContain("At least one pattern is required");
  });
});

describe("describeAnalyticsRules", () => {
  it("summarizes include + OR patterns", () => {
    expect(
      describeAnalyticsRules(
        config({
          patterns: {
            logic: "OR",
            rules: [
              { value: "/collections/", enabled: true },
              { value: "/category/", enabled: true },
            ],
          },
        })
      )
    ).toBe('Including: "/collections/" OR "/category/"');
  });
});

describe("totalsFromGscPages", () => {
  it("sums clicks and averages CTR like the previous PLP tool", () => {
    const totals = totalsFromGscPages([
      { page: "/a", clicks: 10, impressions: 100, ctr: 0.1, position: 2 },
      { page: "/b", clicks: 5, impressions: 50, ctr: 0.2, position: 4 },
    ]);
    expect(totals.clicks).toBe(15);
    expect(totals.impressions).toBe(150);
    expect(totals.ctr).toBeCloseTo(0.15);
    expect(totals.position).toBe(3);
  });
});

describe("aggregateGscTimeSeriesByDate", () => {
  it("rolls filtered date+page rows back up by day", () => {
    expect(
      aggregateGscTimeSeriesByDate([
        { date: "2026-09-10", clicks: 2, impressions: 8 },
        { date: "2026-09-09", clicks: 1, impressions: 4 },
        { date: "2026-09-10", clicks: 3, impressions: 2 },
      ])
    ).toEqual([
      { date: "2026-09-09", clicks: 1, impressions: 4 },
      { date: "2026-09-10", clicks: 5, impressions: 10 },
    ]);
  });
});
