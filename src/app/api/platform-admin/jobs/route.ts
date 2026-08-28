import { platformAdminJson } from "@/lib/platform-admin/api-response";
import { parseLedgerParams } from "@/lib/platform-admin/ledger";
import { loadLiveJobs } from "@/lib/platform-admin/live-dashboard";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const params = parseLedgerParams(
    searchParams,
    ["when", "workspace", "kind", "status", "progress", "duration", "actor", "error"],
    { key: "when", dir: "desc" }
  );
  return platformAdminJson(async () => {
    const page = await loadLiveJobs({
      ...params,
      status: searchParams.get("status") || "all",
      kind: searchParams.get("kind") || "all",
      errorFilter: searchParams.get("error") || "all",
    });
    return {
      jobs: page.rows,
      total: page.total,
      page: page.page,
      pageSize: page.pageSize,
    };
  });
}
