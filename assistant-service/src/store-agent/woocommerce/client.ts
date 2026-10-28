import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptIntegrationConfig } from "../../../../src/lib/integrations/crypto";
import { StoreNotConnectedError } from "../store-connection";

const REQUEST_TIMEOUT_MS = 90_000;
/** Waits before retrying a request the store did not process (rate limit, overload, dropped connection). */
const RETRY_DELAYS_MS = [1_000, 3_000, 8_000];

export type WooConnection = {
  workspaceId: string;
  storeName: string;
  /** https://shop.example.com (no trailing slash). */
  storeUrl: string;
  domain: string;
  /** Never logged, never shown to the model. */
  authHeader: string;
};

export type WooResponse = {
  ok: boolean;
  status: number;
  data: unknown;
  /** X-WP-Total / X-WP-TotalPages on list endpoints. */
  total: number | null;
  totalPages: number | null;
  /** WooCommerce's error code and message when !ok. */
  code?: string;
  message?: string;
};

/** Load the workspace's WooCommerce connection with its decrypted credentials. */
export async function loadWooConnection(db: SupabaseClient, workspaceId: string): Promise<WooConnection> {
  const { data, error } = await db
    .from("workspace_integrations")
    .select("provider, integration_name, base_url, config")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the store connection: ${error.message}`);
  if (!data || data.provider !== "woocommerce") throw new StoreNotConnectedError("No WooCommerce store is connected to this workspace.");
  const config = decryptIntegrationConfig(data.config).plaintext as Record<string, unknown>;
  const username = String(config.username ?? "").trim();
  const password = String(config.application_password ?? "").trim();
  const storeUrl = String(data.base_url ?? "").replace(/\/+$/, "");
  if (!username || !password || !storeUrl) throw new StoreNotConnectedError("The WooCommerce connection is incomplete. Reconnect the store in Settings.");
  const domain = new URL(storeUrl).hostname;
  return {
    workspaceId,
    storeName: String(config.store_name ?? "").trim() || String(data.integration_name ?? "").trim() || domain,
    storeUrl,
    domain,
    authHeader: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
  };
}

/** Stores whose permalinks are "Plain" have no /wp-json; they answer on ?rest_route= instead. */
const plainPermalinks = new Set<string>();

function buildUrl(conn: WooConnection, path: string, query?: Record<string, unknown> | null): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    params.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  const route = `/wc/v3/${path}`;
  if (plainPermalinks.has(conn.storeUrl)) {
    params.set("rest_route", route);
    return `${conn.storeUrl}/?${params}`;
  }
  const qs = params.toString();
  return `${conn.storeUrl}/wp-json${route}${qs ? `?${qs}` : ""}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function header(res: Response, name: string): number | null {
  const value = res.headers.get(name);
  return value === null || value === "" || Number.isNaN(Number(value)) ? null : Number(value);
}

/**
 * One request to the store's WooCommerce REST API (wc/v3). Errors the store
 * reports come back as `ok: false` with its code and message; a store that
 * cannot be reached throws.
 *
 * A request the store never processed (429, 503, a connection that failed
 * before sending) is retried. A dropped connection after sending is retried
 * only for `retry: true` requests: creating twice is worse than failing once.
 */
export async function wooRequest(
  conn: WooConnection,
  request: { method: string; path: string; query?: Record<string, unknown> | null; body?: unknown; retry?: boolean },
  signal?: AbortSignal
): Promise<WooResponse> {
  const method = request.method.toUpperCase();
  const retryAfterSend = request.retry ?? (method === "GET" || method === "OPTIONS");
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort);
    let res: Response;
    try {
      res = await fetch(buildUrl(conn, request.path, request.query), {
        method,
        headers: {
          Authorization: conn.authHeader,
          Accept: "application/json",
          ...(request.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: request.body !== undefined ? JSON.stringify(request.body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) throw new Error("Cancelled");
      const timedOut = (error as Error).name === "AbortError";
      // A connection that never opened was never processed: always safe to retry.
      const neverSent = /ENOTFOUND|ECONNREFUSED|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT/.test(String((error as Error).cause ?? error));
      if ((neverSent || retryAfterSend) && attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]!);
        continue;
      }
      throw new Error(
        timedOut
          ? "The store did not answer in time. It may still have applied the change: read it back before trying again."
          : `Could not reach the store: ${(error as Error).message}`
      );
    }
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);

    const raw = await res.text();
    const isJson = /json/i.test(res.headers.get("content-type") ?? "");
    if (res.status === 404 && !isJson && !plainPermalinks.has(conn.storeUrl)) {
      plainPermalinks.add(conn.storeUrl);
      continue;
    }
    if ((res.status === 429 || res.status === 503) && attempt < RETRY_DELAYS_MS.length) {
      const after = Number(res.headers.get("retry-after"));
      await sleep(Math.max(RETRY_DELAYS_MS[attempt]!, Number.isFinite(after) ? Math.min(after, 30) * 1000 : 0));
      continue;
    }
    if ((res.status === 502 || res.status === 504) && retryAfterSend && attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]!);
      continue;
    }

    let data: unknown = null;
    if (isJson) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = null;
      }
    }
    const total = header(res, "x-wp-total");
    const totalPages = header(res, "x-wp-totalpages");
    if (res.ok && isJson) return { ok: true, status: res.status, data, total, totalPages };

    const body = (data ?? {}) as { code?: string; message?: string };
    if (res.status === 401) {
      return { ok: false, status: 401, data, total, totalPages, code: body.code ?? "unauthorized", message: "The store rejected the connection's credentials. Reconnect the store in Settings." };
    }
    return {
      ok: false,
      status: res.status,
      data,
      total,
      totalPages,
      code: body.code ?? `http_${res.status}`,
      message: body.message
        ? body.message.replace(/<[^>]+>/g, "")
        : isJson
          ? `The store answered ${res.status}.`
          : `The store answered ${res.status} with a web page instead of data (a security plugin, firewall or maintenance mode may be blocking the API).`,
    };
  }
}
