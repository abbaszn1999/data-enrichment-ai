import type { Hono } from "hono";
import { MODEL_PRICING } from "../../../src/lib/store-agent/pricing";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  answerSchema,
  cancelSchema,
  decisionSchema,
  startRunSchema,
  steerSchema,
  type StoreAgentEvent,
} from "../../../src/lib/store-agent/protocol";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, USER_HEADER, verifyRequest } from "../auth";
import { FILES_BUCKET } from "./files";
import { cursorModels } from "./model-catalog";
import { searchStore, storeInsights } from "./insights";
import { UndoError, undoApproval } from "./undo";
import { StoreAgentBusyError, type StoreAgentRegistry, type StoreAgentRun } from "./run";
import { executeStoreRun, interruptedRuns, type StoreAgentDeps } from "./runner";

const encoder = new TextEncoder();

type Auth = { ok: true; userId: string; body: string } | { ok: false };

async function authenticate(secret: string, request: Request, pathname: string): Promise<Auth> {
  const body = request.method === "GET" ? "" : await request.text();
  const userId = request.headers.get(USER_HEADER) ?? undefined;
  const verdict = verifyRequest({
    secret,
    timestamp: request.headers.get(TIMESTAMP_HEADER) ?? undefined,
    signature: request.headers.get(SIGNATURE_HEADER) ?? undefined,
    userId,
    method: request.method,
    path: pathname,
    body,
  });
  return verdict.ok && userId ? { ok: true, userId, body } : { ok: false };
}

/** Any zod schema: the protocol's zod copy is not the service's, so type it structurally. */
type Schema<T> = { safeParse(input: unknown): { success: true; data: T } | { success: false } };

function parse<T>(schema: Schema<T>, body: string): T | null {
  try {
    const result = schema.safeParse(JSON.parse(body));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** NDJSON stream of a run's events after `afterSeq`. Closing it never stops the run. */
function streamRun(run: StoreAgentRun, afterSeq: number): Response {
  let unsubscribe: (() => void) | null = null;
  let keepAlive: NodeJS.Timeout | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        if (keepAlive) clearInterval(keepAlive);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      const send = (event: StoreAgentEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          close();
          return;
        }
        if (event.type === "done") setTimeout(close, 0);
      };
      unsubscribe = run.subscribe(send, afterSeq);
      if (run.finished && !run.history.some((e) => e.type === "done" && e.seq > afterSeq)) close();
      keepAlive = setInterval(() => send({ type: "ping", seq: run.lastSeq }), 10_000);
      keepAlive.unref?.();
    },
    cancel() {
      unsubscribe?.();
      if (keepAlive) clearInterval(keepAlive);
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  });
}

export type StoreAgentRouteDeps = StoreAgentDeps & { secret: string };

