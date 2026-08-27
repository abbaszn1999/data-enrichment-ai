import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-admin/server-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const denied = await requirePlatformAdmin();
  if (denied) return denied;
  const { id } = await ctx.params;

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.getUserById(id);
    if (error || !data.user?.email) {
      return NextResponse.json({ error: "User has no email" }, { status: 404 });
    }

    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: data.user.email,
    });
    const tokenHash = link?.properties?.hashed_token;
    if (linkError || !tokenHash) {
      return NextResponse.json(
        { error: linkError?.message || "Could not create a sign-in link for this user." },
        { status: 500 }
      );
    }

    const supabase = await createClient();
    const { error: otpError } = await supabase.auth.verifyOtp({
      type: "magiclink",
      token_hash: tokenHash,
    });
    if (otpError) {
      return NextResponse.json({ error: otpError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, email: data.user.email, redirectTo: "/workspaces" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Impersonation failed" },
      { status: 500 }
    );
  }
}
