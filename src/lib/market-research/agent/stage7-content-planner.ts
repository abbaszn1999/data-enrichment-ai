import {
  MAX_STRATEGY_KEYWORDS,
  priorityFor,
  selectStrategyKeywords,
  titleFromKeyword,
  typeFromKeyword,
  uniqueInformationalKeywords,
  type ExtractedKeyword,
  type ProposedCollection,
  type StrategyArticle,
  type StrategyArticleType,
} from "@/components/market-research/workspace-data";
import { cosineSimilarity, embedTexts } from "./embeddings";
import { buildArticleLinkTargets } from "./internal-links";
import { runGeminiMarketResearch } from "./gemini-runner";
import type { StoreCollectionItem } from "./store-catalog";

/**
 * Stage 7 content planner.
 *
 * Turns the informational keywords that survived Stage 4 into a publishing
 * plan: one article per keyword, with a human title, an article format, and the
 * collection pages the article must link out to. It writes no copy — that is the
 * article writer's job — and it never invents a URL: link targets come from the
 * verified store registry.
 */

const KEYWORDS_PER_AI_CALL = 40;

/**
 * How many of the highest-volume keywords are embedded for intent clustering.
 * Comparing every pair is quadratic, and anything below this line is unlikely
 * to survive the 240 cap anyway.
 */
const INTENT_POOL_SIZE = 600;

/**
 * Cosine similarity at which two keywords are treated as the same intent.
 * Tuned to fold "how to organize chargers and cables" into "how to store cables
 * and chargers" while leaving genuinely different questions apart. Raise it if
 * distinct topics start merging; lower it if duplicates still slip through.
 */
const INTENT_MERGE_THRESHOLD = 0.86;

const VALID_TYPES = new Set<StrategyArticleType>([
  "guide",
  "comparison",
  "faq",
  "roundup",
]);

export interface Stage7PlanInput {
  keywords: ExtractedKeyword[];
  storeName?: string;
  parentNiches?: string[];
  storeCollections?: StoreCollectionItem[];
  proposedCollections?: ProposedCollection[];
  collectionPrefix?: string;
  linksPerArticle?: number;
  /** Skips the Gemini titling pass; titles fall back to the deterministic form. */
  disableAi?: boolean;
}

export interface Stage7PlanResult {
  articles: StrategyArticle[];
  isAiGenerated: boolean;
  /** How many informational keywords were dropped by the 240 cap. */
  droppedByCap: number;
  /** How many near-duplicate keywords were folded into another article. */
  mergedByIntent: number;
}

type IntentMerge = { count: number; volume: number };

interface GeminiPlanItem {
  id?: string;
  title?: string;
  type?: string;
}

interface GeminiPlanResponse {
  articles?: GeminiPlanItem[];
}

function normalizeType(value: string | undefined): StrategyArticleType | null {
  const clean = (value || "").toLowerCase().trim();
  if (!clean) return null;
  if (VALID_TYPES.has(clean as StrategyArticleType)) {
    return clean as StrategyArticleType;
  }
  if (clean.includes("compar") || clean.includes("vs")) return "comparison";
  if (clean.includes("faq") || clean.includes("question")) return "faq";
  if (clean.includes("round") || clean.includes("best") || clean.includes("list")) {
    return "roundup";
  }
  if (clean.includes("guide") || clean.includes("how")) return "guide";
  return null;
}

function cleanTitle(value: string | undefined, keyword: string): string {
  const clean = (value || "").replace(/\s+/g, " ").trim().slice(0, 90);
  // A title that lost the keyword's subject is worse than the plain form.
  if (clean.length < 12) return titleFromKeyword(keyword);
  return clean;
}

/**
 * Asks Gemini for a human-sounding title and a format per keyword. Only titles
 * and types are requested: everything else in the row is copied verbatim from
 * the keyword so the numbers on screen always match Stage 4.
 */
async function titleBatchWithAi(
  batch: ExtractedKeyword[],
  context: { storeName?: string; parentNiches?: string[] }
): Promise<Map<string, GeminiPlanItem>> {
  const byId = new Map<string, GeminiPlanItem>();

  const userPrompt = JSON.stringify({
    task: "plan_articles",
    storeContext: {
      storeName: context.storeName || "Ecommerce Store",
      niches: context.parentNiches ?? [],
    },
    keywords: batch.map((row) => ({
      id: row.id,
      keyword: row.keyword,
      volume: row.volume,
      difficulty: row.difficulty,
    })),
  });

  const systemInstruction = `You are the Autommerce Content Planner.

For each informational keyword, write the article title a real editor would publish, and pick the article format.

Title rules:
- Keep the keyword's search intent intact; the reader must recognise their question.
- Front-load the subject. No clickbait, no "Ultimate", no emoji, no year unless the keyword has one.
- Under 70 characters. Sentence case. Keep a question mark only if the keyword is a question.
- Do not name the store and do not add a brand the keyword does not mention.

Format must be exactly one of:
- "guide" — explains how to choose, use, or care for something.
- "comparison" — weighs two or more named options against each other.
- "faq" — answers one direct question, plus closely related ones.
- "roundup" — a ranked or curated list of options.

Output strictly valid JSON:
{
  "articles": [ { "id": "id from input", "title": "The article title", "type": "guide" } ]
}`;

  try {
    const result = await runGeminiMarketResearch<GeminiPlanResponse>({
      stage: 7,
      systemInstruction,
      userPrompt,
    });
    for (const item of result.data?.articles ?? []) {
      if (item?.id) byId.set(item.id, item);
    }
  } catch (error) {
    console.error("[stage7-planner] Titling batch failed, using fallback titles:", error);
  }

  return byId;
}

