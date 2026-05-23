// Shopify GraphQL Admin API client (2026-04) with cost-aware throttling.
// Single source of truth for every GraphQL call the sync engine makes.
//
// Features:
// - Reads extensions.cost.throttleStatus after each call to update bucket state
// - Pre-flight sleep when estimated cost > currentlyAvailable
// - Exponential backoff on THROTTLED errors (1s → 2s → 4s → 8s)
// - Parses userErrors from common mutations
// - Optional Shopify-GraphQL-Cost-Debug=1 via env flag

import type {
  IntegrationRecord,
  ShopifyCostInfo,
  ShopifyGraphQLResult,
} from "@/lib/sync/core/types";
import { SHOPIFY_API_VERSION } from "./schema-catalog";

type BucketState = {
  available: number;
  max: number;
  restoreRatePerSecond: number;
  updatedAt: number;
};

const BUCKETS = new WeakMap<object, BucketState>();

function getBucketKey(integration: IntegrationRecord): object {
  // Key by config object identity — one bucket per integration instance.
  return (integration.config ?? integration) as object;
}

function getBucket(integration: IntegrationRecord): BucketState {
  const key = getBucketKey(integration);
  let state = BUCKETS.get(key);
  if (!state) {
    state = {
      available: 2000,
      max: 2000,
      restoreRatePerSecond: 100,
      updatedAt: Date.now(),
    };
    BUCKETS.set(key, state);
  }
  return state;
}

function updateBucketFromCost(
  integration: IntegrationRecord,
  cost: ShopifyCostInfo | null
): void {
  if (!cost?.throttleStatus) return;
  const state = getBucket(integration);
  state.available = cost.throttleStatus.currentlyAvailable;
  state.max = cost.throttleStatus.maximumAvailable;
  state.restoreRatePerSecond = cost.throttleStatus.restoreRate;
  state.updatedAt = Date.now();
}

function projectAvailable(state: BucketState): number {
  const elapsedSec = (Date.now() - state.updatedAt) / 1000;
  return Math.min(state.max, state.available + elapsedSec * state.restoreRatePerSecond);
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((r) => setTimeout(r, ms));
}

function getAdminToken(integration: IntegrationRecord): string {
  const config = (integration.config ?? {}) as Record<string, unknown>;
  const token = String(config.admin_api_token ?? "").trim();
  if (!token) throw new Error("Missing Shopify admin_api_token in integration config");
  return token;
}

