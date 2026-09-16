import { describe, expect, it, vi, afterEach } from "vitest";
import {
  listAnalyticsProperties,
  mapGa4AccountSummaries,
  mapGscPages,
  mapGscTimeSeries,
  mapGscTotals,
} from "./google-api";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

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

describe("mapGa4AccountSummaries", () => {
  it("flattens nested propertySummaries into picker options", () => {
    expect(
      mapGa4AccountSummaries([
        {
          displayName: "Acme",
          propertySummaries: [
            { property: "properties/123", displayName: "Shop" },
            { property: "properties/456", displayName: "Blog" },
          ],
        },
        {
          displayName: "Other",
          propertySummaries: [{ property: "properties/789", displayName: "EU" }],
        },
      ])
    ).toEqual([
      { id: "123", label: "Shop", detail: "Acme" },
      { id: "456", label: "Blog", detail: "Acme" },
      { id: "789", label: "EU", detail: "Other" },
    ]);
  });

  it("skips malformed properties and falls back to the numeric id as the label", () => {
    expect(
      mapGa4AccountSummaries([
        { propertySummaries: [{ property: "properties/" }] },
        { propertySummaries: [{ property: "properties/42" }] },
      ])
    ).toEqual([{ id: "42", label: "42", detail: undefined }]);
  });

  it("returns an empty list when Google sends no summaries", () => {
    expect(mapGa4AccountSummaries(undefined)).toEqual([]);
    expect(mapGa4AccountSummaries([])).toEqual([]);
  });
});

describe("listAnalyticsProperties", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses a single accountSummaries call and follows page tokens", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input);
      if (url.includes("/accountSummaries") && !url.includes("pageToken=")) {
        return jsonResponse({
          accountSummaries: [
            {
              displayName: "Acme",
              propertySummaries: [{ property: "properties/1", displayName: "Shop" }],
            },
          ],
          nextPageToken: "page-2",
        });
      }
      if (url.includes("pageToken=page-2")) {
        return jsonResponse({
          accountSummaries: [
            {
              displayName: "Acme EU",
              propertySummaries: [{ property: "properties/2", displayName: "EU Shop" }],
            },
          ],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(listAnalyticsProperties("token")).resolves.toEqual([
      { id: "1", label: "Shop", detail: "Acme" },
      { id: "2", label: "EU Shop", detail: "Acme EU" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(urlOf(fetchMock.mock.calls[0][0] as RequestInfo | URL)).toContain("/accountSummaries");
    expect(
      fetchMock.mock.calls.some((call) => /\/v1beta\/accounts(?:\?|$)/.test(urlOf(call[0] as RequestInfo | URL)))
    ).toBe(false);
  });

  it("falls back to the accounts+properties loop when accountSummaries fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input);
      if (url.includes("/accountSummaries")) {
        return jsonResponse({ error: { message: "accountSummaries unavailable" } }, 500);
      }
      if (/\/v1beta\/accounts(?:\?|$)/.test(url)) {
        return jsonResponse({
          accounts: [{ name: "accounts/1", displayName: "Acme" }],
        });
      }
      if (url.includes("/v1beta/properties?")) {
        return jsonResponse({
          properties: [{ name: "properties/99", displayName: "Fallback Shop" }],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(listAnalyticsProperties("token")).resolves.toEqual([
      { id: "99", label: "Fallback Shop", detail: "Acme" },
    ]);
    expect(
      fetchMock.mock.calls.some((call) =>
        /\/v1beta\/accounts(?:\?|$)/.test(urlOf(call[0] as RequestInfo | URL))
      )
    ).toBe(true);
  });
});
