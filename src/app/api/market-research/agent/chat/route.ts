import { NextRequest, NextResponse } from "next/server";
import {
  agentChatBodySchema,
  jsonError,
  requireMrWrite,
} from "@/lib/market-research/api-schema";
import { fetchStoreCatalog } from "@/lib/market-research/agent/store-catalog";
import { runStage1AgentChat } from "@/lib/market-research/agent/stage1-chat";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = agentChatBodySchema.safeParse(json);
  if (!parsed.success) {
    return jsonError("Invalid chat payload", 400);
  }

  const auth = await requireMrWrite(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  try {
    const catalog = await fetchStoreCatalog(auth.admin, parsed.data.workspaceId);
    const chatResult = await runStage1AgentChat({
      stage: parsed.data.stage,
      market: parsed.data.market,
      storeName: catalog.storeName,
      collections: catalog.collections,
      currentNiches: parsed.data.currentNiches ?? [],
      selectedCollectionIds: parsed.data.selectedCollectionIds,
      seedRows: parsed.data.seedRows as any,
      probes: parsed.data.probes,
      messages: parsed.data.messages,
      userMessage: parsed.data.userMessage,
    });

    return NextResponse.json(
      {
        reply: chatResult.reply,
        updatedNiches: chatResult.updatedNiches,
        updatedStructuredNiches: chatResult.updatedStructuredNiches,
      },
      { headers: auth.headers }
    );
  } catch (err) {
    console.error("[api/market-research/agent/chat] Error:", err);
    const msg = err instanceof Error ? err.message : "Failed to run chat agent";
    const status = msg.includes("No active store integration") ? 400 : 500;
    return jsonError(msg, status);
  }
}
