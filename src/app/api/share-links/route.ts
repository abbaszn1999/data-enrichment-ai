import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";
import {
  createShareLink,
  getActiveShareLink,
  regenerateShareLink,
  revokeShareLink,
  SHARE_RESOURCE_TYPES,
  updateShareLinkView,
  type ShareResourceType,
} from "@/lib/share/links";
import { sanitizeShareView } from "@/lib/share/view";

function shareUrl(request: NextRequest, token: string): string {
  const origin =
    request.headers.get("origin") ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:4000";
  return `${origin}/share/${token}`;
}

function isResourceType(value: unknown): value is ShareResourceType {
  return SHARE_RESOURCE_TYPES.includes(value as ShareResourceType);
}

/** Editor-or-above can manage share links; viewers cannot. */
async function requireEditor(workspaceId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const admin = createAdminClient();
  const { data: member } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .single();
  if (!member || !["owner", "admin", "editor"].includes(member.role)) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { ok: true as const, admin, userId: user.id };
}

function readResourceParams(params: {
  workspaceId?: unknown;
  resourceType?: unknown;
  resourceId?: unknown;
}) {
  const workspaceId = String(params.workspaceId || "");
  const resourceType = String(params.resourceType || "");
  const resourceId = String(params.resourceId || "");
  if (!workspaceId || !resourceId || !isResourceType(resourceType)) return null;
  return { workspaceId, resourceType, resourceId };
}

/** GET — fetch the current active share link for a resource, if any. */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const parsed = readResourceParams({
    workspaceId: searchParams.get("workspaceId"),
    resourceType: searchParams.get("resourceType"),
    resourceId: searchParams.get("resourceId"),
  });
  if (!parsed) {
    return NextResponse.json({ error: "Missing or invalid parameters" }, { status: 400 });
  }
  const auth = await requireEditor(parsed.workspaceId);
  if (!auth.ok) return auth.response;

  const link = await getActiveShareLink(
    auth.admin,
    parsed.workspaceId,
    parsed.resourceType,
    parsed.resourceId
  );
  return NextResponse.json({
    link,
    shareUrl: link ? shareUrl(request, link.token) : null,
  });
}

/**
 * POST — turn sharing on (or regenerate the link if `regenerate: true`).
 * `view` is the sheet view the link should open with; an existing link that
 * is reused takes the new view too.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | { workspaceId?: string; resourceType?: string; resourceId?: string; regenerate?: boolean; view?: unknown }
    | null;
  const parsed = readResourceParams(body ?? {});
  if (!parsed) {
    return NextResponse.json({ error: "Missing or invalid parameters" }, { status: 400 });
  }
  const auth = await requireEditor(parsed.workspaceId);
  if (!auth.ok) return auth.response;

  const view = sanitizeShareView(body?.view);
  try {
    let link = body?.regenerate
      ? await regenerateShareLink(auth.admin, { ...parsed, createdBy: auth.userId, view })
      : await getActiveShareLink(auth.admin, parsed.workspaceId, parsed.resourceType, parsed.resourceId);
    if (!link) link = await createShareLink(auth.admin, { ...parsed, createdBy: auth.userId, view });
    else if (!body?.regenerate && body && "view" in body) {
      link = (await updateShareLinkView(auth.admin, { ...parsed, view })) ?? link;
    }
    return NextResponse.json({ link, shareUrl: shareUrl(request, link.token) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create share link";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** PATCH — change the view the active link opens with (null opens it unfiltered). */
export async function PATCH(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | { workspaceId?: string; resourceType?: string; resourceId?: string; view?: unknown }
    | null;
  const parsed = readResourceParams(body ?? {});
  if (!parsed) {
    return NextResponse.json({ error: "Missing or invalid parameters" }, { status: 400 });
  }
  const auth = await requireEditor(parsed.workspaceId);
  if (!auth.ok) return auth.response;

  const link = await updateShareLinkView(auth.admin, { ...parsed, view: sanitizeShareView(body?.view) });
  if (!link) return NextResponse.json({ error: "Sharing is not turned on" }, { status: 404 });
  return NextResponse.json({ link, shareUrl: shareUrl(request, link.token) });
}

/** DELETE — turn sharing off. The old link stops working immediately. */
export async function DELETE(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | { workspaceId?: string; resourceType?: string; resourceId?: string }
    | null;
  const parsed = readResourceParams(body ?? {});
  if (!parsed) {
    return NextResponse.json({ error: "Missing or invalid parameters" }, { status: 400 });
  }
  const auth = await requireEditor(parsed.workspaceId);
  if (!auth.ok) return auth.response;

  await revokeShareLink(auth.admin, parsed.workspaceId, parsed.resourceType, parsed.resourceId);
  return NextResponse.json({ success: true });
}
