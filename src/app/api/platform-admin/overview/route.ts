import { loadLiveOverview, parseOverviewRange } from "@/lib/platform-admin/live-dashboard";
import { platformAdminJson } from "@/lib/platform-admin/api-response";

export async function GET(req: Request) {
  const range = parseOverviewRange(new URL(req.url).searchParams.get("range"));
  return platformAdminJson(async () => loadLiveOverview(range));
}