export function mountStoreAgentRoutes(app: Hono, deps: StoreAgentRouteDeps) {
  const { registry, secret, db, log } = deps;
  const owned = (runId: string, userId: string) => {
    const run = registry.get(runId);
    return run && run.userId === userId ? run : null;
  };

  app.post("/store-agent/runs", async (c) => {
    const auth = await authenticate(secret, c.req.raw, "/store-agent/runs");
    if (!auth.ok) return c.json({ error: "unauthorized" }, 401);
    const request = parse(startRunSchema, auth.body);
    if (!request || request.userId !== auth.userId) return c.json({ error: "bad request" }, 400);
    let run: StoreAgentRun;
    try {
      run = registry.create(request);
    } catch (error) {
      if (error instanceof StoreAgentBusyError) return c.json({ error: error.message }, 429);
      throw error;
    }
    // The run belongs to the service, not to this connection.
    void executeStoreRun(deps, run).catch((error) => log(`store run ${run.id} crashed`, error));
    return streamRun(run, 0);
  });

  app.get("/store-agent/runs/:runId/stream", async (c) => {
    const runId = c.req.param("runId");
    const auth = await authenticate(secret, c.req.raw, `/store-agent/runs/${runId}/stream`);
    if (!auth.ok) return c.json({ error: "unauthorized" }, 401);
    const run = owned(runId, auth.userId);
    if (!run) return c.json({ error: "not found" }, 404);
    const after = Math.max(0, Number(c.req.query("after")) || 0);
    return streamRun(run, after);
  });

  app.get("/store-agent/chats/:chatId/live", async (c) => {
    const chatId = c.req.param("chatId");
    const auth = await authenticate(secret, c.req.raw, `/store-agent/chats/${chatId}/live`);
    if (!auth.ok) return c.json({ error: "unauthorized" }, 401);
    const run = registry.forChat(chatId);
    if (!run || run.userId !== auth.userId) return c.json({ run: null });
    return c.json({ run: { runId: run.id, lastSeq: run.lastSeq, waiting: run.waitingOnUser, startedAt: run.startedAt } });
  });

  app.post("/store-agent/runs/cancel", async (c) => {
    const auth = await authenticate(secret, c.req.raw, "/store-agent/runs/cancel");
    if (!auth.ok) return c.json({ error: "unauthorized" }, 401);
    const body = parse(cancelSchema, auth.body);
    const run = body && owned(body.runId, auth.userId);
    if (!run) return c.json({ error: "not found" }, 404);
    run.cancel();
    return c.json({ ok: true });
  });

  app.post("/store-agent/runs/steer", async (c) => {
    const auth = await authenticate(secret, c.req.raw, "/store-agent/runs/steer");
    if (!auth.ok) return c.json({ error: "unauthorized" }, 401);
    const body = parse(steerSchema, auth.body);
    const run = body && owned(body.runId, auth.userId);
    if (!run || run.finished) return c.json({ error: "not found" }, 404);
    // Queued first, so it reaches the agent even if the SDK hands it back;
    // the SDK's answer can wait for the end of the turn, so it is not awaited.
    const id = run.addGuidance(body.text);
    void run
      .steer?.(body.text)
      .then((outcome) => {
        if (outcome === "complete_delivered") run.guidanceDelivered(id);
      })
      .catch(() => undefined);
    return c.json({ ok: true, delivered: true });
  });

  app.post("/store-agent/approvals", async (c) => {
    const auth = await authenticate(secret, c.req.raw, "/store-agent/approvals");
    if (!auth.ok) return c.json({ error: "unauthorized" }, 401);
    const body = parse(decisionSchema, auth.body);
    const run = body && owned(body.runId, auth.userId);
    if (!run) return c.json({ error: "not found" }, 404);
    return c.json({ ok: run.decide(body.approvalId, body.approve) });
  });

  app.post("/store-agent/questions", async (c) => {
    const auth = await authenticate(secret, c.req.raw, "/store-agent/questions");
    if (!auth.ok) return c.json({ error: "unauthorized" }, 401);
    const body = parse(answerSchema, auth.body);
    const run = body && owned(body.runId, auth.userId);
    if (!run) return c.json({ error: "not found" }, 404);
    return c.json({ ok: run.answer(body.questionId, body.answers) });
  });

  app.post("/store-agent/approvals/undo", async (c) => {
    const auth = await authenticate(secret, c.req.raw, "/store-agent/approvals/undo");
    if (!auth.ok) return c.json({ error: "unauthorized" }, 401);
    let approvalId = "";
    try {
      approvalId = String((JSON.parse(auth.body) as { approvalId?: unknown }).approvalId ?? "");
    } catch {
      approvalId = "";
    }
    if (!/^[0-9a-f-]{36}$/i.test(approvalId)) return c.json({ error: "bad request" }, 400);
    try {
      return c.json(await undoApproval(db, { approvalId, userId: auth.userId }));
    } catch (error) {
      if (error instanceof UndoError) return c.json({ error: error.message }, error.status as 404 | 409);
      log(`undo ${approvalId} failed`, error);
      // Undo writes saved values back, so a second try finishes a half-done one safely.
      return c.json({ error: "The undo was interrupted before it finished. Try again to complete it." }, 500);
    }
  });

  // The workspace is in the (signed) path; the gateway checked the user may use it.
  app.get("/store-agent/insights/:workspaceId", async (c) => {
    const workspaceId = c.req.param("workspaceId");
    const auth = await authenticate(secret, c.req.raw, `/store-agent/insights/${workspaceId}`);
    if (!auth.ok) return c.json({ error: "unauthorized" }, 401);
    if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) return c.json({ error: "bad request" }, 400);
    try {
      return c.json(await storeInsights(db, workspaceId));
    } catch (error) {
      log("insights failed", error);
      return c.json({ insights: [], scanned: 0, totalProducts: 0 });
    }
  });

  app.get("/store-agent/search/:workspaceId", async (c) => {
    const workspaceId = c.req.param("workspaceId");
    const auth = await authenticate(secret, c.req.raw, `/store-agent/search/${workspaceId}`);
    if (!auth.ok) return c.json({ error: "unauthorized" }, 401);
    if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) return c.json({ error: "bad request" }, 400);
    try {
      return c.json({ results: await searchStore(db, workspaceId, c.req.query("q") ?? "") });
    } catch (error) {
      log("search failed", error);
      return c.json({ results: [] });
    }
  });

  app.get("/store-agent/models", async (c) => {
    const auth = await authenticate(secret, c.req.raw, "/store-agent/models");
    if (!auth.ok) return c.json({ error: "unauthorized" }, 401);
    try {
      return c.json({ models: await modelCatalog(deps.cursorApiKey) });
    } catch (error) {
      log("model catalog failed", error);
      return c.json({ error: "Model list unavailable" }, 503);
    }
  });

  app.post("/store-agent/chats/delete", async (c) => {
    const auth = await authenticate(secret, c.req.raw, "/store-agent/chats/delete");
    if (!auth.ok) return c.json({ error: "unauthorized" }, 401);
    let chatId: string | null = null;
    try {
      chatId = String((JSON.parse(auth.body) as { chatId?: unknown }).chatId ?? "") || null;
    } catch {
      chatId = null;
    }
    if (!chatId) return c.json({ error: "bad request" }, 400);
    const { data: chat } = await db.from("store_agent_chats").select("id, user_id, workspace_id, cursor_agent_id").eq("id", chatId).maybeSingle();
    if (!chat || chat.user_id !== auth.userId) return c.json({ error: "not found" }, 404);
    registry.forChat(chatId)?.cancel();
    try {
      await deleteChatData(deps, chat as { id: string; workspace_id: string; cursor_agent_id: string | null });
    } catch (error) {
      log(`deleting chat ${chatId} failed`, error);
      return c.json({ error: "Could not delete the chat" }, 500);
    }
    return c.json({ ok: true });
  });
}

