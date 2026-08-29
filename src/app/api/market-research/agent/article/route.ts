import { NextRequest, NextResponse } from "next/server";
import {
  agentArticleBodySchema,
  jsonError,
  requireMrWrite,
} from "@/lib/market-research/api-schema";
import { writeArticle } from "@/lib/market-research/agent/stage7-article-writer";
import {
  loadProjectSliceAdmin,
  saveProjectSliceAdmin,
} from "@/lib/market-research/storage-admin";
import type { GeneratedArticle } from "@/components/market-research/workspace-data";

export const maxDuration = 300;

/**
 * Writes exactly one article per request. The client fires three of these in
 * parallel, which keeps a slow article from stalling the other two and keeps
 * every call inside the platform's function timeout.
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

  const { article, blogs, projectId, workspaceId } = parsed.data;

  try {
    let storeName = "Ecommerce Store";
    const { data: integrationRow } = await auth.admin
      .from("workspace_integrations")
      .select("integration_name")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (integrationRow?.integration_name) {
      storeName = integrationRow.integration_name;
    }

    const written = await writeArticle({
      articleId: article.id,
      title: article.title,
      keyword: article.keyword,
      type: article.type,
      linksOut: article.linksOut ?? [],
      storeName,
      blogs: blogs ?? [],
    });

    const generated: GeneratedArticle = {
      articleId: written.articleId,
      seoTitle: written.seoTitle,
      seoDescription: written.seoDescription,
      blogTitle: written.blogTitle,
      bodyHtml: written.bodyHtml,
      images: written.images,
      featuredImage: written.featuredImage,
    };

    // Merge into the slice so a page refresh mid-batch never loses an article.
    if (projectId) {
      try {
        const existing = (await loadProjectSliceAdmin<
          Record<string, GeneratedArticle>
        >(auth.admin, workspaceId, projectId, "articles").catch(
          () => ({}) as Record<string, GeneratedArticle>
        )) ?? {};
        await saveProjectSliceAdmin(auth.admin, workspaceId, projectId, "articles", {
          ...existing,
          [generated.articleId]: generated,
        });
      } catch (err) {
        console.error("[article] Error saving articles slice:", err);
      }
    }

    return NextResponse.json(
      { article: generated, cost: written.cost?.totalCost ?? 0 },
      { headers: auth.headers }
    );
  } catch (err) {
    console.error("[api/market-research/agent/article] Error:", err);
    const msg = err instanceof Error ? err.message : "Failed to write the article";
    return jsonError(msg, 500);
  }
}