/**
 * Folds keywords that ask the same question into one article.
 *
 * Exact-text deduplication misses the common case entirely: "how to organize
 * chargers and cables" and "how to store cables and chargers" are two rows but
 * one intent, and publishing both puts the store in competition with itself.
 * Keywords are visited highest volume first, so the strongest phrasing becomes
 * the head of its cluster.
 *
 * Without an embeddings key nothing is merged — a silently unfiltered plan is
 * better than a wrongly filtered one.
 */
async function collapseDuplicateIntents(unique: ExtractedKeyword[]): Promise<{
  keywords: ExtractedKeyword[];
  mergesByHeadId: Map<string, IntentMerge>;
}> {
  const mergesByHeadId = new Map<string, IntentMerge>();
  const pool = unique.slice(0, INTENT_POOL_SIZE);
  const rest = unique.slice(INTENT_POOL_SIZE);
  if (pool.length < 2) return { keywords: unique, mergesByHeadId };

  const vectors = await embedTexts(pool.map((row) => row.keyword));
  if (!vectors.some((vector) => Array.isArray(vector))) {
    return { keywords: unique, mergesByHeadId };
  }

  const heads: Array<{ row: ExtractedKeyword; vector: number[] }> = [];
  const kept: ExtractedKeyword[] = [];

  pool.forEach((row, index) => {
    const vector = vectors[index];
    if (!vector) {
      kept.push(row);
      return;
    }

    let bestHead: ExtractedKeyword | null = null;
    let bestScore = INTENT_MERGE_THRESHOLD;
    for (const head of heads) {
      const score = cosineSimilarity(vector, head.vector);
      if (score >= bestScore) {
        bestScore = score;
        bestHead = head.row;
      }
    }

    if (bestHead) {
      const acc = mergesByHeadId.get(bestHead.id) ?? { count: 0, volume: 0 };
      mergesByHeadId.set(bestHead.id, {
        count: acc.count + 1,
        volume: acc.volume + row.volume,
      });
      return;
    }

    heads.push({ row, vector });
    kept.push(row);
  });

  return { keywords: [...kept, ...rest], mergesByHeadId };
}

export async function runStage7ContentPlan(
  input: Stage7PlanInput
): Promise<Stage7PlanResult> {
  const unique = uniqueInformationalKeywords(input.keywords);
  const { keywords: collapsed, mergesByHeadId } = input.disableAi
    ? { keywords: unique, mergesByHeadId: new Map<string, IntentMerge>() }
    : await collapseDuplicateIntents(unique);
  const selected = selectStrategyKeywords(collapsed, MAX_STRATEGY_KEYWORDS);

  if (selected.length === 0) {
    return {
      articles: [],
      isAiGenerated: false,
      droppedByCap: 0,
      mergedByIntent: 0,
    };
  }

  const useAi = !input.disableAi && Boolean(process.env.GEMINI_API_KEY?.trim());

  const planById = new Map<string, GeminiPlanItem>();
  if (useAi) {
    for (let i = 0; i < selected.length; i += KEYWORDS_PER_AI_CALL) {
      const batch = selected.slice(i, i + KEYWORDS_PER_AI_CALL);
      const picks = await titleBatchWithAi(batch, {
        storeName: input.storeName,
        parentNiches: input.parentNiches,
      });
      for (const [id, item] of picks) planById.set(id, item);
    }
  }

  const drafts = selected.map((row) => {
    const plan = planById.get(row.id);
    return {
      id: row.id,
      title: cleanTitle(plan?.title, row.keyword),
      keyword: row.keyword,
      type: normalizeType(plan?.type) ?? typeFromKeyword(row.keyword),
      volume: row.volume,
      difficulty: row.difficulty,
    };
  });

  const linksByArticle = await buildArticleLinkTargets({
    articles: drafts.map((draft) => ({
      id: draft.id,
      title: draft.title,
      keyword: draft.keyword,
    })),
    storeCollections: input.storeCollections,
    proposed: input.proposedCollections,
    collectionPrefix: input.collectionPrefix,
    linksPerArticle: input.linksPerArticle,
  });

  const articles: StrategyArticle[] = drafts.map((draft) => {
    const merge = mergesByHeadId.get(draft.id);
    return {
      id: draft.id,
      title: draft.title,
      keyword: draft.keyword,
      type: draft.type,
      // The writer decides the blog; until then the cell stays visibly empty.
      category: "-",
      volume: draft.volume,
      difficulty: draft.difficulty,
      linksOut: linksByArticle[draft.id] ?? [],
      // Volume stays verbatim so the row still matches Stage 4, but priority
      // counts the merged demand too: an article covering five phrasings is
      // worth more than its head keyword alone suggests.
      priority: priorityFor(draft.volume + (merge?.volume ?? 0), draft.difficulty),
      mergedCount: merge?.count,
      status: "pending",
    };
  });

  return {
    articles,
    isAiGenerated: planById.size > 0,
    droppedByCap: Math.max(0, collapsed.length - selected.length),
    mergedByIntent: Math.max(0, unique.length - collapsed.length),
  };
}
