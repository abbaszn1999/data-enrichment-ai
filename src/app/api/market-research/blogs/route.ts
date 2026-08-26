import { NextRequest, NextResponse } from "next/server";
import { jsonError, requireMrRead } from "@/lib/market-research/api-schema";
import {
  fetchShopifyBlogs,
  fetchShopInfo,
  isShopifyAccessDenied,
  SHOPIFY_CONTENT_SCOPE_HINT,
} from "@/lib/sync/providers/shopify/articles";
import type { IntegrationRecord } from "@/lib/sync/core/types";

export const maxDuration = 60;

function normalizeStoreUrl(value: string | null | undefined): string {
  const clean = (value ?? "").trim().replace(/\/+$/, "");
  if (!clean) return "";
  return /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
}

/**
 * The store's blog categories, so the article writer can file each article
 * where the merchant already publishes instead of inventing a section, plus the
 * storefront origin the dashboard needs to turn stored relative collection
 * paths into links a merchant can actually click.
 */
export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? "";
  if (!workspaceId) return jsonError("workspaceId is required", 400);

  const auth = await requireMrRead(workspaceId);
  if (!auth.ok) return auth.response;

  const { data: integrationRow } = await auth.admin
    .from("workspace_integrations")
    .select("provider, integration_name, base_url, config")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  const provider = String(integrationRow?.provider ?? "").toLowerCase();
  const fallbackUrl = normalizeStoreUrl(integrationRow?.base_url);

  if (!integrationRow || provider !== "shopify") {
    return NextResponse.json(
      {
        blogs: [],
        provider: provider || null,
        storeUrl: fallbackUrl,
        contentAccess: false,
      },
      { headers: auth.headers }
    );
  }

  const integration = integrationRow as IntegrationRecord;

  // A missing scope must not block writing articles — the merchant can still
  // draft and review them — but it has to be reported, since the upload will
  // fail for the same reason.
  let scopeWarning: string | null = null;
  const [blogs, shopInfo] = await Promise.all([
    fetchShopifyBlogs({ integration }).catch((err) => {
      if (isShopifyAccessDenied(err)) {
        scopeWarning = SHOPIFY_CONTENT_SCOPE_HINT;
      } else {
        console.error("[api/market-research/blogs] Error:", err);
      }
      return [];
    }),
    fetchShopInfo({ integration }),
  ]);

  return NextResponse.json(
    {
      blogs,
      provider,
      storeUrl: normalizeStoreUrl(shopInfo.storeUrl) || fallbackUrl,
      contentAccess: scopeWarning === null,
      scopeWarning,
    },
    { headers: auth.headers }
  );
}
