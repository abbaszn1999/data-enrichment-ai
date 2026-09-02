import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireGalleryAuth } from "@/lib/gallery/auth";
import { listWalletTransactions } from "@/lib/wallet/server";

const querySchema = z.object({
  workspaceId: z.string().uuid(),
  module: z.string().optional(),
  q: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    workspaceId: request.nextUrl.searchParams.get("workspaceId"),
    module: request.nextUrl.searchParams.get("module") ?? undefined,
    q: request.nextUrl.searchParams.get("q") ?? undefined,
    cursor: request.nextUrl.searchParams.get("cursor") ?? undefined,
    limit: request.nextUrl.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const auth = await requireGalleryAuth({ workspaceId: parsed.data.workspaceId });
  if (!auth.ok) return auth.response;

  const page = await listWalletTransactions(auth.admin, {
    workspaceId: parsed.data.workspaceId,
    module: parsed.data.module,
    query: parsed.data.q,
    cursor: parsed.data.cursor,
    limit: parsed.data.limit ?? 20,
  });
  return NextResponse.json(page, { headers: auth.headers });
}
