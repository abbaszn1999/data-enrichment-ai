"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { totalsFromGscPages } from "@/lib/analytics/aggregate";
import { analyticsDateWindows, parseAnalyticsDateRange } from "@/lib/analytics/dates";
import type {
  AnalyticsDateRange,
  AnalyticsPageType,
  AnalyticsPropertyOption,
  AnalyticsRuleConfig,
  AnalyticsRulesRecord,
  AnalyticsStatus,
  Ga4Overview,
  Ga4PageRow,
  Ga4TimeSeriesRow,
  GscPageRow,
  GscTimeSeriesRow,
  GscTotals,
} from "@/lib/analytics/types";

// ==========================================
// Client-side Caching & Request Deduplication
// ==========================================
const activeFetches = new Map<string, Promise<unknown>>();
const clientCacheStore = new Map<string, { data: unknown; ts: number }>();
const CLIENT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes client cache

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}

async function dedupedFetch<T>(url: string, forceRefresh = false): Promise<T> {
  const cached = clientCacheStore.get(url) as { data: T; ts: number } | undefined;
  if (!forceRefresh && cached && Date.now() - cached.ts < CLIENT_CACHE_TTL_MS) {
    return cached.data;
  }

  let promise = activeFetches.get(url) as Promise<T> | undefined;
  if (!promise) {
    promise = fetch(url).then(async (res) => {
      const data = await readJson<T>(res);
      clientCacheStore.set(url, { data, ts: Date.now() });
      return data;
    }).finally(() => {
      activeFetches.delete(url);
    });
    activeFetches.set(url, promise as Promise<unknown>);
  }
  return promise;
}

export function invalidateClientAnalyticsCache(workspaceId?: string) {
  if (!workspaceId) {
    clientCacheStore.clear();
    return;
  }
  for (const key of clientCacheStore.keys()) {
    if (key.includes(workspaceId)) {
      clientCacheStore.delete(key);
    }
  }
}

const emptyStatus = (): AnalyticsStatus => ({
  configured: false,
  gsc: { connected: false, email: null, property: null, propertyLabel: null, needsProperty: false },
  ga4: { connected: false, email: null, property: null, propertyLabel: null, needsProperty: false },
});

function clearGsc(
  setGscTotals: (value: GscTotals | null) => void,
  setPrevGscTotals: (value: GscTotals | null) => void,
  setGscPages: (value: GscPageRow[]) => void,
  setGscTimeSeries: (value: GscTimeSeriesRow[]) => void
) {
  setGscTotals(null);
  setPrevGscTotals(null);
  setGscPages([]);
  setGscTimeSeries([]);
}

function clearGa4(
  setGa4Overview: (value: Ga4Overview | null) => void,
  setPrevGa4Overview: (value: Ga4Overview | null) => void,
  setGa4Pages: (value: Ga4PageRow[]) => void,
  setGa4TimeSeries: (value: Ga4TimeSeriesRow[]) => void
) {
  setGa4Overview(null);
  setPrevGa4Overview(null);
  setGa4Pages([]);
  setGa4TimeSeries([]);
}

type AnalyticsCacheSnapshot = {
  status: AnalyticsStatus | null;
  rules: AnalyticsRulesRecord | null;
  gscTotals: GscTotals | null;
  prevGscTotals: GscTotals | null;
  gscPages: GscPageRow[];
  gscTimeSeries: GscTimeSeriesRow[];
  ga4Overview: Ga4Overview | null;
  prevGa4Overview: Ga4Overview | null;
  ga4Pages: Ga4PageRow[];
  ga4TimeSeries: Ga4TimeSeriesRow[];
};

