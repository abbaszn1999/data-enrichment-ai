"use client";

import { useEffect, useState, useCallback } from "react";
import { getCreditBalance } from "@/lib/supabase";

interface CreditState {
  used: number;
  total: number;
  remaining: number;
  isLoading: boolean;
}

export function useCredits(workspaceId: string | null) {
  const [state, setState] = useState<CreditState>({
    used: 0,
    total: 0,
    remaining: 0,
    isLoading: true,
  });

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const balance = await getCreditBalance(workspaceId);
      setState({ ...balance, isLoading: false });
    } catch {
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, [workspaceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const hasCredits = (amount: number) => state.remaining >= amount;
  const isLow = state.total > 0 && state.remaining < state.total * 0.2;

  return { ...state, refresh, hasCredits, isLow };
}
