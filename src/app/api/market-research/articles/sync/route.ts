import { NextRequest, NextResponse } from "next/server";
import {
  articleSyncBodySchema,
  jsonError,
  requireMrWrite,
} from "@/lib/market-research/api-schema";
import {
  createShopifyArticle,
  ensureShopifyBlog,
  fetchShopifyBlogs,
  fetchShopInfo,
  isShopifyAccessDenied,
  SHOPIFY_CONTENT_SCOPE_HINT,
} from "@/lib/sync/providers/shopify/articles";
import { buildPublishSchedule } from "@/lib/market-research/article-schedule";
import {
  loadProjectSliceAdmin,
  saveProjectSliceAdmin,
} from "@/lib/market-research/storage-admin";
import type { IntegrationRecord } from "@/lib/sync/core/types";
import type { GeneratedArticle } from "@/components/market-research/workspace-data";

export const maxDuration = 300;

/**
 * Uploads the selected articles to the store's blog as *scheduled* posts — one
 * per day at a jittered time — so the blog fills up at a human pace instead of
 * dumping a month of content in one afternoon.
 */
export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = articleSyncBodySchema.safeParse(json);
  if (!parsed.success) return jsonError("Invalid sync payload", 400);

  const auth = await requireMrWrite(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  const { workspaceId, projectId, articles } = parsed.data;

  try {
    const { data: integrationRow } = await auth.admin
      .from("workspace_integrations")
      .select("provider, integration_name, base_url, config")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const provider = String(integrationRow?.provider ?? "").toLowerCase();
    if (!integrationRow || provider !== "shopify") {
      return jsonError(
        provider
          ? `Publishing articles is only supported on Shopify (this workspace is connected to ${provider}).`
          : "No store integration connected.",
        400
      );
    }

    const integration = integrationRow as IntegrationRecord;
    const [blogs, shopInfo] = await Promise.all([
      fetchShopifyBlogs({ integration }).catch(() => []),
      fetchShopInfo({ integration }),
    ]);
    const timeZone = shopInfo.ianaTimezone;

    const blogIdByTitle = new Map(
      blogs.map((blog) => [blog.title.trim().toLowerCase(), blog.id])
    );

    // Continue the calendar after anything already scheduled for this project,
    // so a second batch does not double-book the same days.
    const existing = (await loadProjectSliceAdmin<
      Record<string, GeneratedArticle>
    >(auth.admin, workspaceId, projectId, "articles").catch(
      () => ({}) as Record<string, GeneratedArticle>
    )) ?? {};

    let lastScheduled = 0;
    for (const record of Object.values(existing)) {
      const at = record?.scheduledAt ? Date.parse(record.scheduledAt) : 0;
      if (Number.isFinite(at) && at > lastScheduled) lastScheduled = at;
    }
    const startFrom =
      lastScheduled > Date.now() ? new Date(lastScheduled) : new Date();

    const results: Array<{
      articleId: string;
      ok: boolean;
      scheduledAt?: string;
      storeArticleId?: string;
      storeHandle?: string;
      coverApplied?: boolean;
      alreadySynced?: boolean;
      error?: string;
    }> = [];

    // An article that already carries a store id is on the calendar, so making
    // it again would put a duplicate on the blog. Skipping here rather than in
    // the UI keeps a double click, a retry after a dropped connection, or a
    // stale tab from publishing the same post twice — and it happens before the
    // schedule is built so a skipped article does not burn a publishing day.
    const pending: typeof articles = [];
    for (const article of articles) {
      const record = existing[article.articleId];
      if (record?.storeArticleId) {
        results.push({
          articleId: article.articleId,
          ok: true,
          scheduledAt: record.scheduledAt,
          storeArticleId: record.storeArticleId,
          storeHandle: record.storeHandle,
          alreadySynced: true,
        });
        continue;
      }
      pending.push(article);
    }

    const schedule = buildPublishSchedule(
      pending.map((article) => article.articleId),
      { timeZone, startFrom }
    );
    const publishAtById = new Map(
      schedule.map((slot) => [slot.articleId, slot.publishAt])
    );

    let fallbackBlogId: string | null = null;
    const merged: Record<string, GeneratedArticle> = { ...existing };

    for (const article of pending) {
      const publishAt = publishAtById.get(article.articleId);
      if (!publishAt) continue;

      try {
        const wanted = (article.blogTitle ?? "").trim().toLowerCase();
        let blogId = wanted && wanted !== "none"
          ? blogIdByTitle.get(wanted) ?? null
          : null;

        if (!blogId) {
          // The writer found no matching blog, so everything lands in the
          // store's default blog rather than being dropped.
          if (!fallbackBlogId) {
            const blog = await ensureShopifyBlog({ integration });
            fallbackBlogId = blog.id;
            blogIdByTitle.set(blog.title.trim().toLowerCase(), blog.id);
          }
          blogId = fallbackBlogId;
        }

        const previous = merged[article.articleId];
        // The client sends the cover it is showing the merchant; the stored
        // slice is only a fallback, since the client also rewrites that file.
        const cover = article.featuredImage ?? previous?.featuredImage;

        const create = (image?: { url: string; altText?: string }) =>
          createShopifyArticle({
            integration,
            blogId,
            title: article.title,
            bodyHtml: article.bodyHtml,
            summary: article.seoDescription,
            author: shopInfo.storeName ?? undefined,
            publishDate: publishAt,
            seoTitle: article.seoTitle,
            seoDescription: article.seoDescription,
            image,
          });

        // Shopify fetches the cover from its source url at create time, so a
        // hotlink-protected or expired image would take the whole article down
        // with it. The post matters more than its cover.
        let created: Awaited<ReturnType<typeof create>> | undefined;
        let coverApplied = false;
        if (cover?.url) {
          try {
            created = await create({ url: cover.url, altText: cover.alt });
            coverApplied = true;
          } catch (err) {
            if (isShopifyAccessDenied(err)) throw err;
            console.warn(
              `[articles/sync] ${article.articleId} cover rejected, publishing without it:`,
              err instanceof Error ? err.message : err
            );
          }
        }
        if (!created) created = await create();

        merged[article.articleId] = {
          articleId: article.articleId,
          seoTitle: article.seoTitle ?? previous?.seoTitle ?? "",
          seoDescription: article.seoDescription ?? previous?.seoDescription ?? "",
          blogTitle: article.blogTitle ?? previous?.blogTitle ?? "none",
          bodyHtml: article.bodyHtml,
          images: previous?.images ?? [],
          featuredImage: cover,
          storeArticleId: created.id,
          storeHandle: created.handle,
          scheduledAt: publishAt,
        };

        results.push({
          articleId: article.articleId,
          ok: true,
          scheduledAt: publishAt,
          storeArticleId: created.id,
          storeHandle: created.handle,
          coverApplied,
        });
      } catch (err) {
        if (isShopifyAccessDenied(err)) {
          // Every remaining article would fail identically, so stop and say why.
          return jsonError(SHOPIFY_CONTENT_SCOPE_HINT, 403);
        }
        console.error(
          `[articles/sync] ${article.articleId} failed:`,
          err instanceof Error ? err.message : err
        );
        results.push({
          articleId: article.articleId,
          ok: false,
          error: err instanceof Error ? err.message : "Upload failed",
        });
      }
    }

    await saveProjectSliceAdmin(
      auth.admin,
      workspaceId,
      projectId,
      "articles",
      merged
    ).catch((err) => console.error("[articles/sync] Error saving slice:", err));

    const syncedCount = results.filter((row) => row.ok).length;
    return NextResponse.json(
      { ok: true, syncedCount, timeZone: timeZone ?? "UTC", results },
      { headers: auth.headers }
    );
  } catch (err) {
    console.error("[api/market-research/articles/sync] Error:", err);
    const msg = err instanceof Error ? err.message : "Failed to sync articles";
    return jsonError(msg, 500);
  }
}
