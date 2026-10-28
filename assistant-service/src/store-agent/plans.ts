import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanStatus } from "../../../src/lib/store-agent/protocol";
import { planTitle } from "./events";
import type { StoreAgentRun } from "./run";

/**
 * Plans from Plan mode (store_agent_plans). The agent writes one with
 * Cursor's createPlan; asking for changes writes it again, which revises the
 * chat's open plan (a new version) rather than starting another. Build runs
 * the latest version in Agent mode.
 */

type PlanRow = { id: string; title: string; content: string; version: number; status: PlanStatus };

const MAX_PLAN_CHARS = 100_000;

function emitPlan(run: StoreAgentRun, plan: PlanRow) {
  run.emit({ type: "plan", planId: plan.id, title: plan.title, content: plan.content, version: plan.version, status: plan.status });
}

/** Save the plan the agent just wrote: a new version of the chat's draft plan, or a new plan. */
export async function savePlan(db: SupabaseClient, run: StoreAgentRun, markdown: string): Promise<PlanRow> {
  const content = markdown.slice(0, MAX_PLAN_CHARS);
  const title = planTitle(content);
  const now = new Date().toISOString();
  const { data: draft } = await db
    .from("store_agent_plans")
    .select("id, version")
    .eq("chat_id", run.chatId)
    .eq("status", "draft")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const query = draft
    ? db
        .from("store_agent_plans")
        .update({ title, content, version: Number(draft.version) + 1, run_id: run.id, updated_at: now })
        .eq("id", draft.id)
    : db.from("store_agent_plans").insert({ chat_id: run.chatId, workspace_id: run.workspaceId, run_id: run.id, title, content });
  const { data, error } = await query.select("id, title, content, version, status").single();
  if (error || !data) throw new Error(`Could not save the plan: ${error?.message ?? "no row"}`);
  const plan = data as PlanRow;
  emitPlan(run, plan);
  return plan;
}

/** Mark a plan as being built by this run and return what to build. */
export async function startBuild(db: SupabaseClient, run: StoreAgentRun, planId: string): Promise<PlanRow> {
  const { data, error } = await db
    .from("store_agent_plans")
    .update({ status: "building", build_run_id: run.id, updated_at: new Date().toISOString() })
    .eq("id", planId)
    .eq("chat_id", run.chatId)
    .neq("status", "building")
    .select("id, title, content, version, status")
    .maybeSingle();
  if (error) throw new Error(`Could not start the plan: ${error.message}`);
  if (!data) throw new Error("This plan is not available to build (it may already be building).");
  const plan = data as PlanRow;
  emitPlan(run, plan);
  return plan;
}

/** After the Build run: built when it finished, otherwise back to draft so it can be built again. */
export async function finishBuild(db: SupabaseClient, run: StoreAgentRun, planId: string, finished: boolean): Promise<void> {
  const { data } = await db
    .from("store_agent_plans")
    .update({ status: finished ? "built" : "draft", updated_at: new Date().toISOString() })
    .eq("id", planId)
    .eq("build_run_id", run.id)
    .select("id, title, content, version, status")
    .maybeSingle();
  if (data) emitPlan(run, data as PlanRow);
}

/** What the agent receives when the user presses Build. */
export function buildMessage(plan: PlanRow): string {
  return (
    `Build this plan now, in Agent mode. It is the approved version ${plan.version} of "${plan.title}".\n\n` +
    "Carry it out step by step, exactly as written. Track its steps with updateTodos (one to-do per step, marked as you go). " +
    "If a step turns out to be impossible or wrong for the store as it is now, stop and explain instead of improvising a different change. " +
    "End with a short summary of what was done, with counts.\n\n" +
    `--- PLAN ---\n${plan.content}\n--- END OF PLAN ---`
  );
}
