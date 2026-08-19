import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireGalleryAuth } from "@/lib/gallery/auth";
import { readWorkspaceWallet, updateWalletAutoReload } from "@/lib/wallet/server";

const bodySchema = z.object({
  workspaceId: z.string().uuid(),
  autoReload: z.object({
    enabled: z.boolean(),
    threshold: z.number().min(0).max(10_000),
    amount: z.number().min(5).max(10_000),
  }),
});

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid wallet settings" }, { status: 400 });
  }

  const auth = await requireGalleryAuth({
    workspaceId: parsed.data.workspaceId,
    requireWrite: true,
  });
  if (!auth.ok) return auth.response;

  await updateWalletAutoReload(
    auth.admin,
    parsed.data.workspaceId,
    parsed.data.autoReload
  );
  const wallet = await readWorkspaceWallet(auth.admin, parsed.data.workspaceId);
  return NextResponse.json({ wallet }, { headers: auth.headers });
}
