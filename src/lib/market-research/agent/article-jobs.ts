/**
 * Stage 7 article jobs — the OpenAI write is backgrounded, so the response id
 * has to land in storage before we wait for the body. Polling (or a refresh)
 * can then retrieve a completed response and save the article even if the
 * original HTTP request already died.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  GeneratedArticle,
  StrategyArticle,
} from "@/components/market-research/workspace-data";
import {
  loadProjectSliceAdmin,
  saveProjectSliceAdmin,
} from "@/lib/market-research/storage-admin";
import { markSliceSavedAdmin } from "@/lib/market-research/server-persist";
import {
  articleFromOpenAiResponse,
  isOpenAiWriteFailure,
  retrieveArticleResponse,
  startArticleWrite,
  type ArticleWriteInput,
} from "@/lib/market-research/agent/stage7-article-writer";

export { reconcileStrategyArticles } from "./article-reconcile";

export type ArticleWriteJobStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "failed";

export type ArticleWriteJob = {
  articleId: string;
  openaiResponseId: string;
  status: ArticleWriteJobStatus;
  startedAt: string;
  updatedAt: string;
  error?: string;
  input: ArticleWriteInput;
};

export type ArticleJobMap = Record<string, ArticleWriteJob>;

function jobStatusFromOpenAi(
  status: string | undefined
): ArticleWriteJobStatus {
  if (status === "completed") return "completed";
  if (isOpenAiWriteFailure(status)) return "failed";
  if (status === "in_progress") return "in_progress";
  return "queued";
}

export async function loadArticleJobs(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string
): Promise<ArticleJobMap> {
  const data = await loadProjectSliceAdmin<ArticleJobMap>(
    admin,
    workspaceId,
    projectId,
    "article-jobs"
  ).catch(() => null);
  return data && typeof data === "object" ? data : {};
}

export async function saveArticleJob(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  job: ArticleWriteJob
): Promise<ArticleWriteJob> {
  const existing = await loadArticleJobs(admin, workspaceId, projectId);
  const next: ArticleWriteJob = { ...job, updatedAt: new Date().toISOString() };
  await saveProjectSliceAdmin(admin, workspaceId, projectId, "article-jobs", {
    ...existing,
    [job.articleId]: next,
  });
  return next;
}

export async function loadGeneratedArticles(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string
): Promise<Record<string, GeneratedArticle>> {
  const data = await loadProjectSliceAdmin<Record<string, GeneratedArticle>>(
    admin,
    workspaceId,
    projectId,
    "articles"
  ).catch(() => null);
  return data && typeof data === "object" ? data : {};
}

export async function saveGeneratedArticle(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  article: GeneratedArticle
): Promise<Record<string, GeneratedArticle>> {
  const existing = await loadGeneratedArticles(admin, workspaceId, projectId);
  const next = { ...existing, [article.articleId]: article };
  await saveProjectSliceAdmin(
    admin,
    workspaceId,
    projectId,
    "articles",
    next
  );
  await markSliceSavedAdmin(admin, projectId, "articles", next);
  return next;
}

async function markStrategyArticleReady(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  articleId: string,
  blogTitle: string
): Promise<void> {
  const strategy = await loadProjectSliceAdmin<StrategyArticle[]>(
    admin,
    workspaceId,
    projectId,
    "strategy"
  ).catch(() => null);
  if (!Array.isArray(strategy) || strategy.length === 0) return;
  const next = strategy.map((row) => {
    if (row.id !== articleId) return row;
    if (row.status === "syncing" || row.status === "scheduled") {
      return row;
    }
    return {
      ...row,
      status: "ready" as const,
      category: blogTitle || row.category,
      error: undefined,
    };
  });
  await saveProjectSliceAdmin(
    admin,
    workspaceId,
    projectId,
    "strategy",
    next
  );
  await markSliceSavedAdmin(admin, projectId, "strategy", next);
}

export type ArticleFinalizeResult =
  | { status: "ready"; article: GeneratedArticle; cost: number }
  | { status: "pending"; openaiStatus: string }
  | { status: "failed"; error: string };

export async function persistCompletedArticle(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  job: ArticleWriteJob,
  written: ReturnType<typeof articleFromOpenAiResponse>
): Promise<GeneratedArticle> {
  const generated: GeneratedArticle = {
    articleId: written.articleId,
    seoTitle: written.seoTitle,
    seoDescription: written.seoDescription,
    blogTitle: written.blogTitle,
    bodyHtml: written.bodyHtml,
    images: written.images,
    featuredImage: written.featuredImage,
  };
  await saveGeneratedArticle(admin, workspaceId, projectId, generated);
  await saveArticleJob(admin, workspaceId, projectId, {
    ...job,
    status: "completed",
    error: undefined,
  });
  await markStrategyArticleReady(
    admin,
    workspaceId,
    projectId,
    generated.articleId,
    generated.blogTitle
  );
  return generated;
}

export async function finalizeArticleJob(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  job: ArticleWriteJob
): Promise<ArticleFinalizeResult> {
  const body = await retrieveArticleResponse(job.openaiResponseId);
  const openaiStatus = body.status || "in_progress";

  if (openaiStatus === "completed") {
    const written = articleFromOpenAiResponse(job.input, body);
    const article = await persistCompletedArticle(
      admin,
      workspaceId,
      projectId,
      job,
      written
    );
    return {
      status: "ready",
      article,
      cost: written.cost?.totalCost ?? 0,
    };
  }

  if (isOpenAiWriteFailure(openaiStatus)) {
    const error =
      body.error?.message || `Article writer ended with status ${openaiStatus}`;
    await saveArticleJob(admin, workspaceId, projectId, {
      ...job,
      status: "failed",
      error,
    });
    return { status: "failed", error };
  }

  await saveArticleJob(admin, workspaceId, projectId, {
    ...job,
    status: jobStatusFromOpenAi(openaiStatus),
  });
  return { status: "pending", openaiStatus };
}

export async function startOrResumeArticleJob(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  input: ArticleWriteInput
): Promise<{ job: ArticleWriteJob; started: boolean }> {
  const jobs = await loadArticleJobs(admin, workspaceId, projectId);
  const existing = jobs[input.articleId];
  if (existing?.openaiResponseId && existing.status !== "failed") {
    return { job: existing, started: false };
  }

  const started = await startArticleWrite(input);
  const now = new Date().toISOString();
  const job = await saveArticleJob(admin, workspaceId, projectId, {
    articleId: input.articleId,
    openaiResponseId: started.responseId,
    status: jobStatusFromOpenAi(started.response.status),
    startedAt: existing?.startedAt || now,
    updatedAt: now,
    input,
  });
  return { job, started: true };
}
