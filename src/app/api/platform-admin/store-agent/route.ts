import { platformAdminJson } from "@/lib/platform-admin/api-response";
import { createAdminClient } from "@/lib/supabase-admin";

const WINDOWS: Record<string, number> = { "24h": 1, "7d": 7, "30d": 30 };

type RunRow = {
  id: string;
  workspace_id: string;
  chat_id: string;
  model_id: string;
  status: string;
  error: string | null;
  usd: number | string;
  credits: number | string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  started_at: string;
  finished_at: string | null;
};

/** Store Agent health for platform admins: volume, failures, cost by model, recent problems. */
export async function GET(req: Request) {
  return platformAdminJson(async () => {
    const window = new URL(req.url).searchParams.get("window") ?? "7d";
    const days = WINDOWS[window] ?? 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const admin = createAdminClient();

    const { data, error } = await admin
      .from("store_agent_runs")
      .select("id, workspace_id, chat_id, model_id, status, error, usd, credits, input_tokens, output_tokens, cache_read_tokens, started_at, finished_at")
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .limit(10_000);
    if (error) throw new Error(error.message);
    const runs = (data ?? []) as RunRow[];

    const byStatus: Record<string, number> = {};
    const byModel = new Map<string, { runs: number; credits: number; usd: number; inputTokens: number; cacheReadTokens: number; outputTokens: number; errors: number }>();
    let durationTotal = 0;
    let durationCount = 0;
    for (const r of runs) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      const m = byModel.get(r.model_id) ?? { runs: 0, credits: 0, usd: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, errors: 0 };
      m.runs += 1;
      m.credits += Number(r.credits) || 0;
      m.usd += Number(r.usd) || 0;
      m.inputTokens += r.input_tokens ?? 0;
      m.cacheReadTokens += r.cache_read_tokens ?? 0;
      m.outputTokens += r.output_tokens ?? 0;
      if (r.status === "error") m.errors += 1;
      byModel.set(r.model_id, m);
      if (r.finished_at) {
        durationTotal += new Date(r.finished_at).getTime() - new Date(r.started_at).getTime();
        durationCount += 1;
      }
    }

    const workspaceIds = [...new Set(runs.filter((r) => r.status === "error" || r.status === "interrupted").slice(0, 50).map((r) => r.workspace_id))];
    const { data: workspaces } = workspaceIds.length
      ? await admin.from("workspaces").select("id, name").in("id", workspaceIds)
      : { data: [] as Array<{ id: string; name: string }> };
    const names = new Map((workspaces ?? []).map((w) => [w.id as string, w.name as string]));

    const { count: activeChats } = await admin.from("store_agent_chats").select("id", { count: "exact", head: true }).gte("last_activity_at", since);
    const { count: changes } = await admin.from("store_agent_audit_log").select("id", { count: "exact", head: true }).gte("created_at", since);

    return {
      window,
      totals: {
        runs: runs.length,
        workspaces: new Set(runs.map((r) => r.workspace_id)).size,
        chats: activeChats ?? 0,
        storeChanges: changes ?? 0,
        credits: runs.reduce((s, r) => s + (Number(r.credits) || 0), 0),
        usd: runs.reduce((s, r) => s + (Number(r.usd) || 0), 0),
        avgDurationMs: durationCount ? Math.round(durationTotal / durationCount) : null,
        cacheHitRatio: (() => {
          const input = runs.reduce((s, r) => s + (r.input_tokens ?? 0), 0);
          const cached = runs.reduce((s, r) => s + (r.cache_read_tokens ?? 0), 0);
          return input ? cached / input : null;
        })(),
      },
      byStatus,
      byModel: [...byModel].map(([model, v]) => ({ model, ...v })).sort((a, b) => b.runs - a.runs),
      problems: runs
        .filter((r) => r.status === "error" || r.status === "interrupted")
        .slice(0, 50)
        .map((r) => ({
          id: r.id,
          status: r.status,
          error: r.error,
          model: r.model_id,
          workspace: names.get(r.workspace_id) ?? r.workspace_id,
          startedAt: r.started_at,
        })),
    };
  });
}
