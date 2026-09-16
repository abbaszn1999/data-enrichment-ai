import { ga4DateToIso } from "./dates";
import type {
  AnalyticsPropertyOption,
  Ga4FilterExpression,
  Ga4Overview,
  Ga4PageRow,
  Ga4TimeSeriesRow,
  GscDimensionFilterGroup,
  GscPageRow,
  GscTimeSeriesRow,
  GscTotals,
} from "./types";

async function googleJson<T>(
  url: string,
  accessToken: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { error: text };
  }
  if (!res.ok) {
    const err = json as { error?: { message?: string } | string };
    const message =
      typeof err?.error === "string"
        ? err.error
        : err?.error?.message || `Google API ${res.status}`;
    if (res.status === 403) {
      throw new Error(
        "This Google account does not have permission for the selected property."
      );
    }
    throw new Error(message);
  }
  return json as T;
}

type GscApiRow = {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
};

export async function listSearchConsoleSites(accessToken: string): Promise<AnalyticsPropertyOption[]> {
  const data = await googleJson<{ siteEntry?: { siteUrl?: string; permissionLevel?: string }[] }>(
    "https://www.googleapis.com/webmasters/v3/sites",
    accessToken
  );
  return (data.siteEntry ?? []).map((site) => ({
    id: site.siteUrl || "",
    label: site.siteUrl || "Untitled property",
    detail: site.permissionLevel || undefined,
  })).filter((site) => site.id);
}

export async function querySearchConsole(
  accessToken: string,
  siteUrl: string,
  startDate: string,
  endDate: string,
  dimensions: string[] = [],
  dimensionFilterGroups?: GscDimensionFilterGroup[]
): Promise<GscApiRow[]> {
  const encoded = encodeURIComponent(siteUrl);
  const data = await googleJson<{ rows?: GscApiRow[] }>(
    `https://www.googleapis.com/webmasters/v3/sites/${encoded}/searchAnalytics/query`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        startDate,
        endDate,
        ...(dimensions.length ? { dimensions } : {}),
        ...(dimensionFilterGroups?.length ? { dimensionFilterGroups } : {}),
        rowLimit: 25000,
        searchType: "web",
        aggregationType: dimensions.includes("page") ? "byPage" : "auto",
        dataState: "final",
      }),
    }
  );
  return data.rows ?? [];
}

export function mapGscPages(rows: GscApiRow[]): GscPageRow[] {
  return rows.map((row) => ({
    page: row.keys?.[0] || "",
    clicks: row.clicks || 0,
    impressions: row.impressions || 0,
    ctr: row.ctr || 0,
    position: row.position || 0,
  }));
}

export function mapGscTotals(rows: GscApiRow[]): GscTotals {
  if (rows.length === 1 && !rows[0].keys?.length) {
    const row = rows[0];
    return {
      clicks: row.clicks || 0,
      impressions: row.impressions || 0,
      ctr: row.ctr || 0,
      position: row.position || 0,
    };
  }
  const clicks = rows.reduce((sum, row) => sum + (row.clicks || 0), 0);
  const impressions = rows.reduce((sum, row) => sum + (row.impressions || 0), 0);
  const positionSum = rows.reduce((sum, row) => sum + (row.position || 0), 0);
  const ctrSum = rows.reduce((sum, row) => sum + (row.ctr || 0), 0);
  return {
    clicks,
    impressions,
    ctr: rows.length ? ctrSum / rows.length : 0,
    position: rows.length ? positionSum / rows.length : 0,
  };
}

