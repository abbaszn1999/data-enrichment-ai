import { NextRequest, NextResponse } from "next/server";
import { authorizeStoreAgent, callStoreAgentService } from "@/lib/store-agent/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Concrete gaps in the store with ready prompts, for the new-chat screen. */
export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? "";
  const access = await authorizeStoreAgent({ workspaceId });
  if (access instanceof NextResponse) return access;
  try {
    const res = await callStoreAgentService({ path: `/store-agent/insights/${workspaceId}`, userId: access.userId, method: "GET" });
    if (!res.ok) return NextResponse.json({ insights: [] });
    return NextResponse.json(await res.json(), { headers: { "Cache-Control": "private, max-age=120" } });
  } catch {
    return NextResponse.json({ insights: [] });
  }
}
