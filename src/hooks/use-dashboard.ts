"use client";

import { useEffect, useState, useCallback } from "react";

interface DashboardStats {
  totalProducts: number;
  totalCategories: number;
  recentImports: number;
  teamMembers: number;
}

interface DashboardData {
  stats: DashboardStats;
  creditTransactions: any[];
  importSessions: any[];
}

const activeFetches = new Map<string, Promise<any>>();
const cacheStore = new Map<string, { data: any; ts: number }>();
const CACHE_TTL_MS = 20_000; // 20 seconds SWR TTL

async function dedupedFetch(url: string, forceRefresh = false) {
  const cached = cacheStore.get(url);
  if (!forceRefresh && cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  let promise = activeFetches.get(url);
  if (!promise) {
    promise = fetch(url).then(async (res) => {
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const data = await res.json();
      cacheStore.set(url, { data, ts: Date.now() });
      return data;
    }).finally(() => {
      activeFetches.delete(url);
    });
    activeFetches.set(url, promise);
  }
  return promise;
}

export function useDashboardSummary(workspaceId: string | null) {
  const [state, setState] = useState<{
    data: DashboardData | null;
    isLoading: boolean;
    error: string | null;
  }>(() => {
    if (workspaceId) {
      const cached = cacheStore.get(`/api/dashboard/summary?workspaceId=${workspaceId}`);
      if (cached) {
        return {
          data: cached.data,
          isLoading: false,
          error: null,
        };
      }
    }
    return {
      data: null,
      isLoading: true,
      error: null,
    };
  });

  const refresh = useCallback(async (force = false) => {
    if (!workspaceId) return;
    try {
      const url = `/api/dashboard/summary?workspaceId=${workspaceId}`;
      const data = await dedupedFetch(url, force);
      setState({
        data,
        isLoading: false,
        error: null,
      });
    } catch (err: any) {
      setState((prev) => ({ ...prev, isLoading: false, error: err.message }));
    }
  }, [workspaceId]);

  useEffect(() => {
    refresh(false);
  }, [refresh]);

  return {
    ...state,
    refresh: () => refresh(true),
  };
}
