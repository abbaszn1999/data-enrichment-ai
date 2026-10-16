import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAssistant } from "@/lib/assistant/gateway-auth";
import { listAgentProjects } from "@/lib/assistant/projects";
import { projectToolSchema } from "@/lib/assistant/protocol";
import { createClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  workspaceId: z.string().max(80),
  workspaceSlug: z.string().max(120),
  tool: projectToolSchema.optional(),
});

/** Read-only project list for the agent, scoped to the user's session and workspace. */
export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const access = await authorizeAssistant({
    workspaceId: parsed.data.workspaceId,
    workspaceSlug: parsed.data.workspaceSlug,
    requireCredits: false,
  });
  if (access instanceof NextResponse) return access;

  const projects = await listAgentProjects(await createClient(), parsed.data);
  return NextResponse.json({ projects });
}
