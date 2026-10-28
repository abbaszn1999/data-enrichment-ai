import { NextRequest, NextResponse } from "next/server";
import { authorizeStoreAgent, callStoreAgentService } from "@/lib/store-agent/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Products and collections matching a title, for @-mentions in the composer. */
export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? "";
  const term = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 60);
  const access = await authorizeStoreAgent({ workspaceId });
  if (access instanceof NextResponse) return access;
  if (!term) return NextResponse.json({ results: [] });
  try {
    const res = await callStoreAgentService({
      path: `/store-agent/search/${workspaceId}`,
      userId: access.userId,
      method: "GET",
      query: new URLSearchParams({ q: term }).toString(),
    });
    return NextResponse.json(res.ok ? await res.json() : { results: [] });
  } catch {
    return NextResponse.json({ results: [] });
  }
}
