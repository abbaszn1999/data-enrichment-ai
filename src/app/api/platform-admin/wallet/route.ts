import { platformAdminJson } from "@/lib/platform-admin/api-response";
import { parseLedgerParams } from "@/lib/platform-admin/ledger";
import { loadLiveWalletTransactions } from "@/lib/platform-admin/live-dashboard";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const params = parseLedgerParams(
    searchParams,
    ["when", "workspace", "kind", "module", "description", "amount"],
    { key: "when", dir: "desc" }
  );
  return platformAdminJson(async () => {
    const page = await loadLiveWalletTransactions({
      ...params,
      kind: searchParams.get("kind") || "all",
      module: searchParams.get("module") || "all",
    });
    return {
      transactions: page.rows,
      total: page.total,
      page: page.page,
      pageSize: page.pageSize,
    };
  });
}
