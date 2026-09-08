import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireGalleryAuth } from "@/lib/gallery/auth";
import { readWorkspaceWallet } from "@/lib/wallet/server";
import {
  jsonByteLength,
  recordResponseBytes,
} from "@/lib/observability/metrics";

const querySchema = z.object({
  workspaceId: z.string().uuid(),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    workspaceId: request.nextUrl.searchParams.get("workspaceId"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const auth = await requireGalleryAuth({ workspaceId: parsed.data.workspaceId });
  if (!auth.ok) return auth.response;

  const wallet = await readWorkspaceWallet(auth.admin, parsed.data.workspaceId);
  const body = { wallet };
  recordResponseBytes("wallet", jsonByteLength(body));
  return NextResponse.json(body, { headers: auth.headers });
}
