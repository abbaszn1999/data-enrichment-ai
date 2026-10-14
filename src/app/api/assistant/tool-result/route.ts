import { forwardRunCall } from "@/lib/assistant/forward";
import { toolResultSchema } from "@/lib/assistant/protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return forwardRunCall(request, "/runs/tool-result", toolResultSchema);
}
