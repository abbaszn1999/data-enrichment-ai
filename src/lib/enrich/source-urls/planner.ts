/**
 * Source URLs planner: ONE GPT-6.1 Sol call per run (no web search) that reads
 * the owner's custom instruction, the ticked columns and a few sample values,
 * and writes up to 5 search requests (./plan.ts). The caller bills every round
 * it returns; this function never throws, so a planner problem can never fail
 * a job: it returns the default plan (today's single query) and the reason.
 */
import type { AiCallCost } from "@/lib/ai-pricing";
import { SOURCE_URLS_PLANNER_OPENAI_MODEL, SOURCE_URLS_PLANNER_REASONING_EFFORT } from "../models";
import {
  billedCostsOf,
  isEnrichCancelledError,
  isEnrichProviderUnavailableError,
  runEnrichOpenAiResponse,
  type EnrichResponseParser,
} from "../openai";
import type { EnrichToolPolicy } from "../policy";
import { defaultSourceUrlsPlan, validatePlanSteps, type SourceUrlsPlan, type SourceUrlsPlanStep } from "./plan";
import {
  buildSourceUrlsPlannerBrief,
  buildSourceUrlsPlannerSchema,
  SOURCE_URLS_PLANNER_INSTRUCTIONS,
  type PlannerColumn,
} from "./planner-skill";

const PLANNER_ATTEMPT_BUDGET_MS = 120_000;
/** Reasoning plus a few short requests; far above what is needed, it is only a ceiling. */
const PLANNER_MAX_OUTPUT_TOKENS = 16_000;
/** Two tries: a rare unusable answer is worth one more call, never more. */
const PLANNER_ATTEMPTS = 2;

export interface PlanSourceUrlsInput {
  instruction: string;
  columns: PlannerColumn[];
  hasPhoto: boolean;
  shouldCancel?: () => Promise<boolean>;
}

export interface PlanSourceUrlsResult {
  plan: SourceUrlsPlan;
  /** Every OpenAI round billed, including a failed first try. Empty when nothing was billed. */
  costs: AiCallCost[];
}

const POLICY: EnrichToolPolicy = {
  needsImages: false,
  needsSources: false,
  needsCategories: false,
  textColumnIds: [],
  toolChoice: "auto",
  searchContentTypes: ["text"],
  imageCount: 0,
  sourceCount: 0,
  includeResults: false,
  includeSources: false,
};

export async function planSourceUrls(input: PlanSourceUrlsInput): Promise<PlanSourceUrlsResult> {
  const columnNames = input.columns.map((column) => column.name);
  if (!input.instruction.trim() || columnNames.length === 0) {
    return { plan: defaultSourceUrlsPlan("nothing to plan"), costs: [] };
  }

  const costs: AiCallCost[] = [];
  let steps: SourceUrlsPlanStep[] = [];
  let notes = "";
  let retryHint: string | undefined;
  let lastReason = "";

  const parse: EnrichResponseParser = async ({ selection }) => {
    const validated = validatePlanSteps(selection.steps, columnNames);
    if (validated.steps.length === 0) {
      const why = validated.dropped.slice(0, 3).join("; ") || "no steps";
      throw new Error(`no usable search requests (${why})`);
    }
    if (validated.dropped.length > 0) {
      console.warn("[Source URLs planner] Some requests were dropped", { dropped: validated.dropped });
    }
    steps = validated.steps;
    notes = typeof selection.notes === "string" ? selection.notes.trim().slice(0, 300) : "";
    return { ok: true };
  };

  for (let attempt = 1; attempt <= PLANNER_ATTEMPTS; attempt += 1) {
    try {
      const result = await runEnrichOpenAiResponse({
        tier: "standard",
        promptText: buildSourceUrlsPlannerBrief({
          columns: input.columns,
          hasPhoto: input.hasPhoto,
          instruction: input.instruction,
          retryHint,
        }),
        imageUrls: [],
        policy: POLICY,
        schemaName: "source_urls_plan",
        schema: buildSourceUrlsPlannerSchema(),
        enabledColumns: [],
        instructions: SOURCE_URLS_PLANNER_INSTRUCTIONS,
        parse,
        modelOverride: SOURCE_URLS_PLANNER_OPENAI_MODEL,
        reasoningEffortOverride: SOURCE_URLS_PLANNER_REASONING_EFFORT,
        webSearch: false,
        attemptBudgetMs: PLANNER_ATTEMPT_BUDGET_MS,
        maxOutputTokens: PLANNER_MAX_OUTPUT_TOKENS,
        shouldCancel: input.shouldCancel,
      });
      costs.push(...result.costs);
      console.log("[Source URLs planner] Plan ready", {
        steps: steps.map((step) => ({ name: step.name, text: step.text })),
        notes,
        rounds: result.costs.length,
      });
      return {
        plan: {
          version: 1,
          source: "planner",
          steps,
          columns: columnNames,
          model: result.model,
          ...(notes ? { notes } : {}),
        },
        costs,
      };
    } catch (error) {
      costs.push(...billedCostsOf(error));
      lastReason = error instanceof Error ? error.message : "planner failed";
      const stop = isEnrichCancelledError(error) || isEnrichProviderUnavailableError(error);
      if (stop || attempt === PLANNER_ATTEMPTS) break;
      console.warn("[Source URLs planner] Attempt failed; trying once more", { message: lastReason.slice(0, 200) });
      retryHint = lastReason.slice(0, 200);
      steps = [];
    }
  }

  console.warn("[Source URLs planner] No plan; the default query is used for every search", {
    reason: lastReason.slice(0, 200),
  });
  return { plan: defaultSourceUrlsPlan(lastReason.slice(0, 200)), costs };
}
