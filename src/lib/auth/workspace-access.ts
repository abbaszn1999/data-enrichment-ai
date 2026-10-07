import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

/**
 * Verifies the caller is signed in (token validated by Supabase Auth) and is a
 * member of the workspace. Returns an error response to send back, or null
 * when access is allowed.
 */
export async function requireWorkspaceMember(
  workspaceId: string
): Promise<NextResponse | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: member } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
