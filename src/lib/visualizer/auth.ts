import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  getWorkspaceContext,
  isContextSubscriptionActive,
  type WorkspaceContext,
} from "@/lib/workspace-context";
import type { User } from "@supabase/supabase-js";
import { visualizerError, visualizerWarn } from "@/lib/visualizer/log";

export type VisualizerAuthOk = {
  ok: true;
  user: User;
  ctx: WorkspaceContext;
  headers: Record<string, string>;
  admin: ReturnType<typeof createAdminClient>;
};

export type VisualizerAuthErr = {
  ok: false;
  response: NextResponse;
};

export async function requireVisualizerAuth(options: {
  workspaceId: string;
  requireWrite?: boolean;
  requireCredits?: boolean;
}): Promise<VisualizerAuthOk | VisualizerAuthErr> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    const message = authError?.message || "";
    const transient =
      /fetch failed|timeout|network|econnreset|enotfound/i.test(message);
    if (transient) {
      visualizerError(
        "auth",
        "Supabase auth service is temporarily unreachable",
        authError
      );
      return {
        ok: false,
        response: NextResponse.json(
          { error: "AUTH_SERVICE_UNAVAILABLE", retryable: true },
          { status: 503, headers: { "Retry-After": "5" } }
        ),
      };
    }
    visualizerWarn("auth", "Not authenticated", {
      message: authError?.message,
      reason: user ? undefined : "no user",
    });
    return {
      ok: false,
      response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }),
    };
  }

  let ctx: WorkspaceContext;
  try {
    ctx = await getWorkspaceContext({
      workspaceId: options.workspaceId,
      userId: user.id,
    });
  } catch (error) {
    visualizerError("auth", "Workspace context lookup failed", error);
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
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403, headers }),
    };
  }

  if (options.requireWrite && ctx.membershipRole === "viewer") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403, headers }),
    };
  }

  if (options.requireCredits) {
    if (!ctx.subscription || !isContextSubscriptionActive(ctx)) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "An active subscription is required" },
          { status: 402, headers }
        ),
      };
    }
    if ((ctx.credits?.total ?? 0) <= 0) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "NO_CREDITS", remaining: 0 },
          { status: 402, headers }
        ),
      };
    }
  }

  return {
    ok: true,
    user,
    ctx,
    headers,
    admin: createAdminClient(),
  };
}

export async function requireVisualizerAdmin(
  workspaceId: string,
  userId: string
) {
  const ctx = await getWorkspaceContext({ workspaceId, userId });
  return ctx.membershipRole === "admin" || ctx.membershipRole === "owner";
}
