import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getProvider, isProviderSupported } from "@/lib/sync";

async function requireWorkspaceMember(workspaceId: string, userId: string) {
  const admin = createAdminClient();
  const { data: member, error } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .single();
  if (error || !member) throw new Error("Forbidden");
  return admin;
}

export async function POST(request: NextRequest) {
  try {
    const { workspaceId, limit = 50 } = (await request.json()) as {
      workspaceId?: string;
      limit?: number;
    };

    if (!workspaceId) {
      return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const admin = await requireWorkspaceMember(workspaceId, user.id);
    const { data: integration, error: integrationError } = await admin
      .from("workspace_integrations")
      .select("provider, integration_name, base_url, config")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (integrationError) {
      return NextResponse.json({ error: integrationError.message }, { status: 500 });
    }
    if (!integration) {
      return NextResponse.json({ error: "No connected integration found" }, { status: 404 });
    }
    if (!isProviderSupported(integration.provider)) {
      return NextResponse.json(
        { error: `${integration.provider} is not supported yet in Sync actions` },
        { status: 400 }
      );
    }

    const provider = getProvider(integration.provider);
    const sheet = await provider.fetchProductsSheet(
      {
        provider: integration.provider,
        integration_name: integration.integration_name,
        base_url: integration.base_url,
        config: integration.config,
      },
      { limit }
    );

    return NextResponse.json({
      title: sheet.title,
      columns: sheet.columns,
      rows: sheet.rows,
      total: sheet.rows.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : 500 });
  }
}
