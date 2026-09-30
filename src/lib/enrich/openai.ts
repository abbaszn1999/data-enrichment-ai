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
 * Ceiling on a single OpenAI call. A row with several long columns (specs,
 * FAQ, descriptions) writes a long answer after a required web search, so this
 * is sized for that; two attempts must still fit ENRICH_ROW_TIMEOUT_SECONDS.
 */
export const ENRICH_CALL_TIMEOUT_MS = 420_000;

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

/**
 * The model ran out of output budget (`incomplete_details.reason ===
 * "max_output_tokens"`). The call is billed, and the same request would run
 * out again, so callers must not retry it.
 */
export class EnrichOutputTruncatedError extends EnrichBilledAttemptError {
  constructor(costs: AiCallCost[], maxOutputTokens?: number) {
    super(
      `The AI ran out of output space${
        maxOutputTokens ? ` (${maxOutputTokens.toLocaleString("en-US")} tokens)` : ""
      } before finishing this row. Select fewer columns or shorten the custom instructions, then run the row again.`,
      costs
    );
    this.name = "EnrichOutputTruncatedError";
  }
}

export function isEnrichOutputTruncatedError(error: unknown): error is EnrichOutputTruncatedError {
  return error instanceof EnrichOutputTruncatedError;
}

export function billedCostsOf(error: unknown): AiCallCost[] {
  if (error instanceof EnrichBilledAttemptError) return error.costs;
  if (error instanceof EnrichCancelledError) return error.costs;
  if (error instanceof EnrichProviderUnavailableError) return error.costs;
  return [];
}

/**
 * Stop was requested after an attempt failed, so no further attempt starts.
 * `costs` carries what OpenAI already billed for the row so it is still
 * charged. Callers must not retry this.
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
 * balance). Nothing about the row is wrong, so it must not be retried or
 * marked as an error: the job stops and the row stays pending. `costs` holds
 * rounds OpenAI already billed before the account ran out, which are charged.
 */
export class EnrichProviderUnavailableError extends Error {
  readonly costs: AiCallCost[];

  constructor(message = "AI service temporarily unavailable", costs: AiCallCost[] = []) {
    super(message);
    this.name = "EnrichProviderUnavailableError";
    this.costs = costs;
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
   * Checked between rounds, never mid-request: an in-flight OpenAI call is
   * billed whether or not we wait for it, so aborting it would pay for a
   * result and throw it away. Once this returns true the row wraps up — the
   * next round forces a final answer from what is already verified — and no
   * further attempts or retries start.
   */
  shouldCancel?: () => Promise<boolean>;
  /** Overrides the tier's model (agents with their own model choice). */
  modelOverride?: EnrichOpenAiModelId;
  /**
   * `false` sends no hosted web_search tool at all (no search charge, no
   * `include`, no `tool_choice`). Used by Categories mode, which classifies
   * from the row and the store's category list only.
   */
  webSearch?: boolean;
  /** Overrides the tier's web_search context size. */
  searchContextSizeOverride?: EnrichSearchContextSize | "low";
  /** Server-side functions the model may call; see EnrichFunctionTool. */
  functionTools?: EnrichFunctionTool[];
  /** Function-call rounds per attempt before the model must answer. */
  maxFunctionRounds?: number;
  /** Time budget shared by every round of one attempt. */
  attemptBudgetMs?: number;
  /** Sent as `max_output_tokens` (reasoning + answer). Omitted when unset. */
  maxOutputTokens?: number;
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

  const stopRequested = async (): Promise<boolean> => {
    if (!params.shouldCancel) return false;
    try {
      return await params.shouldCancel();
    } catch {
      // A failed control read must not end a paid-for call early.
      return false;
    }
  };

  const postOnce = async (imageUrls: string[], withFilters: boolean) => {
    const tool = withFilters ? { ...webSearchTool, filters } : webSearchTool;
    const content: Array<Record<string, unknown>> = [
      ...inputImageParts(imageUrls),
      { type: "input_text", text: params.promptText },
    ];

    console.log(`[Enrich OpenAI] Starting row enrichment`, {
      model,
      reasoningEffort,
      webSearch: params.webSearch !== false,
      searchContextSize,
      toolChoice: params.policy.toolChoice,
      columns: params.enabledColumns,
      needsImages: params.policy.needsImages,
      needsSources: params.policy.needsSources,
      attachedSourceImages: imageUrls.length,
      domainFilters: withFilters ? filters : undefined,
    });

    const functionTools = params.functionTools ?? [];
    const useWebSearch = params.webSearch !== false;
    const maxRounds = params.maxFunctionRounds ?? DEFAULT_MAX_FUNCTION_ROUNDS;
    const baseRequest = {
      model,
      ...(params.instructions ? { instructions: params.instructions } : {}),
      ...(params.maxOutputTokens ? { max_output_tokens: params.maxOutputTokens } : {}),
      reasoning: { effort: reasoningEffort },
      tools: [
        ...(useWebSearch ? [tool] : []),
        ...functionTools.map((t) => ({
          type: "function",
          name: t.name,
          description: t.description,
          parameters: t.parameters,
          strict: true,
        })),
      ],
      ...(useWebSearch && include.length > 0 ? { include } : {}),
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

    /**
     * One request, answered when OpenAI finishes it. Responses background
     * mode was tried (scripts/openai-background-lab.mts) and rejected: a
     * response cancelled mid-run reports usage 0 even though it worked, so
     * it cannot recover the cost of a timed-out call. The row/tier budgets
     * are therefore sized so calls normally finish, and only a call cut off
     * by the budget goes unrecorded (it is never charged to the customer).
     */
    const sendDirect = async (
      request: Record<string, unknown>,
      remainingMs: number
    ): Promise<{ ok: boolean; status: number; rawText: string }> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(new Error("timeout")), remainingMs);
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
        if (costs.length > 0) {
          fail(fetchError instanceof Error ? fetchError.message : String(fetchError));
        }
        throw fetchError;
      } finally {
        clearTimeout(timeoutId);
      }
      return { ok: response.ok, status: response.status, rawText: await response.text() };
    };