function readSnapshotFromCache(
  workspaceId: string | null,
  range: AnalyticsDateRange,
  pageType?: AnalyticsPageType | null
): AnalyticsCacheSnapshot {
  if (!workspaceId) {
    return {
      status: null,
      rules: null,
      gscTotals: null,
      prevGscTotals: null,
      gscPages: [],
      gscTimeSeries: [],
      ga4Overview: null,
      prevGa4Overview: null,
      ga4Pages: [],
      ga4TimeSeries: [],
    };
  }

  const statusUrl = `/api/analytics/status?workspaceId=${encodeURIComponent(workspaceId)}`;
  const statusCached = clientCacheStore.get(statusUrl)?.data as AnalyticsStatus | undefined;

  let rulesCached: AnalyticsRulesRecord | null = null;
  if (pageType) {
    const rulesUrl = `/api/analytics/rules?workspaceId=${encodeURIComponent(workspaceId)}&pageType=${pageType}`;
    const rulesRes = clientCacheStore.get(rulesUrl)?.data as { rules: AnalyticsRulesRecord | null } | undefined;
    if (rulesRes) {
      rulesCached = rulesRes.rules;
    }
  }

  const days = Number(parseAnalyticsDateRange(range));
  const dates = analyticsDateWindows(days);
  const qs = (extra: Record<string, string>) =>
    new URLSearchParams({
      workspaceId,
      ...(pageType ? { pageType } : {}),
      ...extra,
    }).toString();

  const gscPagesUrl = `/api/analytics/gsc/pages?${qs({ startDate: dates.startDate, endDate: dates.endDate })}`;
  const prevGscPagesUrl = `/api/analytics/gsc/pages?${qs({ startDate: dates.prevStartDate, endDate: dates.prevEndDate })}`;
  const gscTimeseriesUrl = `/api/analytics/gsc/timeseries?${qs({ startDate: dates.startDate, endDate: dates.endDate })}`;

  const ga4OverviewUrl = `/api/analytics/ga4/overview?${qs({ startDate: dates.startDate, endDate: dates.endDate })}`;
  const prevGa4OverviewUrl = `/api/analytics/ga4/overview?${qs({ startDate: dates.prevStartDate, endDate: dates.prevEndDate })}`;
  const ga4PagesUrl = `/api/analytics/ga4/pages?${qs({ startDate: dates.startDate, endDate: dates.endDate })}`;
  const ga4TimeseriesUrl = `/api/analytics/ga4/timeseries?${qs({ startDate: dates.startDate, endDate: dates.endDate })}`;

  const gscPagesData = clientCacheStore.get(gscPagesUrl)?.data as { rows: GscPageRow[] } | undefined;
  const prevGscPagesData = clientCacheStore.get(prevGscPagesUrl)?.data as { rows: GscPageRow[] } | undefined;
  const gscTimeseriesData = clientCacheStore.get(gscTimeseriesUrl)?.data as { rows: GscTimeSeriesRow[] } | undefined;

  const ga4OverviewData = clientCacheStore.get(ga4OverviewUrl)?.data as Ga4Overview | undefined;
  const prevGa4OverviewData = clientCacheStore.get(prevGa4OverviewUrl)?.data as Ga4Overview | undefined;
  const ga4PagesData = clientCacheStore.get(ga4PagesUrl)?.data as { rows: Ga4PageRow[] } | undefined;
  const ga4TimeseriesData = clientCacheStore.get(ga4TimeseriesUrl)?.data as { rows: Ga4TimeSeriesRow[] } | undefined;

  const gscPages = gscPagesData?.rows || [];
  const gscTotals = gscPages.length ? totalsFromGscPages(gscPages) : null;
  const prevGscTotals = prevGscPagesData?.rows?.length ? totalsFromGscPages(prevGscPagesData.rows) : null;

  return {
    status: statusCached || null,
    rules: rulesCached,
    gscTotals,
    prevGscTotals,
    gscPages,
    gscTimeSeries: gscTimeseriesData?.rows || [],
    ga4Overview: ga4OverviewData || null,
    prevGa4Overview: prevGa4OverviewData || null,
    ga4Pages: ga4PagesData?.rows || [],
    ga4TimeSeries: ga4TimeseriesData?.rows || [],
  };
}

