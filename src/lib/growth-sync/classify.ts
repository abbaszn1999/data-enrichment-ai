import { aiJsonParse } from "ai-json-safe-parse";
import type { DetectedProduct } from "@/lib/sync/core/types";
import { calculateCallCost } from "@/lib/ai-pricing";
import { loadClassifySkill } from "./skill";
import type { ClassificationTarget, Decision } from "./types";

/** Model Sync bills the wallet for — see `skills/classify.md` for the system
 *  instruction, kept entirely separate from Market Research's own skills so
 *  edits to one never silently change the other's behavior. */
const MODEL = "gemini-3.7-flash";

/** Loaded once and reused: batches run several `import("@google/genai")` calls
 *  concurrently (see `CONCURRENT_CALLS` below), and a shared promise means
 *  they all resolve the same module load instead of racing separate ones. */
let genaiModule: Promise<typeof import("@google/genai")> | null = null;
function loadGenAI() {
  if (!genaiModule) genaiModule = import("@google/genai");
  return genaiModule;
}

async function mediumThinkingLevel() {
  const { ThinkingLevel } = await loadGenAI();
  return ThinkingLevel.MEDIUM;
}

export type ClassifyResult = {
  decisions: Decision[];
  /** Summed `AiCallCost.totalCost` across every batch call this run made. */
  totalCostUsd: number;
  /** Products actually sent to the agent this run. This is the count Sync's
   *  wallet billing reports as "products classified". */
  validatedCount: number;
};

/**
 * Classification: products are scored against live categories with cheap
 * lexical overlap, then Gemini judges only the top candidates. That keeps
 * the pipeline on Gemini 3.7 Flash (what the wallet is billed for) without
 * dumping thousands of irrelevant collections into every prompt.
 */

/** Products per agent call. One call per product would be needlessly slow and
 *  expensive; a run's whole backlog (capped at `MAX_PRODUCTS_PER_RUN` in
 *  engine.ts) fits in a single call at this size, which is what keeps Sync's
 *  wallet cost down to a fraction of a cent per run. */
const PRODUCTS_PER_CALL = 100;

/**
 * Agent calls in flight at once. A run has to finish inside one HTTP request,
 * and batches are independent, so waiting for each in turn would spend the
 * whole budget on latency. Kept low to stay well clear of provider rate limits.
 */
const CONCURRENT_CALLS = 3;

// ─── Agent validation ────────────────────────────────────────────────────────

type AgentVerdict = {
  productId: string;
  taxonomyRef: string;
  belongs: boolean;
  reason: string;
};

const MAX_CANDIDATES_PER_PRODUCT = 15;

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 1);
}

export function scoreTargetForProduct(
  product: DetectedProduct,
  target: ClassificationTarget
): number {
  const hay = new Set(
    tokenize(
      [
        product.title,
        product.productType,
        product.vendor,
        ...(product.tags ?? []),
        product.description?.slice(0, 300),
      ]
        .filter(Boolean)
        .join(" ")
    )
  );
  const needle = tokenize(
    [target.name, target.targetKeyword].filter(Boolean).join(" ")
  );
  if (hay.size === 0 || needle.length === 0) return 0;
  let hits = 0;
  for (const token of needle) {
    if (hay.has(token)) hits += 1;
  }
  return hits / needle.length;
}

