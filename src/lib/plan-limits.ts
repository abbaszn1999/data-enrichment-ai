import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getOwnerSubscription } from "@/lib/stripe";
import { getCachedProductsCountServer } from "@/lib/storage-helpers-server";
import { CATALOG_INTELLIGENCE } from "@/lib/product-modules";

export type PlanResource = "products" | "imports";

const PLAN_RESOURCE_NOUN: Record<PlanResource, string> = {
  products: "products",
  imports: `${CATALOG_INTELLIGENCE.label} projects`,
};

export class PlanLimitError extends Error {
  readonly code = "plan_limit_exceeded";
  readonly status = 402;

  constructor(
    readonly resource: PlanResource,
    readonly current: number,
    readonly limit: number,
    readonly incoming: number
  ) {
    super(
      `Your plan allows up to ${limit.toLocaleString()} ${PLAN_RESOURCE_NOUN[resource]}. Upgrade to continue.`
    );
    this.name = "PlanLimitError";
  }
}

export function startOfUtcMonth(now = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  ).toISOString();
}

export function projectedTotal(current: number, incoming: number): number {
  return current + Math.max(0, incoming);
}

export function assertWithinLimit(params: {
  resource: PlanResource;
  current: number;
  incoming: number;
  limit: number | null | undefined;
}): { current: number; limit: number | null; projected: number; warning: boolean } {
  const projected = projectedTotal(params.current, params.incoming);
  const limit = params.limit ?? null;
  if (limit !== null && projected > limit) {
    throw new PlanLimitError(params.resource, params.current, limit, params.incoming);
  }
  return {
    current: params.current,
    limit,
    projected,
    warning: limit !== null && projected >= limit * 0.8,
  };
}

export async function upgradeUrlFor(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string
): Promise<string> {
  const { data } = await admin
    .from("workspaces")
    .select("slug")
    .eq("id", workspaceId)
    .maybeSingle();
  const slug = (data as { slug?: string } | null)?.slug;
  return slug ? `/w/${slug}/subscription` : "/subscription";
}

export function planLimitResponse(
  error: PlanLimitError,
  upgradeUrl: string
): NextResponse {
  return NextResponse.json(
    {
      code: error.code,
      resource: error.resource,
      current: error.current,
      limit: error.limit,
      incoming: error.incoming,
      upgradeUrl,
      error: error.message,
    },
    { status: 402 }
  );
}

export async function assertProductQuota(params: {
  workspaceId: string;
  incoming: number;
  currentOverride?: number;
}): Promise<{ current: number; limit: number | null; projected: number; warning: boolean }> {
  const ownerSub = await getOwnerSubscription(params.workspaceId);
  const limit = ownerSub?.plan?.max_products_per_workspace ?? null;
  const current =
    params.currentOverride ??
    (await getCachedProductsCountServer(params.workspaceId));
  return assertWithinLimit({
    resource: "products",
    current,
    incoming: params.incoming,
    limit,
  });
}

/**
 * Cap a single gallery/visualizer job at the plan's product ceiling.
 * Does not add catalog size — a 200-row job on a full catalog must still run.
 */
export async function assertJobRowQuota(params: {
  workspaceId: string;
  rowCount: number;
}): Promise<{ current: number; limit: number | null; projected: number; warning: boolean }> {
  return assertProductQuota({
    workspaceId: params.workspaceId,
    incoming: params.rowCount,
    currentOverride: 0,
  });
}

export async function assertImportQuota(params: {
  workspaceId: string;
  incomingSessions?: number;
}): Promise<{ current: number; limit: number | null; projected: number; warning: boolean }> {
  const admin = createAdminClient();
  const ownerSub = await getOwnerSubscription(params.workspaceId);
  const limit = ownerSub?.plan?.max_imports_per_month ?? null;
  const incoming = params.incomingSessions ?? 1;
  const { count, error } = await admin
    .from("catalog_sessions")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", params.workspaceId)
    .gte("created_at", startOfUtcMonth());
  if (error) throw new Error(error.message);
  return assertWithinLimit({
    resource: "imports",
    current: count ?? 0,
    incoming,
    limit,
  });
}
