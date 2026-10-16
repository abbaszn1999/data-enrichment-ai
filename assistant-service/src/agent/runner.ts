import { promises as fs } from "node:fs";
import path from "node:path";
import { Agent, JsonlLocalAgentStore, type AgentOptions, type SDKAgent, type ToolName } from "@cursor/sdk";
import type { ServiceRunRequest } from "../../../src/lib/assistant/protocol";
import type { ServiceConfig } from "../config";
import { billedCents, usageToCredits, type RunTokenUsage } from "../usage";
import type { AssistantRun } from "./bridge";
import { ContextMeter, type SdkDeltaUpdate } from "./context-meter";
import { mapSdkMessage, type SdkStreamMessage } from "./events";
import { createAllTools } from "./tools";

/** Built-in tools that must never be offered, on top of the `tools` allowlist. */
const DENIED_TOOLS: ToolName[] = ["shell", "edit", "delete", "applyAgentDiff", "webFetch", "generateImage"];

/** conversation (agent id) -> owning user, so one user cannot resume another's conversation. */
export class ConversationOwners {
  private cache: Record<string, string> | null = null;
  constructor(private readonly file: string) {}

  private async load(): Promise<Record<string, string>> {
    if (this.cache) return this.cache;
    try {
      this.cache = JSON.parse(await fs.readFile(this.file, "utf8")) as Record<string, string>;
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  async owner(conversationId: string): Promise<string | undefined> {
    return (await this.load())[conversationId];
  }

  async set(conversationId: string, userId: string): Promise<void> {
    const data = await this.load();
    data[conversationId] = userId;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(data), "utf8");
  }
}

export function buildPrompt(request: ServiceRunRequest): string {
  const context = [
    "[page context]",
    `workspace slug: ${request.context.workspaceSlug}`,
    `current page: ${request.context.path}`,
    request.context.sessionId ? `open sheet session: ${request.context.sessionId}` : "",
    request.files?.length
      ? `${request.files.length} file(s) attached by the user (use the ids with upload_file): ${request.files.map((f) => `${f.id} = "${f.name}"`).join("; ")}`
      : "",
    "[/page context]",
  ].filter(Boolean);
  return `${context.join("\n")}\n\n${request.message}`;
}

function baseOptions(config: ServiceConfig, store: JsonlLocalAgentStore): AgentOptions {
  return {
    apiKey: config.cursorApiKey,
    model: { id: config.model, params: [{ id: "fast", value: String(config.modelFast) }] },
    tools: ["mcp"],
    disallowedTools: DENIED_TOOLS,
    local: {
      cwd: config.knowledgeRoot,
      settingSources: ["project"],
      store,
    },
  };
}

/** Billed usage for local agents is enabled per account; while Cursor says it is unavailable, stop asking for an hour. */
let billedUsageUnavailableUntil = 0;

/** The agent's total billed cents so far, or undefined when Cursor does not report billed usage. */
async function readBilledCents(agent: SDKAgent): Promise<number | undefined> {
  if (Date.now() < billedUsageUnavailableUntil) return undefined;
  try {
    const usage = await agent.getUsage();
    return usage.cost ? (billedCents(usage.cost) ?? 0) : 0;
  } catch (error) {
    if ((error as { code?: string }).code === "feature_unavailable") billedUsageUnavailableUntil = Date.now() + 60 * 60 * 1000;
    return undefined;
  }
}

/** Billed cost settles shortly after a run ends, so poll briefly until the total moves. */
async function waitForBilledCents(agent: SDKAgent, before: number): Promise<number | undefined> {
  let latest: number | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    latest = await readBilledCents(agent);
    if (latest === undefined || latest > before) return latest;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return latest;
}

async function appendUsageLog(storeDir: string, entry: Record<string, unknown>): Promise<void> {
  try {
    await fs.mkdir(storeDir, { recursive: true });
    await fs.appendFile(path.join(storeDir, "usage.jsonl"), `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // the usage log is for reconciliation only
  }
}

export interface RunnerDeps {
  config: ServiceConfig;
  owners: ConversationOwners;
  store: JsonlLocalAgentStore;
  log?: (message: string, extra?: unknown) => void;
}

export interface RunOutcome {
  status: "finished" | "cancelled" | "error";
  credits: number;
}

/** Execute one run: stream public events, then report the outcome. Never throws. */
export async function executeRun(deps: RunnerDeps, run: AssistantRun, request: ServiceRunRequest): Promise<RunOutcome> {
  const { config, owners, store } = deps;
  const log = deps.log ?? (() => {});
  let agent: SDKAgent | null = null;
  try {
    const options = baseOptions(config, store);
    if (request.conversationId) {
      const owner = await owners.owner(request.conversationId);
      if (owner !== request.userId) {
        run.emit({ type: "error", message: "This conversation is not available." });
        return { status: "error", credits: 0 };
      }
      agent = await Agent.resume(request.conversationId, options);
    } else {
      agent = await Agent.create(options);
      await owners.set(agent.agentId, request.userId);
    }
    run.emit({ type: "run", runId: run.id, conversationId: agent.agentId });

    const billedBefore = request.conversationId ? await readBilledCents(agent) : 0;
    const meter = new ContextMeter(config.contextWindow);
    const sdkRun = await agent.send(buildPrompt(request), {
      local: { customTools: createAllTools(config.knowledgeRoot, run) },
      onDelta: ({ update }) => {
        for (const event of meter.onUpdate(update as SdkDeltaUpdate)) run.emit(event);
      },
    });
    run.steer = async (text: string) => sdkRun.steer?.(text);
    run.onAbort(() => {
      void sdkRun.cancel().catch(() => {});
    });

    for await (const message of sdkRun.stream()) {
      for (const event of mapSdkMessage(message as SdkStreamMessage)) run.emit(event);
    }
    const result = await sdkRun.wait();

    const billedAfter = billedBefore === undefined ? undefined : await waitForBilledCents(agent, billedBefore);
    const runBilledCents = billedAfter === undefined || billedBefore === undefined ? undefined : billedAfter - billedBefore;
    const tokens = result.usage
      ? ({
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          cacheReadTokens: result.usage.cacheReadTokens,
          cacheWriteTokens: result.usage.cacheWriteTokens,
        } satisfies RunTokenUsage)
      : undefined;
    const cost = usageToCredits({ billedCents: runBilledCents, usage: tokens, rates: config.rates });
    log(
      `run ${run.id} ${result.status} model=${config.model}${config.modelFast ? " fast" : ""} ` +
        `tokens in=${tokens?.inputTokens ?? 0} out=${tokens?.outputTokens ?? 0} cacheRead=${tokens?.cacheReadTokens ?? 0} ` +
        `usd=${cost.usd.toFixed(5)} credits=${cost.credits} source=${cost.source}`
    );
    await appendUsageLog(config.storeDir, {
      at: new Date().toISOString(),
      runId: run.id,
      conversationId: agent.agentId,
      userId: request.userId,
      workspaceId: request.workspaceId,
      status: result.status,
      model: config.model,
      fast: config.modelFast,
      tokens,
      usd: cost.usd,
      credits: cost.credits,
      source: cost.source,
    });

    const status = run.cancelled ? "cancelled" : result.status === "finished" ? "finished" : result.status === "cancelled" ? "cancelled" : "error";
    if (status === "error") run.emit({ type: "error", message: "The assistant ran into a problem. Please try again." });
    run.emit({ type: "done", status, credits: cost.credits });
    return { status, credits: cost.credits };
  } catch (error) {
    log(`run ${run.id} failed`, error);
    if (!run.cancelled) run.emit({ type: "error", message: "The assistant ran into a problem. Please try again." });
    run.emit({ type: "done", status: run.cancelled ? "cancelled" : "error" });
    return { status: run.cancelled ? "cancelled" : "error", credits: 0 };
  } finally {
    try {
      await agent?.[Symbol.asyncDispose]();
    } catch {
      // ignore disposal errors
    }
  }
}
