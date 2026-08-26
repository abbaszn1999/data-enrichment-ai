// Auth helper for Website Restructure API routes — same shape as
// `requireGalleryAuth`/`requireVisualizerAuth`, but the subscription check is
// unconditional and independent from credits: this tool is free to use once
// subscribed, it never draws down the wallet.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  getWorkspaceContext,
  isContextSubscriptionActive,
  type WorkspaceContext,
} from "@/lib/workspace-context";
import type { User } from "@supabase/supabase-js";

export type WrAuthOk = {
  ok: true;
  user: User;
  ctx: WorkspaceContext;
  headers: Record<string, string>;
  admin: ReturnType<typeof createAdminClient>;
};

export type WrAuthErr = {
  ok: false;
  response: NextResponse;
};

export async function requireWrAuth(options: {
  workspaceId: string;
  requireWrite?: boolean;
}): Promise<WrAuthOk | WrAuthErr> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }),
    };
  }

  let ctx: WorkspaceContext;
  try {
    ctx = await getWorkspaceContext({ workspaceId: options.workspaceId, userId: user.id });
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "WORKSPACE_SERVICE_UNAVAILABLE", retryable: true },
        { status: 503, headers: { "Retry-After": "5" } }
      ),
    };
  }

  const headers: Record<string, string> = {
    "X-Context-Source": ctx.source,
    "Server-Timing": `ctx;dur=${ctx.durationMs.toFixed(1)}`,
  };

  if (!ctx.membershipRole) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403, headers }) };
  }

  if (options.requireWrite && ctx.membershipRole === "viewer") {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403, headers }) };
  }

  if (!isContextSubscriptionActive(ctx)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "An active subscription is required" },
        { status: 402, headers }
      ),
    };
  }

  return { ok: true, user, ctx, headers, admin: createAdminClient() };
}
