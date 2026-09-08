import type { SupabaseClient } from "@supabase/supabase-js";
import { collectStoreDomains, normalizeStoreDomain } from "./store-domain";

type Admin = SupabaseClient;

export async function lookupWorkspaceIdByStoreDomain(
  admin: Admin,
  rawDomain: string
): Promise<string | null> {
  const normalized = normalizeStoreDomain(rawDomain);
  if (!normalized) return null;

  const { data, error } = await admin
    .from("workspace_domains")
    .select("workspace_id")
    .eq("normalized_domain", normalized)
    .maybeSingle();

  if (error) {
    console.error("[embed] workspace_domains lookup failed:", error.message);
    return null;
  }
  return (data?.workspace_id as string | undefined) ?? null;
}

export async function replaceWorkspaceDomains(
  admin: Admin,
  workspaceId: string,
  sources: Array<string | null | undefined>
): Promise<string[]> {
  const domains = collectStoreDomains(sources);

  const { error: deleteError } = await admin
    .from("workspace_domains")
    .delete()
    .eq("workspace_id", workspaceId);
  if (deleteError) throw new Error(deleteError.message);

  if (domains.length === 0) return [];

  const { error: insertError } = await admin.from("workspace_domains").insert(
    domains.map((normalized_domain) => ({
      workspace_id: workspaceId,
      normalized_domain,
      source: "integration",
    }))
  );
  if (insertError) {
    if (insertError.code === "23505") {
      throw new Error(
        "This store domain is already connected to another workspace"
      );
    }
    throw new Error(insertError.message);
  }
  return domains;
}

export async function deleteWorkspaceDomains(
  admin: Admin,
  workspaceId: string
): Promise<void> {
  const { error } = await admin
    .from("workspace_domains")
    .delete()
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
}
