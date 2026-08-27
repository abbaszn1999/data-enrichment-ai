import type { SupabaseClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe";
import { purgeWorkspace } from "@/lib/workspace-purge";

const REASSIGN_COLUMNS: Array<{ table: string; column: string }> = [
  { table: "import_sessions", column: "created_by" },
  { table: "image_classification_sessions", column: "created_by" },
  { table: "gallery_sessions", column: "created_by" },
  { table: "visualizer_sessions", column: "created_by" },
  { table: "mr_projects", column: "created_by" },
  { table: "mr_extracts", column: "created_by" },
  { table: "gs_rules", column: "created_by" },
  { table: "wr_projects", column: "created_by" },
  { table: "job_runs", column: "created_by" },
  { table: "activity_log", column: "user_id" },
  { table: "wallet_transactions", column: "user_id" },
  { table: "credit_transactions", column: "user_id" },
  { table: "sync_agent_traces", column: "user_id" },
  { table: "workspace_invites", column: "invited_by" },
];

export async function purgeUser(
  admin: SupabaseClient,
  userId: string
): Promise<{ workspacesDeleted: number; filesDeleted: number }> {
  const { data: owned } = await admin
    .from("workspaces")
    .select("id")
    .eq("owner_id", userId);

  const ownedIds = (owned ?? []).map((row) => row.id as string);
  let filesDeleted = 0;
  for (const workspaceId of ownedIds) {
    const result = await purgeWorkspace(admin, workspaceId);
    filesDeleted += result.filesDeleted;
  }

  await cancelStripeSubscription(admin, userId);

  const { data: remainingWorkspaces } = await admin.from("workspaces").select("id, owner_id");
  const ownerByWorkspace = new Map(
    (remainingWorkspaces ?? []).map((row) => [row.id as string, row.owner_id as string])
  );

  for (const { table, column } of REASSIGN_COLUMNS) {
    await reassignOrDelete(admin, table, column, userId, ownerByWorkspace);
  }

  await admin.from("workspace_members").delete().eq("user_id", userId);
  await admin.from("notifications").delete().eq("user_id", userId);
  await admin.from("credit_purchases").delete().eq("user_id", userId);
  await admin.from("user_subscriptions").delete().eq("user_id", userId);
  await admin.from("wallet_stripe_customers").delete().eq("user_id", userId);
  await admin.from("profiles").delete().eq("id", userId);

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(error.message);

  return { workspacesDeleted: ownedIds.length, filesDeleted };
}

async function reassignOrDelete(
  admin: SupabaseClient,
  table: string,
  column: string,
  userId: string,
  ownerByWorkspace: Map<string, string>
) {
  const { data, error } = await admin.from(table).select("id, workspace_id").eq(column, userId);
  if (error || !data?.length) return;

  for (const row of data) {
    const ownerId = ownerByWorkspace.get(row.workspace_id as string);
    if (ownerId && ownerId !== userId) {
      await admin.from(table).update({ [column]: ownerId }).eq("id", row.id);
    } else {
      await admin.from(table).delete().eq("id", row.id);
    }
  }
}

async function cancelStripeSubscription(admin: SupabaseClient, userId: string) {
  const { data } = await admin
    .from("user_subscriptions")
    .select("stripe_subscription_id")
    .eq("user_id", userId)
    .maybeSingle();
  const stripeId = data?.stripe_subscription_id as string | null | undefined;
  if (!stripeId) return;
  try {
    await stripe.subscriptions.cancel(stripeId);
  } catch (error) {
    console.error("[purgeUser] Stripe cancel failed:", error);
  }
}
