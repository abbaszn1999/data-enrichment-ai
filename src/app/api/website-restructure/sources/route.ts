import { NextRequest, NextResponse } from "next/server";
import { requireWrAuth } from "@/lib/website-restructure/auth";
import { jsonError, projectIdSchema, workspaceIdSchema } from "@/lib/website-restructure/api-schema";
import { loadIntegration } from "@/lib/growth-sync/repo";
import { getProvider, isProviderSupported } from "@/lib/sync/core/registry";
import type { IntegrationRecord, TaxonomySummary } from "@/lib/sync/core/types";
import { fetchShopifyVendorBrands, fetchWooBrandTaxonomy } from "@/lib/sync/brand-taxonomy";
import { buildWrStoreLinks } from "@/lib/website-restructure/provider-links";
import { buildWrTaxonomyTree } from "@/lib/website-restructure/taxonomy-tree";
import { getWrProjectRow, setWrPhase } from "@/lib/website-restructure/server-persist";
import { saveWrTaxonomyAdmin } from "@/lib/website-restructure/storage";

/**
 * Real brand/vendor PLPs, synthesized alongside the normal taxonomy list so
 * the IA planner can elect brand pillars (e.g. "Gucci") from real store data
 * instead of guessing from collection titles alone.
 *
 * Time-boxed well inside this route's own `maxDuration`, and never thrown on
 * failure: Shopify's vendor roster is derived by walking every product, which
 * on a large store takes longer than the whole request is allowed to live.
 * Loading the store's categories must not hinge on finishing that walk, so a
 * slow store yields a partial (or empty) brand roster instead of a timeout.
 */
const WR_BRAND_FETCH_BUDGET_MS = 25_000;

async function fetchWrBrandTaxonomies(
  providerId: string,
  integration: IntegrationRecord
): Promise<TaxonomySummary[]> {
  try {
    const options = { timeBudgetMs: WR_BRAND_FETCH_BUDGET_MS };
    const brands =
      providerId === "woocommerce"
        ? await fetchWooBrandTaxonomy(integration, options)
        : providerId === "shopify"
          ? await fetchShopifyVendorBrands(integration, options)
          : [];
    return brands.map((b) => ({
      id: b.id,
      title: b.name,
      handle: b.handle,
      productCount: b.productCount,
      manual: true,
      kind: "brand" as const,
    }));
  } catch (error) {
    console.error("[website-restructure/sources] Failed to fetch brand taxonomies:", error);
    return [];
  }
}

export const maxDuration = 60;

/**
 * The store's real taxonomies + navigation, compressed and cached to storage
 * for the build/edit agent calls to reuse without re-fetching every time.
 */
export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  const projectId = request.nextUrl.searchParams.get("projectId");
  const wsParsed = workspaceIdSchema.safeParse(workspaceId);
  const pidParsed = projectIdSchema.safeParse(projectId);
  if (!wsParsed.success || !pidParsed.success) {
    return jsonError("workspaceId and projectId are required", 400);
  }

  const auth = await requireWrAuth({ workspaceId: wsParsed.data, requireWrite: true });
  if (!auth.ok) return auth.response;

  try {
    const project = await getWrProjectRow(auth.admin, wsParsed.data, pidParsed.data);
    if (!project) return jsonError("Project not found", 404);

    const integrationRow = await loadIntegration(auth.admin, wsParsed.data);
    if (!integrationRow) {
      return NextResponse.json(
        { error: "No store is connected to this workspace" },
        { status: 409, headers: auth.headers }
      );
    }
    if (!isProviderSupported(integrationRow.provider)) {
      return jsonError(`Unsupported store provider: ${integrationRow.provider}`, 400);
    }

    const provider = getProvider(integrationRow.provider);
    const integration = integrationRow as IntegrationRecord;

    const [taxonomies, brandTaxonomies, navResult, workspaceRow] = await Promise.all([
      provider.taxonomy?.list ? provider.taxonomy.list({ integration }) : Promise.resolve([]),
      fetchWrBrandTaxonomies(provider.id, integration),
      provider.navigation ? provider.navigation.list({ integration }) : Promise.resolve(null),
      auth.admin
        .from("workspaces")
        .select("collection_prefix")
        .eq("id", wsParsed.data)
        .maybeSingle(),
    ]);

    const storeLinks = buildWrStoreLinks(provider.id, integrationRow.base_url ?? "");
    const tree = buildWrTaxonomyTree({
      taxonomies: [...taxonomies, ...brandTaxonomies],
      navigationMenus: navResult?.menus ?? null,
      navigationUnavailableReason: navResult?.unavailableReason,
      storeLinks,
      // Same default as the Market Research push route, so the collections it
      // created are tagged growth-engine and kept out of the vision slice.
      generatedCollectionPrefix:
        (workspaceRow.data?.collection_prefix as string | null)?.trim() || "AI",
    });

    await saveWrTaxonomyAdmin(auth.admin, wsParsed.data, pidParsed.data, tree);

    if (project.phase === "collecting") {
      await setWrPhase(auth.admin, wsParsed.data, pidParsed.data, "awaiting_images");
    }
    if (!project.provider && provider.id) {
      await auth.admin
        .from("wr_projects")
        .update({ provider: provider.id })
        .eq("workspace_id", wsParsed.data)
        .eq("id", pidParsed.data);
    }

    return NextResponse.json(
      { ok: true, provider: provider.id, tree, storeLinks },
      { headers: auth.headers }
    );
  } catch (error) {
    console.error("[website-restructure/sources] failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load store data" },
      { status: 500, headers: auth.headers }
    );
  }
}
