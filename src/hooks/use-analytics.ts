"use client";

import { useCallback, useEffect, useState } from "react";
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

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
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

export function useAnalytics(
  workspaceId: string | null,
  range: AnalyticsDateRange,
  pageType?: AnalyticsPageType | null
) {
  const [status, setStatus] = useState<AnalyticsStatus>(emptyStatus());
  const [statusLoading, setStatusLoading] = useState(true);
  const [rules, setRules] = useState<AnalyticsRulesRecord | null>(null);
  const [rulesLoading, setRulesLoading] = useState(Boolean(pageType));
  const [gscTotals, setGscTotals] = useState<GscTotals | null>(null);
  const [prevGscTotals, setPrevGscTotals] = useState<GscTotals | null>(null);
  const [gscPages, setGscPages] = useState<GscPageRow[]>([]);
  const [ga4Overview, setGa4Overview] = useState<Ga4Overview | null>(null);
  const [prevGa4Overview, setPrevGa4Overview] = useState<Ga4Overview | null>(null);
  const [ga4Pages, setGa4Pages] = useState<Ga4PageRow[]>([]);
  const [gscTimeSeries, setGscTimeSeries] = useState<GscTimeSeriesRow[]>([]);
  const [ga4TimeSeries, setGa4TimeSeries] = useState<Ga4TimeSeriesRow[]>([]);
  const [gscLoading, setGscLoading] = useState(false);
  const [ga4Loading, setGa4Loading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    if (!workspaceId) return emptyStatus();
    const data = await readJson<AnalyticsStatus>(
      await fetch(`/api/analytics/status?workspaceId=${encodeURIComponent(workspaceId)}`)
    );
    setStatus(data);
    return data;
  }, [workspaceId]);

  const loadRules = useCallback(async () => {
    if (!workspaceId || !pageType) {
      setRules(null);
      setRulesLoading(false);
      return null;
    }
    setRulesLoading(true);
    try {
      const data = await readJson<{ rules: AnalyticsRulesRecord | null }>(
        await fetch(
          `/api/analytics/rules?workspaceId=${encodeURIComponent(workspaceId)}&pageType=${pageType}`
        )
      );
      setRules(data.rules);
      return data.rules;
    } finally {
      setRulesLoading(false);
    }
  }, [pageType, workspaceId]);

  const loadData = useCallback(async (
    current: AnalyticsStatus,
    currentRules: AnalyticsRulesRecord | null
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
        ...extra,
      }).toString();

    setError(null);

    const gscReady = current.gsc.connected && !current.gsc.needsProperty;
    const ga4Ready = current.ga4.connected && !current.ga4.needsProperty;

    const gscTasks = gscReady
      ? Promise.all([
          fetch(`/api/analytics/gsc/pages?${qs({ startDate: dates.startDate, endDate: dates.endDate })}`).then((res) =>
            readJson<{ rows: GscPageRow[] }>(res)
          ),
          fetch(`/api/analytics/gsc/pages?${qs({ startDate: dates.prevStartDate, endDate: dates.prevEndDate })}`)
            .then((res) => readJson<{ rows: GscPageRow[] }>(res))
            .catch(() => ({ rows: [] as GscPageRow[] })),
          fetch(`/api/analytics/gsc/timeseries?${qs({ startDate: dates.startDate, endDate: dates.endDate })}`).then((res) =>
            readJson<{ rows: GscTimeSeriesRow[] }>(res)
          ),
        ])
      : null;

    const ga4Tasks = ga4Ready
      ? Promise.all([
          fetch(`/api/analytics/ga4/overview?${qs({ startDate: dates.startDate, endDate: dates.endDate })}`).then((res) =>
            readJson<Ga4Overview>(res)
          ),
          fetch(`/api/analytics/ga4/overview?${qs({ startDate: dates.prevStartDate, endDate: dates.prevEndDate })}`)
            .then((res) => readJson<Ga4Overview>(res))
            .catch(() => null),
          fetch(`/api/analytics/ga4/pages?${qs({ startDate: dates.startDate, endDate: dates.endDate })}`).then((res) =>
            readJson<{ rows: Ga4PageRow[] }>(res)
          ),
          fetch(`/api/analytics/ga4/timeseries?${qs({ startDate: dates.startDate, endDate: dates.endDate })}`).then((res) =>
            readJson<{ rows: Ga4TimeSeriesRow[] }>(res)
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

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setStatusLoading(true);
    try {
      const next = await loadStatus();
      const nextRules = await loadRules();
      await loadData(next, nextRules);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      setStatusLoading(false);
    }
  }, [loadData, loadRules, loadStatus, workspaceId]);

  useEffect(() => {
    void refresh();
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
    refresh,
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
  return data.rules;
}
