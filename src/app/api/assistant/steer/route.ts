import { z } from "zod";
import { forwardRunCall } from "@/lib/assistant/forward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ runId: z.string().max(80), text: z.string().min(1).max(2000) });

export async function POST(request: Request) {
  return forwardRunCall(request, "/runs/steer", schema);
}
