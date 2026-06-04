"use client";

// Shared client-side cache for the workspace "bootstrap" payload.
//
// The dashboard layout used to trigger a 4-level client fetch waterfall:
//   useAuth → /api/workspace-init → (credits + subscription + integration)
//            → page data
// Every one of those was a separate Netlify function invocation (cold-start
// prone on the free plan), and nothing rendered until the last level resolved.
//
// `/api/workspace-bootstrap` now returns ALL of that in a single request
// (the server already had it via `getWorkspaceContext`'s single RPC). After
// `useWorkspace` fetches it, it seeds this module-level cache. `useCredits`
// and `useSubscription` read from here FIRST, so they resolve instantly with
// no extra network round-trip — collapsing 4 requests into 1.
//
// This is intentionally non-breaking: the hooks fall back to their own
// `fetch` when no seed is present (e.g. components used outside the layout, or
// after the short TTL expires).

export interface BootstrapCreditsShape {
  used: number;
  total: number;
  bonus: number;
  remaining: number;
}

export interface BootstrapSubscriptionShape {
  subscription: unknown | null;
  currentPlan: unknown | null;
  availablePlans: unknown[];
  creditPacks: unknown[];
  credits: unknown | null;
  isActive: boolean;
}

export interface BootstrapData {
  credits: BootstrapCreditsShape;
  subscription: BootstrapSubscriptionShape;
  hasIntegration: boolean;
}

const TTL_MS = 15_000; // match the per-hook client SWR TTL
const store = new Map<string, { data: BootstrapData; ts: number }>();

export function seedBootstrap(workspaceId: string, data: BootstrapData): void {
  if (!workspaceId) return;
  store.set(workspaceId, { data, ts: Date.now() });
}

export function readBootstrap(workspaceId: string | null): BootstrapData | null {
  if (!workspaceId) return null;
  const entry = store.get(workspaceId);
  if (entry && Date.now() - entry.ts < TTL_MS) return entry.data;
  return null;
}

export function clearBootstrap(workspaceId?: string): void {
  if (!workspaceId) {
    store.clear();
    return;
  }
  store.delete(workspaceId);
}
