import { platformAdminJson } from "@/lib/platform-admin/api-response";
import { loadLiveIntegrations } from "@/lib/platform-admin/live-dashboard";

export async function GET() {
  return platformAdminJson(async () => loadLiveIntegrations());
}
