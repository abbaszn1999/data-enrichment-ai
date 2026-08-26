import type { SupabaseClient } from "@supabase/supabase-js";
import type { DetectedProduct, IntegrationRecord } from "@/lib/sync/core/types";
import { getProvider, isProviderSupported } from "@/lib/sync/core/registry";
import { loadProjectSliceAdmin } from "@/lib/market-research/storage-admin";
import type { ProposedCollection } from "@/components/market-research/workspace-data";
import { classifyProducts } from "./classify";
import { holdSyncRun, settleSyncRun } from "./wallet-ops";
import {
  advanceWatermark,
  finishRun,
  loadIntegration,
  loadWatermarks,
  recordDecisions,
  releaseRule,
  startRun,
} from "./repo";
import type {
  ClassificationTarget,
  Decision,
  RunOutcome,
  SyncRuleRecord,
} from "./types";

/**
 * The Growth Sync pipeline.
 *
 * Provider-agnostic by construction: everything store-shaped is reached through
 * `getProvider(...)`, and this file never imports a provider module. That is
 * what makes adding a CMS a matter of registering it rather than editing here.
 */

type Admin = SupabaseClient;

/** Raised for conditions that are the rule's fault, not a transient failure,
 *  so the caller can disable the rule instead of retrying it hourly. */
class RuleConfigError extends Error {}

/**
 * The project's taxonomies that exist on the store. A collection that was never
 * pushed has no live reference, so it cannot receive products.
 */
async function loadTargets(
  admin: Admin,
  rule: SyncRuleRecord
): Promise<ClassificationTarget[]> {
  const collections = await loadProjectSliceAdmin<ProposedCollection[]>(
    admin,
    rule.workspace_id,
    rule.project_id,
    "collections"
  ).catch(() => [] as ProposedCollection[]);

  if (!Array.isArray(collections)) return [];
  return collections
    .filter((collection) => Boolean(collection.storeCollectionId))
    .map((collection) => ({
      collectionId: collection.id,
      taxonomyRef: String(collection.storeCollectionId),
      name: collection.name,
      targetKeyword: collection.headKeyword || undefined,
    }));
}

/**
 * Products classified in a single run.
 *
 * Matches `classify.ts`'s `PRODUCTS_PER_CALL`, so a run's whole backlog is one
 * Gemini call. The ceiling exists because a run has to finish inside one HTTP
 * request: the agent is called in batches, and an unbounded backlog would be
 * killed mid-pipeline, leaving a hold charged against the wallet and the run
 * row stuck on "running". Whatever does not fit is not lost — the watermark
 * simply stops below it and the next run continues from there (immediately,
 * not on the next scheduled tick — see `dueNow` below).
 */
const MAX_PRODUCTS_PER_RUN = 100;

type Entry = { product: DetectedProduct; createdMs: number };

/** What one taxonomy's detection returned, oldest first. */
type PerTaxonomy = Map<string, Entry[]>;

async function detectAcrossWatched(params: {
  rule: SyncRuleRecord;
  integration: IntegrationRecord;
  watermarks: Map<string, string>;
}): Promise<PerTaxonomy> {
  const provider = getProvider(params.integration.provider);
  const growthSync = provider.growthSync;
  if (!growthSync) {
    throw new RuleConfigError(
      `New-product detection is not supported on ${provider.label}`
    );
  }

  const perTaxonomy: PerTaxonomy = new Map();

  for (const watched of params.rule.watched_taxonomies) {
    const since = params.watermarks.get(watched.ref) ?? null;
    const result = await growthSync.detectNewProducts({
      integration: params.integration,
      taxonomyId: watched.ref,
      since,
    });

    // A truncated walk means the provider gave up before reaching the
    // watermark, so the oldest new products were never even seen. A single
    // high-water mark cannot describe "handled the newest, missed the oldest",
    // and guessing would silently drop products. Refuse the run instead.
    if (result.truncated) {
      throw new RuleConfigError(
        `Too many products were added to "${watched.title || watched.ref}" at once for Sync to work through. ` +
          `Sync follows a store as it grows; a bulk import is better classified from the Market research project directly.`
      );
    }

    const entries: Entry[] = [];
    for (const product of result.products) {
      const createdMs = Date.parse(product.createdAt);
      // Without a usable timestamp the product cannot be placed relative to the
      // watermark, so processing it would risk classifying it on every run.
      if (!Number.isFinite(createdMs)) continue;
      entries.push({ product, createdMs });
    }
    entries.sort((a, b) => a.createdMs - b.createdMs);
    perTaxonomy.set(watched.ref, entries);
  }

  return perTaxonomy;
}

type WorkPlan = {
  products: DetectedProduct[];
  sourceByProductId: Map<string, string>;
  /** How far each taxonomy's watermark may move once this run is durable. */
  watermarks: Map<string, { createdAt: string; productRef: string }>;
  /** Detected but left for the next run because of the per-run ceiling. */
  deferredCount: number;
};

