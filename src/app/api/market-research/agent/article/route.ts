import { NextRequest, NextResponse } from "next/server";
import {
  agentArticleBodySchema,
  jsonError,
  requireMrWrite,
} from "@/lib/market-research/api-schema";
import type { ArticleWriteInput } from "@/lib/market-research/agent/stage7-article-writer";
import {
  finalizeArticleJob,
  loadArticleJobs,
  loadGeneratedArticles,
  startOrResumeArticleJob,
} from "@/lib/market-research/agent/article-jobs";

export const maxDuration = 60;

function normalizeStoreUrl(value: string | null | undefined): string {
  const clean = (value ?? "").trim().replace(/\/+$/, "");
  if (!clean) return "";
  return /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
}

/**
 * Starts one OpenAI article write in the background and returns as soon as
 * the response id is stored. The client polls the same route until the body
 * is saved — so an OpenAI completion still finalizes after the original
 * request or a page refresh dies.
 */
export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = agentArticleBodySchema.safeParse(json);
  if (!parsed.success) return jsonError("Invalid article payload", 400);

  const auth = await requireMrWrite(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  const { article, blogs, projectId, workspaceId, storeUrl } = parsed.data;
  const mode = parsed.data.mode ?? "start";

  try {
    const existing = await loadGeneratedArticles(
      auth.admin,
      workspaceId,
      projectId
    );
    const saved = existing[article.id];
    if (saved?.bodyHtml) {
      return NextResponse.json(
        { article: saved, cost: 0, pending: false },
        { headers: auth.headers }
      );
    }

    let storeName = "Ecommerce Store";
    const { data: integrationRow } = await auth.admin
      .from("workspace_integrations")
      .select("integration_name, base_url")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (integrationRow?.integration_name) {
      storeName = integrationRow.integration_name;
    }
    const resolvedStoreUrl =
      normalizeStoreUrl(storeUrl) ||
      normalizeStoreUrl(integrationRow?.base_url);

    const input: ArticleWriteInput = {
      articleId: article.id,
      title: article.title?.trim() || saved?.seoTitle || article.id,
      keyword: article.keyword?.trim() || "",
      type: article.type ?? "guide",
      linksOut: article.linksOut ?? [],
      skuLinks: article.skuLinks ?? [],
      storeName,
      storeUrl: resolvedStoreUrl,
      blogs: blogs ?? [],
    };

    const jobs = await loadArticleJobs(auth.admin, workspaceId, projectId);
    let job = jobs[article.id];
    if (mode !== "poll") {
      const started = await startOrResumeArticleJob(
        auth.admin,
        workspaceId,
        projectId,
        input
      );
      job = started.job;
    }

    if (!job) {
      return NextResponse.json(
        { pending: true, status: "missing", articleId: article.id },
        { headers: auth.headers }
      );
    }

    if (job.status === "failed") {
      return jsonError(job.error || "Writing failed", 500);
    }

    let result: Awaited<ReturnType<typeof finalizeArticleJob>>;
    try {
      result = await finalizeArticleJob(
        auth.admin,
        workspaceId,
        projectId,
        job
      );
    } catch (err) {
      // The response id is already stored. A flaky retrieve must not look like
      // a failed write — the client will poll and try again.
      console.error("[api/market-research/agent/article] retrieve:", err);
      return NextResponse.json(
        { pending: true, status: job.status, articleId: article.id },
        { headers: auth.headers }
      );
    }

    if (result.status === "ready") {
      return NextResponse.json(
        { article: result.article, cost: result.cost, pending: false },
        { headers: auth.headers }
      );
    }
    if (result.status === "failed") {
      return jsonError(result.error, 500);
    }
    return NextResponse.json(
      { pending: true, status: result.openaiStatus, articleId: article.id },
      { headers: auth.headers }
    );
  } catch (err) {
    console.error("[api/market-research/agent/article] Error:", err);
    const msg =
      err instanceof Error ? err.message : "Failed to write the article";
    return jsonError(msg, 500);
  }
}
