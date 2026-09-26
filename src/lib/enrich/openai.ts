import { calculateOpenAiWebSearchCost, type AiCallCost } from "@/lib/ai-pricing";
import type { CategoryItem, SessionKind } from "@/types";
import {
  resolveEnrichOpenAiModel,
  resolveEnrichReasoningEffort,
  resolveEnrichSearchContextSize,
  type EnrichOpenAiModelId,
  type EnrichReasoningEffort,
  type EnrichSearchContextSize,
} from "./models";
import type { EnrichToolPolicy } from "./policy";
import type {
  EnrichColumnConfig,
  EnrichSettings,
  OpenAiResponse,
} from "./types";
import {
  buildEnrichedData,
  countWebSearchCalls,
  parseJsonObject,
  responseOutputText,
} from "./parse";

export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

/**
 * Ceiling on a single OpenAI call. Raised from the previous 180s because Stop
 * now aborts an in-flight call directly (see `shouldCancel` below) instead of
 * only blocking new rows — a longer ceiling no longer means a longer stuck
 * wait after the user clicks Stop.
 */
export const ENRICH_CALL_TIMEOUT_MS = 240_000;

/** How often an in-flight call re-checks `shouldCancel` while waiting on OpenAI. */
const CANCEL_POLL_MS = 5_000;

/**
 * An attempt that OpenAI billed (the response carried `usage`) but whose
 * result could not be used. Callers that retry add `costs` to the row total.
 */
export class EnrichBilledAttemptError extends Error {
  readonly costs: AiCallCost[];

  constructor(message: string, costs: AiCallCost[]) {
    super(message);
    this.name = "EnrichBilledAttemptError";
    this.costs = costs;
  }
}

export function billedCostsOf(error: unknown): AiCallCost[] {
  if (error instanceof EnrichBilledAttemptError) return error.costs;
  if (error instanceof EnrichCancelledError) return error.costs;
  return [];
}

/**
 * The user clicked Stop while this call was in flight. The cancelled attempt
 * itself is never billed (OpenAI never returned a response for it), but an
 * earlier attempt on the same row may have been billed before the cancel —
 * `costs` carries that forward so the row is still charged for what OpenAI
 * actually billed. Callers must not retry this: retrying after a
 * user-requested stop would defeat the point of Stop.
 */
export class EnrichCancelledError extends Error {
  readonly costs: AiCallCost[];

  constructor(message = "Cancelled by user", costs: AiCallCost[] = []) {
    super(message);
    this.name = "EnrichCancelledError";
    this.costs = costs;
  }
}

export function isEnrichCancelledError(error: unknown): boolean {
  return error instanceof EnrichCancelledError;
}

/**
 * Our own AI provider account cannot serve requests (out of quota or credit
 * balance). Nothing about the row is wrong, so it must not be retried,
 * charged or marked as an error: the job stops and the row stays pending.
 */
export class EnrichProviderUnavailableError extends Error {
  constructor(message = "AI service temporarily unavailable") {
    super(message);
    this.name = "EnrichProviderUnavailableError";
  }
}

export function isEnrichProviderUnavailableError(error: unknown): error is EnrichProviderUnavailableError {
  return error instanceof EnrichProviderUnavailableError;
}

const PROVIDER_UNAVAILABLE_CODES = new Set(["insufficient_quota", "credit_balance_exhausted", "billing_hard_limit_reached"]);

/** OpenAI's out-of-quota / out-of-credit errors (never a problem with the request itself). */
export function isOpenAiProviderUnavailable(error: { code?: unknown; type?: unknown; message?: unknown } | undefined): boolean {
  if (!error) return false;
  if (PROVIDER_UNAVAILABLE_CODES.has(String(error.code ?? "")) || PROVIDER_UNAVAILABLE_CODES.has(String(error.type ?? ""))) {
    return true;
  }
  return /exceeded your current quota|credit balance is too low|billing hard limit/i.test(String(error.message ?? ""));
}

/** What a function tool hands back to the model: plain text or text + images. */
export type EnrichToolOutput =
  | string
  | Array<
      | { type: "input_text"; text: string }
      | { type: "input_image"; image_url: string; detail?: "low" | "high" | "auto" }
    >;

