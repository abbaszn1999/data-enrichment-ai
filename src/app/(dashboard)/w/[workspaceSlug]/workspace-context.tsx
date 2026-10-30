"use client";

import { createContext, useContext } from "react";
import type { Workspace } from "@/lib/supabase";
import type { Role } from "@/lib/permissions";
import { storeToolLocks, type StoreToolId, type ToolLock } from "@/lib/integrations/shopify-access";

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
  /** A Shopify or WooCommerce store is connected (what the Store Assistant needs). */
  hasStoreAgentStore: boolean;
  /** Which store tools are locked, and why (null: open). */
  toolLocks: Record<StoreToolId, ToolLock>;
}

export const WorkspaceContext = createContext<WorkspaceContextType>({
  workspace: null,
  role: null,
  wsLoading: true,
  hasIntegration: false,
  hasStoreAgentStore: false,
  toolLocks: storeToolLocks(null, null),
});

export const useWorkspaceContext = () => useContext(WorkspaceContext);
