import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getProvider, isProviderSupported, type ApplyUpdate, type SyncSheetRow } from "@/lib/sync";

export const maxDuration = 300;

type ApplyRequest = {
  workspaceId?: string;
  creates?: SyncSheetRow[];
  updates?: ApplyUpdate[];
};

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
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { workspaceId, creates = [], updates = [] } = (await request.json()) as ApplyRequest;
    if (!workspaceId) {
      return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
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
        { error: `${integration.provider} is not supported yet for Sync apply` },
        { status: 400 }
      );
    }

    const provider = getProvider(integration.provider);
    const result = await provider.applyChanges({
      integration: {
        provider: integration.provider,
        integration_name: integration.integration_name,
        base_url: integration.base_url,
        config: integration.config,
      },
      creates,
      updates,
    });

    const errorSuffix = result.errors.length > 0 ? ` (${result.errors.length} failed)` : "";
    return NextResponse.json({
      message: `Sync completed: ${result.updatedCount} updated, ${result.createdCount} created${result.skippedCount > 0 ? `, ${result.skippedCount} skipped` : ""}${errorSuffix}.`,
      updatedCount: result.updatedCount,
      createdCount: result.createdCount,
      skippedCount: result.skippedCount,
      errorCount: result.errors.length,
      errors: result.errors.slice(0, 5),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : 500 });
  }
}
