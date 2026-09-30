/**
 * Products Gallery generate mode: the prompt planner. One GPT-6.1 Sol (medium)
 * call per row sees every reference image (product photos, model / scene,
 * brand guide, logo) plus the row data and custom instructions, and returns a
 * complete Nano Banana prompt for each requested gallery image. Code re-checks
 * the answer (planner-plan.ts) and every billed round is returned for billing.
 */
import type { AiCallCost } from "@/lib/ai-pricing";
import {
  GALLERY_PLANNER_OPENAI_MODEL,
  GALLERY_PLANNER_REASONING_EFFORT,
} from "@/lib/enrich/models";
import {
  billedCostsOf,
  isEnrichCancelledError,
  isEnrichProviderUnavailableError,
  runEnrichOpenAiResponse,
  type EnrichResponseParser,
} from "@/lib/enrich/openai";
import type { EnrichToolPolicy } from "@/lib/enrich/policy";
import type { AiImageModel, AiReferenceImage } from "@/lib/gallery/agents/ai-shared";
import { classifyRowValues } from "@/lib/gallery/agents/gallery-brief";
import { buildPlannerBrief, formatRowFields } from "@/lib/gallery/agents/planner-brief";
import {
  buildPlannerResponseSchema,
  galleryPlanFingerprint,
  guardGalleryPlan,
  readStoredGalleryPlan,
  type GalleryPlannerPlan,
} from "@/lib/gallery/agents/planner-plan";
import { bufferToDataUrl } from "@/lib/ai-images/reference-image";
import { galleryLog, galleryWarn } from "@/lib/gallery/log";
import { loadGallerySkill } from "@/lib/gallery/skill-loader";
import type { GalleryAiSettings, GalleryRow } from "@/lib/gallery/types";

export type { GalleryPlannerPlan, GalleryShotBrief } from "@/lib/gallery/agents/planner-plan";

/** A planner failure that still carries every billed OpenAI round. */
export class GalleryPlannerError extends Error {
  readonly costs: AiCallCost[];
  constructor(message: string, costs: AiCallCost[]) {
    super(message);
    this.name = "GalleryPlannerError";
    this.costs = costs;
  }
}

const PLANNER_ATTEMPT_BUDGET_MS = 240_000;
const PLANNER_MAX_OUTPUT_TOKENS = 24_000;

export interface PlanGalleryImagesParams {
  row: Pick<GalleryRow, "id" | "originalData" | "sourceMeta">;
  selectedColumns: string[];
  settings: GalleryAiSettings;
  imageModel: AiImageModel;
  galleryCount: number;
  /** Reference images in send order (products, model, brand guide, logo). */
  references: AiReferenceImage[];
  shouldCancel?: () => Promise<boolean>;
}

export interface PlanGalleryImagesResult {
  plan: GalleryPlannerPlan;
  /** Every billed planner round; empty when a stored plan was reused. */
  costs: AiCallCost[];
  model: string;
  reused: boolean;
}

export async function planGalleryImages(params: PlanGalleryImagesParams): Promise<PlanGalleryImagesResult> {
  const galleryCount = Math.min(8, Math.max(1, Math.floor(params.galleryCount) || 1));
  const settings = params.settings;
  const classified = classifyRowValues(params.row.originalData, params.selectedColumns, { fieldChars: 1_200 });
  const attached = params.references.filter((image) => image.buffer && image.buffer.length > 0);
  const hasLogo = attached.some((image) => image.role === "logo");

  const fingerprint = galleryPlanFingerprint({
    galleryCount,
    tier: settings.tier,
    aspectRatio: settings.aspectRatio,
    style: settings.style || "studio",
    instructions: settings.instructions || "",
    rowText: formatRowFields(classified),
    referenceKeys: attached.map((image) => `${image.role}:${image.key ?? ""}`),
    brandingEnabled: settings.brandingEnabled,
    brandGuideMode: settings.brandGuideMode,
    brandColors: settings.brandColors || [],
    groundWithSearch: !!settings.groundWithSearch,
  });

  const stored = readStoredGalleryPlan(params.row, fingerprint, galleryCount);
  if (stored) {
    galleryLog("ai-planner", "Reusing stored Gallery plan", { rowId: params.row.id, galleryCount });
    return { plan: stored, costs: [], model: "cached", reused: true };
  }

  const skill = await loadGallerySkill("planner");
  const brief = buildPlannerBrief({
    classified,
    count: galleryCount,
    settings,
    imageModel: params.imageModel,
    references: attached.map((image) => ({ role: image.role, label: image.label })),
  });
  const imageUrls = attached.map((image) =>
    bufferToDataUrl(image.buffer as Buffer, image.contentType || "image/jpeg")
  );

  let guardedResult: ReturnType<typeof guardGalleryPlan> | null = null;
  const parse: EnrichResponseParser = async ({ selection }) => {
    guardedResult = guardGalleryPlan(selection, galleryCount, { hasLogo });
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

  galleryLog("ai-planner", "Planning Gallery prompts", {
    rowId: params.row.id,
    model: GALLERY_PLANNER_OPENAI_MODEL,
    galleryCount,
    images: imageUrls.length,
    imageModel: params.imageModel,
  });

  const priorCosts: AiCallCost[] = [];
  // One retry: a rare unusable answer (short prompt, wrong count) is worth a second try.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await runEnrichOpenAiResponse({
        tier: "standard",
        promptText: brief,
        imageUrls,
        policy,
        schemaName: "gallery_prompt_plan",
        schema: buildPlannerResponseSchema(galleryCount),
        enabledColumns: [],
        instructions: skill.instructions,
        parse,
        modelOverride: GALLERY_PLANNER_OPENAI_MODEL,
        reasoningEffortOverride: GALLERY_PLANNER_REASONING_EFFORT,
        webSearch: false,
        attemptBudgetMs: PLANNER_ATTEMPT_BUDGET_MS,
        maxOutputTokens: PLANNER_MAX_OUTPUT_TOKENS,
        shouldCancel: params.shouldCancel,
      });
      const guarded = guardedResult as ReturnType<typeof guardGalleryPlan> | null;
      if (!guarded) throw new Error("Gallery planner returned an unreadable response");
      return {
        plan: {
          fingerprint,
          productIdentity: guarded.productIdentity,
          gallery: guarded.gallery,
          notes: guarded.notes,
        },
        costs: [...priorCosts, ...result.costs],
        model: result.model,
        reused: false,
      };
    } catch (error) {
      priorCosts.push(...billedCostsOf(error));
      const message = error instanceof Error ? error.message : "Gallery planner failed";
      const retryable =
        attempt === 1 && !isEnrichCancelledError(error) && !isEnrichProviderUnavailableError(error);
      if (!retryable) throw new GalleryPlannerError(message, priorCosts);
      galleryWarn("ai-planner", "Planner attempt failed; retrying once", { rowId: params.row.id, message });
      guardedResult = null;
    }
  }
  throw new GalleryPlannerError("Gallery planner failed", priorCosts);
}
