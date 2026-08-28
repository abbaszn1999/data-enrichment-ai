import { platformAdminJson } from "@/lib/platform-admin/api-response";
import { parseLedgerParams } from "@/lib/platform-admin/ledger";
import { loadLiveCredits } from "@/lib/platform-admin/live-dashboard";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const params = parseLedgerParams(
    searchParams,
    ["when", "user", "workspace", "operation", "credits"],
    { key: "when", dir: "desc" }
  );
  return platformAdminJson(async () => {
    const page = await loadLiveCredits({
      ...params,
      operation: searchParams.get("operation") || "all",
      direction: searchParams.get("direction") || "all",
    });
    return {
      transactions: page.rows,
      total: page.total,
      page: page.page,
      pageSize: page.pageSize,
    };
  });
}
