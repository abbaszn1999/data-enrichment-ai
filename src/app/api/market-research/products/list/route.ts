import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  jsonError,
  projectIdSchema,
  requireMrRead,
  workspaceIdSchema,
} from "@/lib/market-research/api-schema";
import { loadProjectProducts } from "@/lib/market-research/storage-admin";

// Read-only display endpoint for panels that need real product records
// (images, price, title) for already-matched product ids — e.g. the Tab 5
// collections sheet. Never persisted back through client autosave: this is
// a snapshot for rendering, not the source of truth (that lives in the
// sharded `products-shards/` store written by `/products/fetch`).
export const maxDuration = 30;

const querySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
});

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    workspaceId: searchParams.get("workspaceId"),
    projectId: searchParams.get("projectId"),
  });
  if (!parsed.success) {
    return jsonError("Invalid query", 400);
  }

  const auth = await requireMrRead(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  try {
    const products = await loadProjectProducts(
      auth.admin,
      parsed.data.workspaceId,
      parsed.data.projectId
    );
    return NextResponse.json({ products }, { headers: auth.headers });
  } catch (err) {
    console.error("[api/market-research/products/list] Error:", err);
    const msg = err instanceof Error ? err.message : "Failed to load products";
    return jsonError(msg, 500);
  }
}
