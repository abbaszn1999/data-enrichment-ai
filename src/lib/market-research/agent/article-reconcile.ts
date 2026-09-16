import type {
  ArticleStatus,
  GeneratedArticle,
  StrategyArticle,
} from "@/components/market-research/workspace-data";

type JobLike = {
  status: string;
  error?: string;
};

const KEEP_STATUSES = new Set<ArticleStatus>(["syncing", "scheduled"]);

/**
 * Stage 7 stores the article plan (`strategy`) and the written bodies
 * (`articles`) in separate slices. OpenAI can finish — and the body can land
 * — while the plan row is still `generating`. Reload then looks empty unless
 * we rebuild status from the body / job.
 */
export function reconcileStrategyArticles(
  strategy: StrategyArticle[],
  articles: Record<string, GeneratedArticle>,
  jobs: Record<string, JobLike> = {}
): StrategyArticle[] {
  if (strategy.length === 0) return strategy;
  return strategy.map((row) => {
    const generated = articles[row.id];
    if (generated && !KEEP_STATUSES.has(row.status)) {
      return {
        ...row,
        status: "ready" as const,
        category: generated.blogTitle || row.category,
        error: undefined,
      };
    }
    const job = jobs[row.id];
    if (!generated && job?.status === "failed") {
      return {
        ...row,
        status: "failed" as const,
        error: job.error || row.error || "Writing failed",
      };
    }
    if (
      !generated &&
      job &&
      job.status !== "completed" &&
      row.status !== "failed"
    ) {
      return { ...row, status: "generating" as const, error: undefined };
    }
    return row;
  });
}
