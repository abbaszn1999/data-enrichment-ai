import { NextRequest, NextResponse } from "next/server";
import { jsonError, requireMrRead } from "@/lib/market-research/api-schema";
import { getProvider, isProviderSupported } from "@/lib/sync/core/registry";
import { loadIntegration } from "@/lib/growth-sync/repo";
import type { IntegrationRecord } from "@/lib/sync/core/types";

/**
 * The store's real taxonomies, for the "what should I watch" picker.
 *
 * `taxonomyLabel` travels with the payload so the UI can say "Collections" or
 * "Categories" without knowing which store is connected.
 */
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
  if (!workspaceId) return jsonError("workspaceId is required", 400);

  const auth = await requireMrRead(workspaceId);
  if (!auth.ok) return auth.response;

  try {
    const integrationRow = await loadIntegration(auth.admin, workspaceId);
    if (!integrationRow) {
      return NextResponse.json({
        ok: true,
        connected: false,
        taxonomies: [],
        taxonomyLabel: "Categories",
        message: "No store is connected to this workspace",
      });
    }
    if (!isProviderSupported(integrationRow.provider)) {
      return jsonError(`Unsupported store provider: ${integrationRow.provider}`, 400);
    }

    const provider = getProvider(integrationRow.provider);
    const list = provider.taxonomy?.list;
    if (!list) {
      return NextResponse.json({
        ok: true,
        connected: true,
        provider: provider.id,
        taxonomyLabel: provider.schema.taxonomyLabel,
        taxonomies: [],
        message: `Listing categories is not supported on ${provider.label}`,
      });
    }

    const taxonomies = await list({
      integration: integrationRow as IntegrationRecord,
    });

    return NextResponse.json({
      ok: true,
      connected: true,
      provider: provider.id,
      taxonomyLabel: provider.schema.taxonomyLabel,
      // The picker needs to know which of these it can actually write to, so
      // the flag is passed through rather than filtered out here.
      taxonomies,
      supportsUndo: Boolean(provider.taxonomy?.unassign),
    });
  } catch (err) {
    console.error("[growth-sync/taxonomies] failed:", err);
    const message = err instanceof Error ? err.message : "Could not load categories";
    return jsonError(message, 500);
  }
}
