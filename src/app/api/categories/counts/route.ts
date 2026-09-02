import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getWorkspaceContext } from "@/lib/workspace-context";

export async function GET(request: NextRequest) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const ctx = await getWorkspaceContext({ workspaceId, userId: user.id });
  if (!ctx.membershipRole) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("category_product_counts", {
    p_workspace_id: workspaceId,
  });
  if (error) {
    return NextResponse.json({ counts: {}, error: error.message }, { status: 200 });
  }
  const counts =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, number>)
      : {};
  return NextResponse.json({ counts });
}
