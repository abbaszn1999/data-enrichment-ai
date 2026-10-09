/**
 * Products Visualizer planner. One GPT-6.1 Sol (medium) call per row sees every
 * reference image (product photos, brand guide, logo) plus the row data, the
 * selected layout and the custom instructions. It returns plain page copy and a
 * complete Nano Banana prompt for every image slot; code checks the answer and
 * renders the page from the layout's fixed template (planner-plan.ts,
 * templates.ts). Every billed round is returned for billing.
 */
import type { AiCallCost } from "@/lib/ai-pricing";
import { bufferToDataUrl } from "@/lib/ai-images/reference-image";
import {
  VISUALIZER_PLANNER_OPENAI_MODEL,
  VISUALIZER_PLANNER_REASONING_EFFORT,
} from "@/lib/enrich/models";
import {
  billedCostsOf,
  isEnrichCancelledError,
  isEnrichProviderUnavailableError,
  runEnrichOpenAiResponse,
  type EnrichResponseParser,
} from "@/lib/enrich/openai";
import type { EnrichToolPolicy } from "@/lib/enrich/policy";
import type { AiReferenceImage } from "@/lib/gallery/agents/ai-shared";
import { classifyRowValues } from "@/lib/gallery/agents/gallery-brief";
import { buildVisualizerPlannerBrief } from "@/lib/visualizer/agents/planner-brief";
import {
  buildVisualizerPlannerSchema,
  guardVisualizerPlan,
  type GuardedVisualizerPlan,
} from "@/lib/visualizer/agents/planner-plan";
import { clampVisualizerImageCount } from "@/lib/visualizer/layouts";
import { visualizerLog, visualizerWarn } from "@/lib/visualizer/log";
import { loadVisualizerSkill } from "@/lib/visualizer/skill-loader";
import {
  resolveVisualizerImageModel,
  type VisualizerProjectSettings,
  type VisualizerRow,
} from "@/lib/visualizer/types";

/** A planner failure that still carries every billed OpenAI round. */
export class VisualizerPlannerError extends Error {
  readonly costs: AiCallCost[];
  constructor(message: string, costs: AiCallCost[]) {
    super(message);
    this.name = "VisualizerPlannerError";
    this.costs = costs;
  }
}

const PLANNER_ATTEMPT_BUDGET_MS = 240_000;
const PLANNER_MAX_OUTPUT_TOKENS = 24_000;

export type VisualizerPlanResult = GuardedVisualizerPlan & {
  /** Every billed planner round. */
  costs: AiCallCost[];
  model: string;
};

export interface PlanVisualizerParams {
  row: Pick<VisualizerRow, "id" | "originalData">;
  settings: VisualizerProjectSettings;
  /** Reference images in send order (products, brand guide, logo). */
  references: AiReferenceImage[];
  shouldCancel?: () => Promise<boolean>;
}

export async function planVisualizerContent(params: PlanVisualizerParams): Promise<VisualizerPlanResult> {
  const { settings } = params;
  const layoutId = settings.description.layoutId;
  const imageCount = clampVisualizerImageCount(layoutId, settings.description.imageCount);
  const imageModel = resolveVisualizerImageModel(settings.images.tier);
  const classified = classifyRowValues(params.row.originalData, settings.selectedColumns, { fieldChars: 1_200 });
  const attached = params.references.filter((image) => image.buffer && image.buffer.length > 0);
  const hasLogo = attached.some((image) => image.role === "logo");
  const skill = await loadVisualizerSkill("description");
  const imageUrls = attached.map((image) => bufferToDataUrl(image.buffer as Buffer, image.contentType || "image/jpeg"));
  const brandColors =
    settings.images.brandingEnabled && settings.images.brandGuideMode === "colors"
      ? settings.images.brandColors
      : undefined;

  let guardedResult: GuardedVisualizerPlan | null = null;
  let strictVariety = true;
  const parse: EnrichResponseParser = async ({ selection }) => {
    guardedResult = guardVisualizerPlan(selection, imageCount, { hasLogo, layoutId, brandColors, strictVariety });
    return { ok: true };
  };

  const policy: EnrichToolPolicy = {
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

  visualizerLog("description-agent", "Planning Visualizer row", {
    rowId: params.row.id,
    model: VISUALIZER_PLANNER_OPENAI_MODEL,
    layoutId: settings.description.layoutId,
    imageCount,
    images: imageUrls.length,
    imageModel,
  });

  const priorCosts: AiCallCost[] = [];
  let retryHint: string | undefined;
  // One retry: a rare unusable answer (missing marker, short prompt) is worth a second try.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const brief = buildVisualizerPlannerBrief({
      classified,
      layoutId: settings.description.layoutId,
      count: imageCount,
      imageModel,
      images: settings.images,
      brand: settings.brand,
      customInstructions: settings.description.instructions,
      references: attached.map((image) => ({ role: image.role, label: image.label })),
      retryHint,
    });
    try {
      const result = await runEnrichOpenAiResponse({
        tier: "standard",
        promptText: brief,
        imageUrls,
        policy,
        schemaName: "visualizer_plan",
        schema: buildVisualizerPlannerSchema(layoutId, imageCount),
        enabledColumns: [],
        instructions: skill.instructions,
        parse,
        modelOverride: VISUALIZER_PLANNER_OPENAI_MODEL,
        reasoningEffortOverride: VISUALIZER_PLANNER_REASONING_EFFORT,
        webSearch: false,
        attemptBudgetMs: PLANNER_ATTEMPT_BUDGET_MS,
        maxOutputTokens: PLANNER_MAX_OUTPUT_TOKENS,
        shouldCancel: params.shouldCancel,
      });
      const guarded = guardedResult as GuardedVisualizerPlan | null;
      if (!guarded) throw new Error("Planner returned an unreadable response");
      return { ...guarded, costs: [...priorCosts, ...result.costs], model: result.model };
    } catch (error) {
      priorCosts.push(...billedCostsOf(error));
      const message = error instanceof Error ? error.message : "Planner failed";
      const retryable =
        attempt === 1 && !isEnrichCancelledError(error) && !isEnrichProviderUnavailableError(error);
      if (!retryable) throw new VisualizerPlannerError(message, priorCosts);
      visualizerWarn("description-agent", "Planner attempt failed; retrying once", {
        rowId: params.row.id,
        message,
      });
      retryHint = message;
      guardedResult = null;
      strictVariety = false;
    }
  }
  throw new VisualizerPlannerError("Planner failed", priorCosts);
}
