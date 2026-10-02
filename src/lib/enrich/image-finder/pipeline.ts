import type { AiCallCost } from "@/lib/ai-pricing";
import { IMAGE_SOURCES_COLUMN_ID, PRODUCT_MODE_COLUMN_IDS, type ImageUrl } from "@/types";
import {
  billedCostsOf,
  EnrichBilledAttemptError,
  EnrichCancelledError,
  EnrichProviderUnavailableError,
} from "../openai";
import type { EnrichAgentParams, EnrichAgentResult } from "../types";
import { findProductImagesExact, IMAGE_FINDER_EXACT_BUDGET_MS } from "./exact/agent";
import {
  imageFinderFoundByKey,
  imageFinderMatchBasisKey,
  imageFinderMatchNoteKey,
  imageFinderNotFoundKey,
} from "./not-found";
import { findProductImagesPremium, IMAGE_FINDER_ATTEMPT_BUDGET_MS } from "./premium-agent";
import { buildImageSourceUrls } from "./sources";
import { findProductImagesStandard, IMAGE_FINDER_STANDARD_BUDGET_MS } from "./standard-agent";

const IMAGE_COLUMN_ID = PRODUCT_MODE_COLUMN_IDS.images;

export type ImageFinderTier = "standard" | "exact" | "premium";

/**
 * The one place the order lives. Cheapest and fastest first; a later tier
 * only runs when every earlier one returned zero verified images.
 */
export const IMAGE_FINDER_TIER_ORDER: readonly ImageFinderTier[] = ["standard", "exact", "premium"];

/** Whole-row deadline for the chain; the row backstop (jobs/config.ts) sits above it. */
export const IMAGE_FINDER_CHAIN_BUDGET_MS = 2_100_000;

/** Slack per tier on top of its own research budget: image checks, page fetches, parsing. */
const TIER_OVERHEAD_MS = 60_000;
/** Exact runs up to two Google AI Mode searches (120 s each) before its OpenAI call. */
const EXACT_SEARCHES_MS = 2 * 120_000;

/** Worst-case time a tier needs; a tier is skipped when the row deadline leaves less. */
export const IMAGE_FINDER_TIER_BUDGET_MS: Record<ImageFinderTier, number> = {
  standard: IMAGE_FINDER_STANDARD_BUDGET_MS + TIER_OVERHEAD_MS,
  exact: EXACT_SEARCHES_MS + IMAGE_FINDER_EXACT_BUDGET_MS + TIER_OVERHEAD_MS,
  premium: IMAGE_FINDER_ATTEMPT_BUDGET_MS + TIER_OVERHEAD_MS,
};

const TIER_LABEL: Record<ImageFinderTier, string> = {
  standard: "Standard",
  exact: "Exact",
  premium: "Premium",
};

const MAX_TIER_NOTE_CHARS = 700;

type TierRunner = (params: EnrichAgentParams) => Promise<EnrichAgentResult>;

export interface ImageFinderPipelineDeps {
  runners?: Partial<Record<ImageFinderTier, TierRunner>>;
  now?: () => number;
  /** Overrides the tier order (tests). */
  order?: readonly ImageFinderTier[];
  chainBudgetMs?: number;
}

const DEFAULT_RUNNERS: Record<ImageFinderTier, TierRunner> = {
  standard: findProductImagesStandard,
  exact: findProductImagesExact,
  premium: findProductImagesPremium,
};

function imagesOf(data: Record<string, unknown>): ImageUrl[] {
  const value = data[IMAGE_COLUMN_ID];
  return Array.isArray(value) ? (value as ImageUrl[]) : [];
}

function tierNote(data: Record<string, unknown>): string {
  const reason = data[imageFinderNotFoundKey(IMAGE_COLUMN_ID)];
  const text = typeof reason === "string" ? reason.trim() : "";
  return (text || "no images found").slice(0, MAX_TIER_NOTE_CHARS);
}

function notFoundData(reason: string): Record<string, unknown> {
  return {
    [IMAGE_COLUMN_ID]: [],
    [IMAGE_SOURCES_COLUMN_ID]: [],
    [imageFinderNotFoundKey(IMAGE_COLUMN_ID)]: reason,
    [imageFinderMatchBasisKey(IMAGE_COLUMN_ID)]: "",
    [imageFinderMatchNoteKey(IMAGE_COLUMN_ID)]: "",
    [imageFinderFoundByKey(IMAGE_COLUMN_ID)]: "",
  };
}