    const send = async (request: Record<string, unknown>): Promise<OpenAiResponse> => {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) fail("timeout");

      const { ok, status: httpStatus, rawText } = await sendDirect(request, remainingMs);
      let body: OpenAiResponse;
      try {
        body = JSON.parse(rawText) as OpenAiResponse;
      } catch {
        return fail(`OpenAI enrich returned invalid JSON (${httpStatus})`);
      }

      const roundSearchCalls = countWebSearchCalls(body);
      searchCallCount += roundSearchCalls;
      // Recorded before anything below can fail, so a billed call is never lost.
      if (body.usage) {
        costs.push(calculateOpenAiWebSearchCost(model, body.usage, roundSearchCalls));
      } else if (ok && body.status === "completed") {
        console.error("[Enrich OpenAI] Completed response carried no usage; this call cannot be costed", {
          id: body.id,
          model,
        });
      }
      if (!ok || body.status === "failed") {
        if (isOpenAiProviderUnavailable(body.error)) {
          console.error("[Enrich OpenAI] Provider account unavailable", { status: httpStatus, code: body.error?.code });
          throw new EnrichProviderUnavailableError(undefined, [...costs]);
        }
        fail(body.error?.message || `OpenAI enrich failed (${httpStatus})`);
      }
      if (body.status === "incomplete" && body.incomplete_details?.reason === "max_output_tokens") {
        // Usage was recorded above, so the attempt is charged.
        throw new EnrichOutputTruncatedError([...costs], params.maxOutputTokens);
      }
      if (body.status && body.status !== "completed") {
        fail(`OpenAI enrich ended with status ${body.status}`);
      }
      return body;
    };

    let body = await send({
      ...baseRequest,
      // With no tools at all the API rejects a tool_choice.
      ...(useWebSearch || functionTools.length > 0 ? { tool_choice: params.policy.toolChoice } : {}),
      input: [{ role: "user", content }],
    });
    for (let round = 1; functionTools.length > 0; round += 1) {
      const calls = functionCallsOf(body);
      if (calls.length === 0) break;
      if (!body.id) fail("OpenAI enrich returned a function call without a response id");
      // Stop: finish this row with what is already verified instead of
      // discarding the rounds OpenAI has billed so far.
      const stopping = await stopRequested();
      const toolBudgetMs = deadline - Date.now() - ANSWER_RESERVE_MS;
      const outOfTime = toolBudgetMs < 5_000;
      const outputs = await Promise.all(
        calls.map(async (call) => ({
          type: "function_call_output",
          call_id: call.call_id,
          output: stopping
            ? JSON.stringify({ error: "The run was stopped. Answer now with what you have verified." })
            : outOfTime
              ? JSON.stringify({ error: "Research time is up. Answer now with what you have verified." })
              : await runFunctionCall(functionTools, call, Math.min(TOOL_CALL_TIMEOUT_MS, toolBudgetMs)),
        }))
      );
      const mustAnswer =
        stopping || round >= maxRounds || outOfTime || deadline - Date.now() < ANSWER_RESERVE_MS;
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
      // A user Stop click always wins — never retried; any cost OpenAI already
      // billed on this row still reaches the caller.
      if (isEnrichCancelledError(error)) {
        throw new EnrichCancelledError((error as Error).message, [
          ...priorCosts,
          ...billedCostsOf(error),
        ]);
      }
      if (isEnrichProviderUnavailableError(error)) {
        throw new EnrichProviderUnavailableError(error.message, [...priorCosts, ...billedCostsOf(error)]);
      }
      const message = error instanceof Error ? error.message : String(error);
      priorCosts.push(...billedCostsOf(error));
      if (isEnrichOutputTruncatedError(error)) {
        throw new EnrichOutputTruncatedError(priorCosts, params.maxOutputTokens);
      }
      // After Stop, no fallback attempt starts; the row stays pending and is
      // charged only for what was already billed.
      if (await stopRequested()) {
        throw new EnrichCancelledError(undefined, [...priorCosts]);
      }
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