export function candidateTargetsForProduct(
  product: DetectedProduct,
  targets: ClassificationTarget[],
  limit = MAX_CANDIDATES_PER_PRODUCT
): ClassificationTarget[] {
  if (targets.length <= limit) return targets;
  return [...targets]
    .map((target) => ({ target, score: scoreTargetForProduct(product, target) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => row.target);
}

function unionCandidates(
  batch: DetectedProduct[],
  targets: ClassificationTarget[]
): ClassificationTarget[] {
  if (targets.length <= MAX_CANDIDATES_PER_PRODUCT) return targets;
  const seen = new Set<string>();
  const out: ClassificationTarget[] = [];
  for (const product of batch) {
    for (const target of candidateTargetsForProduct(product, targets)) {
      if (seen.has(target.taxonomyRef)) continue;
      seen.add(target.taxonomyRef);
      out.push(target);
    }
  }
  return out.length > 0 ? out : targets.slice(0, MAX_CANDIDATES_PER_PRODUCT);
}

function buildPrompt(
  batch: DetectedProduct[],
  targets: ClassificationTarget[]
): string {
  const lines: string[] = [
    "Decide, for each product below, which of the listed candidate categories it genuinely belongs in.",
    "",
    "Candidates were pre-filtered by lexical overlap; only judge among the categories listed.",
    "A product may belong in several categories, or in none. Only say a product belongs where it is a genuine, confident match.",
    "",
    "Return JSON: { \"verdicts\": [{ \"productId\", \"taxonomyRef\", \"belongs\", \"reason\" }] }",
    "Only include a verdict for a category a product actually belongs in — omit the rest.",
    "Keep each reason under 20 words.",
    "",
    "CANDIDATE CATEGORIES:",
  ];
  for (const target of targets) {
    lines.push(
      `  - taxonomyRef: ${target.taxonomyRef} | name: ${target.name}` +
        (target.targetKeyword ? ` | keyword: ${target.targetKeyword}` : "")
    );
  }
  lines.push("");

  for (const product of batch) {
    lines.push(`PRODUCT ${product.id}`);
    lines.push(`  title: ${product.title}`);
    if (product.productType) lines.push(`  type: ${product.productType}`);
    if (product.vendor) lines.push(`  vendor: ${product.vendor}`);
    if (product.tags?.length) lines.push(`  tags: ${product.tags.join(", ")}`);
    if (product.description) {
      lines.push(`  description: ${product.description.slice(0, 300)}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function validateBatch(
  batch: DetectedProduct[],
  targets: ClassificationTarget[]
): Promise<{ verdicts: AgentVerdict[]; costUsd: number }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY environment variable is not configured");

  const [systemInstruction, { GoogleGenAI }] = await Promise.all([
    loadClassifySkill(),
    loadGenAI(),
  ]);
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 180000 } });

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: buildPrompt(batch, targets) }] }],
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: await mediumThinkingLevel() },
    },
  });

  const rawText = response.text || "{}";
  let data: { verdicts?: unknown };
  try {
    data = JSON.parse(rawText) as { verdicts?: unknown };
  } catch {
    const recovered = aiJsonParse<{ verdicts?: unknown }>(rawText);
    if (!recovered.success) {
      throw new Error(
        `Failed to parse structured JSON from Gemini classify output: ${rawText.slice(0, 300)}`
      );
    }
    data = recovered.data;
  }

  const raw = Array.isArray(data.verdicts) ? data.verdicts : [];
  const verdicts: AgentVerdict[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const productId = String(row.productId ?? "").trim();
    const taxonomyRef = String(row.taxonomyRef ?? "").trim();
    if (!productId || !taxonomyRef) continue;
    verdicts.push({
      productId,
      taxonomyRef,
      belongs: row.belongs === true,
      reason: String(row.reason ?? "").trim(),
    });
  }

  const cost = calculateCallCost(MODEL, response.usageMetadata);
  return { verdicts, costUsd: cost.totalCost };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function classifyProducts(input: {
  products: DetectedProduct[];
  targets: ClassificationTarget[];
  /** The watched taxonomy each product was detected in, by product id. */
  sourceByProductId: Map<string, string>;
}): Promise<ClassifyResult> {
  const { products, targets, sourceByProductId } = input;
  const decisions: Decision[] = [];
  const sourceOf = (id: string) => sourceByProductId.get(id) ?? "";

  if (products.length === 0) return { decisions, totalCostUsd: 0, validatedCount: 0 };
  if (targets.length === 0) {
    return {
      decisions: products.map((product) => ({
        product,
        sourceTaxonomyRef: sourceOf(product.id),
        decision: "skipped" as const,
        reason: "The project has no categories live on the store yet",
      })),
      totalCostUsd: 0,
      validatedCount: 0,
    };
  }

  const targetByRef = new Map(targets.map((t) => [t.taxonomyRef, t]));

  const batches: DetectedProduct[][] = [];
  for (let i = 0; i < products.length; i += PRODUCTS_PER_CALL) {
    batches.push(products.slice(i, i + PRODUCTS_PER_CALL));
  }

  const results: Array<{
    batch: DetectedProduct[];
    outcome: { verdicts: AgentVerdict[]; costUsd: number } | Error;
  }> = [];
  for (let i = 0; i < batches.length; i += CONCURRENT_CALLS) {
    const wave = batches.slice(i, i + CONCURRENT_CALLS);
    const settled = await Promise.all(
      wave.map(async (batch) => {
        try {
          return {
            batch,
            outcome: await validateBatch(batch, unionCandidates(batch, targets)),
          };
        } catch (err) {
          // One batch failing must not discard the ones that succeeded
          // alongside it, so the error travels with its own batch.
          return {
            batch,
            outcome: err instanceof Error ? err : new Error("Agent call failed"),
          };
        }
      })
    );
    results.push(...settled);
  }

  let totalCostUsd = 0;
  for (const { batch, outcome } of results) {
    if (outcome instanceof Error) {
      // A failed agent call is not a rejection. Marking the batch failed keeps
      // the products eligible next run instead of burying them as "skipped".
      for (const product of batch) {
        decisions.push({
          product,
          sourceTaxonomyRef: sourceOf(product.id),
          decision: "failed",
          reason: outcome.message,
        });
      }
      continue;
    }

    totalCostUsd += outcome.costUsd;
    const { verdicts } = outcome;

    for (const product of batch) {
      const own = verdicts.filter((v) => v.productId === product.id);
      const accepted = own.filter((v) => v.belongs);

      if (accepted.length === 0) {
        const rejection = own[0]?.reason;
        decisions.push({
          product,
          sourceTaxonomyRef: sourceOf(product.id),
          decision: "skipped",
          reason: rejection || "The agent found no category it belongs in",
        });
        continue;
      }

      for (const verdict of accepted) {
        const target = targetByRef.get(verdict.taxonomyRef);
        // A ref the agent invented is not a category this project has live;
        // writing to it would put the product somewhere nobody chose.
        if (!target) continue;
        decisions.push({
          product,
          sourceTaxonomyRef: sourceOf(product.id),
          target,
          decision: "assigned",
          reason: verdict.reason || "Matches the category",
        });
      }
    }
  }

  return { decisions, totalCostUsd, validatedCount: products.length };
}

export const CLASSIFY_TUNING = {
  PRODUCTS_PER_CALL,
  CONCURRENT_CALLS,
  MAX_CANDIDATES_PER_PRODUCT,
} as const;
