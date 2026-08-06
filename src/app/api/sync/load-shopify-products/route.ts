// Load Shopify products into a Sync sheet.
// Replaces the deprecated Supabase Edge Function `load-shopify-products`.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { buildShopifyCoreProductsSheet } from "@/lib/sync/providers/shopify/normalize";

export const maxDuration = 300;

type Body = {
  workspaceId?: string;
  limit?: number;
};

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = (await request.json()) as Body;
    const { workspaceId, limit } = body;

    if (!workspaceId) {
      return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: member, error: memberError } = await admin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .single();

    if (memberError || !member) {
      return NextResponse.json(
        { error: "Forbidden: not a workspace member" },
        { status: 403 }
      );
    }

    const { data: integration, error: intError } = await admin
      .from("workspace_integrations")
      .select("provider, integration_name, base_url, config")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (intError) throw new Error(intError.message);
    if (!integration) throw new Error("No connected integration found");
    if (integration.provider !== "shopify") {
      throw new Error(
        `${integration.provider} is not supported yet in Sync actions`
      );
    }

    const config = (integration.config ?? {}) as Record<string, unknown>;
    const adminApiToken = String(config.admin_api_token ?? "").trim();
    if (!adminApiToken) {
      throw new Error("Missing Shopify admin token in integration config");
    }

    const shouldLoadAll = (limit ?? 0) <= 0;
    const pageSize = shouldLoadAll
      ? 250
      : Math.min(Math.max(limit ?? 50, 1), 250);

    let nextUrl: URL | null = new URL(
      `${integration.base_url}/admin/api/2024-10/products.json`
    );
    nextUrl.searchParams.set("limit", String(pageSize));
    nextUrl.searchParams.set(
      "fields",
      "id,title,handle,status,vendor,product_type,tags,body_html,seo_title,seo_description,published_at,created_at,updated_at,variants,image,images"
    );

    const allProducts: unknown[] = [];
    while (nextUrl) {
      const res = await fetch(nextUrl.toString(), {
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": adminApiToken,
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Shopify request failed (${res.status})${text ? ": " + text : ""}`
        );
      }

      const data = (await res.json()) as { products?: unknown[] };
      const products = Array.isArray(data?.products) ? data.products : [];
      allProducts.push(...products);

      if (!shouldLoadAll || products.length < 250) break;

      const link = res.headers.get("link") || res.headers.get("Link") || "";
      const match = link.match(/<([^>]+)>;\s*rel="next"/i);
      if (!match?.[1]) break;
      nextUrl = new URL(match[1]);
    }

    const sheet = buildShopifyCoreProductsSheet({
      integrationName: String(integration.integration_name ?? "Shopify"),
      products: allProducts,
    });

    console.log(
      `[load-shopify-products] Loaded ${allProducts.length} products for workspace ${workspaceId}`
    );

    return NextResponse.json({ sheet });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Internal error";
    console.error("[load-shopify-products] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
