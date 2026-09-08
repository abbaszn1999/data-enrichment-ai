import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { decryptedIntegrationConfig } from "@/lib/integrations/load";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    if (!workspaceId) {
      return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const admin = createAdminClient();
    const [memberCheck, workspaceResult, integrationResult] = await Promise.all([
      admin
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", workspaceId)
        .eq("user_id", user.id)
        .maybeSingle(),
      admin
        .from("workspaces")
        .select("id, collection_prefix")
        .eq("id", workspaceId)
        .single(),
      admin
        .from("workspace_integrations")
        .select("provider, base_url, config")
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
    ]);

    if (!memberCheck.data) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const prefix = workspaceResult.data?.collection_prefix || "AI";
    const integration = integrationResult.data;
    let storeUrl = integration?.base_url || "";
    if (!storeUrl && integration?.config && typeof integration.config === "object") {
      const cfg = decryptedIntegrationConfig(integration.config);
      storeUrl = String(cfg.store_url || cfg.url || "");
    }

    return NextResponse.json({
      prefix,
      provider: integration?.provider || null,
      storeUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    let body: { workspaceId?: string; prefix?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { workspaceId, prefix } = body;
    if (!workspaceId) {
      return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: member } = await admin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!member || !["owner", "admin", "editor"].includes(member.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const cleaned = (prefix ?? "").trim() || "AI";

    const { error: updateErr } = await admin
      .from("workspaces")
      .update({ collection_prefix: cleaned, updated_at: new Date().toISOString() })
      .eq("id", workspaceId);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, prefix: cleaned });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
