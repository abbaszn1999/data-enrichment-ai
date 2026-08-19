import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireGalleryAuth } from "@/lib/gallery/auth";
import { walletDevTopupEnabled } from "@/lib/wallet/dev-topup";
import { creditWorkspaceWallet, readWorkspaceWallet } from "@/lib/wallet/server";

const bodySchema = z.object({
  workspaceId: z.string().uuid(),
  amountUsd: z.number().min(5).max(10_000),
  method: z.string().min(1).max(80).optional(),
});

export async function POST(request: NextRequest) {
  if (!walletDevTopupEnabled()) {
    return NextResponse.json(
      { error: "Live card top-ups are not enabled yet" },
      { status: 403 }
    );
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid top-up payload" }, { status: 400 });
  }

  const auth = await requireGalleryAuth({
    workspaceId: parsed.data.workspaceId,
    requireWrite: true,
  });
  if (!auth.ok) return auth.response;

  const credited = await creditWorkspaceWallet(auth.admin, {
    workspaceId: parsed.data.workspaceId,
    userId: auth.user.id,
    amountUsd: parsed.data.amountUsd,
    kind: "topup",
    description: "Wallet top-up",
    module: "Billing",
    method: parsed.data.method ?? "Dev credit",
    details: { source: "dev_topup" },
  });

  if (!credited.ok) {
    return NextResponse.json(
      { error: credited.message || "Top-up failed" },
      { status: credited.reason === "forbidden" ? 403 : 500, headers: auth.headers }
    );
  }

  const wallet = await readWorkspaceWallet(auth.admin, parsed.data.workspaceId);
  return NextResponse.json(
    { wallet, duplicate: credited.duplicate === true },
    { headers: auth.headers }
  );
}
