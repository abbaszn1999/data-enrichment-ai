import { platformAdminJson } from "@/lib/platform-admin/api-response";
import { loadLiveJobs } from "@/lib/platform-admin/live-dashboard";

export async function GET() {
  return platformAdminJson(async () => ({ jobs: await loadLiveJobs() }));
}
