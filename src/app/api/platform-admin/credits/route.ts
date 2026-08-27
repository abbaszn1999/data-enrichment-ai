import { platformAdminJson } from "@/lib/platform-admin/api-response";
import { loadLiveCredits } from "@/lib/platform-admin/live-dashboard";

export async function GET() {
  return platformAdminJson(async () => ({ transactions: await loadLiveCredits() }));
}
