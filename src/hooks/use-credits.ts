"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useWorkspaceStore } from "@/store/workspace-store";
import { readBootstrap } from "@/lib/workspace-bootstrap-cache";

interface CreditState {
  used: number;
  total: number;
  bonus: number;
  remaining: number;
  isLoading: boolean;
}

// Client-side promise deduplication & caching store
const activeFetches = new Map<string, Promise<any>>();
const cacheStore = new Map<string, { data: any; ts: number }>();
const CACHE_TTL_MS = 15_000; // 15 seconds client-side TTL

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

export function useCredits(workspaceId: string | null) {
  const creditsVersion = useWorkspaceStore((s) => s.creditsVersion);

  const [state, setState] = useState<CreditState>(() => {
    // Synchronously check if cached data is available to populate initial state instantly.
    // Prefer the shared bootstrap cache (seeded by the layout's single bootstrap
    // request) so we avoid an extra /api/credits/balance round-trip entirely.
    if (workspaceId) {
      const boot = readBootstrap(workspaceId);
      if (boot?.credits) {
        return { ...boot.credits, isLoading: false };
      }
      const cached = cacheStore.get(`/api/credits/balance?workspaceId=${workspaceId}`);
      if (cached) {
        return {
          used: cached.data.used ?? 0,
          total: cached.data.total ?? 0,
          bonus: cached.data.bonus ?? 0,
          remaining: cached.data.remaining ?? 0,
          isLoading: false,
        };
      }
    }
    return {
      used: 0,
      total: 0,
      bonus: 0,
      remaining: 0,
      isLoading: true,
    };
  });

  const refresh = useCallback(async (force = false) => {
    if (!workspaceId) return;
    // Fast path: a fresh bootstrap seed satisfies non-forced reads with no fetch.
    if (!force) {
      const boot = readBootstrap(workspaceId);
      if (boot?.credits) {
        setState({ ...boot.credits, isLoading: false });
        return;
      }
    }
    try {
      const url = `/api/credits/balance?workspaceId=${workspaceId}`;
      const data = await dedupedFetch(url, force);
      setState({
        used: data.used ?? 0,
        total: data.total ?? 0,
        bonus: data.bonus ?? 0,
        remaining: data.remaining ?? 0,
        isLoading: false,
      });
    } catch {
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, [workspaceId]);

  // Force a refresh only when creditsVersion actually CHANGES (e.g. after the
  // user spends credits) — not on the initial mount. This removes the
  // duplicate request that previously fired on every mount.
  const prevVersionRef = useRef(creditsVersion);
  useEffect(() => {
    if (prevVersionRef.current !== creditsVersion) {
      prevVersionRef.current = creditsVersion;
      refresh(true);
    }
  }, [refresh, creditsVersion]);

  // Regular mount effect — uses the bootstrap seed / 15s SWR cache when available.
  useEffect(() => {
    refresh(false);
  }, [refresh]);

  const hasCredits = (amount: number) => state.remaining >= amount;
  const isLow = state.total > 0 && state.remaining < state.total * 0.2;

  return { ...state, refresh: () => refresh(true), hasCredits, isLow };
}
