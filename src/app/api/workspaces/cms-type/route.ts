import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getWorkspaceContext } from "@/lib/workspace-context";
import { loadCategoriesJsonServer } from "@/lib/storage-helpers-server";
import { isSupportedCmsType } from "@/lib/cms-types";
import { canAdmin, type Role } from "@/lib/permissions";

/**
 * The workspace platform (Shopify / WooCommerce) decides how categories are
 * structured (flat collections vs a tree with parents), so it can only change
 * while the Categories tab is empty. Enforced here, not only in the UI.
 */

async function authorize(workspaceId: string, needAdmin: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const ctx = await getWorkspaceContext({ workspaceId, userId: user.id });
  if (!ctx.membershipRole) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  if (needAdmin && !canAdmin(ctx.membershipRole as Role)) {
    return { error: NextResponse.json({ error: "Only an admin can change the platform" }, { status: 403 }) };
  }
  return { user };
}

export async function GET(request: NextRequest) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId")?.trim();
  if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  const auth = await authorize(workspaceId, false);
  if (auth.error) return auth.error;

  const admin = createAdminClient();
  const { data } = await admin.from("workspaces").select("cms_type").eq("id", workspaceId).single();
  const categories = await loadCategoriesJsonServer(workspaceId);
  return NextResponse.json({ cmsType: data?.cms_type ?? "shopify", categoryCount: categories.length });
}

export async function POST(request: NextRequest) {
  let body: { workspaceId?: string; cmsType?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const workspaceId = body.workspaceId?.trim();
  const cmsType = body.cmsType?.trim().toLowerCase();
  if (!workspaceId || !cmsType) {
    return NextResponse.json({ error: "workspaceId and cmsType are required" }, { status: 400 });
  }
  if (!isSupportedCmsType(cmsType)) {
    return NextResponse.json({ error: "This platform is not available yet" }, { status: 400 });
  }
  const auth = await authorize(workspaceId, true);
  if (auth.error) return auth.error;

  const admin = createAdminClient();
  const { data: current } = await admin.from("workspaces").select("cms_type").eq("id", workspaceId).single();
  if (current?.cms_type === cmsType) return NextResponse.json({ ok: true, cmsType });

  const categories = await loadCategoriesJsonServer(workspaceId);
  if (categories.length > 0) {
    return NextResponse.json(
      {
        code: "CATEGORIES_EXIST",
        error:
          "Clear your categories first. Shopify collections and WooCommerce categories are structured differently, so the list cannot be switched in place.",
        categoryCount: categories.length,
      },
      { status: 409 }
    );
  }

  const { error } = await admin.from("workspaces").update({ cms_type: cmsType }).eq("id", workspaceId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, cmsType });
}
