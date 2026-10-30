"use client";

import { useEffect, useState } from "react";
import type { Workspace } from "@/lib/supabase";
import type { Role } from "@/lib/permissions";
import type { User } from "@supabase/supabase-js";
import { seedBootstrap } from "@/lib/workspace-bootstrap-cache";

/** Fired after the store connection changes (saved, disconnected, rechecked): the workspace reloads. */
export const WORKSPACE_REFRESH_EVENT = "workspace:refresh";

export function refreshWorkspace() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(WORKSPACE_REFRESH_EVENT));
}

interface WorkspaceState {
  workspace: Workspace | null;
  role: Role | null;
  hasIntegration: boolean;
  /** The connected platform ("shopify" | "woocommerce" | "wordpress"), null when none. */
  storeProvider: string | null;
  /** The scopes the Shopify store granted; null when not known or not Shopify. */
  storeScopes: string[] | null;
  isLoading: boolean;
  error: string | null;
}

const EMPTY = { workspace: null, role: null, hasIntegration: false, storeProvider: null, storeScopes: null } as const;

export function useWorkspace(slug: string, user: User | null | undefined) {
  const [state, setState] = useState<WorkspaceState>({ ...EMPTY, isLoading: true, error: null });

  useEffect(() => {
    if (!slug || user === undefined) return;
    if (!user) {
      setState({ ...EMPTY, isLoading: false, error: "Not authenticated" });
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        // Single API call that resolves workspace + role + credits + subscription
        // + integration server-side in ONE round-trip (collapsing the former
        // 4-level client fetch waterfall). The credits/subscription payloads are
        // seeded into a shared cache so useCredits/useSubscription resolve from
        // it instantly with no extra request.
        const res = await fetch(`/api/workspace-bootstrap?slug=${encodeURIComponent(slug)}`);

        if (cancelled) return;

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setState({ ...EMPTY, isLoading: false, error: err?.error || "Failed to load workspace" });
          return;
        }

        const data = await res.json();
        const { workspace, role: memberRole, credits, subscription, hasIntegration, integration } = data;

        // Seed the shared cache BEFORE committing workspace state, so the
        // dependent hooks read it synchronously on their next render.
        if (workspace?.id && credits && subscription) {
          seedBootstrap(workspace.id, {
            credits,
            subscription,
            hasIntegration: !!hasIntegration,
          });
        }

        setState({
          workspace,
          role: (memberRole as Role) ?? null,
          hasIntegration: !!hasIntegration,
          storeProvider: typeof integration?.provider === "string" ? integration.provider : null,
          storeScopes: Array.isArray(integration?.grantedScopes) ? integration.grantedScopes.map(String) : null,
          isLoading: false,
          error: memberRole ? null : "Not a member",
        });
      } catch (err: any) {
        if (!cancelled) {
          setState({ ...EMPTY, isLoading: false, error: err?.message || "Failed to load workspace" });
        }
      }
    }

    load();
    // The store connection changed: reload in place (no loading state, no flicker).
    const onRefresh = () => void load();
    window.addEventListener(WORKSPACE_REFRESH_EVENT, onRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener(WORKSPACE_REFRESH_EVENT, onRefresh);
    };
  }, [slug, user?.id]);

  return state;
}
