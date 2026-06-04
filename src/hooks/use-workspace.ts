"use client";

import { useEffect, useState } from "react";
import type { Workspace } from "@/lib/supabase";
import type { Role } from "@/lib/permissions";
import type { User } from "@supabase/supabase-js";
import { seedBootstrap } from "@/lib/workspace-bootstrap-cache";

interface WorkspaceState {
  workspace: Workspace | null;
  role: Role | null;
  hasIntegration: boolean;
  isLoading: boolean;
  error: string | null;
}

export function useWorkspace(slug: string, user: User | null | undefined) {
  const [state, setState] = useState<WorkspaceState>({
    workspace: null,
    role: null,
    hasIntegration: false,
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    if (!slug || user === undefined) return;
    if (!user) {
      setState({ workspace: null, role: null, hasIntegration: false, isLoading: false, error: "Not authenticated" });
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
          setState({ workspace: null, role: null, hasIntegration: false, isLoading: false, error: err?.error || "Failed to load workspace" });
          return;
        }

        const data = await res.json();
        const { workspace, role: memberRole, credits, subscription, hasIntegration } = data;

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
          isLoading: false,
          error: memberRole ? null : "Not a member",
        });
      } catch (err: any) {
        if (!cancelled) {
          setState({ workspace: null, role: null, hasIntegration: false, isLoading: false, error: err?.message || "Failed to load workspace" });
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [slug, user?.id]);

  return state;
}
