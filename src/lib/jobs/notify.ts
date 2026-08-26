import { createAdminClient } from "@/lib/supabase-admin";
import { jobHref, jobKindLabel } from "./href";
import type { JobRunRecord, NotificationEvent } from "./types";

type Admin = ReturnType<typeof createAdminClient>;

function messageFor(run: JobRunRecord, event: NotificationEvent): { title: string; body: string } {
  const tool = jobKindLabel(run.kind);
  const session = String(run.settings.sessionName || "Untitled session");
  const total = run.target_ids.length;
  const done = run.completed_count;
  const failed = run.failed_count;

  if (event === "completed") {
    return {
      title: `${tool} finished`,
      body: `${session}: ${done} of ${total} succeeded${failed ? `, ${failed} failed` : ""}.`,
    };
  }
  if (event === "paused_no_credits") {
    return {
      title: `${tool} paused`,
      body: `${session} ran out of credits. Open the session to resume.`,
    };
  }
  return {
    title: `${tool} failed`,
    body: `${session}: ${run.last_error || "Something went wrong."}`,
  };
}

export async function notifyJobEvent(
  run: JobRunRecord,
  event: NotificationEvent,
  admin: Admin = createAdminClient()
): Promise<void> {
  if (event !== "completed" && event !== "failed" && event !== "paused_no_credits") {
    return;
  }
  const slug = String(run.settings.workspaceSlug || "");
  const href = slug
    ? jobHref({ kind: run.kind, workspaceSlug: slug, sessionId: run.session_id })
    : "/";
  const { title, body } = messageFor(run, event);

  const { error } = await admin.from("notifications").insert({
    workspace_id: run.workspace_id,
    user_id: run.created_by,
    job_run_id: run.id,
    event,
    title,
    body,
    href,
  });

  if (error) {
    if (/duplicate|unique/i.test(error.message)) return;
    console.error("[jobs/notify] insert failed:", error.message);
  }
}

export async function notifyIfMissing(
  run: JobRunRecord,
  admin: Admin = createAdminClient()
): Promise<void> {
  if (run.status !== "completed" && run.status !== "failed" && run.status !== "paused_no_credits") {
    return;
  }
  const { data, error } = await admin
    .from("notifications")
    .select("id")
    .eq("job_run_id", run.id)
    .eq("event", run.status)
    .maybeSingle();
  if (error) {
    console.error("[jobs/notify] lookup failed:", error.message);
    return;
  }
  if (data) return;
  await notifyJobEvent(run, run.status, admin);
}
