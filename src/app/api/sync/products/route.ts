import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { buildShopifyCoreProductsSheet } from "@/lib/sync/shopify-products";

async function requireWorkspaceMember(workspaceId: string, userId: string) {
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
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

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

    if (integration.provider !== "shopify") {
      return NextResponse.json({ error: `${integration.provider} is not supported yet in Sync actions` }, { status: 400 });
    }

    const adminApiToken = String(integration.config?.admin_api_token ?? "").trim();
    if (!adminApiToken) {
      return NextResponse.json({ error: "Missing Shopify admin token in integration config" }, { status: 400 });
    }

    const products: any[] = [];
    const shouldLoadAll = limit <= 0;
    let nextUrl = new URL(`${integration.base_url}/admin/api/2024-10/products.json`);
    nextUrl.searchParams.set("limit", shouldLoadAll ? "250" : String(Math.min(Math.max(limit, 1), 250)));
    nextUrl.searchParams.set(
      "fields",
      "id,title,handle,status,vendor,product_type,tags,body_html,published_at,created_at,updated_at,variants,image,images"
    );

    while (nextUrl) {
      const response = await fetch(nextUrl.toString(), {
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": adminApiToken,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return NextResponse.json(
          { error: `Shopify products request failed (${response.status})`, details: text },
          { status: 400 }
        );
      }

      const data = await response.json();
      const pageProducts = Array.isArray(data?.products) ? data.products : [];
      products.push(...pageProducts);

      if (!shouldLoadAll || pageProducts.length < 250) {
        break;
      }

      const linkHeader = response.headers.get("link") || response.headers.get("Link") || "";
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/i);
      if (!nextMatch?.[1]) {
        break;
      }

      nextUrl = new URL(nextMatch[1]);
    }

    const sheet = buildShopifyCoreProductsSheet({
      integrationName: integration.integration_name,
      products,
    });

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
