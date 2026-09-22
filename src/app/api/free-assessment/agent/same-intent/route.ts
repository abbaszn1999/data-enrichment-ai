import { NextRequest, NextResponse } from "next/server";
import {
  agentIntentBodySchema,
  jsonError,
  requireFaWrite,
} from "@/lib/free-assessment/api-schema";
import { advanceSameIntent } from "@/lib/free-assessment/agent/same-intent-job";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = agentIntentBodySchema.safeParse(json);
  if (!parsed.success) {
    return jsonError("Invalid same-intent payload", 400);
  }

  const auth = await requireFaWrite(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  try {
    const page = await advanceSameIntent(
      auth.admin,
      parsed.data.workspaceId,
      parsed.data.projectId,
      parsed.data.offset
    );
    return NextResponse.json(page, { headers: auth.headers });
  } catch (err) {
    console.error("[api/free-assessment/agent/same-intent] Error:", err);
    const msg = err instanceof Error ? err.message : "Failed to clean same-intent terms";
    return jsonError(msg, 500);
  }
}
