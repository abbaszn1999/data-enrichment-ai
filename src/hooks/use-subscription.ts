"use client";

import { useEffect, useState, useCallback } from "react";

interface SubscriptionState {
  subscription: any | null;
  plan: any | null;
  availablePlans: any[];
  creditPacks: any[];
  credits: { monthlyTotal: number; monthlyRemaining: number; bonus: number; total: number; used: number } | null;
  isActive: boolean;
  isLoading: boolean;
}

export function useSubscription(workspaceId: string | null) {
  const [state, setState] = useState<SubscriptionState>({
    subscription: null,
    plan: null,
    availablePlans: [],
    creditPacks: [],
    credits: null,
    isActive: false,
    isLoading: true,
  });

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const res = await fetch(`/api/subscription?workspaceId=${workspaceId}`);
      if (!res.ok) throw new Error("Failed to fetch subscription");
      const data = await res.json();
      setState({
        subscription: data.subscription,
        plan: data.currentPlan,
        availablePlans: data.availablePlans || [],
        creditPacks: data.creditPacks || [],
        credits: data.credits || null,
        isActive: data.isActive || false,
        isLoading: false,
      });
    } catch {
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, [workspaceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const planName = state.plan?.display_name || "No Plan";
  const isStarter = state.plan?.name === "starter";
  const isGrowth = state.plan?.name === "growth";
  const isPro = state.plan?.name === "pro";

  return { ...state, refresh, planName, isStarter, isGrowth, isPro };
}