/**
 * Decide what this run will actually do.
 *
 * Two rules drive everything here. Work is taken **oldest first**, so what gets
 * processed is always a contiguous block starting at the watermark — that is the
 * only shape a single timestamp can describe. And a watermark advances only
 * across products this run handled, stopping at the first one it did not, so
 * nothing is ever stepped over.
 */
function planWork(perTaxonomy: PerTaxonomy): WorkPlan {
  const firstSeen = new Map<string, { entry: Entry; sourceRef: string }>();
  for (const [ref, entries] of perTaxonomy) {
    for (const entry of entries) {
      // The same product can sit in two watched taxonomies. Classifying it
      // twice would double-charge the pack and duplicate the activity log.
      if (!firstSeen.has(entry.product.id)) {
        firstSeen.set(entry.product.id, { entry, sourceRef: ref });
      }
    }
  }

  const ordered = [...firstSeen.values()].sort(
    (a, b) => a.entry.createdMs - b.entry.createdMs
  );
  const taken = ordered.slice(0, MAX_PRODUCTS_PER_RUN);
  const handled = new Set(taken.map((row) => row.entry.product.id));

  const watermarks = new Map<string, { createdAt: string; productRef: string }>();
  for (const [ref, entries] of perTaxonomy) {
    let furthest: Entry | null = null;
    for (const entry of entries) {
      // A product handled under another taxonomy still counts as handled here,
      // otherwise this taxonomy would stay behind and pay for it again next run.
      if (!handled.has(entry.product.id)) break;
      furthest = entry;
    }
    if (furthest) {
      watermarks.set(ref, {
        createdAt: furthest.product.createdAt,
        productRef: furthest.product.id,
      });
    }
  }

  return {
    products: taken.map((row) => row.entry.product),
    sourceByProductId: new Map(
      taken.map((row) => [row.entry.product.id, row.sourceRef])
    ),
    watermarks,
    deferredCount: ordered.length - taken.length,
  };
}

/** Push the accepted decisions to the store, grouped by destination so each
 *  taxonomy takes one request rather than one per product. */
async function applyDecisions(params: {
  integration: IntegrationRecord;
  decisions: Decision[];
}): Promise<number> {
  const provider = getProvider(params.integration.provider);
  const assign = provider.taxonomy?.assign;
  if (!assign) {
    throw new RuleConfigError(
      `Assigning products to categories is not supported on ${provider.label}`
    );
  }

  const byTaxonomy = new Map<string, Decision[]>();
  for (const decision of params.decisions) {
    if (decision.decision !== "assigned" || !decision.target) continue;
    const ref = decision.target.taxonomyRef;
    const list = byTaxonomy.get(ref);
    if (list) list.push(decision);
    else byTaxonomy.set(ref, [decision]);
  }

  let assignedCount = 0;
  for (const [taxonomyRef, group] of byTaxonomy) {
    try {
      await assign({
        integration: params.integration,
        taxonomyId: taxonomyRef,
        productIds: group.map((d) => d.product.id),
      });
      assignedCount += group.length;
    } catch (err) {
      // One unwritable taxonomy must not discard the rest of the run's work.
      const message = err instanceof Error ? err.message : "Assignment failed";
      for (const decision of group) {
        decision.decision = "failed";
        decision.reason = message;
      }
    }
  }
  return assignedCount;
}

/**
 * Run one rule end to end.
 *
 * Never throws for expected failures: the outcome is written to `gs_runs` and
 * the rule is released either way, because a tick that dies mid-pipeline would
 * otherwise leave the rule leased until the lease expires.
 */
