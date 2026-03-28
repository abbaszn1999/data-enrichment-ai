"use client";

import { useEffect, useState, useCallback } from "react";
import { getWorkspaceSubscription } from "@/lib/supabase";

interface SubscriptionState {
  subscription: any | null;
  plan: any | null;
  isLoading: boolean;
}

export function useSubscription(workspaceId: string | null) {
  const [state, setState] = useState<SubscriptionState>({
    subscription: null,
    plan: null,
    isLoading: true,
  });

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const sub = await getWorkspaceSubscription(workspaceId);
      setState({
        subscription: sub,
        plan: sub?.subscription_plans || null,
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
  const isPro = state.plan?.name === "pro";
  const isEnterprise = state.plan?.name === "enterprise";

  return { ...state, refresh, planName, isStarter, isPro, isEnterprise };
}
