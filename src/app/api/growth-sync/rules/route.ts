import { NextRequest, NextResponse } from "next/server";
import {
  jsonError,
  requireMrRead,
  requireMrWrite,
} from "@/lib/market-research/api-schema";
import { getProvider, isProviderSupported } from "@/lib/sync/core/registry";
import {
  createRuleBodySchema,
  deleteRuleBodySchema,
  updateRuleBodySchema,
} from "@/lib/growth-sync/api-schema";
import { loadIntegration, seedWatermarks } from "@/lib/growth-sync/repo";

const RULE_COLUMNS =
  "id, workspace_id, project_id, name, enabled, provider, run_interval, watched_taxonomies, mode, next_run_at, last_run_at, last_error, created_at, updated_at";

function intervalToMinutes(interval: string): number | null {
  return interval === "24h" ? 1440 : null;
}

function nextRunFor(interval: string): string | null {
  const minutes = intervalToMinutes(interval);
  if (minutes === null) return null;
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/** Rules, their recent runs, and the shared activity feed. */
export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
  if (!workspaceId) return jsonError("workspaceId is required", 400);

  const auth = await requireMrRead(workspaceId);
  if (!auth.ok) return auth.response;

  try {
    const [rulesRes, activityRes] = await Promise.all([
      auth.admin
        .from("gs_rules")
        .select(RULE_COLUMNS)
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false }),
      auth.admin
        .from("gs_activity")
        .select(
          "id, rule_id, product_ref, product_title, product_url, product_image_url, taxonomy_ref, taxonomy_name, decision, score, reason, undone_at, created_at"
        )
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    if (rulesRes.error) throw new Error(rulesRes.error.message);

    const ruleIds = (rulesRes.data ?? []).map((r) => String(r.id));
    let runs: unknown[] = [];
    if (ruleIds.length > 0) {
      const runsRes = await auth.admin
        .from("gs_runs")
        .select(
          "id, rule_id, trigger, status, detected_count, classified_count, assigned_count, error, started_at, finished_at"
        )
        .in("rule_id", ruleIds)
        .order("started_at", { ascending: false })
        .limit(60);
      if (runsRes.error) throw new Error(runsRes.error.message);
      runs = runsRes.data ?? [];
    }

    return NextResponse.json({
      ok: true,
      rules: rulesRes.data ?? [],
      runs,
      activity: activityRes.data ?? [],
    });
  } catch (err) {
    console.error("[growth-sync/rules] GET failed:", err);
    const message = err instanceof Error ? err.message : "Could not load sync rules";
    return jsonError(message, 500);
  }
}

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = createRuleBodySchema.safeParse(json);
  if (!parsed.success) return jsonError("Invalid payload", 400);
  const body = parsed.data;

  const auth = await requireMrWrite(body.workspaceId);
  if (!auth.ok) return auth.response;

  try {
    const integrationRow = await loadIntegration(auth.admin, body.workspaceId);
    if (!integrationRow) {
      return jsonError("Connect a store before creating a sync rule", 400);
    }
    if (!isProviderSupported(integrationRow.provider)) {
      return jsonError(`Unsupported store provider: ${integrationRow.provider}`, 400);
    }

    const provider = getProvider(integrationRow.provider);
    // Refuse up front rather than accepting a rule that could never run.
    if (!provider.growthSync) {
      return jsonError(
        `Automatic sync is not supported on ${provider.label} yet`,
        400
      );
    }
    if (!provider.taxonomy?.assign) {
      return jsonError(
        `Assigning products to categories is not supported on ${provider.label}`,
        400
      );
    }

    const { data, error } = await auth.admin
      .from("gs_rules")
      .insert({
        workspace_id: body.workspaceId,
        project_id: body.projectId,
        created_by: auth.user.id,
        name: body.name.trim(),
        provider: provider.id,
        run_interval: body.interval,
        mode: body.mode,
        watched_taxonomies: body.watchedTaxonomies,
        next_run_at: nextRunFor(body.interval),
      })
      .select(RULE_COLUMNS)
      .single();

    if (error) {
      if (error.code === "23505" || /duplicate key/i.test(error.message)) {
        return jsonError("A rule with this name already exists", 409);
      }
      throw new Error(error.message);
    }

    // Seeded at "now", which is what keeps the rule off the existing catalogue.
    await seedWatermarks(
      auth.admin,
      String(data.id),
      body.watchedTaxonomies.map((t) => t.ref)
    );

    return NextResponse.json({ ok: true, rule: data });
  } catch (err) {
    console.error("[growth-sync/rules] POST failed:", err);
    const message = err instanceof Error ? err.message : "Could not create the rule";
    return jsonError(message, 500);
  }
}

export async function PATCH(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = updateRuleBodySchema.safeParse(json);
  if (!parsed.success) return jsonError("Invalid payload", 400);
  const body = parsed.data;

  const auth = await requireMrWrite(body.workspaceId);
  if (!auth.ok) return auth.response;

  try {
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.mode !== undefined) patch.mode = body.mode;
    if (body.watchedTaxonomies !== undefined) {
      patch.watched_taxonomies = body.watchedTaxonomies;
    }
    if (body.interval !== undefined) {
      patch.run_interval = body.interval;
      patch.next_run_at = nextRunFor(body.interval);
    }
    if (body.enabled !== undefined) {
      patch.enabled = body.enabled;
      // Re-enabling clears the error that caused the pause, otherwise the card
      // keeps showing a failure the user has already acted on.
      if (body.enabled) {
        patch.last_error = null;
        if (patch.next_run_at === undefined) {
          const { data: current } = await auth.admin
            .from("gs_rules")
            .select("run_interval")
            .eq("id", body.ruleId)
            .maybeSingle();
          patch.next_run_at = nextRunFor(String(current?.run_interval ?? "24h"));
        }
      }
    }

    if (Object.keys(patch).length === 0) {
      return jsonError("Nothing to update", 400);
    }

    const { data, error } = await auth.admin
      .from("gs_rules")
      .update(patch)
      .eq("id", body.ruleId)
      .eq("workspace_id", body.workspaceId)
      .select(RULE_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return jsonError("Rule not found", 404);

    if (body.watchedTaxonomies) {
      await seedWatermarks(
        auth.admin,
        body.ruleId,
        body.watchedTaxonomies.map((t) => t.ref)
      );
    }

    return NextResponse.json({ ok: true, rule: data });
  } catch (err) {
    console.error("[growth-sync/rules] PATCH failed:", err);
    const message = err instanceof Error ? err.message : "Could not update the rule";
    return jsonError(message, 500);
  }
}

export async function DELETE(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = deleteRuleBodySchema.safeParse(json);
  if (!parsed.success) return jsonError("Invalid payload", 400);

  const auth = await requireMrWrite(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  const { error } = await auth.admin
    .from("gs_rules")
    .delete()
    .eq("id", parsed.data.ruleId)
    .eq("workspace_id", parsed.data.workspaceId);
  if (error) {
    console.error("[growth-sync/rules] DELETE failed:", error);
    return jsonError(error.message, 500);
  }

  return NextResponse.json({ ok: true });
}
