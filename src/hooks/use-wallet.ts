"use client";

import { useCallback, useEffect, useState } from "react";
import { useWorkspaceStore } from "@/store/workspace-store";
import type { WalletAutoReload, WalletState } from "@/lib/wallet/types";

export function useWallet(workspaceId: string | null | undefined) {
  const walletVersion = useWorkspaceStore((s) => s.walletVersion);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(workspaceId));

  const refresh = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!workspaceId) {
        setWallet(null);
        setIsLoading(false);
        return;
      }
      if (!opts?.silent) setIsLoading(true);
      try {
        const response = await fetch(
          `/api/wallet?workspaceId=${encodeURIComponent(workspaceId)}`
        );
        if (!response.ok) {
          setWallet(null);
          return;
        }
        const data = (await response.json()) as { wallet?: WalletState };
        setWallet(data.wallet ?? null);
      } catch {
        setWallet(null);
      } finally {
        setIsLoading(false);
      }
    },
    [workspaceId]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (walletVersion === 0) return;
    void refresh({ silent: true });
  }, [walletVersion, refresh]);

  return { wallet, isLoading, refresh };
}

export async function topUpWalletApi(
  workspaceId: string,
  amountUsd: number,
  method: string
): Promise<WalletState> {
  const response = await fetch("/api/wallet/topup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, amountUsd, method }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    wallet?: WalletState;
    error?: string;
  };
  if (!response.ok || !data.wallet) {
    throw new Error(data.error || "Top-up failed");
  }
  return data.wallet;
}

export async function startWalletCheckoutApi(
  workspaceId: string,
  workspaceSlug: string,
  amountUsd: number
): Promise<string> {
  const response = await fetch("/api/wallet/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, workspaceSlug, amountUsd }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    url?: string;
    error?: string;
  };
  if (!response.ok || !data.url) {
    throw new Error(data.error || "Could not start checkout");
  }
  return data.url;
}

export async function saveWalletAutoReloadApi(
  workspaceId: string,
  autoReload: WalletAutoReload
): Promise<WalletState> {
  const response = await fetch("/api/wallet/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, autoReload }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    wallet?: WalletState;
    error?: string;
  };
  if (!response.ok || !data.wallet) {
    throw new Error(data.error || "Could not save wallet settings");
  }
  return data.wallet;
}
