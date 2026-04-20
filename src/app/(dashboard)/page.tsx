import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;

  if (!user) {
    redirect("/login");
  }

  // Check if user has any workspaces
  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("workspace_id, workspaces(slug)")
    .eq("user_id", user.id)
    .limit(1);

  if (memberships && memberships.length > 0) {
    const ws = (memberships[0] as any).workspaces;
    if (ws?.slug) {
      redirect(`/w/${ws.slug}`);
    }
  }

  redirect("/workspaces/new");
}