function graphqlEndpoint(integration: IntegrationRecord): string {
  const baseUrl = (integration.base_url ?? "").replace(/\/$/, "");
  if (!baseUrl) throw new Error("Missing Shopify base_url on integration");
  return `${baseUrl}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
}

function parseCost(extensions: unknown): ShopifyCostInfo | null {
  if (!extensions || typeof extensions !== "object") return null;
  const ext = extensions as Record<string, unknown>;
  const cost = ext.cost as Record<string, unknown> | undefined;
  if (!cost) return null;
  const throttleStatus = cost.throttleStatus as Record<string, unknown> | undefined;
  if (!throttleStatus) return null;
  return {
    requestedQueryCost: Number(cost.requestedQueryCost ?? 0),
    actualQueryCost: cost.actualQueryCost != null ? Number(cost.actualQueryCost) : null,
    throttleStatus: {
      maximumAvailable: Number(throttleStatus.maximumAvailable ?? 0),
      currentlyAvailable: Number(throttleStatus.currentlyAvailable ?? 0),
      restoreRate: Number(throttleStatus.restoreRate ?? 0),
    },
  };
}

function extractUserErrors(data: unknown): Array<{
  field: string[] | null;
  message: string;
  code?: string;
}> {
  if (!data || typeof data !== "object") return [];
  const collected: Array<{ field: string[] | null; message: string; code?: string }> = [];
  for (const value of Object.values(data)) {
    if (value && typeof value === "object" && "userErrors" in (value as Record<string, unknown>)) {
      const errs = (value as Record<string, unknown>).userErrors;
      if (Array.isArray(errs)) {
        for (const e of errs) {
          if (e && typeof e === "object") {
            const obj = e as Record<string, unknown>;
            collected.push({
              field: Array.isArray(obj.field) ? (obj.field as string[]) : null,
              message: String(obj.message ?? ""),
              code: obj.code ? String(obj.code) : undefined,
            });
          }
        }
      }
    }
  }
  return collected;
}

function isThrottledError(errors: Array<{ message: string }>): boolean {
  return errors.some((e) => /throttled/i.test(e.message || ""));
}

export type ShopifyGraphQLRequestOptions = {
  /** Pre-flight estimate in cost points. If > currentlyAvailable, we sleep. */
  estimatedCost?: number;
  /** Tag for logging/tracing. */
  tag?: string;
  /** Max backoff retries on THROTTLED. Default 5. */
  maxRetries?: number;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
};

export async function shopifyGraphQL<T>(params: {
  integration: IntegrationRecord;
  query: string;
  variables?: Record<string, unknown>;
  options?: ShopifyGraphQLRequestOptions;
}): Promise<ShopifyGraphQLResult<T>> {
  const { integration, query, variables, options } = params;
  const token = getAdminToken(integration);
  const endpoint = graphqlEndpoint(integration);
  const debug = process.env.SHOPIFY_COST_DEBUG === "1";
  const maxRetries = options?.maxRetries ?? 5;

  // Pre-flight throttle wait
  if (options?.estimatedCost && options.estimatedCost > 0) {
    const state = getBucket(integration);
    const projected = projectAvailable(state);
    if (projected < options.estimatedCost) {
      const needed = options.estimatedCost - projected;
      const waitMs = Math.ceil((needed / Math.max(state.restoreRatePerSecond, 1)) * 1000);
      if (waitMs > 0) await sleep(Math.min(waitMs, 10_000));
    }
  }

  let attempt = 0;
  let backoffMs = 1000;

  while (true) {
    attempt += 1;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
        ...(debug ? { "Shopify-GraphQL-Cost-Debug": "1" } : {}),
      },
      body: JSON.stringify({ query, variables: variables ?? {} }),
      signal: options?.signal,
    });

    // Honor Retry-After header on HTTP throttle
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after") ?? "1") || 1;
      if (attempt >= maxRetries) {
        return {
          data: null,
          errors: [{ message: `Throttled (HTTP 429) after ${attempt} attempts` }],
          userErrors: [],
          cost: null,
        };
      }
      await sleep(retryAfter * 1000);
      continue;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        data: null,
        errors: [{ message: `Shopify HTTP ${response.status}${text ? `: ${text.slice(0, 500)}` : ""}` }],
        userErrors: [],
        cost: null,
      };
    }

    const body = (await response.json().catch(() => ({}))) as {
      data?: T;
      errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
      extensions?: unknown;
    };

    const cost = parseCost(body.extensions);
    updateBucketFromCost(integration, cost);

    const errors = Array.isArray(body.errors) ? body.errors : [];

    // Exponential backoff on THROTTLED
    if (errors.length > 0 && isThrottledError(errors)) {
      if (attempt >= maxRetries) {
        return {
          data: body.data ?? null,
          errors,
          userErrors: extractUserErrors(body.data),
          cost,
        };
      }
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, 8_000);
      continue;
    }

    return {
      data: body.data ?? null,
      errors,
      userErrors: extractUserErrors(body.data),
      cost,
    };
  }
}

/** Read current bucket state (for planner cost estimation). */
export function getBucketSnapshot(integration: IntegrationRecord): {
  available: number;
  max: number;
  restoreRate: number;
} {
  const state = getBucket(integration);
  return {
    available: projectAvailable(state),
    max: state.max,
    restoreRate: state.restoreRatePerSecond,
  };
}
