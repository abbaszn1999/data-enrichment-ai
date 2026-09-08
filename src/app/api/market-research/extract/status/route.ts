import { NextRequest, NextResponse } from "next/server";
import {
  jsonError,
  requireMrRead,
  workspaceIdSchema,
  projectIdSchema,
} from "@/lib/market-research/api-schema";
import { z } from "zod";
import {
  loadLatestMrExtract,
  loadMrExtractHeader,
  persistExtractKeywordSample,
} from "@/lib/market-research/extract-advance";
import { loadProjectSliceAdmin } from "@/lib/market-research/storage-admin";
import type { DisplayKeyword } from "@/lib/market-research/map-keywords";

export const maxDuration = 30;

const querySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  extractId: z.string().uuid().optional(),
});

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const parsed = querySchema.safeParse({
    workspaceId: params.get("workspaceId") ?? undefined,
    projectId: params.get("projectId") ?? undefined,
    extractId: params.get("extractId") ?? undefined,
  });
  if (!parsed.success) return jsonError("Invalid extract status request", 400);

  const auth = await requireMrRead(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  try {
    const extract = parsed.data.extractId
      ? await loadMrExtractHeader(auth.admin, {
          workspaceId: parsed.data.workspaceId,
          projectId: parsed.data.projectId,
          extractId: parsed.data.extractId,
        })
      : await loadLatestMrExtract(auth.admin, {
          workspaceId: parsed.data.workspaceId,
          projectId: parsed.data.projectId,
        });
    if (!extract) {
      return NextResponse.json({ extract: null, seeds: [] }, { headers: auth.headers });
    }

    const { data: runRows, error: runsError } = await auth.admin
      .from("mr_runs")
      .select("seed_id, seed_term, status, rows_returned, pages, next_cursor")
      .eq("extract_id", extract.id);
    if (runsError && !/next_cursor/i.test(runsError.message)) {
      return NextResponse.json(
        { error: runsError.message },
        { status: 500, headers: auth.headers }
      );
    }
    let runs = runRows ?? [];
    if (runsError && /next_cursor/i.test(runsError.message)) {
      const fallback = await auth.admin
        .from("mr_runs")
        .select("seed_id, seed_term, status, rows_returned, pages")
        .eq("extract_id", extract.id);
      runs = (fallback.data ?? []).map((row) => ({ ...row, next_cursor: null }));
    }

    const active =
      extract.status === "running" || extract.billing_status === "held";
    let sample: DisplayKeyword[] | undefined;
    if (!active) {
      const stored = await loadProjectSliceAdmin<DisplayKeyword[]>(
        auth.admin,
        parsed.data.workspaceId,
        parsed.data.projectId,
        "keywords"
      ).catch(() => null);
      sample = Array.isArray(stored) ? stored : undefined;
      if (!sample?.length && Number(extract.rows_returned) > 0) {
        sample = await persistExtractKeywordSample(auth.admin, {
          workspaceId: parsed.data.workspaceId,
          projectId: parsed.data.projectId,
          extractId: extract.id,
          runs: runs.map((run) => ({
            seed_id: String(run.seed_id ?? ""),
            seed_term: String(run.seed_term ?? ""),
          })),
        }).catch(() => undefined);
      }
    }

    return NextResponse.json(
      {
        extract: {
          id: extract.id,
          status: extract.status,
          billingStatus: extract.billing_status,
          rowsReturned: Number(extract.rows_returned) || 0,
          heldUsd: Number(extract.held_usd) || 0,
          actualUsd: Number(extract.actual_usd) || 0,
          createdAt: extract.created_at,
        },
        seeds: runs.map((run) => ({
          seedId: String(run.seed_id ?? ""),
          term: String(run.seed_term ?? ""),
          status: String(run.status ?? "running"),
          rowsReturned: Number(run.rows_returned) || 0,
          pages: Number(run.pages) || 0,
        })),
        sample,
      },
      { headers: auth.headers }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load extract status",
      },
      { status: 500, headers: auth.headers }
    );
  }
}