export function useAnalytics(
  workspaceId: string | null,
  range: AnalyticsDateRange,
  pageType?: AnalyticsPageType | null
) {
  // Read snapshot synchronously from memory cache if already visited
  const initialSnapshot = readSnapshotFromCache(workspaceId, range, pageType);

  const [status, setStatus] = useState<AnalyticsStatus>(initialSnapshot.status || emptyStatus());
  const [statusLoading, setStatusLoading] = useState(!initialSnapshot.status);
  const [rules, setRules] = useState<AnalyticsRulesRecord | null>(initialSnapshot.rules);
  const [rulesLoading, setRulesLoading] = useState(Boolean(pageType && !initialSnapshot.rules));
  const [gscTotals, setGscTotals] = useState<GscTotals | null>(initialSnapshot.gscTotals);
  const [prevGscTotals, setPrevGscTotals] = useState<GscTotals | null>(initialSnapshot.prevGscTotals);
  const [gscPages, setGscPages] = useState<GscPageRow[]>(initialSnapshot.gscPages);
  const [ga4Overview, setGa4Overview] = useState<Ga4Overview | null>(initialSnapshot.ga4Overview);
  const [prevGa4Overview, setPrevGa4Overview] = useState<Ga4Overview | null>(initialSnapshot.prevGa4Overview);
  const [ga4Pages, setGa4Pages] = useState<Ga4PageRow[]>(initialSnapshot.ga4Pages);
  const [gscTimeSeries, setGscTimeSeries] = useState<GscTimeSeriesRow[]>(initialSnapshot.gscTimeSeries);
  const [ga4TimeSeries, setGa4TimeSeries] = useState<Ga4TimeSeriesRow[]>(initialSnapshot.ga4TimeSeries);
  const [gscLoading, setGscLoading] = useState(false);
  const [ga4Loading, setGa4Loading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync with cache if range or pageType changes
  const prevKeyRef = useRef<string>("");
  useEffect(() => {
    const key = `${workspaceId}:${range}:${pageType || "overview"}`;
    if (prevKeyRef.current !== key) {
      prevKeyRef.current = key;
      const snapshot = readSnapshotFromCache(workspaceId, range, pageType);
      if (snapshot.status) setStatus(snapshot.status);
      if (snapshot.rules !== undefined) setRules(snapshot.rules);
      setGscPages(snapshot.gscPages);
      setGscTotals(snapshot.gscTotals);
      setPrevGscTotals(snapshot.prevGscTotals);
      setGscTimeSeries(snapshot.gscTimeSeries);
      setGa4Overview(snapshot.ga4Overview);
      setPrevGa4Overview(snapshot.prevGa4Overview);
      setGa4Pages(snapshot.ga4Pages);
      setGa4TimeSeries(snapshot.ga4TimeSeries);
    }
  }, [workspaceId, range, pageType]);

  const loadStatus = useCallback(async (force = false) => {
    if (!workspaceId) return emptyStatus();
    const data = await dedupedFetch<AnalyticsStatus>(
      `/api/analytics/status?workspaceId=${encodeURIComponent(workspaceId)}`,
      force
    );
    setStatus(data);
    return data;
  }, [workspaceId]);

  const loadRules = useCallback(async (force = false) => {
    if (!workspaceId || !pageType) {
      setRules(null);
      setRulesLoading(false);
      return null;
    }
    setRulesLoading(true);
    try {
      const data = await dedupedFetch<{ rules: AnalyticsRulesRecord | null }>(
        `/api/analytics/rules?workspaceId=${encodeURIComponent(workspaceId)}&pageType=${pageType}`,
        force
      );
      setRules(data.rules);
      return data.rules;
    } finally {
      setRulesLoading(false);
    }
  }, [pageType, workspaceId]);

  const loadData = useCallback(async (
    current: AnalyticsStatus,
    currentRules: AnalyticsRulesRecord | null,
    force = false
  ) => {
    if (!workspaceId) return;
    if (pageType && !currentRules) {
      clearGsc(setGscTotals, setPrevGscTotals, setGscPages, setGscTimeSeries);
      clearGa4(setGa4Overview, setPrevGa4Overview, setGa4Pages, setGa4TimeSeries);
      setGscLoading(false);
      setGa4Loading(false);
      setError(null);
      return;
    }

    const days = Number(parseAnalyticsDateRange(range));
    const dates = analyticsDateWindows(days);
    const qs = (extra: Record<string, string>) =>
      new URLSearchParams({
        workspaceId,
        ...(pageType ? { pageType } : {}),
        ...(force ? { force: "1" } : {}),
        ...extra,
      }).toString();

    setError(null);

    const gscReady = current.gsc.connected && !current.gsc.needsProperty;
    const ga4Ready = current.ga4.connected && !current.ga4.needsProperty;

    const gscTasks = gscReady
      ? Promise.all([
          dedupedFetch<{ rows: GscPageRow[] }>(
            `/api/analytics/gsc/pages?${qs({ startDate: dates.startDate, endDate: dates.endDate })}`,
            force
          ),
          dedupedFetch<{ rows: GscPageRow[] }>(
            `/api/analytics/gsc/pages?${qs({ startDate: dates.prevStartDate, endDate: dates.prevEndDate })}`,
            force
          ).catch(() => ({ rows: [] as GscPageRow[] })),
          dedupedFetch<{ rows: GscTimeSeriesRow[] }>(
            `/api/analytics/gsc/timeseries?${qs({ startDate: dates.startDate, endDate: dates.endDate })}`,
            force
          ),
        ])
      : null;

    const ga4Tasks = ga4Ready
      ? Promise.all([
          dedupedFetch<Ga4Overview>(
            `/api/analytics/ga4/overview?${qs({ startDate: dates.startDate, endDate: dates.endDate })}`,
            force
          ),
          dedupedFetch<Ga4Overview>(
            `/api/analytics/ga4/overview?${qs({ startDate: dates.prevStartDate, endDate: dates.prevEndDate })}`,
            force
          ).catch(() => null),
          dedupedFetch<{ rows: Ga4PageRow[] }>(
            `/api/analytics/ga4/pages?${qs({ startDate: dates.startDate, endDate: dates.endDate })}`,
            force
          ),
          dedupedFetch<{ rows: Ga4TimeSeriesRow[] }>(
            `/api/analytics/ga4/timeseries?${qs({ startDate: dates.startDate, endDate: dates.endDate })}`,
            force
          ),
        ])
      : null;

    const gscPromise = gscTasks
      ? (async () => {
          setGscLoading(true);
          try {
            const [pages, prevPages, series] = await gscTasks;
            setGscPages(pages.rows);
            setGscTotals(totalsFromGscPages(pages.rows));
            setPrevGscTotals(prevPages.rows.length ? totalsFromGscPages(prevPages.rows) : null);
            setGscTimeSeries(series.rows);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load Search Console data");
            clearGsc(setGscTotals, setPrevGscTotals, setGscPages, setGscTimeSeries);
          } finally {
            setGscLoading(false);
          }
        })()
      : (async () => {
          clearGsc(setGscTotals, setPrevGscTotals, setGscPages, setGscTimeSeries);
          setGscLoading(false);
        })();

    const ga4Promise = ga4Tasks
      ? (async () => {
          setGa4Loading(true);
          try {
            const [overview, prevOverview, pages, series] = await ga4Tasks;
            setGa4Overview(overview);
            setPrevGa4Overview(prevOverview);
            setGa4Pages(pages.rows);
            setGa4TimeSeries(series.rows);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load Analytics data");
            clearGa4(setGa4Overview, setPrevGa4Overview, setGa4Pages, setGa4TimeSeries);
          } finally {
            setGa4Loading(false);
          }
        })()
      : (async () => {
          clearGa4(setGa4Overview, setPrevGa4Overview, setGa4Pages, setGa4TimeSeries);
          setGa4Loading(false);
        })();

    await Promise.all([gscPromise, ga4Promise]);
  }, [pageType, range, workspaceId]);

  const refresh = useCallback(async (force = false) => {
    if (!workspaceId) return;
    setStatusLoading(true);
    try {
      const next = await loadStatus(force);
      const nextRules = await loadRules(force);
      await loadData(next, nextRules, force);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      setStatusLoading(false);
    }
  }, [loadData, loadRules, loadStatus, workspaceId]);

  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  return {
    status,
    statusLoading,
    rules,
    rulesLoading,
    gscTotals,
    prevGscTotals,
    gscPages,
    ga4Overview,
    prevGa4Overview,
    ga4Pages,
    gscTimeSeries,
    ga4TimeSeries,
    gscLoading,
    ga4Loading,
    error,
    refresh: (force = true) => refresh(force),
  };
}

export async function fetchAnalyticsProperties(
  workspaceId: string,
  type: "search-console" | "google-analytics"
): Promise<AnalyticsPropertyOption[]> {
  const data = await readJson<{ properties: AnalyticsPropertyOption[] }>(
    await fetch(
      `/api/analytics/properties?workspaceId=${encodeURIComponent(workspaceId)}&type=${type}`
    )
  );
  return data.properties;
}

export async function saveAnalyticsProperty(
  workspaceId: string,
  type: "search-console" | "google-analytics",
  selectedProperty: string,
  propertyDetails: Record<string, unknown>
) {
  await readJson(
    await fetch("/api/analytics/properties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, type, selectedProperty, propertyDetails }),
    })
  );
  invalidateClientAnalyticsCache(workspaceId);
}

export async function disconnectAnalytics(
  workspaceId: string,
  type: "search-console" | "google-analytics"
) {
  await readJson(
    await fetch(
      `/api/analytics/connection?workspaceId=${encodeURIComponent(workspaceId)}&type=${type}`,
      { method: "DELETE" }
    )
  );
  invalidateClientAnalyticsCache(workspaceId);
}

export async function saveAnalyticsRules(
  workspaceId: string,
  pageType: AnalyticsPageType,
  config: AnalyticsRuleConfig
): Promise<AnalyticsRulesRecord> {
  const data = await readJson<{ rules: AnalyticsRulesRecord }>(
    await fetch("/api/analytics/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, pageType, ...config }),
    })
  );
  invalidateClientAnalyticsCache(workspaceId);
  return data.rules;
}