export async function runRule(params: {
  admin: Admin;
  rule: SyncRuleRecord;
  trigger: "cron" | "manual";
}): Promise<RunOutcome> {
  const { admin, rule, trigger } = params;
  let runId: string | null = null;
  let heldUsd = 0;
  let settled = false;

  try {
    const integrationRow = await loadIntegration(admin, rule.workspace_id);
    if (!integrationRow) {
      throw new RuleConfigError("No store is connected to this workspace");
    }
    if (!isProviderSupported(integrationRow.provider)) {
      throw new RuleConfigError(`Unsupported store provider: ${integrationRow.provider}`);
    }
    // The rule was built against a specific store. Silently re-pointing it at a
    // different one would write products into categories nobody chose.
    if (integrationRow.provider !== rule.provider) {
      throw new RuleConfigError(
        `This rule was created for ${rule.provider} but the workspace is now connected to ${integrationRow.provider}`
      );
    }
    const integration = integrationRow as IntegrationRecord;

    if (rule.watched_taxonomies.length === 0) {
      throw new RuleConfigError("This rule watches no categories");
    }

    const watermarks = await loadWatermarks(admin, rule.id);
    const detected = await detectAcrossWatched({ rule, integration, watermarks });
    const plan = planWork(detected);

    if (plan.products.length === 0) {
      // The common case by far. Recording it keeps "we checked and there was
      // nothing" distinguishable from "we never ran".
      runId = await startRun(admin, {
        workspaceId: rule.workspace_id,
        ruleId: rule.id,
        trigger,
      });
      await finishRun(admin, runId, {
        status: "skipped",
        detectedCount: 0,
        classifiedCount: 0,
        assignedCount: 0,
      });
      await releaseRule(admin, rule.id);
      return {
        runId,
        status: "skipped",
        detectedCount: 0,
        classifiedCount: 0,
        assignedCount: 0,
      };
    }

    runId = await startRun(admin, {
      workspaceId: rule.workspace_id,
      ruleId: rule.id,
      trigger,
    });

    // Held before the agent runs, so a wallet that cannot pay for this run
    // never spends AI budget it cannot cover.
    const hold = await holdSyncRun(admin, {
      workspaceId: rule.workspace_id,
      userId: rule.created_by,
      runId,
      productCount: plan.products.length,
    });
    if (!hold.ok) {
      await finishRun(admin, runId, {
        status: "failed",
        detectedCount: plan.products.length,
        classifiedCount: 0,
        assignedCount: 0,
        error: hold.message,
      });
      // Pausing beats burning a tick every hour on a rule that cannot proceed.
      await releaseRule(admin, rule.id, { error: hold.message, disable: true });
      return {
        runId,
        status: "failed",
        detectedCount: plan.products.length,
        classifiedCount: 0,
        assignedCount: 0,
        error: hold.message,
      };
    }
    heldUsd = hold.heldUsd;

    const targets = await loadTargets(admin, rule);
    const { decisions, totalCostUsd, validatedCount } = await classifyProducts({
      products: plan.products,
      targets,
      sourceByProductId: plan.sourceByProductId,
    });

    await settleSyncRun(admin, {
      workspaceId: rule.workspace_id,
      userId: rule.created_by,
      runId,
      ruleId: rule.id,
      ruleName: rule.name,
      heldUsd,
      actualUsd: totalCostUsd,
      productCount: validatedCount,
    });
    settled = true;

    const assignedCount = await applyDecisions({ integration, decisions });
    await recordDecisions(admin, {
      workspaceId: rule.workspace_id,
      ruleId: rule.id,
      runId,
      decisions,
    });

    // Watermarks move only after the decisions are durable, so a crash between
    // the two re-detects the products rather than losing them.
    for (const [taxonomyRef, mark] of plan.watermarks) {
      await advanceWatermark(admin, {
        ruleId: rule.id,
        taxonomyRef,
        createdAt: mark.createdAt,
        productRef: mark.productRef,
      });
    }

    const classifiedCount = decisions.filter((d) => d.decision === "assigned").length;
    const deferredNote =
      plan.deferredCount > 0
        ? `${plan.deferredCount} more new product(s) are queued for the next run`
        : undefined;

    await finishRun(admin, runId, {
      status: "succeeded",
      detectedCount: plan.products.length,
      classifiedCount,
      assignedCount,
      error: deferredNote,
    });
    // A backlog is worked down run after run, so the rule is made due again
    // immediately rather than waiting out its interval.
    await releaseRule(admin, rule.id, { dueNow: plan.deferredCount > 0 });

    return {
      runId,
      status: "succeeded",
      detectedCount: plan.products.length,
      classifiedCount,
      assignedCount,
      deferredCount: plan.deferredCount,
    };
  } catch (err) {
    const isConfig = err instanceof RuleConfigError;
    const message = err instanceof Error ? err.message : "Sync run failed";
    if (runId) {
      await finishRun(admin, runId, {
        status: "failed",
        detectedCount: 0,
        classifiedCount: 0,
        assignedCount: 0,
        error: message,
      }).catch(() => {});
    }
    // A misconfigured rule is paused; a transient failure is retried on schedule.
    await releaseRule(admin, rule.id, {
      error: message,
      disable: isConfig,
    }).catch(() => {});
    return {
      runId,
      status: "failed",
      detectedCount: 0,
      classifiedCount: 0,
      assignedCount: 0,
      error: message,
    };
  } finally {
    // A hold that never got settled (the pipeline threw between the hold and
    // the settle call) means no AI cost was ever confirmed, so it is handed
    // back in full rather than left sitting against the wallet.
    if (heldUsd > 0 && !settled && runId) {
      await settleSyncRun(admin, {
        workspaceId: rule.workspace_id,
        userId: rule.created_by,
        runId,
        ruleId: rule.id,
        ruleName: rule.name,
        heldUsd,
        actualUsd: 0,
        productCount: 0,
      }).catch(() => {});
    }
  }
}

export const ENGINE_TUNING = { MAX_PRODUCTS_PER_RUN } as const;
