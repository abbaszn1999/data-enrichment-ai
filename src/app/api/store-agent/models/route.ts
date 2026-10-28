import { NextRequest, NextResponse } from "next/server";
import { authorizeStoreAgent, callStoreAgentService } from "@/lib/store-agent/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CatalogModel = {
  id: string;
  displayName: string;
  parameters: Array<{ id: string; displayName: string; values: Array<{ value: string; displayName: string }> }>;
};

let cache: { at: number; models: CatalogModel[] } | null = null;

/**
 * The models customers can pick, in the platform's order, each with the
 * params Cursor offers (Fast, Context, Effort…), plus the user's preferences.
 */
export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? "";
  const access = await authorizeStoreAgent({ workspaceId });
  if (access instanceof NextResponse) return access;

  if (!cache || Date.now() - cache.at > 10 * 60 * 1000) {
    try {
      const res = await callStoreAgentService({ path: "/store-agent/models", userId: access.userId, method: "GET" });
      if (res.ok) cache = { at: Date.now(), models: ((await res.json()) as { models: CatalogModel[] }).models };
    } catch {
      // keep the old cache, if any
    }
  }
  const [{ data: enabled }, { data: prefs }] = await Promise.all([
    access.admin.from("store_agent_models").select("model_id, display_name, is_default, sort, default_params").eq("enabled", true).order("sort"),
    access.admin.from("store_agent_prefs").select("auto_run, model_id, model_params").eq("workspace_id", workspaceId).eq("user_id", access.userId).maybeSingle(),
  ]);
  const catalog = new Map((cache?.models ?? []).map((m) => [m.id, m]));
  const models = (enabled ?? []).map((m) => ({
    id: m.model_id as string,
    displayName: (m.display_name as string) || catalog.get(m.model_id as string)?.displayName || (m.model_id as string),
    isDefault: m.is_default === true,
    defaultParams: m.default_params ?? [],
    parameters: catalog.get(m.model_id as string)?.parameters ?? [],
  }));
  return NextResponse.json({
    models,
    prefs: { autoRun: prefs?.auto_run === true, modelId: prefs?.model_id ?? null, modelParams: prefs?.model_params ?? null },
  });
}
