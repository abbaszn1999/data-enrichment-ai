import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Agent, type AgentOptions, type Run, type RunResult, type SDKAgent, type SDKUserMessage, type SendOptions, type ToolName } from "@cursor/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { STORE_AGENT_LIMITS, type TodoItem } from "../../../src/lib/store-agent/protocol";
import { emptyReply, reduceReply, replyText, type ReplyState } from "../../../src/lib/store-agent/blocks";
import { MemoryAgentStoreBackend } from "./agent-store/memory-backend";
import { WriteBehindAgentStore } from "./agent-store/write-behind-store";
import { chargeRun } from "./billing/charge";
import { IMAGE_GENERATION_USD, contextWindowFor, estimateUsd, usdToCredits, type TokenUsage } from "../../../src/lib/store-agent/pricing";
import { describeTool, mapTodos, mergeTodos, scrub, summarizeResult, unwrapToolCall, webCallsInMessages } from "./events";
import { oncePerToolCall } from "./call-once";
import { guidanceText, withGuidance } from "./guidance";
import { buildMessage, finishBuild, savePlan, startBuild } from "./plans";
import { createFileTools } from "./file-tools";
import { ChatFiles } from "./files";
import { veraRule } from "./instructions";
import type { StoreAgentRegistry, StoreAgentRun } from "./run";
import { createScriptTool } from "./script-tool";
import { loadShopifyConnection, type ShopifyConnection } from "./shopify/client";
import { storePlatform } from "./store-connection";
import { loadWooConnection, type WooConnection } from "./woocommerce/client";
import { createStoreAgentTools } from "./tools";

/**
 * Cursor tools the agent gets. File access goes through our confined tools
 * instead of read/edit/grep/ls. No `task`: sub-agents report no token usage,
 * so their cost could not be billed.
 */
const WEB_SCAN_EVERY_MS = 1500;
const BUILTIN_TOOLS: ToolName[] = ["mcp", "webSearch", "webFetch", "generateImage", "updateTodos", "readTodos"];
/** A run that makes this many tool calls is stopped (runaway loops, surprise bills). */
const MAX_TOOL_CALLS = 200;
const PROGRESS_EVERY_MS = 1_500;
/** Thinking kept in the saved reply; the full text is only useful live. */
const MAX_SAVED_THINKING = 4_000;
const CHECKPOINT_EVERY_MS = 15_000;
const SAVE_DEBOUNCE_MS = 1_500;

export type StoreAgentDeps = {
  db: SupabaseClient;
  store: WriteBehindAgentStore;
  registry: StoreAgentRegistry;
  cursorApiKey: string;
  /** Parent folder of every chat's working folder. */
  workRoot: string;
  log: (message: string, extra?: unknown) => void;
};

/** Marks a run stopped by a deploy or shutdown rather than by the user. */
export const interruptedRuns = new WeakSet<StoreAgentRun>();

function titleFrom(message: string): string {
  const line = message.replace(/\s+/g, " ").trim();
  return line.length > 60 ? `${line.slice(0, 59)}…` : line || "New chat";
}

function isMissingAgent(error: unknown): boolean {
  return error instanceof Error && /not found/i.test(error.message);
}

async function loadStoreNotes(db: SupabaseClient, workspaceId: string): Promise<string> {
  const { data } = await db.from("store_agent_notes").select("content").eq("workspace_id", workspaceId).maybeSingle();
  return String(data?.content ?? "").trim();
}

const TITLE_MODEL = { id: "composer-2.5", params: [{ id: "fast", value: "false" }] };

/**
 * A 2–6 word title in the chat's language, from the first exchange. Runs a
 * throwaway agent with no tools and an in-memory store; its cost is added
 * to the run.
 */
