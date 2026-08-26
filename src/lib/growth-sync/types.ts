import type { DetectedProduct } from "@/lib/sync/core/types";

/** A watched taxonomy as stored on the rule. */
export type WatchedTaxonomy = {
  /** Provider-native reference (Shopify GID, WooCommerce numeric id, …). */
  ref: string;
  title: string;
  productCount?: number;
};

export type SyncInterval = "manual" | "24h";

export type RuleMode = "auto" | "review";

/** A rule as it lives in `gs_rules`. */
export type SyncRuleRecord = {
  id: string;
  workspace_id: string;
  project_id: string;
  created_by: string;
  name: string;
  enabled: boolean;
  provider: string;
  run_interval: SyncInterval;
  watched_taxonomies: WatchedTaxonomy[];
  mode: RuleMode;
  next_run_at: string | null;
  lease_until: string | null;
  last_run_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

/** A destination the engine can classify into: a project taxonomy that has
 *  already been pushed to the store and therefore has a live reference. */
export type ClassificationTarget = {
  /** Project-local collection id, for tracing back to the project. */
  collectionId: string;
  /** Live provider reference on the store. */
  taxonomyRef: string;
  name: string;
  /** The keyword the collection was built around, if any. Sharpens matching. */
  targetKeyword?: string;
};

/** One decision the engine reached about one product. */
export type Decision = {
  product: DetectedProduct;
  /** The watched taxonomy the product was detected in. */
  sourceTaxonomyRef: string;
  target?: ClassificationTarget;
  decision: "assigned" | "skipped" | "failed";
  score?: number;
  reason: string;
};

export type RunOutcome = {
  runId: string | null;
  status: "succeeded" | "failed" | "skipped";
  detectedCount: number;
  classifiedCount: number;
  assignedCount: number;
  error?: string;
  /** New products left behind by `MAX_PRODUCTS_PER_RUN`, still to classify.
   *  A scheduled rule works this down on its own (see `dueNow` in
   *  `releaseRule`); a manual rule needs "Run now" pressed again. */
  deferredCount?: number;
};
