import { NextRequest, NextResponse } from "next/server";
import { jsonError, requireMrWrite } from "@/lib/market-research/api-schema";
import { getProvider, isProviderSupported } from "@/lib/sync/core/registry";
import { undoBodySchema } from "@/lib/growth-sync/api-schema";
import { loadIntegration } from "@/lib/growth-sync/repo";
import type { IntegrationRecord } from "@/lib/sync/core/types";

/**
 * Take back assignments the engine made.
 *
 * The watermark is deliberately left alone: rolling it back would make the next
 * run re-detect the very products the user just rejected.
 */
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = undoBodySchema.safeParse(json);
  if (!parsed.success) return jsonError("Invalid payload", 400);
  const { workspaceId, activityIds } = parsed.data;

  const auth = await requireMrWrite(workspaceId);
  if (!auth.ok) return auth.response;

  try {
    const integrationRow = await loadIntegration(auth.admin, workspaceId);
    if (!integrationRow || !isProviderSupported(integrationRow.provider)) {
      return jsonError("No supported store is connected", 400);
    }
    const provider = getProvider(integrationRow.provider);
    const unassign = provider.taxonomy?.unassign;
    if (!unassign) {
      return jsonError(`Undo is not supported on ${provider.label}`, 400);
    }

    const { data: rows, error } = await auth.admin
      .from("gs_activity")
      .select("id, product_ref, taxonomy_ref, decision, undone_at")
      .eq("workspace_id", workspaceId)
      .in("id", activityIds);
    if (error) throw new Error(error.message);

    // Only live assignments can be taken back; a skip or an earlier undo has
    // nothing on the store to reverse.
    const undoable = (rows ?? []).filter(
      (row) => row.decision === "assigned" && !row.undone_at && row.taxonomy_ref
    );
    if (undoable.length === 0) {
      return NextResponse.json({ ok: true, undoneCount: 0 });
    }

    const byTaxonomy = new Map<string, Array<{ id: string; productRef: string }>>();
    for (const row of undoable) {
      const ref = String(row.taxonomy_ref);
      const entry = { id: String(row.id), productRef: String(row.product_ref) };
      const list = byTaxonomy.get(ref);
      if (list) list.push(entry);
      else byTaxonomy.set(ref, [entry]);
    }

    const undoneIds: string[] = [];
    const failures: Array<{ taxonomyRef: string; error: string }> = [];
    let pendingJobRef: string | undefined;

    for (const [taxonomyRef, group] of byTaxonomy) {
      try {
        const result = await unassign({
          integration: integrationRow as IntegrationRecord,
          taxonomyId: taxonomyRef,
          productIds: group.map((g) => g.productRef),
        });
        if (result.pendingJobRef) pendingJobRef = result.pendingJobRef;
        undoneIds.push(...group.map((g) => g.id));
      } catch (err) {
        failures.push({
          taxonomyRef,
          error: err instanceof Error ? err.message : "Removal failed",
        });
      }
    }

    if (undoneIds.length > 0) {
      const { error: markError } = await auth.admin
        .from("gs_activity")
        .update({
          undone_at: new Date().toISOString(),
          pending_job_ref: pendingJobRef ?? null,
        })
        .in("id", undoneIds);
      if (markError) throw new Error(markError.message);
    }

    return NextResponse.json({
      ok: failures.length === 0,
      undoneCount: undoneIds.length,
      // Providers that queue the removal have not finished yet, so the UI
      // should say "removing" rather than claiming it is done.
      pending: Boolean(pendingJobRef),
      failures: failures.length > 0 ? failures : undefined,
    });
  } catch (err) {
    console.error("[growth-sync/undo] failed:", err);
    const message = err instanceof Error ? err.message : "Could not undo";
    return jsonError(message, 500);
  }
}
