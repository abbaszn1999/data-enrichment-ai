import { createAdminClient } from "@/lib/supabase-admin";
import { isJobCancelRequested } from "./repo";

type Admin = ReturnType<typeof createAdminClient>;

/** Stop was requested for this run, either on the job or on the session. */
export async function isVisualizerCancelled(
  admin: Admin,
  runId: string,
  sessionId: string,
  workspaceId: string
): Promise<boolean> {
  if (await isJobCancelRequested(admin, runId)) return true;
  const { data, error } = await admin
    .from("visualizer_sessions")
    .select("cancel_requested")
    .eq("id", sessionId)
    .eq("workspace_id", workspaceId)
    .single();
  if (error) throw error;
  return Boolean(data?.cancel_requested);
}
