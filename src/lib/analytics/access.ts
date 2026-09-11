import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";
import { getWorkspaceContext } from "@/lib/workspace-context";
import { canAdmin } from "@/lib/permissions";
import type { Role } from "@/lib/permissions";

export class AnalyticsHttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export function analyticsErrorResponse(err: unknown) {
  if (err instanceof AnalyticsHttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : "Internal error";
  const reconnect = /reconnect|invalid_grant|No refresh token/i.test(message);
  return NextResponse.json(
    { error: reconnect ? "Please reconnect this Google account." : message, reconnect },
    { status: reconnect ? 401 : 500 }
  );
}

export async function requireAnalyticsAccess(
  workspaceId: string,
  opts?: { admin?: boolean }
) {
  if (!workspaceId) {
    throw new AnalyticsHttpError(400, "Missing workspaceId");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new AnalyticsHttpError(401, "Unauthorized");
  }

  const ctx = await getWorkspaceContext({ workspaceId, userId: user.id });
  if (!ctx.membershipRole) {
    throw new AnalyticsHttpError(403, "Forbidden");
  }
  if (!canAdmin(ctx.membershipRole as Role)) {
    throw new AnalyticsHttpError(403, "Forbidden");
  }

  return { user, role: ctx.membershipRole as Role, admin: createAdminClient() };
}
