import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getWorkspaceContext, isContextSubscriptionActive, type WorkspaceContext } from "@/lib/workspace-context";
import { isAssistantEnabled } from "./service-client";

export type AssistantAccess = {
  userId: string;
  ctx: WorkspaceContext;
};

/** Cookie session, workspace membership (not a viewer), active plan and a positive balance. */
export async function authorizeAssistant(params: {
  workspaceId: string;
  workspaceSlug?: string;
  requireCredits: boolean;
}): Promise<AssistantAccess | NextResponse> {
  if (!isAssistantEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const ctx = await getWorkspaceContext({ workspaceId: params.workspaceId, userId: user.id });
  if (!ctx.membershipRole || ctx.membershipRole === "viewer") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (params.workspaceSlug) {
    // The slug the browser reports must be this workspace's own slug (RLS limits the lookup to members).
    const { data } = await supabase
      .from("workspaces")
      .select("id")
      .eq("id", params.workspaceId)
      .eq("slug", params.workspaceSlug)
      .maybeSingle();
    if (!data) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (params.requireCredits) {
    if (!ctx.subscription || !isContextSubscriptionActive(ctx)) {
      return NextResponse.json({ error: "NO_SUBSCRIPTION" }, { status: 402 });
    }
    if ((ctx.credits?.total ?? 0) <= 0) {
      return NextResponse.json({ error: "NO_CREDITS" }, { status: 402 });
    }
  }
  return { userId: user.id, ctx };
}