async function generateTitle(apiKey: string, message: string, reply: string): Promise<{ title: string; usd: number } | null> {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "sa-title-"));
  const agent = await Agent.create({
    apiKey,
    model: TITLE_MODEL,
    tools: [],
    local: { cwd: workDir, settingSources: [], store: new WriteBehindAgentStore(new MemoryAgentStoreBackend()) },
  });
  try {
    const run = await agent.send(
      `Write a title of 2 to 6 words for this chat, in the same language as the user's message. Reply with the title only, no quotes or punctuation at the end.\n\nUser: ${message.slice(0, 1500)}\n\nAssistant: ${reply.slice(0, 1500)}`
    );
    const result = await run.wait();
    const title = String(result.result ?? "").replace(/["'«»“”]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
    const usage = result.usage;
    const usd = usage
      ? estimateUsd(TITLE_MODEL.id, TITLE_MODEL.params, {
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          cacheReadTokens: usage.cacheReadTokens ?? 0,
          cacheWriteTokens: usage.cacheWriteTokens ?? 0,
        })
      : 0;
    return title ? { title, usd } : null;
  } finally {
    await agent[Symbol.asyncDispose]().catch(() => undefined);
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * What the customer sees when a run fails. Problems with our own model
 * account (billing, quota, rate limits) are not theirs to fix, so they get a
 * plain "temporarily unavailable" and the real reason stays in the run record.
 */
export function customerMessage(internal: string): string {
  if (isAgentExhausted(internal)) {
    // The agent is replaced for the next message (see retireAgent), so continuing works at once.
    return "The agent was interrupted before it finished. Send \"continue\" and it will pick up from where the store is now.";
  }
  if (/unpaid invoice|billing|payment|quota|rate.?limit|usage limit|too many requests|overloaded|capacity/i.test(internal)) {
    return "The Store Agent is temporarily unavailable. Please try again in a few minutes.";
  }
  if (/Network request failed|Connection failed|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|CONNECT_TIMEOUT/i.test(internal)) {
    return "The connection to the agent dropped. Please send your message again.";
  }
  if (/context.*(too long|length|window)|prompt is too long|maximum context/i.test(internal)) {
    return "This chat has grown too long for the selected model. Start a new chat or pick a model with a larger context.";
  }
  return "The agent ran into a problem. Please try again.";
}

/** A request to Cursor that never got through (connect timeout, reset, DNS), safe to send again. */
export function isNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if ((error as { isRetryable?: unknown }).isRetryable === true) return true;
  const text = `${error.name} ${error.message} ${String((error as { cause?: unknown }).cause ?? "")}`;
  return /NetworkError|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|socket hang up/i.test(text);
}

/** Cursor's per-minute request limits (for example 30 a minute on the model list). */
export function isRateLimited(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "RateLimitError" || /rate limit/i.test(error.message);
}

const NETWORK_RETRY_DELAYS_MS = [1_000, 3_000, 8_000];
/** A per-minute limit clears within the minute. */
const RATE_LIMIT_RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000];

/**
 * Preparing the agent (resume/create) talks to Cursor before any work starts,
 * so a request that failed on the network, or hit a per-minute limit, can
 * simply be made again.
 */
async function retryOnNetwork<T>(fn: () => Promise<T>, run: StoreAgentRun, log: (message: string, extra?: unknown) => void): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const limited = isRateLimited(error);
      const delay = (limited ? RATE_LIMIT_RETRY_DELAYS_MS : NETWORK_RETRY_DELAYS_MS)[attempt];
      if (delay === undefined || run.cancelled || !(limited || isNetworkFailure(error))) throw error;
      log(`${limited ? "Cursor rate limit" : "network error reaching Cursor"}, retry ${attempt + 1} in ${delay / 1000}s: ${(error as Error).message}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Changes the user undid (from the cards, outside the conversation) since the
 * previous run started, so the agent does not answer from stale memory.
 */
async function undoneSinceLastRun(db: SupabaseClient, chatId: string, currentRunId: string): Promise<string[]> {
  const { data: previous } = await db
    .from("store_agent_runs")
    .select("started_at")
    .eq("chat_id", chatId)
    .neq("id", currentRunId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!previous?.started_at) return [];
  const { data } = await db
    .from("store_agent_approvals")
    .select("summary")
    .eq("chat_id", chatId)
    .gte("undone_at", previous.started_at)
    .order("undone_at")
    .limit(20);
  return (data ?? []).map((a) => String(a.summary).slice(0, 200));
}

/**
 * When the previous run in this chat stopped before finishing (an error, a
 * stop, a restart), the store changes it had already made, so the agent does
 * not make them twice when the user says "continue".
 */
async function appliedByUnfinishedRun(db: SupabaseClient, chatId: string, currentRunId: string): Promise<{ status: string; changes: string[] } | null> {
  const { data: previous } = await db
    .from("store_agent_runs")
    .select("id, status")
    .eq("chat_id", chatId)
    .neq("id", currentRunId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!previous || previous.status === "finished") return null;
  const { data } = await db
    .from("store_agent_approvals")
    .select("summary")
    .eq("run_id", previous.id)
    .not("applied_at", "is", null)
    .order("created_at")
    .limit(30);
  return { status: String(previous.status), changes: (data ?? []).map((a) => String(a.summary).slice(0, 200)) };
}

/** Cursor refuses further work on some agents ("resource_exhausted") while a fresh one works: replace it. */
export function isAgentExhausted(message: string): boolean {
  return /resource_exhausted/i.test(message);
}

/**
 * The model was temporarily at capacity (Cursor: "this wasn't a limit on your
 * key… treat this error as retryable"). SDK 1.1+ reports it as the error code.
 */
export function isCapacityError(error: { message?: string; code?: string } | undefined): boolean {
  return error?.code === "resource_exhausted" || /resource_exhausted/i.test(error?.message ?? "");
}

/** Waits before continuing a run whose model was at capacity. */
const CAPACITY_RETRY_DELAYS_MS = [5_000, 20_000];

/** Store changes already applied in this run, by their card summaries. */
async function appliedInRun(db: SupabaseClient, runId: string): Promise<string[]> {
  const { data } = await db.from("store_agent_approvals").select("summary").eq("run_id", runId).not("applied_at", "is", null).order("created_at").limit(30);
  return (data ?? []).map((a) => String(a.summary).slice(0, 200));
}

export function capacityContinueMessage(applied: readonly string[]): string {
  return (
    "Your last step stopped because the model was briefly at capacity. Continue the same task from where it stopped. " +
    (applied.length
      ? `These store changes were already applied in this task: ${applied.map((s) => `"${s}"`).join("; ")}. Do not repeat them. `
      : "No store change has been applied in this task yet. ") +
    "Check the current state before doing anything again."
  );
}

/** Vera's rules plus Cursor's own prompt, sent with every model call (measured ~7.5K). */
const BASE_PROMPT_TOKENS = 8_000;

const SAVE_RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 30_000, 60_000];

/**
 * Run a save until it goes through, waiting out a dropped connection (about
 * two minutes in all). `attempt` returns the error, or null when saved. Other
 * errors are logged once and not retried.
 */
export async function untilSaved(label: string, log: (message: string, extra?: unknown) => void, attempt: () => Promise<unknown>, delays = SAVE_RETRY_DELAYS_MS): Promise<boolean> {
  for (let i = 0; ; i++) {
    let error: unknown;
    try {
      error = await attempt();
    } catch (thrown) {
      error = thrown;
    }
    if (!error) return true;
    const text = String((error as { message?: unknown })?.message ?? error);
    const transient = /fetch failed|network|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|CONNECT_TIMEOUT|socket hang up|timed? ?out|503|502|504/i.test(text);
    const delay = delays[i];
    if (!transient || delay === undefined) {
      log(`${label}: not saved (${text})`);
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

/** The SDK found the agent but its saved checkpoint cannot be loaded. */
export function isCorruptMemory(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const text = `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}`;
  return /corrupt local agent checkpoint|missing root blob|checkpoint.*(missing|not found)/i.test(text);
}

/**
 * The chat as the user sees it, for an agent that lost its memory: the last
 * messages before this run, newest last, trimmed to stay small.
 */
async function visibleHistory(db: SupabaseClient, chatId: string, currentRunId: string): Promise<string> {
  const { data } = await db
    .from("store_agent_messages")
    .select("role, content, run_id, created_at")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(30);
  const turns = (data ?? [])
    .filter((m) => m.run_id !== currentRunId && String(m.content ?? "").trim())
    .reverse()
    .map((m) => `${m.role === "user" ? "User" : "You (Vera)"}: ${String(m.content).trim().slice(0, 2000)}`);
  if (!turns.length) return "";
  let body = turns.join("\n\n");
  if (body.length > 24_000) body = `…${body.slice(-24_000)}`;
  return `[Earlier in this chat (restored from the chat history; your working memory was reset)]\n${body}\n[End of earlier messages]`;
}

/**
 * Run one message of a Store Agent chat from start to finish. Never throws:
 * every outcome ends with a `done` event, a saved reply and a settled charge.
 */
export async function executeStoreRun(deps: StoreAgentDeps, run: StoreAgentRun): Promise<void> {
  const { db, store, log } = deps;
  const req = run.request;
  let reply: ReplyState = emptyReply();
  const unsubscribe = run.subscribe((event) => {
    reply = reduceReply(reply, event);
    if (event.type !== "ping") scheduleSave();
  });

  let assistantMessageId: string | null = null;
  let agent: SDKAgent | null = null;
  let agentId: string | null = null;
  let saveTimer: NodeJS.Timeout | null = null;
  let checkpointTimer: NodeJS.Timeout | null = null;
  let deadline: NodeJS.Timeout | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = (work: () => Promise<unknown>) => {
    queue = queue.then(work).catch((error) => log("store agent background work failed", error));
  };

  /** Save the reply so far; returns the error, if any, so the final save can retry. */
  const saveReply = async (): Promise<unknown> => {
    if (!assistantMessageId) return null;
    const { error } = await db
      .from("store_agent_messages")
      .update({
        content: replyText(reply.blocks),
        blocks: reply.blocks.map((b) => (b.type === "thinking" && b.text.length > MAX_SAVED_THINKING ? { ...b, text: `…${b.text.slice(-MAX_SAVED_THINKING)}` } : b)),
        updated_at: new Date().toISOString(),
      })
      .eq("id", assistantMessageId);
    if (error) log("saving the reply failed", error.message);
    return error;
  };
  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      enqueue(saveReply);
    }, SAVE_DEBOUNCE_MS);
    saveTimer.unref?.();
  }
  const checkpoint = () =>
    enqueue(async () => {
      await store.flush().catch((error) => log("agent store flush failed", error));
      await saveReply();
    });

  // ── Records ──────────────────────────────────────────────────────────────
  {
    const row = {
      id: req.runId,
      chat_id: req.chatId,
      workspace_id: req.workspaceId,
      user_id: req.userId,
      model_id: req.model.id,
      model_params: req.model.params,
      mode: req.mode,
      status: "running",
    };
    let { error } = await db.from("store_agent_runs").insert(row);
    if (error?.code === "23505") {
      // The registry already holds this chat's only live run, so a "running"
      // row left in the table is from a run whose last save never arrived
      // (a dropped connection or a restart). Close it and carry on.
      const { data: stale } = await db
        .from("store_agent_runs")
        .update({ status: "interrupted", finished_at: new Date().toISOString() })
        .eq("chat_id", req.chatId)
        .eq("status", "running")
        .neq("id", req.runId)
        .select("id");
      if (stale?.length) {
        log(`chat ${req.chatId}: closed ${stale.length} stale run row(s)`);
        ({ error } = await db.from("store_agent_runs").insert(row));
      }
    }
    if (error) {
      run.emit({ type: "error", message: error.code === "23505" ? "This chat is already working on something." : "Could not start the run." });
      run.emit({ type: "done", status: "error", credits: 0 });
      unsubscribe();
      deps.registry.finish(run.id);
      return;
    }
  }

  const { data: chat } = await db.from("store_agent_chats").select("title, cursor_agent_id, context_used").eq("id", req.chatId).single();
  await db.from("store_agent_messages").insert({
    chat_id: req.chatId,
    workspace_id: req.workspaceId,
    run_id: req.runId,
    role: "user",
    content: req.message,
    attachments: req.attachments.map((a) => ({ fileId: a.fileId, name: a.name, mime: a.mime, size: a.size })),
  });
  {
    const { data } = await db
      .from("store_agent_messages")
      .insert({ chat_id: req.chatId, workspace_id: req.workspaceId, run_id: req.runId, role: "assistant" })
      .select("id")
      .single();
    assistantMessageId = (data?.id as string | undefined) ?? null;
  }
  const now = new Date().toISOString();
  await db
    .from("store_agent_chats")
    .update({
      status: "running",
      model_id: req.model.id,
      model_params: req.model.params,
      mode: req.mode,
      title: chat?.title || titleFrom(req.message),
      last_activity_at: now,
      updated_at: now,
    })
    .eq("id", req.chatId);

  run.emit({ type: "run", runId: run.id, chatId: run.chatId });

  let status: "finished" | "cancelled" | "error" | "interrupted" = "error";
  let errorMessage: string | null = null;
  /** The real reason, for the run record and the admin page; never shown to customers. */
  let internalError: string | null = null;
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let modelCalls = 1;
  /** Paid work outside the model's tokens: generated images, image searches. */
  let extraUsd = 0;
  let imagesGenerated = 0;
  let outputTokens = 0;
  let toolCalls = 0;
  /** The to-do list as shown so far (updateTodos may send only what changed). */
  let todos: TodoItem[] = [];
  /** The run was stopped because its cost reached the customer's balance. */
  let budgetExhausted = false;
  /** The plan this run builds (Build button), marked built or back to draft at the end. */
  let buildingPlanId: string | null = null;
  /** Running cost estimate, for the balance check and for a run stopped before its usage arrived. */
  let estimateSoFar = () => extraUsd;
  let lastProgressAt = 0;
  const addCost = (usd: number, label: string) => {
    extraUsd += usd;
    log(`run ${run.id}: +$${usd.toFixed(4)} ${label}`);
  };
  const windowTokens = contextWindowFor(req.model.id, req.model.params);
  let chatFiles: ChatFiles | null = null;

  try {
    // ── Folder, store connection, instructions ─────────────────────────────
    const cwd = path.join(deps.workRoot, req.workspaceId, req.chatId);
    const files = new ChatFiles(db, cwd, req.workspaceId, req.chatId);
    chatFiles = files;
    await files.prepare();

    const platform = await storePlatform(db, req.workspaceId);
    let connection: ShopifyConnection | null = null;
    const getConnection = async () => (connection ??= await loadShopifyConnection(db, req.workspaceId));
    let wooConnection: WooConnection | null = null;
    const getWoo = async () => (wooConnection ??= await loadWooConnection(db, req.workspaceId));
    const storeInfo =
      platform === "woocommerce"
        ? await getWoo().then((c) => ({ name: c.storeName, domain: c.domain }))
        : await getConnection().then((c) => ({ name: c.storeName || c.shopDomain, domain: c.shopDomain }));

    await fs.mkdir(path.join(cwd, ".cursor", "rules"), { recursive: true });
    await fs.writeFile(
      path.join(cwd, ".cursor", "rules", "vera.mdc"),
      veraRule({
        platform,
        storeName: storeInfo.name,
        shopDomain: storeInfo.domain,
        mode: req.mode,
        autoRun: req.autoRun,
        autoRunBulk: req.autoRunBulk,
        notes: await loadStoreNotes(db, req.workspaceId),
      })
    );

    const images: NonNullable<SDKUserMessage["images"]> = [];
    const placed: string[] = [];
    for (const attachment of req.attachments) {
      const relative = await files.placeAttachment(attachment.fileId, attachment.storagePath, attachment.name);
      placed.push(relative);
      if (attachment.mime.startsWith("image/") && attachment.size <= STORE_AGENT_LIMITS.maxImageBytes) {
        const bytes = await fs.readFile(path.join(cwd, ...relative.split("/")));
        images.push({ data: bytes.toString("base64"), mimeType: attachment.mime });
      }
    }
    const undone = await undoneSinceLastRun(db, req.chatId, req.runId).catch((error) => {
      log("reading undone changes failed", error);
      return [] as string[];
    });
    // Build: the agent gets the plan itself; the chat shows the short "Build" message.
    let agentMessage = req.message;
    if (req.buildPlanId) {
      const plan = await startBuild(db, run, req.buildPlanId);
      buildingPlanId = plan.id;
      agentMessage = buildMessage(plan);
    }
    const unfinished = await appliedByUnfinishedRun(db, req.chatId, req.runId).catch((error) => {
      log("reading the previous run failed", error);
      return null;
    });
    const notes = [
      placed.length ? `[Attached files, in your folder: ${placed.join(", ")}]` : "",
      undone.length
        ? `[Since your last reply the user undid these changes from their cards, so the store has the earlier values again: ${undone.map((s) => `"${s}"`).join("; ")}. Read the store again before relying on those values.]`
        : "",
      unfinished
        ? `[Your previous run in this chat stopped before it finished (${unfinished.status}). ${
            unfinished.changes.length
              ? `These store changes from it WERE applied: ${unfinished.changes.map((s) => `"${s}"`).join("; ")}.`
              : "No store change from it was applied."
          } Read the current state of the store before continuing, and never repeat a change that was already applied.]`
        : "",
    ].filter(Boolean);
    const text = notes.length ? `${agentMessage}\n\n${notes.join("\n")}` : agentMessage;

    // ── Tools ──────────────────────────────────────────────────────────────
    const written = new Set<string>();
    // Re-delivered calls join the first execution, which has already seen any guidance.
    const customTools = oncePerToolCall(withGuidance({
      ...createStoreAgentTools({
        db,
        run,
        files,
        platform,
        connection: getConnection,
        woo: getWoo,
        autoRun: req.autoRun,
        autoRunBulk: req.autoRunBulk,
        planMode: req.mode === "plan",
        checkpoint,
        log,
      }),
      ...createFileTools(cwd, (relative) => written.add(relative)),
      ...createScriptTool(cwd, (relative) => written.add(relative)),
    }, run));
    const emitProgress = (force = false) => {
      const now = Date.now();
      if (!force && now - lastProgressAt < PROGRESS_EVERY_MS) return;
      lastProgressAt = now;
      run.emit({ type: "progress", outputTokens, toolCalls });
      checkBudget();
    };
    // The exact token count only arrives when the run ends, so the balance is
    // watched with a running estimate: each model call reads the conversation
    // (mostly from cache) and adds what was written since.
    const startContext = Math.max(BASE_PROMPT_TOKENS, Number(chat?.context_used) || 0);
    estimateSoFar = () => {
      const input = modelCalls * (startContext + outputTokens);
      return (
        extraUsd +
        estimateUsd(req.model.id, req.model.params, { inputTokens: input, cacheReadTokens: Math.round(input * 0.85), cacheWriteTokens: 0, outputTokens }, modelCalls)
      );
    };
    const checkBudget = () => {
      if (budgetExhausted || run.cancelled) return;
      if (usdToCredits(estimateSoFar()) < req.billing.remainingCredits) return;
      budgetExhausted = true;
      log(`run ${run.id} stopped: it reached the remaining balance of ${req.billing.remainingCredits} credits`);
      run.cancel();
    };

    // ── Agent ──────────────────────────────────────────────────────────────
    const options: AgentOptions = {
      apiKey: deps.cursorApiKey,
      model: { id: req.model.id, params: req.model.params },
      // Plan mode delivers its plan through Cursor's own createPlan.
      tools: req.mode === "plan" ? [...BUILTIN_TOOLS, "createPlan"] : BUILTIN_TOOLS,
      local: {
        cwd,
        settingSources: ["project"],
        store,
        // Sub-agents get the same tool allowlist and no shell.
        subagentInherit: { resourceProviderOptions: { suppressDefaultShellExecutor: true } },
      },
    };
    // A chat whose agent memory is gone starts a fresh agent, primed with the
    // conversation the user can see, so the chat carries on instead of failing.
    // No agent yet on a chat that already has messages: its agent was retired
    // (see isAgentExhausted), so the new one starts from the visible history.
    let restoreHistory = !chat?.cursor_agent_id;
    if (chat?.cursor_agent_id) {
      try {
        // The registry allows one run per chat, so anything still "running" here was cut off.
        const released = await store.releaseStaleRuns(chat.cursor_agent_id);
        if (released) log(`agent ${chat.cursor_agent_id}: closed ${released} run(s) left open by a restart`);
        const agentToResume = chat.cursor_agent_id;
        agent = await retryOnNetwork(() => Agent.resume(agentToResume, options), run, log);
      } catch (error) {
        if (!isMissingAgent(error) && !isCorruptMemory(error)) throw error;
        log(`agent ${chat.cursor_agent_id} cannot be resumed; restoring the chat from its messages`, (error as Error).message);
        restoreHistory = true;
      }
    }
    const freshAgent = async () => {
      const created = await retryOnNetwork(() => Agent.create(options), run, log);
      await db.from("store_agent_chats").update({ cursor_agent_id: created.agentId }).eq("id", req.chatId);
      return created;
    };
    if (!agent) agent = await freshAgent();
    agentId = agent.agentId;
    if (run.cancelled) throw new Error("cancelled");

    const payload = async (restore: boolean): Promise<string | SDKUserMessage> => {
      const history = restore ? await visibleHistory(db, req.chatId, req.runId) : "";
      const body = history ? `${history}\n\n${text}` : text;
      return images.length ? { text: body, images } : body;
    };

    const started = new Set<string>();
    // Web searches and page reads are not reported in onDelta (SDK 1.2.0).
    // They are read back from the agent's saved conversation after each model
    // call, and shown once. Calls from earlier turns are marked seen up front.
    const listMessages = () => Agent.messages.list(agentId!, { runtime: "local", cwd, store });
    const webSeen = new Set<string>();
    let webScan: Promise<void> | null = null;
    let webScanAt = 0;
    const showWebCalls = () => {
      if (webScan) return webScan;
      webScanAt = Date.now();
      webScan = listMessages()
        .then((messages) => {
          for (const call of webCallsInMessages(messages)) {
            if (webSeen.has(call.callId) || started.has(call.callId)) continue;
            webSeen.add(call.callId);
            toolCalls += 1;
            run.emit({ type: "tool_start", callId: call.callId, tool: call.tool, ...describeTool(call.tool, call.args) });
            run.emit({ type: "tool_end", callId: call.callId, ok: call.ok, summary: call.summary, links: call.links });
          }
        })
        .catch((e) => log("reading web calls failed", e))
        .finally(() => {
          webScan = null;
        });
      return webScan;
    };
    try {
      for (const call of webCallsInMessages(await listMessages())) webSeen.add(call.callId);
    } catch (e) {
      log("reading earlier web calls failed", e);
    }
    let webWatch = false;
    const sendOptions: SendOptions = {
      model: { id: req.model.id, params: req.model.params },
      mode: req.mode,
      local: { customTools },
      onDelta: ({ update }) => {
        const u = update as { type: string; [key: string]: unknown };
        // After a model call that requested tools, look for finished web tools (from memory, cheap).
        if (webWatch && Date.now() - webScanAt > WEB_SCAN_EVERY_MS) void showWebCalls();
        switch (u.type) {
          case "text-delta":
            if (typeof u.text === "string" && u.text) run.emit({ type: "text", delta: scrub(u.text) });
            return;
          case "thinking-delta":
            if (typeof u.text === "string" && u.text) run.emit({ type: "thinking", delta: scrub(u.text) });
            return;
          case "thinking-completed":
            run.emit({ type: "thinking_done", ms: Number(u.thinkingDurationMs) || 0 });
            return;
          case "tool-requests-listed":
            modelCalls += 1;
            webWatch = true;
            return;
          case "token-delta":
            outputTokens += Number(u.tokens) || 0;
            emitProgress();
            return;
          case "summary-started":
            run.emit({ type: "summary", status: "started" });
            return;
          case "summary-completed":
            run.emit({ type: "summary", status: "completed" });
            return;
          case "tool-call-started": {
            const callId = String(u.callId ?? "");
            const call = unwrapToolCall((u.toolCall ?? {}) as { type?: string; args?: unknown });
            if (!callId || !call.name || started.has(callId)) return;
            started.add(callId);
            toolCalls += 1;
            emitProgress(true);
            if (toolCalls > MAX_TOOL_CALLS) {
              run.emit({ type: "error", message: `This run used more than ${MAX_TOOL_CALLS} tool calls and was stopped. Send a message to continue.` });
              run.cancel();
              return;
            }
            if (call.name === "updateTodos") {
              todos = mergeTodos(todos, mapTodos(call.args.todos), call.args.merge === true);
              run.emit({ type: "todos", items: todos });
              return;
            }
            if (call.name === "readTodos") return;
            run.emit({ type: "tool_start", callId, tool: call.name, ...describeTool(call.name, call.args) });
            return;
          }
          case "tool-call-completed": {
            const callId = String(u.callId ?? "");
            const call = unwrapToolCall((u.toolCall ?? {}) as { type?: string; args?: unknown; result?: unknown });
            if (!callId || !call.name) return;
            if (call.name === "updateTodos") {
              const value = (call.result as { value?: { todos?: unknown } } | undefined)?.value;
              todos = mergeTodos(todos, mapTodos(value?.todos ?? call.args.todos), !value?.todos && call.args.merge === true);
              run.emit({ type: "todos", items: todos });
              return;
            }
            if (call.name === "readTodos") return;
            if (!started.has(callId)) {
              started.add(callId);
              run.emit({ type: "tool_start", callId, tool: call.name, ...describeTool(call.name, call.args) });
            }
            const outcome = summarizeResult(call.name, call.result);
            if (call.name === "createPlan" && typeof call.args.plan === "string" && call.args.plan.trim()) {
              const markdown = call.args.plan;
              enqueue(() => savePlan(db, run, markdown).catch((e) => log("saving the plan failed", e)));
            }
            if (call.name === "generateImage" && outcome.ok) {
              imagesGenerated += 1;
              addCost(IMAGE_GENERATION_USD, "generated image");
              enqueue(() => adoptGeneratedImage(files, run, call.result));
            }
            run.emit({ type: "tool_end", callId, ok: outcome.ok, summary: outcome.summary });
            if (written.size) {
              const names = [...written];
              written.clear();
              enqueue(() => files.sync(run).then(() => undefined).catch((e) => log(`file sync failed (${names.join(", ")})`, e)));
            }
            checkpoint();
            return;
          }
          case "turn-ended": {
            const turn = u.usage as Partial<TokenUsage> | undefined;
            if (!turn) return;
            const prompt = Number(turn.inputTokens) || 0;
            if (prompt > 0) {
              run.emit({ type: "context", usedTokens: Math.min(windowTokens, Math.round(prompt / modelCalls)), windowTokens });
            }
            return;
          }
          default:
            return;
        }
      },
    };

    let sdkRun: Run;
    try {
      sdkRun = await agent.send(await payload(restoreHistory), sendOptions);
    } catch (error) {
      if (!isCorruptMemory(error)) throw error;
      // The saved memory is damaged (for example a checkpoint lost to a network
      // drop): replace the agent, keep the chat.
      const broken = agent.agentId;
      log(`agent ${broken} memory is damaged; restoring the chat from its messages`, (error as Error).message);
      try {
        await agent[Symbol.asyncDispose]();
      } catch {
        // ignore
      }
      agent = await freshAgent();
      agentId = agent.agentId;
      void store.deleteAgentsEverywhere([broken]).catch((e) => log("removing the damaged agent failed", e));
      sdkRun = await agent.send(await payload(true), sendOptions);
    }

    run.steer = async (steerText: string) => sdkRun.steer?.(steerText);
    run.onAbort(() => {
      void sdkRun.cancel().catch(() => undefined);
    });
    if (run.cancelled) void sdkRun.cancel().catch(() => undefined);

    checkpointTimer = setInterval(checkpoint, CHECKPOINT_EVERY_MS);
    checkpointTimer.unref?.();
    deadline = setTimeout(() => {
      run.emit({ type: "error", message: "This run reached the one-hour limit and was stopped." });
      run.cancel();
    }, STORE_AGENT_LIMITS.maxRunMs);
    deadline.unref?.();

    const addUsage = (u: RunResult["usage"]) => {
      if (!u) return;
      usage = {
        inputTokens: usage.inputTokens + (u.inputTokens ?? 0),
        outputTokens: usage.outputTokens + (u.outputTokens ?? 0),
        cacheReadTokens: usage.cacheReadTokens + (u.cacheReadTokens ?? 0),
        cacheWriteTokens: usage.cacheWriteTokens + (u.cacheWriteTokens ?? 0),
      };
    };
    let result = await sdkRun.wait();
    addUsage(result.usage);
    // A model at capacity ("resource_exhausted") is temporary on Cursor's side:
    // wait and carry on in the same run, telling the agent what is already done.
    for (let attempt = 0; result.status === "error" && isCapacityError(result.error) && !run.cancelled; attempt++) {
      const delay = CAPACITY_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) break;
      log(`store run ${run.id}: model at capacity, continuing in ${delay / 1000}s (attempt ${attempt + 1})`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (run.cancelled) break;
      const applied = await appliedInRun(db, req.runId).catch(() => [] as string[]);
      sdkRun = await agent.send(capacityContinueMessage(applied), sendOptions);
      result = await sdkRun.wait();
      addUsage(result.usage);
    }
    // Messages the user sent that the turn never picked up go in as a follow-up,
    // in this same run, so nothing they wrote is dropped.
    for (let pending = run.takeGuidance(); pending.length && result.status === "finished" && !run.cancelled; pending = run.takeGuidance()) {
      sdkRun = await agent.send(`While you were working I wrote:\n${guidanceText(pending)}`, sendOptions);
      result = await sdkRun.wait();
      addUsage(result.usage);
    }
    if (webWatch) {
      // Web tools the last model calls ran: a read already under way may predate them.
      await webScan;
      await showWebCalls();
    }
    status = interruptedRuns.has(run)
      ? "interrupted"
      : run.cancelled || result.status === "cancelled"
        ? "cancelled"
        : result.status === "finished"
          ? "finished"
          : "error";
    if (status === "error") {
      // The SDK reports a failed run without throwing; keep its reason for us.
      const failure = result.error;
      internalError = `${failure?.code ? `[${failure.code}] ` : ""}${failure?.message ?? "run ended with an error"}`.slice(0, 1000);
      errorMessage = customerMessage(internalError);
      log(`store run ${run.id} ended with an error: ${internalError}`);
    }
  } catch (error) {
    status = interruptedRuns.has(run) ? "interrupted" : run.cancelled ? "cancelled" : "error";
    if (status === "error") {
      const message = (error as Error).message ?? "";
      internalError = message.slice(0, 1000);
      errorMessage = /No (Shopify|WooCommerce|Shopify or WooCommerce) store|incomplete|Reconnect|not available to build/i.test(message) ? message : customerMessage(message);
      log(`store run ${run.id} failed`, error);
    }
  } finally {
    if (saveTimer) clearTimeout(saveTimer);
    if (checkpointTimer) clearInterval(checkpointTimer);
    if (deadline) clearTimeout(deadline);
  }

  // ── Settle: files, cost, records ───────────────────────────────────────────
  await queue;
  try {
    // Same instance as during the run: it still knows which files the agent asked to show.
    const files = chatFiles ?? new ChatFiles(db, path.join(deps.workRoot, req.workspaceId, req.chatId), req.workspaceId, req.chatId);
    if (!chatFiles) await files.prepare();
    await files.sync(run);
  } catch (error) {
    log("final file sync failed", error);
  }

  // A new chat gets a short title written from its first exchange.
  if (status === "finished" && chat && !chat.title) {
    const titled = await generateTitle(deps.cursorApiKey, req.message, replyText(reply.blocks)).catch((error) => {
      log("title generation failed", error);
      return null;
    });
    if (titled) {
      extraUsd += titled.usd;
      await db.from("store_agent_chats").update({ title: titled.title }).eq("id", req.chatId);
    }
  }

  let usd = extraUsd;
  try {
    // A run stopped part way (by the user or the balance) may end without its
    // usage report; the work it did is still billed, from the running estimate.
    const unreported = usage.inputTokens === 0 && status === "cancelled" && (outputTokens > 0 || toolCalls > 0);
    usd = unreported ? estimateSoFar() : extraUsd + estimateUsd(req.model.id, req.model.params, usage, modelCalls);
  } catch (error) {
    log("pricing failed", error);
  }
  const credits = usdToCredits(usd);
  // The charge is idempotent per run (store_agent:{runId}), so it can be sent again.
  let charge: Awaited<ReturnType<typeof chargeRun>> = { charged: 0, duplicate: false, error: "not attempted" };
  await untilSaved(`charge for run ${run.id}`, log, async () => {
    charge = await chargeRun(db, {
      ownerUserId: req.billing.ownerUserId,
      workspaceId: req.workspaceId,
      actorUserId: req.userId,
      runId: req.runId,
      credits,
      details: { chatId: req.chatId, model: req.model.id, params: req.model.params, mode: req.mode, usage, usd, extraUsd, imagesGenerated, modelCalls },
    }).catch((error) => ({ charged: 0, duplicate: false, error: String(error) }));
    return charge.error ?? null;
  });
  if (charge.error) log(`charge for run ${run.id} incomplete: ${charge.error}`);

  if (buildingPlanId) {
    const planId = buildingPlanId;
    await untilSaved(`plan ${planId} status`, log, () =>
      finishBuild(db, run, planId, status === "finished").then(() => null, (error: unknown) => error)
    );
  }
  if (errorMessage) run.emit({ type: "error", message: errorMessage });
  if (budgetExhausted) {
    run.emit({ type: "error", message: "Your credit balance ran out, so the agent stopped here. Top up your credits, then send a message to continue." });
  }
  if (status === "interrupted") {
    run.emit({ type: "error", message: "The run was interrupted by a service update. Send a message to continue where it left off." });
  }
  run.emit({ type: "usage", credits: charge.charged, usd });
  run.emit({ type: "done", status, credits: charge.charged });

  // The closing saves wait out a dropped connection, so a finished run is not
  // left looking "running" (which would block the chat) or lose its reply.
  await untilSaved("final reply", log, saveReply);
  await untilSaved("agent memory", log, () => store.flush().then(() => null, (error: unknown) => error));
  if (agentId) store.evictAgent(agentId);
  const retireAgent = status === "error" && !!agentId && isAgentExhausted(internalError ?? "");
  if (retireAgent) {
    log(`agent ${agentId} is exhausted on Cursor's side; chat ${req.chatId} will continue with a fresh agent`);
    void store.deleteAgentsEverywhere([agentId!]).catch((e) => log("removing the exhausted agent failed", e));
  }

  const finishedAt = new Date().toISOString();
  await untilSaved(`run ${req.runId} record`, log, async () => {
    const { error } = await db
      .from("store_agent_runs")
      .update({
        status,
        error: internalError ?? errorMessage,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        cache_read_tokens: usage.cacheReadTokens,
        cache_write_tokens: usage.cacheWriteTokens,
        usd,
        credits: charge.charged,
        cost_source: usd > 0 ? "estimated" : "none",
        charged: charge.charged > 0,
        finished_at: finishedAt,
      })
      .eq("id", req.runId);
    return error;
  });
  await untilSaved(`chat ${req.chatId} totals`, log, async () => {
    const { data: totals, error: readError } = await db.from("store_agent_chats").select("credits_total").eq("id", req.chatId).single();
    if (readError) return readError;
    const { error } = await db
      .from("store_agent_chats")
      .update({
        status: status === "error" ? "error" : status === "interrupted" ? "interrupted" : "idle",
        // An exhausted agent is retired; the next message starts a fresh one from the visible history.
        ...(retireAgent ? { cursor_agent_id: null } : {}),
        credits_total: Number(totals?.credits_total ?? 0) + charge.charged,
        // A run stopped before the model answered leaves the chat's context as it was.
        ...(reply.context ? { context_used: reply.context.usedTokens, context_window: windowTokens } : {}),
        last_activity_at: finishedAt,
        updated_at: finishedAt,
      })
      .eq("id", req.chatId);
    return error;
  });

  unsubscribe();
  try {
    await agent?.[Symbol.asyncDispose]();
  } catch {
    // ignore
  }
  deps.registry.finish(run.id);
}

/**
 * `generateImage` saves outside the chat folder. Copy the image in, under
 * images/, and show it to the user.
 */
async function adoptGeneratedImage(files: ChatFiles, run: StoreAgentRun, result: unknown): Promise<void> {
  const value = (result as { value?: { filePath?: string; imageData?: string } } | undefined)?.value;
  if (!value?.filePath && !value?.imageData) return;
  let bytes: Buffer;
  if (value.imageData) bytes = Buffer.from(value.imageData, "base64");
  else bytes = await fs.readFile(value.filePath!);
  const name = path.basename(value.filePath ?? `image-${Date.now()}.png`).replace(/[^\w.\-]+/g, "_");
  let relative = `images/${name}`;
  const target = () => path.join(files.cwd, ...relative.split("/"));
  for (let n = 2; ; n++) {
    try {
      await fs.access(target());
      relative = `images/${path.parse(name).name}-${n}${path.extname(name)}`;
    } catch {
      break;
    }
  }
  await fs.mkdir(path.dirname(target()), { recursive: true });
  await fs.writeFile(target(), bytes);
  await files.sync(run, new Set([relative]));
}
