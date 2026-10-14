import { promises as fs } from "node:fs";
import path from "node:path";
import { Agent, JsonlLocalAgentStore, type AgentOptions, type SDKAgent, type ToolName } from "@cursor/sdk";
import type { ServiceRunRequest } from "../../../src/lib/assistant/protocol";
import type { ServiceConfig } from "../config";
import { usageToCredits, type RunTokenUsage } from "../usage";
import type { AssistantRun } from "./bridge";
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
      ? `files attached by the user (use the id with upload_file): ${request.files.map((f) => `${f.id} = "${f.name}"`).join("; ")}`
      : "",
    "[/page context]",
  ].filter(Boolean);
  return `${context.join("\n")}\n\n${request.message}`;
}

function baseOptions(config: ServiceConfig, store: JsonlLocalAgentStore): AgentOptions {
  return {
    apiKey: config.cursorApiKey,
    model: { id: config.model },
    tools: ["mcp"],
    disallowedTools: DENIED_TOOLS,
    local: {
      cwd: config.knowledgeRoot,
      settingSources: ["project"],
      store,
    },
  };
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

    const sdkRun = await agent.send(buildPrompt(request), {
      local: { customTools: createAllTools(config.knowledgeRoot, run) },
    });
    run.steer = async (text: string) => sdkRun.steer?.(text);
    run.onAbort(() => {
      void sdkRun.cancel().catch(() => {});
    });

    for await (const message of sdkRun.stream()) {
      for (const event of mapSdkMessage(message as SdkStreamMessage)) run.emit(event);
    }
    const result = await sdkRun.wait();

    let chargedCents: number | undefined;
    try {
      const billed = await agent.getUsage({ runId: sdkRun.id });
      chargedCents = billed.cost?.chargedCents;
    } catch {
      // Billed usage is not enabled for this account; tokens are used instead.
    }
    const tokens = result.usage
      ? ({
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          cacheReadTokens: result.usage.cacheReadTokens,
          cacheWriteTokens: result.usage.cacheWriteTokens,
        } satisfies RunTokenUsage)
      : undefined;
    const cost = usageToCredits({ chargedCents, usage: tokens, rates: config.rates });
    log(`run ${run.id} ${result.status} credits=${cost.credits} source=${cost.source}`);

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
