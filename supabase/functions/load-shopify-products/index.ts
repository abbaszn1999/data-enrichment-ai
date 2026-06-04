import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// ─── Types ────────────────────────────────────────────────────────────────────
type SyncSheetRow = Record<string, unknown>;
type SyncSheet = { title: string; columns: string[]; rows: SyncSheetRow[] };

// ─── CORS ─────────────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─── Supabase admin singleton ─────────────────────────────────────────────────
let _admin: ReturnType<typeof createClient> | null = null;
function getSupabaseAdmin() {
  if (!_admin) {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    _admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  }
  return _admin;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function toText(value: unknown): string {
  return String(value ?? "").trim();
}
function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// ─── Shopify normalisation (same logic as shopify-products.ts) ────────────────
const SHOPIFY_CORE_PRODUCT_COLUMNS = [
  "id", "title", "handle", "status", "vendor", "product_type", "tags",
  "price", "compare_at_price", "inventory_total", "primary_sku",
  "barcode", "inventory_policy", "variant_count",
  "featured_image", "featured_image_alt_text",
  "body_html", "seo_title", "seo_description",
  "published_at", "created_at", "updated_at",
] as const;

function getFeaturedImage(product: any) {
  const img = product?.image;
  if (toText(img?.src)) return img;
  if (Array.isArray(product?.images)) {
    return product.images.find((i: any) => toText(i?.src)) ?? null;
  }
  return null;
}

function collectVariantStats(variants: any[]) {
  const prices = variants.map((v) => toText(v?.price)).filter(Boolean);
  const compareAtPrices = variants.map((v) => toText(v?.compare_at_price)).filter(Boolean);
  const inventoryTotal = variants.reduce((s, v) => s + toNumber(v?.inventory_quantity), 0);
  const primary = variants[0] ?? null;
  return {
    variant_id: toText(primary?.id),
    inventory_item_id: toText(primary?.inventory_item_id),
    price: prices[0] || "",
    compare_at_price: compareAtPrices[0] || "",
    inventory_total: inventoryTotal,
    primary_sku: toText(primary?.sku),
    barcode: toText(primary?.barcode),
    inventory_policy: toText(primary?.inventory_policy),
    variant_count: variants.length,
  };
}

function normalizeProduct(product: any): SyncSheetRow {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const vs = collectVariantStats(variants);
  const img = getFeaturedImage(product);
  return {
    id: toText(product?.id),
    title: toText(product?.title),
    handle: toText(product?.handle),
    status: toText(product?.status),
    vendor: toText(product?.vendor),
    product_type: toText(product?.product_type),
    tags: Array.isArray(product?.tags)
      ? product.tags.map((t: unknown) => toText(t)).filter(Boolean).join(", ")
      : toText(product?.tags),
    variant_id: vs.variant_id,
    inventory_item_id: vs.inventory_item_id,
    price: vs.price,
    compare_at_price: vs.compare_at_price,
    inventory_total: vs.inventory_total,
    primary_sku: vs.primary_sku,
    barcode: vs.barcode,
    inventory_policy: vs.inventory_policy,
    variant_count: vs.variant_count,
    featured_image: toText(img?.src),
    featured_image_id: toText(img?.id),
    featured_image_alt_text: toText(img?.alt),
    body_html: toText(product?.body_html),
    seo_title: toText(product?.seo_title),
    seo_description: toText(product?.seo_description),
    published_at: toText(product?.published_at),
    created_at: toText(product?.created_at),
    updated_at: toText(product?.updated_at),
  };
}

function buildSheet(integrationName: string, products: any[]): SyncSheet {
  return {
    title: `Products · ${integrationName}`,
    columns: [...SHOPIFY_CORE_PRODUCT_COLUMNS],
    rows: products.map(normalizeProduct),
  };
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const jsonHeaders = { "Content-Type": "application/json", ...CORS_HEADERS };

  try {
    const body = await req.json();
    const { workspaceId, userId, limit } = body as { workspaceId?: string; userId?: string; limit?: number };

    if (!workspaceId) {
      return new Response(JSON.stringify({ error: "Missing workspaceId" }), { status: 400, headers: jsonHeaders });
    }
    if (!userId) {
      return new Response(JSON.stringify({ error: "Missing userId" }), { status: 400, headers: jsonHeaders });
    }

    const admin = getSupabaseAdmin();

    // Verify workspace membership
    const { data: member, error: memberError } = await admin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .single();

    if (memberError || !member) {
      return new Response(JSON.stringify({ error: "Forbidden: not a workspace member" }), { status: 403, headers: jsonHeaders });
    }

    // Get Shopify integration
    const { data: integration, error: intError } = await admin
      .from("workspace_integrations")
      .select("provider, integration_name, base_url, config")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (intError) throw new Error(intError.message);
    if (!integration) throw new Error("No connected integration found");
    if (integration.provider !== "shopify") throw new Error(`${integration.provider} is not supported yet in Sync actions`);

    const adminApiToken = String(integration.config?.admin_api_token ?? "").trim();
    if (!adminApiToken) throw new Error("Missing Shopify admin token in integration config");

    // Load all Shopify products (paginated)
    const shouldLoadAll = (limit ?? 0) <= 0;
    const pageSize = shouldLoadAll ? 250 : Math.min(Math.max(limit ?? 50, 1), 250);

    let nextUrl: URL | null = new URL(`${integration.base_url}/admin/api/2024-10/products.json`);
    nextUrl.searchParams.set("limit", String(pageSize));
    nextUrl.searchParams.set(
      "fields",
      "id,title,handle,status,vendor,product_type,tags,body_html,seo_title,seo_description,published_at,created_at,updated_at,variants,image,images"
    );

    const allProducts: any[] = [];
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
        throw new Error(`Shopify request failed (${res.status})${text ? ": " + text : ""}`);
      }

      const data = await res.json();
      const products = Array.isArray(data?.products) ? data.products : [];
      allProducts.push(...products);

      if (!shouldLoadAll || products.length < 250) break;

      const link = res.headers.get("link") || res.headers.get("Link") || "";
      const match = link.match(/<([^>]+)>;\s*rel="next"/i);
      if (!match?.[1]) break;
      nextUrl = new URL(match[1]);
    }

    const sheet = buildSheet(integration.integration_name, allProducts);

    console.log(`[load-shopify-products] Loaded ${allProducts.length} products for workspace ${workspaceId}`);

    return new Response(JSON.stringify({ sheet }), { status: 200, headers: jsonHeaders });
  } catch (error: any) {
    console.error("[load-shopify-products] Error:", error?.message);
    return new Response(
      JSON.stringify({ error: error?.message || "Internal error" }),
      { status: 500, headers: jsonHeaders }
    );
  }
});