/**
 * A server-side function the model may call mid-response, alongside
 * web_search. Every extra round is a billed Responses call, so each round's
 * cost is carried into the result.
 */
export interface EnrichFunctionTool {
  name: string;
  description: string;
  /** Strict JSON schema for the call arguments. */
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<EnrichToolOutput>;
}

/** Default cap on function-call rounds per attempt. */
export const DEFAULT_MAX_FUNCTION_ROUNDS = 25;

type FunctionCallItem = { type: "function_call"; call_id: string; name: string; arguments: string };

function functionCallsOf(body: OpenAiResponse): FunctionCallItem[] {
  return (body.output ?? []).filter(
    (item): item is FunctionCallItem =>
      item.type === "function_call" &&
      typeof (item as Partial<FunctionCallItem>).call_id === "string" &&
      typeof (item as Partial<FunctionCallItem>).name === "string"
  );
}

/** No single tool call may hold a row longer than this (a hanging website must not freeze the loop). */
export const TOOL_CALL_TIMEOUT_MS = 90_000;
/**
 * Time kept for the final answer. When less remains, pending tool calls are
 * answered with "time is up" and the model must answer with what it has
 * verified — instead of the attempt timing out and discarding all its work.
 */
export const ANSWER_RESERVE_MS = 75_000;

async function runFunctionCall(
  tools: EnrichFunctionTool[],
  call: FunctionCallItem,
  timeoutMs: number
): Promise<EnrichToolOutput> {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) return JSON.stringify({ error: `Unknown tool ${call.name}` });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
    const timedOut = new Promise<EnrichToolOutput>((resolve) => {
      timer = setTimeout(
        () => resolve(JSON.stringify({ error: "The tool timed out. Try another source." })),
        Math.max(1, timeoutMs)
      );
    });
    return await Promise.race([tool.run(args), timedOut]);
  } catch (error) {
    return JSON.stringify({ error: error instanceof Error ? error.message : "Tool failed" });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type EnrichResponseParser = (input: {
  selection: Record<string, unknown>;
  response: OpenAiResponse;
}) => Record<string, unknown> | Promise<Record<string, unknown>>;

export function requireOpenAiApiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  return key;
}

/** OpenAI failed to fetch a source `input_image` URL (dead dummy/CDN links). */
export function isOpenAiInputImageDownloadError(message: string): boolean {
  const text = message.toLowerCase();
  if (text.includes("error while downloading file")) return true;
  if (
    text.includes("upstream status code") &&
    /\b(401|403|404|410)\b/.test(text)
  ) {
    return true;
  }
  if (
    text.includes("invalid_image_url") ||
    text.includes("unable to download") ||
    text.includes("could not download") ||
    text.includes("error downloading")
  ) {
    return true;
  }
  return false;
}

function inputImageParts(imageUrls: string[]): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [];
  for (const url of imageUrls) {
    if (!url) continue;
    const imageUrl =
      url.startsWith("data:image/") || /^https?:\/\//i.test(url) ? url : null;
    if (!imageUrl) continue;
    parts.push({
      type: "input_image",
      image_url: imageUrl,
      detail: "high",
    });
  }
  return parts;
}

