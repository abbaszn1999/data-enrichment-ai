"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
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
      const supabase = createClient();
      try {
        const { data: workspace, error: wsErr } = await supabase
          .from("workspaces")
          .select("*")
          .eq("slug", slug)
          .single();

        if (cancelled) return;

        if (wsErr || !workspace) {
          setState({ workspace: null, role: null, isLoading: false, error: "Workspace not found" });
          return;
        }

        const { data: memberData } = await supabase
          .from("workspace_members")
          .select("role")
          .eq("workspace_id", workspace.id)
          .eq("user_id", user!.id)
          .single();

        if (cancelled) return;

        setState({
          workspace,
          role: (memberData?.role as Role) ?? null,
          isLoading: false,
          error: memberData?.role ? null : "Not a member",
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
