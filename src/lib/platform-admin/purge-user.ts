import type { SupabaseClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe";
import { purgeWorkspace } from "@/lib/workspace-purge";

const REASSIGN_COLUMNS: Array<{ table: string; column: string }> = [
  { table: "catalog_sessions", column: "created_by" },
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
  // workspace_invites.email has no FK to auth.users (it must work for emails
  // that don't have an account yet), so it never cascades on delete. Clean up
  // any invite addressed *to* this person's email now, while we can still
  // resolve it — otherwise a stale accepted/pending row lingers forever and
  // blocks re-inviting the same email later (unique workspace_id+email).
  const { data: userRecord, error: lookupError } = await admin.auth.admin.getUserById(userId);
  if (lookupError) throw new Error(lookupError.message);
  const email = userRecord?.user?.email;
  if (email) {
    await deleteMatching(admin, "workspace_invites", "email", email);
  }

  const { data: owned, error: ownedError } = await admin
    .from("workspaces")
    .select("id")
    .eq("owner_id", userId);
  if (ownedError) throw new Error(ownedError.message);

  const ownedIds = (owned ?? []).map((row) => row.id as string);
  let filesDeleted = 0;
  for (const workspaceId of ownedIds) {
    const result = await purgeWorkspace(admin, workspaceId);
    filesDeleted += result.filesDeleted;
  }

  await cancelStripeSubscription(admin, userId);

  const { data: remainingWorkspaces, error: remainingError } = await admin
    .from("workspaces")
    .select("id, owner_id");
  if (remainingError) throw new Error(remainingError.message);
  const ownerByWorkspace = new Map(
    (remainingWorkspaces ?? []).map((row) => [row.id as string, row.owner_id as string])
  );

  for (const { table, column } of REASSIGN_COLUMNS) {
    await reassignOrDelete(admin, table, column, userId, ownerByWorkspace);
  }

  await deleteMatching(admin, "workspace_members", "user_id", userId);
  await deleteMatching(admin, "notifications", "user_id", userId);
  await deleteMatching(admin, "credit_purchases", "user_id", userId);
  await deleteMatching(admin, "user_subscriptions", "user_id", userId);
  await deleteMatching(admin, "wallet_stripe_customers", "user_id", userId);
  await deleteMatching(admin, "profiles", "id", userId);

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(error.message);

  return { workspacesDeleted: ownedIds.length, filesDeleted };
}

async function deleteMatching(
  admin: SupabaseClient,
  table: string,
  column: string,
  value: string
) {
  const { error } =
    column === "email"
      ? await admin.from(table).delete().ilike(column, value)
      : await admin.from(table).delete().eq(column, value);
  if (error) throw new Error(`${table}: ${error.message}`);
}

async function reassignOrDelete(
  admin: SupabaseClient,
  table: string,
  column: string,
  userId: string,
  ownerByWorkspace: Map<string, string>
) {
  const { data, error } = await admin.from(table).select("id, workspace_id").eq(column, userId);
  if (error) throw new Error(`${table}: ${error.message}`);
  if (!data?.length) return;

  for (const row of data) {
    const ownerId = ownerByWorkspace.get(row.workspace_id as string);
    if (ownerId && ownerId !== userId) {
      const { error: updateError } = await admin
        .from(table)
        .update({ [column]: ownerId })
        .eq("id", row.id);
      if (updateError) throw new Error(`${table} reassign: ${updateError.message}`);
    } else {
      const { error: deleteError } = await admin.from(table).delete().eq("id", row.id);
      if (deleteError) throw new Error(`${table} delete: ${deleteError.message}`);
    }
  }
}

async function cancelStripeSubscription(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin
    .from("user_subscriptions")
    .select("stripe_subscription_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`user_subscriptions: ${error.message}`);
  const stripeId = data?.stripe_subscription_id as string | null | undefined;
  if (!stripeId) return;
  try {
    await stripe.subscriptions.cancel(stripeId);
  } catch (cancelError) {
    console.error("[purgeUser] Stripe cancel failed:", cancelError);
  }
}