export async function runEnrichOpenAiResponse(params: {
  tier: EnrichSettings["enrichmentModel"];
  promptText: string;
  imageUrls: string[];
  policy: EnrichToolPolicy;
  schemaName: string;
  schema: Record<string, unknown>;
  enabledColumns: string[];
  enrichmentColumns?: EnrichColumnConfig[];
  kind?: SessionKind;
  rowData?: Record<string, string>;
  language?: string;
  workspaceCategories?: CategoryItem[];
  categoriesRawRows?: Record<string, string>[];
  cmsType?: string;
  maxCategories?: number;
  /** Sent as the Responses `instructions` field (stable prefix, cache friendly). */
  instructions?: string;
  /** Replaces the column-spec parser for agents with their own output contract. */
  parse?: EnrichResponseParser;
  /** web_search `filters`: only / never search these domains (≤100 each). */
  webSearchFilters?: { allowedDomains?: string[]; blockedDomains?: string[] };
  /**
   * Overrides `image_settings.max_results` (raw candidates OpenAI's search
   * returns), independent of `policy.imageCount` (the final output cap in
   * the schema's `maxItems`). Defaults to `policy.imageCount` so callers that
   * don't set this keep today's exact behavior.
   */
  imageSearchPoolSize?: number;
  /**
   * Overrides the tier's default reasoning effort (e.g. "xhigh" for a deeper,
   * slower search than the shared "high" ceiling). Only pass this for agents
   * that specifically need it — it is not the shared per-tier default.
   */
  reasoningEffortOverride?: EnrichReasoningEffort | "xhigh" | "max";
  /**
   * Sets `web_search.return_token_budget: "unlimited"` so a many-page search
   * is not cut off by the standard returned-token cap. Costs more and is
   * slower — only set this for agents that specifically need deep research.
   */
  unlimitedSearchContentBudget?: boolean;
  /**
   * Polled every few seconds while the call is in flight. Returning true
   * aborts the in-flight OpenAI request immediately (not billed) instead of
   * waiting for it to finish naturally — this is what makes Stop actually
   * stop instead of only blocking rows that have not started yet.
   */
  shouldCancel?: () => Promise<boolean>;
  /** Overrides the tier's model (agents with their own model choice). */
  modelOverride?: EnrichOpenAiModelId;
  /** Overrides the tier's web_search context size. */
  searchContextSizeOverride?: EnrichSearchContextSize | "low";
  /** Server-side functions the model may call; see EnrichFunctionTool. */
  functionTools?: EnrichFunctionTool[];
  /** Function-call rounds per attempt before the model must answer. */
  maxFunctionRounds?: number;
  /** Time budget shared by every round of one attempt. */
  attemptBudgetMs?: number;
}): Promise<{
  data: Record<string, unknown>;
  /** Every billed call for this result, including a failed first attempt. */
  costs: AiCallCost[];
  searchCallCount: number;
  model: EnrichOpenAiModelId;
}> {
  const apiKey = requireOpenAiApiKey();
  const model = params.modelOverride ?? resolveEnrichOpenAiModel(params.tier);
  const reasoningEffort = params.reasoningEffortOverride ?? resolveEnrichReasoningEffort(params.tier);
  const searchContextSize = params.searchContextSizeOverride ?? resolveEnrichSearchContextSize(params.tier);

  const webSearchTool: Record<string, unknown> = {
    type: "web_search",
    search_context_size: searchContextSize,
    external_web_access: true,
  };
  if (params.unlimitedSearchContentBudget) {
    webSearchTool.return_token_budget = "unlimited";
  }

  if (params.policy.searchContentTypes.includes("image")) {
    webSearchTool.search_content_types = params.policy.searchContentTypes;
    webSearchTool.image_settings = {
      max_results: params.imageSearchPoolSize ?? params.policy.imageCount,
      caption: true,
    };
  } else {
    // Text-only search — omit image content types
    webSearchTool.search_content_types = ["text"];
  }

  const filters: Record<string, string[]> = {};
  if (params.webSearchFilters?.allowedDomains?.length) {
    filters.allowed_domains = params.webSearchFilters.allowedDomains;
  }
  if (params.webSearchFilters?.blockedDomains?.length) {
    filters.blocked_domains = params.webSearchFilters.blockedDomains;
  }
  const hasFilters = Object.keys(filters).length > 0;

  const include: string[] = [];
  if (params.policy.includeResults) include.push("web_search_call.results");
  if (params.policy.includeSources) include.push("web_search_call.action.sources");

  // Shared by every attempt this call makes (fallback retries below reuse it),
  // so one user Stop click cancels all of them, not just the first.
  let cancelledByUser = false;

  const postOnce = async (imageUrls: string[], withFilters: boolean) => {
    const tool = withFilters ? { ...webSearchTool, filters } : webSearchTool;
    const content: Array<Record<string, unknown>> = [
      ...inputImageParts(imageUrls),
      { type: "input_text", text: params.promptText },
    ];

    console.log(`[Enrich OpenAI] Starting row enrichment`, {
      model,
      reasoningEffort,
      searchContextSize,
      toolChoice: params.policy.toolChoice,
      columns: params.enabledColumns,
      needsImages: params.policy.needsImages,
      needsSources: params.policy.needsSources,
      attachedSourceImages: imageUrls.length,
      domainFilters: withFilters ? filters : undefined,
    });

    const functionTools = params.functionTools ?? [];
    const maxRounds = params.maxFunctionRounds ?? DEFAULT_MAX_FUNCTION_ROUNDS;
    const baseRequest = {
      model,
      ...(params.instructions ? { instructions: params.instructions } : {}),
      reasoning: { effort: reasoningEffort },
      tools: [
        tool,
        ...functionTools.map((t) => ({
          type: "function",
          name: t.name,
          description: t.description,
          parameters: t.parameters,
          strict: true,
        })),
      ],
      ...(include.length > 0 ? { include } : {}),
      text: {
        format: {
          type: "json_schema",
          name: params.schemaName,
          strict: true,
          schema: params.schema,
        },
      },
      store: true,
    };

    // Every round of one attempt shares this deadline, so function-call
    // rounds can never stretch an attempt past its budget.
    const deadline = Date.now() + (params.attemptBudgetMs ?? ENRICH_CALL_TIMEOUT_MS);
    const costs: AiCallCost[] = [];
    let searchCallCount = 0;
    const fail = (message: string): never => {
      if (costs.length > 0) throw new EnrichBilledAttemptError(message, [...costs]);
      throw new Error(message);
    };
    const cancelled = (): never => {
      throw new EnrichCancelledError(undefined, [...costs]);
    };

    const send = async (request: Record<string, unknown>): Promise<OpenAiResponse> => {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) fail("timeout");
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(new Error("timeout")), remainingMs);
      const pollId = params.shouldCancel
        ? setInterval(() => {
            void params.shouldCancel!().then((isCancelled) => {
              if (!isCancelled) return;
              cancelledByUser = true;
              controller.abort(new Error("cancelled"));
            });
          }, CANCEL_POLL_MS)
        : undefined;

      let response: Response;
      try {
        response = await fetch(OPENAI_RESPONSES_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
      } catch (fetchError) {
        // The abort itself is what makes the fetch reject — catch it here (not
        // after, since a rejected fetch never reaches the line below) and only
        // convert it when the user actually caused it; a timeout abort keeps
        // its original error (plus any billed earlier rounds).
        if (cancelledByUser) cancelled();
        if (costs.length > 0) {
          fail(fetchError instanceof Error ? fetchError.message : String(fetchError));
        }
        throw fetchError;
      } finally {
        clearTimeout(timeoutId);
        if (pollId) clearInterval(pollId);
      }
      if (cancelledByUser) cancelled();

      const rawText = await response.text();
      let body: OpenAiResponse;
      try {
        body = JSON.parse(rawText) as OpenAiResponse;
      } catch {
        return fail(`OpenAI enrich returned invalid JSON (${response.status})`);
      }

      const roundSearchCalls = countWebSearchCalls(body);
      searchCallCount += roundSearchCalls;
      if (body.usage) {
        costs.push(calculateOpenAiWebSearchCost(model, body.usage, roundSearchCalls));
      }
      if (!response.ok) {
        if (isOpenAiProviderUnavailable(body.error)) {
          console.error("[Enrich OpenAI] Provider account unavailable", { status: response.status, code: body.error?.code });
          throw new EnrichProviderUnavailableError();
        }
        fail(body.error?.message || `OpenAI enrich failed (${response.status})`);
      }
      if (body.status && body.status !== "completed") {
        fail(`OpenAI enrich ended with status ${body.status}`);
      }
      return body;
    };

    let body = await send({
      ...baseRequest,
      tool_choice: params.policy.toolChoice,
      input: [{ role: "user", content }],
    });
    for (let round = 1; functionTools.length > 0; round += 1) {
      const calls = functionCallsOf(body);
      if (calls.length === 0) break;
      if (!body.id) fail("OpenAI enrich returned a function call without a response id");
      if (params.shouldCancel && (await params.shouldCancel())) {
        cancelledByUser = true;
        cancelled();
      }
      const toolBudgetMs = deadline - Date.now() - ANSWER_RESERVE_MS;
      const outOfTime = toolBudgetMs < 5_000;
      const outputs = await Promise.all(
        calls.map(async (call) => ({
          type: "function_call_output",
          call_id: call.call_id,
          output: outOfTime
            ? JSON.stringify({ error: "Research time is up. Answer now with what you have verified." })
            : await runFunctionCall(functionTools, call, Math.min(TOOL_CALL_TIMEOUT_MS, toolBudgetMs)),
        }))
      );
      if (cancelledByUser) cancelled();
      const mustAnswer = round >= maxRounds || outOfTime || deadline - Date.now() < ANSWER_RESERVE_MS;
      body = await send({
        ...baseRequest,
        previous_response_id: body.id,
        tool_choice: mustAnswer ? "none" : "auto",
        input: outputs,
      });
    }

    const selection = parseJsonObject(responseOutputText(body));
    if (!selection) {
      return fail("OpenAI enrich returned no parseable JSON output");
    }

    let data: Record<string, unknown>;
    try {
      data = params.parse
        ? await params.parse({ selection, response: body })
        : buildEnrichedData({
            selection,
            response: body,
            enabledColumns: params.enabledColumns,
            enrichmentColumns: params.enrichmentColumns,
            kind: params.kind,
            rowData: params.rowData,
            language: params.language,
            workspaceCategories: params.workspaceCategories,
            categoriesRawRows: params.categoriesRawRows,
            cmsType: params.cmsType,
            maxCategories: params.maxCategories,
          });
    } catch (error) {
      return fail(
        error instanceof Error ? error.message : "OpenAI enrich output could not be parsed"
      );
    }

    console.log(`[Enrich OpenAI] Finished`, {
      model,
      searchCallCount,
      rounds: costs.length,
      totalCost: costs.reduce((sum, c) => sum + c.totalCost, 0),
      notes:
        typeof selection.notes === "string"
          ? selection.notes.slice(0, 200)
          : undefined,
    });

    return { data, costs, searchCallCount, model };
  };

  // Each recovery (dead source image, rejected domain filter) is tried once;
  // billed costs from every attempt carry into the result or the final error.
  let imageUrls = params.imageUrls;
  let withFilters = hasFilters;
  const priorCosts: AiCallCost[] = [];
  for (;;) {
    try {
      const result = await postOnce(imageUrls, withFilters);
      return { ...result, costs: [...priorCosts, ...result.costs] };
    } catch (error) {
      // A user Stop click always wins — never retried, never billed for the
      // cancelled attempt itself, but any earlier billed attempt's cost on
      // this same row still reaches the caller.
      if (isEnrichCancelledError(error)) {
        throw new EnrichCancelledError((error as Error).message, [
          ...priorCosts,
          ...billedCostsOf(error),
        ]);
      }
      if (isEnrichProviderUnavailableError(error)) throw error;
      const message = error instanceof Error ? error.message : String(error);
      priorCosts.push(...billedCostsOf(error));
      if (inputImageParts(imageUrls).length > 0 && isOpenAiInputImageDownloadError(message)) {
        console.warn(
          `[Enrich OpenAI] Source image download failed; retrying without input_image`,
          { message }
        );
        imageUrls = [];
        continue;
      }
      if (withFilters && isOpenAiWebSearchFilterError(message)) {
        // Domain rules are still enforced on the results by the caller.
        console.warn(
          `[Enrich OpenAI] web_search filters rejected; retrying without them`,
          { message }
        );
        withFilters = false;
        continue;
      }
      if (priorCosts.length > 0) {
        throw new EnrichBilledAttemptError(message, priorCosts);
      }
      throw error;
    }
  }
}

/** OpenAI refused the web_search `filters` block (e.g. unsupported with image search). */
export function isOpenAiWebSearchFilterError(message: string): boolean {
  return /allowed_domains|blocked_domains|\bfilters\b/i.test(message);
}
