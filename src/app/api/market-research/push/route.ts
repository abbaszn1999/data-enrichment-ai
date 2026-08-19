import { NextRequest, NextResponse } from "next/server";
import {
  jsonError,
  pushBodySchema,
  requireMrWrite,
} from "@/lib/market-research/api-schema";
import { collectionPushCostUsd } from "@/lib/market-research/cost";
import { getMrProject } from "@/lib/market-research/server-persist";
import { chargeMrWallet } from "@/lib/market-research/wallet-ops";

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = pushBodySchema.safeParse(json);
  if (!parsed.success) return jsonError("Invalid push payload", 400);

  const auth = await requireMrWrite(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  const project = await getMrProject(
    auth.admin,
    parsed.data.workspaceId,
    parsed.data.projectId
  );
  if (!project) return jsonError("Project not found", 404);

  const ids = [...parsed.data.collectionIds].sort();
  const amountUsd = collectionPushCostUsd(ids.length);
  const charged = await chargeMrWallet(auth.admin, {
    workspaceId: parsed.data.workspaceId,
    userId: auth.user.id,
    amountUsd,
    description: `Push ${ids.length} collection${ids.length === 1 ? "" : "s"}`,
    idempotencyKey: `collection_push:${parsed.data.projectId}:${ids.join(",")}`,
    details: { projectId: parsed.data.projectId, collectionIds: ids },
  });

  if (!charged.ok) {
    const status = charged.reason === "insufficient_funds" ? 402 : 500;
    return NextResponse.json(
      { error: charged.message || "Not enough wallet balance" },
      { status, headers: auth.headers }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      duplicate: charged.duplicate === true,
      chargedUsd: amountUsd,
      remaining: charged.remaining,
    },
    { headers: auth.headers }
  );
}
