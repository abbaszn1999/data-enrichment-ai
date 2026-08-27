import { platformAdminJson } from "@/lib/platform-admin/api-response";
import { loadLiveSubscriptions } from "@/lib/platform-admin/live-dashboard";

export async function GET() {
  return platformAdminJson(async () => ({ subscriptions: await loadLiveSubscriptions() }));
}
