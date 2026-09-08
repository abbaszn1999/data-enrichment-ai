import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  DEFAULT_FAQ_STYLE,
  DEFAULT_LINKS_STYLE,
  type PersistedWidgetSettings,
} from "@/lib/customize-widgets";

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
    const [memberCheck, workspaceResult] = await Promise.all([
      admin
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", workspaceId)
        .eq("user_id", user.id)
        .maybeSingle(),
      admin
        .from("workspaces")
        .select("id, widget_settings")
        .eq("id", workspaceId)
        .single(),
    ]);

    if (!memberCheck.data) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rawSettings = workspaceResult.data?.widget_settings as
      | Partial<PersistedWidgetSettings>
      | undefined;

    const settings: PersistedWidgetSettings = {
      links: { ...DEFAULT_LINKS_STYLE, ...(rawSettings?.links || {}) },
      faq: { ...DEFAULT_FAQ_STYLE, ...(rawSettings?.faq || {}) },
    };

    return NextResponse.json({ settings });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    let body: {
      workspaceId?: string;
      settings?: Partial<PersistedWidgetSettings>;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { workspaceId, settings } = body;
    if (!workspaceId || !settings) {
      return NextResponse.json(
        { error: "Missing workspaceId or settings" },
        { status: 400 }
      );
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

    const mergedSettings: PersistedWidgetSettings = {
      links: { ...DEFAULT_LINKS_STYLE, ...(settings.links || {}) },
      faq: { ...DEFAULT_FAQ_STYLE, ...(settings.faq || {}) },
    };

    const { error: updateErr } = await admin
      .from("workspaces")
      .update({
        widget_settings: mergedSettings,
        updated_at: new Date().toISOString(),
      })
      .eq("id", workspaceId);

    if (updateErr) {
      throw updateErr;
    }

    // The embed endpoint always re-reads widget_settings live (it never trusts
    // the cached copy for style), so this isn't required for correctness —
    // but dropping any cached pages for this workspace keeps embed_page_cache
    // from growing stale rows indefinitely.
    try {
      await admin.from("embed_page_cache").delete().eq("workspace_id", workspaceId);
    } catch (cacheErr) {
      console.warn("[widget-settings] Could not clear embed_page_cache:", cacheErr);
    }

    return NextResponse.json({ success: true, settings: mergedSettings });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
