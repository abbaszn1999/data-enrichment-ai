"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { readBootstrap } from "@/lib/workspace-bootstrap-cache";
import { useWorkspaceStore } from "@/store/workspace-store";
import {
  EMPTY_WELCOME_GIFT,
  type WelcomeGiftState,
} from "@/lib/billing/welcome-gift";

interface SubscriptionState {
  subscription: any | null;
  plan: any | null;
  availablePlans: any[];
  credits: { monthlyTotal: number; monthlyRemaining: number; bonus: number; total: number; used: number } | null;
  isActive: boolean;
  isLoading: boolean;
  welcomeGift: WelcomeGiftState;
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

export function useSubscription(workspaceId: string | null) {
  const subscriptionVersion = useWorkspaceStore((s) => s.subscriptionVersion);
  const [state, setState] = useState<SubscriptionState>(() => {
    // Synchronously check if cached data is available to populate initial state instantly.
    // Prefer the shared bootstrap cache (seeded by the layout's single bootstrap
    // request) so we avoid an extra /api/subscription round-trip entirely.
    if (workspaceId) {
      const boot = readBootstrap(workspaceId);
      if (boot?.subscription) {
        const s = boot.subscription;
        return {
          subscription: s.subscription,
          plan: s.currentPlan,
          availablePlans: (s.availablePlans as any[]) || [],
          credits: (s.credits as any) || null,
          isActive: s.isActive || false,
          isLoading: false,
          welcomeGift: s.welcomeGift ?? EMPTY_WELCOME_GIFT,
        };
      }
      const cached = cacheStore.get(`/api/subscription?workspaceId=${workspaceId}`);
      if (cached) {
        return {
          subscription: cached.data.subscription,
          plan: cached.data.currentPlan,
          availablePlans: cached.data.availablePlans || [],
          credits: cached.data.credits || null,
          isActive: cached.data.isActive || false,
          isLoading: false,
          welcomeGift: cached.data.welcomeGift ?? EMPTY_WELCOME_GIFT,
        };
      }
    }
    return {
      subscription: null,
      plan: null,
      availablePlans: [],
      credits: null,
      isActive: false,
      isLoading: true,
      welcomeGift: EMPTY_WELCOME_GIFT,
    };
  });

  const refresh = useCallback(async (force = false) => {
    if (!workspaceId) return;
    // Fast path: a fresh bootstrap seed satisfies non-forced reads with no fetch.
    if (!force) {
      const boot = readBootstrap(workspaceId);
      if (boot?.subscription) {
        const s = boot.subscription;
        setState({
          subscription: s.subscription,
          plan: s.currentPlan,
          availablePlans: (s.availablePlans as any[]) || [],
          credits: (s.credits as any) || null,
          isActive: s.isActive || false,
          isLoading: false,
          welcomeGift: s.welcomeGift ?? EMPTY_WELCOME_GIFT,
        });
        return;
      }
    }
    try {
      const url = `/api/subscription?workspaceId=${workspaceId}`;
      const data = await dedupedFetch(url, force);
      setState({
        subscription: data.subscription,
        plan: data.currentPlan,
        availablePlans: data.availablePlans || [],
        credits: data.credits || null,
        isActive: data.isActive || false,
        isLoading: false,
        welcomeGift: data.welcomeGift ?? EMPTY_WELCOME_GIFT,
      });
    } catch {
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, [workspaceId]);

  const prevVersionRef = useRef(subscriptionVersion);
  useEffect(() => {
    if (prevVersionRef.current !== subscriptionVersion) {
      prevVersionRef.current = subscriptionVersion;
      void refresh(true);
    }
  }, [refresh, subscriptionVersion]);

  useEffect(() => {
    refresh(false);
  }, [refresh]);

  const planName = state.plan?.display_name || "No Plan";
  const isStarter = state.plan?.name === "starter";
  const isGrowth = state.plan?.name === "growth";
  const isPro = state.plan?.name === "pro";
  const isEnterprise = state.plan?.name === "enterprise";

  return { ...state, refresh: () => refresh(true), planName, isStarter, isGrowth, isPro, isEnterprise };
}
