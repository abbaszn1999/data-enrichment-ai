import { z } from "zod";
import { forwardRunCall } from "@/lib/assistant/forward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ runId: z.string().max(80) });

export async function POST(request: Request) {
  return forwardRunCall(request, "/runs/cancel", schema);
}
