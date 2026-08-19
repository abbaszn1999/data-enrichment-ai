import { NextRequest, NextResponse } from "next/server";
import {
  jsonError,
  probeBodySchema,
  requireMrWrite,
} from "@/lib/market-research/api-schema";
import { estimateProbeCostUsd } from "@/lib/market-research/cost";
import { getKeywordProvider } from "@/lib/market-research/providers";
import { marketToSemrushDb } from "@/lib/market-research/providers/keyword-provider";
import { getMrProject } from "@/lib/market-research/server-persist";
import {
  chargeMrWallet,
  refundMrWallet,
} from "@/lib/market-research/wallet-ops";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = probeBodySchema.safeParse(json);
  if (!parsed.success) {
    return jsonError("Invalid probe payload", 400);
  }

  const auth = await requireMrWrite(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  const project = await getMrProject(
    auth.admin,
    parsed.data.workspaceId,
    parsed.data.projectId
  );
  if (!project) {
    return jsonError("Project not found", 404);
  }

  const holdUsd = estimateProbeCostUsd(parsed.data.seeds.length);
  const charged = await chargeMrWallet(auth.admin, {
    workspaceId: parsed.data.workspaceId,
    userId: auth.user.id,
    amountUsd: holdUsd,
    description: `Demand check · ${parsed.data.seeds.length} seeds`,
    idempotencyKey: `apify_seed_probe:${parsed.data.attemptId}`,
    details: {
      projectId: parsed.data.projectId,
      market: parsed.data.market,
      seedCount: parsed.data.seeds.length,
    },
  });
  if (!charged.ok) {
    const status = charged.reason === "insufficient_funds" ? 402 : 500;
    return NextResponse.json(
      { error: charged.message || "Not enough wallet balance" },
      { status, headers: auth.headers }
    );
  }

  const database = marketToSemrushDb(parsed.data.market);
  try {
    const metrics = await getKeywordProvider().fetchSeedMetrics(
      parsed.data.seeds.map((seed) => seed.term),
      database
    );
    const byTerm = new Map(
      metrics.map((row) => [row.seed.toLowerCase(), row])
    );
    const results = parsed.data.seeds.map((seed) => {
      const match = byTerm.get(seed.term.trim().toLowerCase());
      if (!match) {
        return { seedId: seed.id, failed: true as const };
      }
      return {
        seedId: seed.id,
        failed: false as const,
        volume: match.volume,
        keywordDifficulty: match.keywordDifficulty,
        cpcUsd: match.cpcUsd,
        intents: match.intents,
        keywordIdeasTotal: match.keywordIdeasTotal,
        keywordIdeasTotalVolume: match.keywordIdeasTotalVolume,
        sampleKeywords: [
          ...match.relatedKeywords.slice(0, 3).map((row) => row.keyword),
          ...match.questions.slice(0, 2).map((row) => row.keyword),
        ],
      };
    });
    const succeeded = results.filter((row) => !row.failed).length;
    const actualUsd = estimateProbeCostUsd(succeeded);
    const refundUsd = Math.max(0, Math.round((holdUsd - actualUsd) * 100) / 100);
    if (refundUsd > 0) {
      await refundMrWallet(auth.admin, {
        workspaceId: parsed.data.workspaceId,
        userId: auth.user.id,
        amountUsd: refundUsd,
        description: `Demand check refund · ${parsed.data.seeds.length - succeeded} seeds failed`,
        idempotencyKey: `apify_seed_probe:refund:${parsed.data.attemptId}`,
        details: { projectId: parsed.data.projectId, succeeded },
      });
    }

    return NextResponse.json(
      {
        market: parsed.data.market,
        database,
        probeCostUsd: actualUsd,
        chargedUsd: actualUsd,
        results,
      },
      { headers: auth.headers }
    );
  } catch (error) {
    await refundMrWallet(auth.admin, {
      workspaceId: parsed.data.workspaceId,
      userId: auth.user.id,
      amountUsd: holdUsd,
      description: "Demand check refund · probe failed",
      idempotencyKey: `apify_seed_probe:refund:${parsed.data.attemptId}`,
      details: { projectId: parsed.data.projectId, failed: true },
    });
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Demand probe failed",
      },
      { status: 502, headers: auth.headers }
    );
  }
}
