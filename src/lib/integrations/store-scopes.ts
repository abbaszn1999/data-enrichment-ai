import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptedIntegrationConfig } from "@/lib/integrations/load";
import { storeToolLocks, type StoreToolId } from "@/lib/integrations/shopify-access";
import { fetchShopifyGrantedScopes } from "@/lib/sync/providers/shopify/auth";

/**
 * The scopes the connected Shopify store granted, kept with the integration
 * (workspace_integrations.granted_scopes) so pages can lock tools without
 * asking Shopify on every load. Refreshed when older than this.
 */
const FRESH_MS = 60 * 60 * 1000;
/** How long a page waits for a first check before showing what it knows. */
const FIRST_CHECK_WAIT_MS = 6_000;

export type StoreScopes = { provider: string | null; scopes: string[] | null };

/** Record what the store granted (null: unknown or a platform without scopes). */
export async function saveGrantedScopes(admin: SupabaseClient, workspaceId: string, scopes: string[] | null): Promise<void> {
  await admin
    .from("workspace_integrations")
    .update({ granted_scopes: scopes, scopes_checked_at: scopes ? new Date().toISOString() : null })
    .eq("workspace_id", workspaceId);
}

const inFlight = new Map<string, Promise<string[] | null>>();

/** Ask Shopify again and keep the answer; one request at a time per workspace. */
function refresh(admin: SupabaseClient, workspaceId: string, baseUrl: string, config: unknown): Promise<string[] | null> {
  const running = inFlight.get(workspaceId);
  if (running) return running;
  const job = (async () => {
    const token = String(decryptedIntegrationConfig(config).admin_api_token ?? "").trim();
    if (!token) return null;
    const scopes = await fetchShopifyGrantedScopes(baseUrl, token);
    // A failed check keeps the last known scopes rather than locking everything.
    if (scopes) await saveGrantedScopes(admin, workspaceId, scopes);
    return scopes;
  })()
    .catch(() => null)
    .finally(() => inFlight.delete(workspaceId));
  inFlight.set(workspaceId, job);
  return job;
}

/**
 * The store's provider and granted scopes for the sidebar and tool pages.
 * Fresh scopes come back at once; stale ones come back too while a refresh
 * runs behind; a store never checked waits briefly for its first check.
 */
export async function workspaceStoreScopes(admin: SupabaseClient, workspaceId: string): Promise<StoreScopes> {
  const { data } = await admin
    .from("workspace_integrations")
    .select("provider, base_url, config, granted_scopes, scopes_checked_at")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!data) return { provider: null, scopes: null };
  const provider = String(data.provider);
  if (provider !== "shopify" || !data.base_url) return { provider, scopes: null };

  const known = Array.isArray(data.granted_scopes) ? (data.granted_scopes as string[]) : null;
  const checkedAt = data.scopes_checked_at ? Date.parse(String(data.scopes_checked_at)) : 0;
  if (known && Date.now() - checkedAt < FRESH_MS) return { provider, scopes: known };

  const job = refresh(admin, workspaceId, String(data.base_url), data.config);
  if (known) return { provider, scopes: known };
  const first = await Promise.race([job, new Promise<null>((resolve) => setTimeout(() => resolve(null), FIRST_CHECK_WAIT_MS))]);
  return { provider, scopes: first };
}

/** The scopes a connection test reported (Shopify), as the columns saved with the integration. */
export function grantedScopesFromTest(provider: string, metadata: Record<string, unknown> | undefined) {
  const reported = metadata?.grantedScopes;
  const scopes = provider === "shopify" && Array.isArray(reported) ? reported.map(String) : null;
  return { granted_scopes: scopes, scopes_checked_at: scopes ? new Date().toISOString() : null };
}

/**
 * A refusal when the store has not given a tool the scopes it needs, else null.
 * The same rule as the sidebar, so a direct request cannot get past the lock.
 */
export async function storeToolBlock(admin: SupabaseClient, workspaceId: string, tool: StoreToolId): Promise<NextResponse | null> {
  const { provider, scopes } = await workspaceStoreScopes(admin, workspaceId);
  const lock = storeToolLocks(provider, scopes)[tool];
  if (lock?.reason !== "missing-scopes") return null;
  return NextResponse.json(
    { error: `Your Shopify app is missing access this tool needs: ${lock.missing.join(", ")}. Enable it, then press Recheck in Settings.`, code: "MISSING_SCOPES", missing: lock.missing },
    { status: 403 }
  );
}
