import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptIntegrationConfig } from "../../../../src/lib/integrations/crypto";
import { StoreNotConnectedError } from "../store-connection";

export const SHOPIFY_API_VERSION = "2026-04";

/** Throttle retries back off 1s → 2s → 4s → 8s → 16s. */
const MAX_THROTTLE_RETRIES = 5;
const SCOPES_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 60_000;

export type ShopifyConnection = {
  workspaceId: string;
  shopDomain: string;
  storeName: string;
  endpoint: string;
  /** Never logged, never shown to the model. */
  token: string;
};

export type ShopifyResponse = {
  data: unknown;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
  extensions?: { cost?: { requestedQueryCost?: number; actualQueryCost?: number; throttleStatus?: { currentlyAvailable: number; maximumAvailable: number; restoreRate: number } } };
};

export class ShopifyNotConnectedError extends StoreNotConnectedError {}

/** Load the workspace's Shopify connection with a decrypted token. */
export async function loadShopifyConnection(db: SupabaseClient, workspaceId: string): Promise<ShopifyConnection> {
  const { data, error } = await db
    .from("workspace_integrations")
    .select("provider, integration_name, base_url, config")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the store connection: ${error.message}`);
  if (!data || data.provider !== "shopify") throw new ShopifyNotConnectedError("No Shopify store is connected to this workspace.");
  const config = decryptIntegrationConfig(data.config).plaintext;
  const token = String(config.admin_api_token ?? "").trim();
  const baseUrl = String(data.base_url ?? "").replace(/\/$/, "");
  if (!token || !baseUrl) throw new ShopifyNotConnectedError("The Shopify connection is incomplete. Reconnect the store in Settings.");
  return {
    workspaceId,
    shopDomain: new URL(baseUrl).hostname,
    storeName: String(data.integration_name ?? ""),
    endpoint: `${baseUrl}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    token,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isThrottled(body: ShopifyResponse | null, status: number): boolean {
  if (status === 429) return true;
  return !!body?.errors?.some((e) => e.extensions?.code === "THROTTLED");
}

/**
 * Send one GraphQL request, waiting out Shopify's rate limit. Returns the raw
 * response; GraphQL errors are left for the caller to report.
 */
export async function shopifyGraphql(
  conn: ShopifyConnection,
  query: string,
  variables?: Record<string, unknown> | null,
  signal?: AbortSignal
): Promise<ShopifyResponse> {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort);
    let status = 0;
    let body: ShopifyResponse | null = null;
    try {
      const res = await fetch(conn.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": conn.token },
        body: JSON.stringify({ query, variables: variables ?? undefined }),
        signal: controller.signal,
      });
      status = res.status;
      if (status === 401 || status === 403) {
        throw new Error("Shopify rejected the store's access token. Reconnect the store in Settings.");
      }
      body = (await res.json().catch(() => null)) as ShopifyResponse | null;
      if (!res.ok && !isThrottled(body, status)) {
        throw new Error(`Shopify answered ${status}${body?.errors?.[0]?.message ? `: ${body.errors[0].message}` : ""}`);
      }
    } catch (error) {
      if (signal?.aborted) throw new Error("Cancelled");
      if ((error as Error).name === "AbortError") throw new Error("Shopify did not answer in time.");
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }
    if (!isThrottled(body, status)) return body ?? { data: null };
    if (attempt >= MAX_THROTTLE_RETRIES) throw new Error("Shopify is rate limiting this store. Try again in a minute.");
    // Wait for the bucket to refill enough for this query, or back off.
    const cost = body?.extensions?.cost;
    const needed = (cost?.requestedQueryCost ?? 0) - (cost?.throttleStatus?.currentlyAvailable ?? 0);
    const rate = cost?.throttleStatus?.restoreRate ?? 0;
    const refillMs = needed > 0 && rate > 0 ? Math.ceil((needed / rate) * 1000) : 0;
    await sleep(Math.max(refillMs, 1000 * 2 ** attempt));
  }
}

const grantedCache = new Map<string, { scopes: Set<string>; at: number }>();

/** Scopes the store actually granted to its app token (cached for 10 minutes). */
export async function grantedScopes(conn: ShopifyConnection): Promise<Set<string>> {
  const cached = grantedCache.get(conn.workspaceId);
  if (cached && Date.now() - cached.at < SCOPES_TTL_MS) return cached.scopes;
  const res = await shopifyGraphql(conn, "{ currentAppInstallation { accessScopes { handle } } }");
  const handles = (res.data as { currentAppInstallation?: { accessScopes?: Array<{ handle: string }> } } | null)
    ?.currentAppInstallation?.accessScopes?.map((s) => s.handle);
  if (!handles) throw new Error("Could not read the store's permissions from Shopify.");
  const scopes = new Set(handles);
  grantedCache.set(conn.workspaceId, { scopes, at: Date.now() });
  return scopes;
}

/** Forget cached permissions (after the merchant reconnects the store). */
export function forgetGrantedScopes(workspaceId: string): void {
  grantedCache.delete(workspaceId);
}
