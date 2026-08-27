import { NextResponse } from "next/server";
import { loadLiveUserDetail } from "@/lib/platform-admin/live";
import { purgeUser } from "@/lib/platform-admin/purge-user";
import { requirePlatformAdmin } from "@/lib/platform-admin/server-auth";
import { createAdminClient } from "@/lib/supabase-admin";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const denied = await requirePlatformAdmin();
  if (denied) return denied;
  const { id } = await ctx.params;
  try {
    const user = await loadLiveUserDetail(id);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    return NextResponse.json({ user });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load user" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const denied = await requirePlatformAdmin();
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const confirm = String(body.confirm || "").trim().toLowerCase();

  try {
    const admin = createAdminClient();
    const { data } = await admin.auth.admin.getUserById(id);
    const email = data.user?.email?.toLowerCase() || "";
    if (!email || confirm !== email) {
      return NextResponse.json({ error: "Type the user email to confirm deletion." }, { status: 400 });
    }
    const result = await purgeUser(admin, id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete user" },
      { status: 500 }
    );
  }
}
