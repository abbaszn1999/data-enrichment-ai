import { platformAdminJson } from "@/lib/platform-admin/api-response";
import { parseLedgerParams } from "@/lib/platform-admin/ledger";
import { loadLiveAudit } from "@/lib/platform-admin/live-dashboard";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const params = parseLedgerParams(
    searchParams,
    ["when", "user", "workspace", "action", "entity"],
    { key: "when", dir: "desc" }
  );
  return platformAdminJson(async () => {
    const page = await loadLiveAudit({
      ...params,
      entity: searchParams.get("entity") || "all",
    });
    return {
      events: page.rows,
      total: page.total,
      page: page.page,
      pageSize: page.pageSize,
      entityTypes: page.entityTypes,
    };
  });
}
