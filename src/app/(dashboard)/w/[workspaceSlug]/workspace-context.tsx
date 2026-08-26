"use client";

import { createContext, useContext } from "react";
import type { Workspace } from "@/lib/supabase";
import type { Role } from "@/lib/permissions";

/**
 * Lives outside layout.tsx because Next.js only allows a layout file to export
 * the route conventions (default, metadata, ...); any extra export fails the
 * production type check.
 */
export interface WorkspaceContextType {
  workspace: Workspace | null;
  role: Role | null;
  wsLoading: boolean;
  hasIntegration: boolean;
}

export const WorkspaceContext = createContext<WorkspaceContextType>({
  workspace: null,
  role: null,
  wsLoading: true,
  hasIntegration: false,
});

export const useWorkspaceContext = () => useContext(WorkspaceContext);