export type CatalogModel = {
  id: string;
  displayName: string;
  parameters: Array<{ id: string; displayName: string; values: Array<{ value: string; displayName: string }> }>;
};

/** The models we price, with the params Cursor offers for each (the shared hourly list). */
async function modelCatalog(apiKey: string): Promise<CatalogModel[]> {
  const list = await cursorModels(apiKey);
  return list
    .filter((m) => MODEL_PRICING[m.id])
    .map((m) => ({
      id: m.id,
      displayName: m.displayName,
      parameters: (m.parameters ?? []).map((p) => ({
        id: p.id,
        displayName: p.displayName ?? p.id,
        values: (p.values ?? []).map((v) => ({ value: v.value, displayName: (v.displayName ?? v.value).replace(/​/g, "") })),
      })),
    }));
}

/** Delete every object under a folder (Storage lists one level at a time). */
async function removePrefix(db: SupabaseClient, bucket: string, prefix: string) {
  for (let pass = 0; pass < 100; pass++) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 1000 });
    if (error || !data?.length) return;
    for (const folder of data.filter((d) => d.id === null)) await removePrefix(db, bucket, `${prefix}/${folder.name}`);
    const files = data.filter((d) => d.id !== null).map((d) => `${prefix}/${d.name}`);
    if (files.length) {
      const { error: removeError } = await db.storage.from(bucket).remove(files);
      if (removeError) throw new Error(removeError.message);
    }
    if (data.length < 1000) return;
  }
}

/** Remove a chat everywhere: agent memory, files and rows. */
export async function deleteChatData(
  deps: Pick<StoreAgentDeps, "db" | "store">,
  chat: { id: string; workspace_id: string; cursor_agent_id: string | null }
) {
  if (chat.cursor_agent_id) await deps.store.deleteAgentsEverywhere([chat.cursor_agent_id]);
  await removePrefix(deps.db, FILES_BUCKET, `${chat.workspace_id}/${chat.id}`);
  const { error } = await deps.db.from("store_agent_chats").delete().eq("id", chat.id);
  if (error) throw new Error(error.message);
}

/**
 * Housekeeping on start and every hour:
 * - runs left "running" by a process that died are marked interrupted;
 * - agents and files of deleted workspaces are removed (Storage has no cascade).
 */
export async function sweepStoreAgent(
  deps: Pick<StoreAgentDeps, "db" | "store" | "registry" | "log">,
  opts: { startup: boolean }
) {
  const { db, store, registry, log } = deps;
  try {
    if (opts.startup) {
      const live = new Set(registry.live.map((r) => r.id));
      const { data: stale } = await db.from("store_agent_runs").select("id, chat_id").eq("status", "running");
      for (const row of stale ?? []) {
        if (live.has(row.id)) continue;
        await db.from("store_agent_runs").update({ status: "interrupted", finished_at: new Date().toISOString() }).eq("id", row.id);
        await db.from("store_agent_chats").update({ status: "interrupted" }).eq("id", row.chat_id);
      }
      await db
        .from("store_agent_approvals")
        .update({ status: "expired", decided_at: new Date().toISOString() })
        .eq("status", "pending");
      // A plan whose Build was cut off can be built again.
      await db.from("store_agent_plans").update({ status: "draft" }).eq("status", "building");
    }

    const { data: orphans } = await db.from("agent_store_agents").select("agent_id").is("workspace_id", null).limit(200);
    if (orphans?.length) await store.deleteAgentsEverywhere(orphans.map((o) => o.agent_id as string));

    const { data: folders } = await db.storage.from(FILES_BUCKET).list("", { limit: 1000 });
    const ids = (folders ?? []).filter((f) => f.id === null).map((f) => f.name);
    if (ids.length) {
      const { data: existing } = await db.from("workspaces").select("id").in("id", ids);
      const keep = new Set((existing ?? []).map((w) => w.id as string));
      for (const id of ids) if (!keep.has(id)) await removePrefix(db, FILES_BUCKET, id);
    }
  } catch (error) {
    log("store agent sweep failed", error);
  }
}

/** Deploy or shutdown: stop live runs as "interrupted" and let them settle. */
export async function shutdownStoreAgent(deps: Pick<StoreAgentDeps, "store" | "registry" | "log">, timeoutMs = 25_000) {
  const live = deps.registry.live;
  for (const run of live) {
    interruptedRuns.add(run);
    run.cancel();
  }
  const deadline = Date.now() + timeoutMs;
  while (deps.registry.live.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
  await deps.store.flush().catch((error) => deps.log("shutdown flush failed", error));
}
