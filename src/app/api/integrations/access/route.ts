import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { decryptedIntegrationConfig } from "@/lib/integrations/load";
import { saveGrantedScopes } from "@/lib/integrations/store-scopes";
import { fetchShopifyGrantedScopes } from "@/lib/sync/providers/shopify/auth";

/**
 * The access scopes the connected store's token has right now, for the
 * Settings checklist. Owners and admins only, like the integration itself.
 * Only scope names go out, never the token.
 */
export async function GET(request: NextRequest) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const admin = createAdminClient();
  const [member, integration] = await Promise.all([
    admin.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle(),
    admin.from("workspace_integrations").select("provider, base_url, config").eq("workspace_id", workspaceId).maybeSingle(),
  ]);
  if (!member.data || !["owner", "admin"].includes(member.data.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (integration.error) return NextResponse.json({ error: integration.error.message }, { status: 500 });
  const row = integration.data;
  if (!row) return NextResponse.json({ provider: null, grantedScopes: null });
  if (row.provider !== "shopify" || !row.base_url) return NextResponse.json({ provider: row.provider, grantedScopes: null });

  const token = String(decryptedIntegrationConfig(row.config).admin_api_token ?? "").trim();
  const grantedScopes = token ? await fetchShopifyGrantedScopes(row.base_url, token) : null;
  // Kept with the integration, so the sidebar opens or locks tools by what is true now.
  if (grantedScopes) await saveGrantedScopes(admin, workspaceId, grantedScopes);
  return NextResponse.json({ provider: row.provider, grantedScopes });
}