export function mapGscTimeSeries(rows: GscApiRow[]): GscTimeSeriesRow[] {
  return rows
    .map((row) => ({
      date: row.keys?.[0] || "",
      clicks: row.clicks || 0,
      impressions: row.impressions || 0,
    }))
    .filter((row) => row.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

type Ga4RunReport = {
  rows?: Array<{
    dimensionValues?: Array<{ value?: string }>;
    metricValues?: Array<{ value?: string }>;
  }>;
};

export type Ga4AccountSummary = {
  account?: string;
  displayName?: string;
  propertySummaries?: Array<{ property?: string; displayName?: string }>;
};

export type Ga4AccountSummariesResponse = {
  accountSummaries?: Ga4AccountSummary[];
  nextPageToken?: string;
};

export function mapGa4AccountSummaries(
  summaries: Ga4AccountSummary[] | undefined | null
): AnalyticsPropertyOption[] {
  const options: AnalyticsPropertyOption[] = [];
  for (const account of summaries ?? []) {
    for (const prop of account.propertySummaries ?? []) {
      const id = prop.property?.split("/")[1] || "";
      if (!id) continue;
      options.push({
        id,
        label: prop.displayName || id,
        detail: account.displayName || undefined,
      });
    }
  }
  return options;
}

/**
 * Fast path: `accountSummaries` returns every account with its properties
 * nested inline, so the whole property list comes back in one call (or a
 * couple, if the account paginates past 200 accounts — rare in practice).
 * This replaces the old accounts+properties N+1 below, which issued one
 * additional Google call per account and was the main reason opening the
 * property picker felt slow for anyone with more than one GA4 account.
 */
async function listAnalyticsPropertiesViaAccountSummaries(
  accessToken: string
): Promise<AnalyticsPropertyOption[]> {
  const options: AnalyticsPropertyOption[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL("https://analyticsadmin.googleapis.com/v1beta/accountSummaries");
    url.searchParams.set("pageSize", "200");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const data = await googleJson<Ga4AccountSummariesResponse>(url.toString(), accessToken);
    options.push(...mapGa4AccountSummaries(data.accountSummaries));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return options;
}

/** Fallback only: one accounts call, then one properties call per account. */
async function listAnalyticsPropertiesViaAccountsLoop(
  accessToken: string
): Promise<AnalyticsPropertyOption[]> {
  const accounts = await googleJson<{ accounts?: Array<{ name?: string; displayName?: string }> }>(
    "https://analyticsadmin.googleapis.com/v1beta/accounts",
    accessToken
  );
  const options: AnalyticsPropertyOption[] = [];
  for (const account of accounts.accounts ?? []) {
    if (!account.name) continue;
    const props = await googleJson<{
      properties?: Array<{ name?: string; displayName?: string }>;
    }>(
      `https://analyticsadmin.googleapis.com/v1beta/properties?filter=${encodeURIComponent(`parent:${account.name}`)}`,
      accessToken
    );
    for (const prop of props.properties ?? []) {
      const id = prop.name?.split("/")[1] || "";
      if (!id) continue;
      options.push({
        id,
        label: prop.displayName || id,
        detail: account.displayName || undefined,
      });
    }
  }
  return options;
}

export async function listAnalyticsProperties(accessToken: string): Promise<AnalyticsPropertyOption[]> {
  try {
    return await listAnalyticsPropertiesViaAccountSummaries(accessToken);
  } catch (err) {
    console.error(
      "[listAnalyticsProperties] accountSummaries failed, falling back to per-account listing:",
      err
    );
    return listAnalyticsPropertiesViaAccountsLoop(accessToken);
  }
}

export async function runGa4Report(
  accessToken: string,
  propertyId: string,
  startDate: string,
  endDate: string,
  metrics: string[],
  dimensions: string[] = [],
  limit = 100000,
  dimensionFilter?: Ga4FilterExpression
): Promise<Ga4RunReport> {
  return googleJson<Ga4RunReport>(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate }],
        metrics: metrics.map((name) => ({ name })),
        ...(dimensions.length ? { dimensions: dimensions.map((name) => ({ name })) } : {}),
        ...(dimensionFilter ? { dimensionFilter } : {}),
        limit: String(Math.min(limit, 100000)),
      }),
    }
  );
}

export function mapGa4Overview(report: Ga4RunReport): Ga4Overview {
  const row = report.rows?.[0];
  return {
    users: parseInt(row?.metricValues?.[0]?.value || "0", 10),
    sessions: parseInt(row?.metricValues?.[1]?.value || "0", 10),
    pageviews: parseInt(row?.metricValues?.[2]?.value || "0", 10),
    bounceRate: parseFloat(row?.metricValues?.[3]?.value || "0"),
    avgSessionDuration: parseFloat(row?.metricValues?.[4]?.value || "0"),
  };
}

export function mapGa4Pages(report: Ga4RunReport): Ga4PageRow[] {
  return (report.rows ?? []).map((row) => ({
    page: row.dimensionValues?.[0]?.value || "",
    views: parseInt(row.metricValues?.[0]?.value || "0", 10),
    users: parseInt(row.metricValues?.[1]?.value || "0", 10),
    avgDuration: parseFloat(row.metricValues?.[2]?.value || "0"),
  }));
}

export function mapGa4TimeSeries(report: Ga4RunReport): Ga4TimeSeriesRow[] {
  return (report.rows ?? [])
    .map((row) => ({
      date: ga4DateToIso(row.dimensionValues?.[0]?.value || ""),
      sessions: parseInt(row.metricValues?.[0]?.value || "0", 10),
    }))
    .filter((row) => row.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export const GA4_OVERVIEW_METRICS = [
  "activeUsers",
  "sessions",
  "screenPageViews",
  "bounceRate",
  "averageSessionDuration",
] as const;

export const GA4_PAGE_METRICS = [
  "screenPageViews",
  "activeUsers",
  "averageSessionDuration",
] as const;
