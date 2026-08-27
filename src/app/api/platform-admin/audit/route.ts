import { platformAdminJson } from "@/lib/platform-admin/api-response";
import { loadLiveAudit } from "@/lib/platform-admin/live-dashboard";

export async function GET() {
  return platformAdminJson(async () => ({ events: await loadLiveAudit() }));
}
