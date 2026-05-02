import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getProvider, isProviderSupported } from "@/lib/sync";

async function requireAdminWorkspaceMember(workspaceId: string, userId: string) {
  const admin = createAdminClient();
  const { data: member, error } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .single();

  if (error || !member) {
    throw new Error("Forbidden");
  }
  if (!["owner", "admin"].includes(member.role)) {
    throw new Error("Forbidden");
  }
  return admin;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    if (!workspaceId) {
      return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const admin = createAdminClient();
    const [memberCheck, integrationResult] = await Promise.all([
      admin.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", session.user.id).single(),
      admin.from("workspace_integrations").select("*").eq("workspace_id", workspaceId).maybeSingle(),
    ]);

    if (!memberCheck.data) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (integrationResult.error) {
      return NextResponse.json({ error: integrationResult.error.message }, { status: 500 });
    }

    return NextResponse.json({ integration: integrationResult.data ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { workspaceId, provider, integrationName, config, action } = body as {
      workspaceId?: string;
      provider?: string;
      integrationName?: string;
      config?: Record<string, any>;
      action?: "test" | "save";
    };

    if (!workspaceId || !provider || !action) {
      return NextResponse.json({ error: "Missing workspaceId, provider, or action" }, { status: 400 });
    }
    if (!integrationName?.trim()) {
      return NextResponse.json({ error: "Integration name is required" }, { status: 400 });
    }
    if (!config || typeof config !== "object") {
      return NextResponse.json({ error: "Missing integration config" }, { status: 400 });
    }
    if (!isProviderSupported(provider)) {
      return NextResponse.json({ error: `${provider} integration is not available yet` }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const admin = await requireAdminWorkspaceMember(workspaceId, user.id);
    const providerImpl = getProvider(provider);

    const testResult = await providerImpl.testConnection(config);

    if (action === "test") {
      return NextResponse.json({
        result: {
          provider: testResult.provider,
          accountLabel: testResult.accountLabel,
          baseUrl: testResult.baseUrl,
          metadata: testResult.metadata ?? {},
        },
      });
    }

    if (action !== "save") {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const { baseUrl, config: savedConfig } = providerImpl.buildSavePayload({ config, testResult });

    const { data: integration, error } = await admin
      .from("workspace_integrations")
      .upsert(
        {
          workspace_id: workspaceId,
          provider,
          integration_name: integrationName.trim(),
          base_url: baseUrl,
          config: savedConfig,
          status: "connected",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id" }
      )
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ integration });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    const status = message === "Forbidden" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { workspaceId } = await request.json();
    if (!workspaceId) {
      return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const admin = await requireAdminWorkspaceMember(workspaceId, user.id);
    const { error } = await admin
      .from("workspace_integrations")
      .delete()
      .eq("workspace_id", workspaceId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : 500 });
  }
}
