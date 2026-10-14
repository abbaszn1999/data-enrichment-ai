import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAssistant } from "@/lib/assistant/gateway-auth";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  workspaceId: z.string().max(80),
  rows: z.coerce.number().int().min(1).max(100_000),
});

function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[index] ?? 0;
}

/**
 * A credit range for enriching `rows` rows, from what this workspace's recent
 * rows actually cost (10th to 90th percentile per row). `null` when there is no history yet.
 */
export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const access = await authorizeAssistant({ workspaceId: parsed.data.workspaceId, requireCredits: false });
  if (access instanceof NextResponse) return access;

  const { data } = await createAdminClient()
    .from("credit_transactions")
    .select("credits_used")
    .eq("workspace_id", parsed.data.workspaceId)
    .eq("operation", "catalog_intelligence")
    .eq("entity_type", "catalog_row")
    .order("created_at", { ascending: false })
    .limit(200);

  const costs = (data ?? [])
    .map((row) => Number(row.credits_used))
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
