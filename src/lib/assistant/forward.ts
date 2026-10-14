import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { createClient } from "@/lib/supabase-server";
import { callAssistantService, isAssistantEnabled } from "./service-client";

/**
 * Forward a browser call about a live run (tool result, cancel, steer) to the
 * service. The service checks that the signed user owns the run, so only the
 * cookie session is needed here.
 */
export async function forwardRunCall<T>(request: Request, servicePath: string, schema: ZodType<T>): Promise<NextResponse> {
  if (!isAssistantEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  try {
    const response = await callAssistantService({ path: servicePath, userId: user.id, body: parsed.data });
    const data = await response.json().catch(() => ({}));
    return NextResponse.json(data, { status: response.ok ? 200 : response.status === 404 ? 404 : 502 });
  } catch {
    return NextResponse.json({ error: "The assistant is not available right now." }, { status: 503 });
  }
}
