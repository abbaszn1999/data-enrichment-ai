import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAssistant } from "@/lib/assistant/gateway-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { SEARCHAPI_GOOGLE_AI_MODE_MODEL, SEARCHAPI_GOOGLE_LENS_MODEL } from "@/lib/ai-pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  workspaceId: z.string().max(80),
  rows: z.coerce.number().int().min(1).max(100_000),
  feature: z
    .enum(["catalog", "catalog_lens", "catalog_source_urls", "gallery_ai", "gallery_google", "visualizer", "classify", "store"])
    .default("catalog"),
});

/**
 * Catalog runs record the tool in `details.model`: Lens and Source URLs have their own
 * model ids, so they are estimated apart; Enrichment, Categorize and Images share the rest.
 */
const CATALOG_TOOL_MODELS = {
  catalog_lens: SEARCHAPI_GOOGLE_LENS_MODEL,
  catalog_source_urls: SEARCHAPI_GOOGLE_AI_MODE_MODEL,
} as const;

const FEATURE_SOURCE = {
  catalog: { operations: ["catalog_intelligence"], entityType: "catalog_row", unit: "row" },
  catalog_lens: { operations: ["catalog_intelligence"], entityType: "catalog_row", unit: "row" },
  catalog_source_urls: { operations: ["catalog_intelligence"], entityType: "catalog_row", unit: "row" },
  gallery_ai: { operations: ["gallery_ai"], entityType: "gallery_session", unit: "phase" },
  gallery_google: { operations: ["gallery_google"], entityType: "gallery_session", unit: "phase" },
  visualizer: { operations: ["visualizer_description", "visualizer_images"], entityType: "visualizer_session", unit: "phase" },
  classify: { operations: ["image_classification"], entityType: "image_classification_session", unit: "batch" },
  store: { operations: ["store_assistant"], entityType: "store_assistant", unit: "row" },
} as const;

type CostUnit = (typeof FEATURE_SOURCE)[keyof typeof FEATURE_SOURCE]["unit"];

/**
 * One cost per processed item. Gallery and Visualizer charge once per row phase, so phases are summed
 * back per product and run; Image Classification charges once per batch, so it is divided per image.
 */
function costsPerRow(rows: { credits_used: unknown; details: unknown }[], unit: CostUnit): number[] {
  if (unit === "row") return rows.map((row) => Number(row.credits_used));
  if (unit === "batch") {
    return rows.map((row) => {
      const count = Number((row.details as { imageCount?: unknown } | null)?.imageCount);
      return count > 0 ? Number(row.credits_used) / count : Number.NaN;
    });
  }
  const totals = new Map<string, number>();
  rows.forEach((row, index) => {
    const details = row.details as { rowId?: unknown; runId?: unknown } | null;
    const runId = typeof details?.runId === "string" ? details.runId : "";
    const key = typeof details?.rowId === "string" ? `${runId}:${details.rowId}` : `#${index}`;
    totals.set(key, (totals.get(key) ?? 0) + Number(row.credits_used));
  });
  return [...totals.values()];
}

function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[index] ?? 0;
}

/**
 * A credit range for processing `rows` rows with `feature`, from what this workspace's recent
 * rows actually cost (10th to 90th percentile per row). `null` when there is no history yet.
 */
export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const access = await authorizeAssistant({ workspaceId: parsed.data.workspaceId, requireCredits: false });
  if (access instanceof NextResponse) return access;

  const feature = parsed.data.feature;
  const source = FEATURE_SOURCE[feature];
  let query = createAdminClient()
    .from("credit_transactions")
    .select("credits_used, details")
    .eq("workspace_id", parsed.data.workspaceId)
    .in("operation", [...source.operations])
    .eq("entity_type", source.entityType);
  if (feature === "catalog_lens" || feature === "catalog_source_urls") {
    query = query.eq("details->>model", CATALOG_TOOL_MODELS[feature]);
  }
  const { data } = await query.order("created_at", { ascending: false }).limit(400);

  const toolModels: string[] = Object.values(CATALOG_TOOL_MODELS);
  const rows =
    feature === "catalog"
      ? (data ?? []).filter((row) => !toolModels.includes(String((row.details as { model?: unknown } | null)?.model ?? "")))
      : (data ?? []);
  const costs = costsPerRow(rows, source.unit)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (costs.length < (source.unit === "batch" ? 2 : 5)) return NextResponse.json({ estimate: null, balance: access.ctx.credits?.total ?? null });

  const round = (value: number) => Math.round(value * 100) / 100;
  return NextResponse.json({
    estimate: {
      min: round(percentile(costs, 0.1) * parsed.data.rows),
      max: round(percentile(costs, 0.9) * parsed.data.rows),
    },
    balance: access.ctx.credits?.total ?? null,
  });
}
