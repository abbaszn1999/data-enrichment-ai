"use client";

import { useEffect, useState, useCallback } from "react";
import { useWorkspaceStore } from "@/store/workspace-store";

interface CreditState {
  used: number;
  total: number;
  bonus: number;
  remaining: number;
  isLoading: boolean;
}

export function useCredits(workspaceId: string | null) {
  const creditsVersion = useWorkspaceStore((s) => s.creditsVersion);

  const [state, setState] = useState<CreditState>({
    used: 0,
    total: 0,
    bonus: 0,
    remaining: 0,
    isLoading: true,
  });

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const res = await fetch(`/api/credits/balance?workspaceId=${workspaceId}`);
      if (!res.ok) throw new Error("Failed to fetch credits");
      const data = await res.json();
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

  useEffect(() => {
    refresh();
  }, [refresh, creditsVersion]);

  const hasCredits = (amount: number) => state.remaining >= amount;
  const isLow = state.total > 0 && state.remaining < state.total * 0.2;

  return { ...state, refresh, hasCredits, isLow };
}
