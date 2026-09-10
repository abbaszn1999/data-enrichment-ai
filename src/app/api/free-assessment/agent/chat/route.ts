import { NextRequest, NextResponse } from "next/server";
import {
  agentChatBodySchema,
  jsonError,
  requireFaWrite,
} from "@/lib/free-assessment/api-schema";
import { csvRowsToCollectionItems } from "@/lib/free-assessment/agent/csv-catalog";
import { runStage1AgentChat } from "@/lib/free-assessment/agent/stage1-chat";
import { saveProjectSliceAdmin } from "@/lib/free-assessment/storage-admin";

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

  const auth = await requireFaWrite(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  try {
    const { collections, brands } = csvRowsToCollectionItems(
      parsed.data.plpRows ?? []
    );

    const result = await runStage1AgentChat({
      stage: parsed.data.stage,
      market: parsed.data.market,
      storeName: "the uploaded catalog",
      collections: [...collections, ...brands],
      currentNiches: parsed.data.currentNiches ?? [],
      selectedCollectionIds: parsed.data.selectedCollectionIds,
      seedRows: parsed.data.seedRows as any,
      probes: parsed.data.probes,
      messages: parsed.data.messages,
      userMessage: parsed.data.userMessage,
    });

    if (
      parsed.data.projectId &&
      result.updatedNiches &&
      result.updatedStructuredNiches
    ) {
      await saveProjectSliceAdmin(
        auth.admin,
        parsed.data.workspaceId,
        parsed.data.projectId,
        "niches",
        {
          niches: result.updatedNiches,
          structuredNiches: result.updatedStructuredNiches,
        }
      ).catch((err) => console.error("[fa-chat] Error saving niches slice:", err));
    }

    return NextResponse.json(
      {
        reply: result.reply,
        updatedNiches: result.updatedNiches,
        updatedStructuredNiches: result.updatedStructuredNiches,
      },
      { headers: auth.headers }
    );
  } catch (err) {
    console.error("[api/free-assessment/agent/chat] Error:", err);
    const msg = err instanceof Error ? err.message : "Chat failed";
    return jsonError(msg, 500);
  }
}
