import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getUserSubscription, isSubscriptionActive } from "@/lib/stripe";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const admin = createAdminClient();
    const { count } = await admin
      .from("workspaces")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", user.id);

    const currentCount = count ?? 0;
    const userSub = await getUserSubscription(user.id);
    const hasActiveSubscription = !!userSub && isSubscriptionActive(userSub.subscription.status);
    const maxWorkspaces = hasActiveSubscription ? userSub?.plan?.max_workspaces ?? 1 : 1;
    const canCreate = currentCount < maxWorkspaces;

    return NextResponse.json({
      currentCount,
      maxWorkspaces,
      canCreate,
      hasActiveSubscription,
      planName: userSub?.plan?.display_name || null,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}