/**
 * Which internal steps a row runs.
 * Standard (the sidebar default) is Exact only: Google finds the product
 * pages, then the image agent takes the photos. No page means Not found.
 * Premium is the chain: the fast agent, then Exact, then the deep agent.
 * The first step that returns a real image stops the row.
 * A re-check stays on that choice: Exact again for Standard, the deep agent for Premium.
 */
export function imageFinderRunOrder(
  params: Pick<EnrichAgentParams, "settings" | "recheck">
): readonly ImageFinderTier[] {
  const premium = params.settings?.enrichmentModel === "premium";
  if (params.recheck) return premium ? ["premium"] : ["exact"];
  return premium ? IMAGE_FINDER_TIER_ORDER : ["exact"];
}

/**
 * Image Finder for one row. The first step that returns at least one verified
 * image wins and the chain stops — even when that result is only a similar or
 * best-match item. A later step runs only when the earlier one returned zero
 * images, and Not found is reported only after every step that was allowed to
 * run has honestly failed.
 *
 * Billing: every tier's costs (OpenAI tokens, web searches, Google AI Mode
 * calls) are returned together, including the costs carried by errors, so
 * the row is charged once for everything that actually ran.
 *
 * Errors: Stop (cancel) and an out-of-quota AI account end the row at once.
 * Any other tier failure means that tier did not get to answer; the chain
 * moves on, and if nothing is found afterwards the row is reported as an
 * error (never a false Not found) so it can simply be run again.
 *
 * `recheck` (the sheet-level final pass over Not-found rows) repeats the
 * chosen depth: Exact again on Standard, the deep agent alone on Premium.
 */
export async function findProductImagesAuto(
  params: EnrichAgentParams,
  deps: ImageFinderPipelineDeps = {}
): Promise<EnrichAgentResult> {
  const now = deps.now ?? Date.now;
  const order = deps.order ?? imageFinderRunOrder(params);
  const runners = { ...DEFAULT_RUNNERS, ...deps.runners };
  const deadline = now() + (deps.chainBudgetMs ?? IMAGE_FINDER_CHAIN_BUDGET_MS);

  const costs: AiCallCost[] = [];
  const notes: string[] = [];
  const failures: string[] = [];
  const tiersRun: string[] = [];

  for (const tier of order) {
    const label = TIER_LABEL[tier];
    if (params.shouldCancel && (await params.shouldCancel().catch(() => false))) {
      throw new EnrichCancelledError("Cancelled by user", costs);
    }
    if (deadline - now() < IMAGE_FINDER_TIER_BUDGET_MS[tier]) {
      const skipped = `${label}: skipped, not enough time left for this row`;
      notes.push(skipped);
      failures.push(skipped);
      console.warn("[Image Finder] Tier skipped for time", { tier, remainingMs: deadline - now() });
      continue;
    }

    const startedAt = now();
    tiersRun.push(tier);
    try {
      const result = await runners[tier](params);
      costs.push(...result.costs);
      const images = imagesOf(result.data);
      console.log("[Image Finder] Tier finished", {
        tier,
        images: images.length,
        ms: now() - startedAt,
        costs: result.costs.length,
      });
      if (images.length > 0) {
        return {
          data: {
            ...result.data,
            [IMAGE_SOURCES_COLUMN_ID]: buildImageSourceUrls(images),
            [imageFinderNotFoundKey(IMAGE_COLUMN_ID)]: "",
            [imageFinderFoundByKey(IMAGE_COLUMN_ID)]: tier,
          },
          costs,
          meta: { tiersRun, foundBy: tier },
        };
      }
      notes.push(`${label}: ${tierNote(result.data)}`);
    } catch (error) {
      costs.push(...billedCostsOf(error));
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof EnrichCancelledError) throw new EnrichCancelledError(message, costs);
      if (error instanceof EnrichProviderUnavailableError) throw new EnrichProviderUnavailableError(message, costs);
      console.warn("[Image Finder] Tier failed, moving on", { tier, message, ms: now() - startedAt });
      const failed = `${label}: failed (${message.slice(0, MAX_TIER_NOTE_CHARS)})`;
      notes.push(failed);
      failures.push(failed);
    }
  }

  if (failures.length > 0) {
    throw new EnrichBilledAttemptError(
      `Image search could not finish on every step, so this is not a confirmed Not found. ${notes.join("; ")}`,
      costs
    );
  }
  return { data: notFoundData(notes.join("; ")), costs, meta: { tiersRun } };
}
