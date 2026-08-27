import { platformAdminJson } from "@/lib/platform-admin/api-response";
import { loadLiveWalletTransactions } from "@/lib/platform-admin/live-dashboard";

export async function GET() {
  return platformAdminJson(async () => ({ transactions: await loadLiveWalletTransactions() }));
}
