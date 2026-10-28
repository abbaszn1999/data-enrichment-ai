import type { SupabaseClient } from "@supabase/supabase-js";

/** The store platforms the agent works on. */
export type StorePlatform = "shopify" | "woocommerce";

export class StoreNotConnectedError extends Error {}

/** Which platform the workspace's connected store runs on. */
export async function storePlatform(db: SupabaseClient, workspaceId: string): Promise<StorePlatform> {
  const { data, error } = await db.from("workspace_integrations").select("provider").eq("workspace_id", workspaceId).maybeSingle();
  if (error) throw new Error(`Could not load the store connection: ${error.message}`);
  if (data?.provider === "shopify" || data?.provider === "woocommerce") return data.provider;
  throw new StoreNotConnectedError("No Shopify or WooCommerce store is connected to this workspace.");
}
