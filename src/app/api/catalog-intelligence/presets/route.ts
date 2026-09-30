import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getWorkspaceContext } from "@/lib/workspace-context";
import { canEdit, type Role } from "@/lib/permissions";
import { normalizePresetPayload, presetRowToPreset, type PresetRow } from "@/lib/catalog/presets";

/** Max presets per workspace and kind. */
const MAX_PRESETS = 50;
const MAX_NAME = 80;
const COLUMNS = "id, kind, name, payload, created_at, updated_at";

async function authorize(workspaceId: string, needEdit: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const ctx = await getWorkspaceContext({ workspaceId, userId: user.id });
  if (!ctx.membershipRole) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  if (needEdit && !canEdit(ctx.membershipRole as Role)) {
    return { error: NextResponse.json({ error: "You need editor access to change saved settings" }, { status: 403 }) };
  }
  return { user };
}

function kindOf(value: unknown): "product" | "plp" {
  return value === "plp" ? "plp" : "product";
}

function cleanName(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, MAX_NAME) : "";
}

async function readBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId")?.trim();
  if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  const auth = await authorize(workspaceId, false);
  if (auth.error) return auth.error;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("catalog_presets")
    .select(COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(MAX_PRESETS * 2);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ presets: ((data ?? []) as PresetRow[]).map(presetRowToPreset) });
}

/** Create a preset, or overwrite the one with the same name (per workspace and kind). */
export async function POST(request: NextRequest) {
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
  const name = cleanName(body.name);
  if (!workspaceId || !name) {
    return NextResponse.json({ error: "workspaceId and name are required" }, { status: 400 });
  }
  const payload = normalizePresetPayload(body.settings);
  if (!payload) return NextResponse.json({ error: "Choose at least one column to save" }, { status: 400 });
  const kind = kindOf(body.kind);
  const auth = await authorize(workspaceId, true);
  if (auth.error) return auth.error;

  const admin = createAdminClient();
  const { data: existing, error: findError } = await admin
    .from("catalog_presets")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .eq("kind", kind);
  if (findError) return NextResponse.json({ error: findError.message }, { status: 500 });

  const match = (existing ?? []).find((row) => row.name.trim().toLowerCase() === name.toLowerCase());
  if (!match && (existing?.length ?? 0) >= MAX_PRESETS) {
    return NextResponse.json(
      { error: `You can keep up to ${MAX_PRESETS} saved settings. Delete one to save another.` },
      { status: 409 }
    );
  }

  const now = new Date().toISOString();
  const result = match
    ? await admin
        .from("catalog_presets")
        .update({ name, payload, updated_at: now })
        .eq("id", match.id)
        .eq("workspace_id", workspaceId)
        .select(COLUMNS)
        .single()
    : await admin
        .from("catalog_presets")
        .insert({ workspace_id: workspaceId, kind, name, payload, created_by: auth.user!.id })
        .select(COLUMNS)
        .single();
  if (result.error) {
    const status = result.error.code === "23505" ? 409 : 500;
    return NextResponse.json({ error: result.error.message }, { status });
  }
  return NextResponse.json({ preset: presetRowToPreset(result.data as PresetRow), overwritten: Boolean(match) });
}

/** Rename a preset. */
export async function PATCH(request: NextRequest) {
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const name = cleanName(body.name);
  if (!workspaceId || !id || !name) {
    return NextResponse.json({ error: "workspaceId, id and name are required" }, { status: 400 });
  }
  const auth = await authorize(workspaceId, true);
  if (auth.error) return auth.error;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("catalog_presets")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select(COLUMNS)
    .maybeSingle();
  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    return NextResponse.json(
      { error: status === 409 ? "A saved setting with this name already exists" : error.message },
      { status }
    );
  }
  if (!data) return NextResponse.json({ error: "Saved setting not found" }, { status: 404 });
  return NextResponse.json({ preset: presetRowToPreset(data as PresetRow) });
}

export async function DELETE(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const workspaceId = params.get("workspaceId")?.trim();
  const id = params.get("id")?.trim();
  if (!workspaceId || !id) {
    return NextResponse.json({ error: "workspaceId and id are required" }, { status: 400 });
  }
  const auth = await authorize(workspaceId, true);
  if (auth.error) return auth.error;

  const admin = createAdminClient();
  const { error } = await admin.from("catalog_presets").delete().eq("id", id).eq("workspace_id", workspaceId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
