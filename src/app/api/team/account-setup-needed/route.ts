import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { userNeedsAccountSetup } from "@/lib/team/account-setup";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ needsAccountSetup: false }, { status: 401 });
  }

  const needsAccountSetup = await userNeedsAccountSetup(createAdminClient(), user.id);
  return NextResponse.json({ needsAccountSetup });
}
