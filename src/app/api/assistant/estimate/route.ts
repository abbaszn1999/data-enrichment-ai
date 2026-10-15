import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAssistant } from "@/lib/assistant/gateway-auth";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  workspaceId: z.string().max(80),
  rows: z.coerce.number().int().min(1).max(100_000),
  feature: z.enum(["catalog", "gallery_ai", "gallery_google"]).default("catalog"),
});

const FEATURE_SOURCE = {
  catalog: { operation: "catalog_intelligence", entityType: "catalog_row" },
  gallery_ai: { operation: "gallery_ai", entityType: "gallery_session" },
  gallery_google: { operation: "gallery_google", entityType: "gallery_session" },
} as const;

/** Gallery charges once per row phase, so phases are summed back into one cost per product. */
function costsPerRow(rows: { credits_used: unknown; details: unknown }[], groupByRow: boolean): number[] {
  if (!groupByRow) return rows.map((row) => Number(row.credits_used));
  const totals = new Map<string, number>();
  rows.forEach((row, index) => {
    const details = row.details as { rowId?: unknown } | null;
    const key = typeof details?.rowId === "string" ? details.rowId : `#${index}`;
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

  const source = FEATURE_SOURCE[parsed.data.feature];
  const { data } = await createAdminClient()
    .from("credit_transactions")
    .select("credits_used, details")
    .eq("workspace_id", parsed.data.workspaceId)
    .eq("operation", source.operation)
    .eq("entity_type", source.entityType)
    .order("created_at", { ascending: false })
    .limit(400);

  const costs = costsPerRow(data ?? [], parsed.data.feature !== "catalog")
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (costs.length < 5) return NextResponse.json({ estimate: null, balance: access.ctx.credits?.total ?? null });

  const round = (value: number) => Math.round(value * 100) / 100;
  return NextResponse.json({
    estimate: {
      min: round(percentile(costs, 0.1) * parsed.data.rows),
      max: round(percentile(costs, 0.9) * parsed.data.rows),
    },
    balance: access.ctx.credits?.total ?? null,
  });
}
