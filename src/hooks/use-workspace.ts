"use client";

import { useEffect, useState } from "react";
import type { Workspace } from "@/lib/supabase";
import type { Role } from "@/lib/permissions";
import type { User } from "@supabase/supabase-js";

interface WorkspaceState {
  workspace: Workspace | null;
  role: Role | null;
  isLoading: boolean;
  error: string | null;
}

export function useWorkspace(slug: string, user: User | null | undefined) {
  const [state, setState] = useState<WorkspaceState>({
    workspace: null,
    role: null,
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    if (!slug || user === undefined) return;
    if (!user) {
      setState({ workspace: null, role: null, isLoading: false, error: "Not authenticated" });
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        // Single API call that resolves workspace + role server-side in parallel
        // This avoids 2 sequential round-trips (browser→supabase + browser→API→supabase)
        const res = await fetch(`/api/workspace-init?slug=${encodeURIComponent(slug)}`);

        if (cancelled) return;

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setState({ workspace: null, role: null, isLoading: false, error: err?.error || "Failed to load workspace" });
          return;
        }

        const { workspace, role: memberRole } = await res.json();

        setState({
          workspace,
          role: (memberRole as Role) ?? null,
          isLoading: false,
          error: memberRole ? null : "Not a member",
        });
      } catch (err: any) {
        if (!cancelled) {
          setState({ workspace: null, role: null, isLoading: false, error: err?.message || "Failed to load workspace" });
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [slug, user?.id]);

  return state;
}
