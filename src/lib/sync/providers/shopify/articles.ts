// Shopify blog articles module.
//
// Verified against:
//   https://shopify.dev/docs/api/admin-graphql/latest/queries/blogs
//   https://shopify.dev/docs/api/admin-graphql/latest/mutations/articleCreate
//   https://shopify.dev/docs/api/admin-graphql/latest/input-objects/ArticleCreateInput
//   https://shopify.dev/docs/api/admin-graphql/latest/mutations/metafieldsSet

import type { IntegrationRecord } from "@/lib/sync/core/types";
import { shopifyGraphQL } from "./graphql-client";

const BLOGS_QUERY = /* GraphQL */ `
  query Blogs($first: Int!, $after: String) {
    blogs(first: $first, after: $after) {
      edges {
        node {
          id
          title
          handle
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const BLOG_CREATE = /* GraphQL */ `
  mutation BlogCreate($blog: BlogCreateInput!) {
    blogCreate(blog: $blog) {
      blog {
        id
        title
        handle
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const ARTICLE_CREATE = /* GraphQL */ `
  mutation ArticleCreate($article: ArticleCreateInput!) {
    articleCreate(article: $article) {
      article {
        id
        handle
        title
        publishedAt
      }
      userErrors {
        code
        field
        message
      }
    }
  }
`;

const METAFIELDS_SET = /* GraphQL */ `
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors {
        field
        message
      }
    }
  }
`;

const SHOP_INFO_QUERY = /* GraphQL */ `
  query ShopInfo {
    shop {
      name
      ianaTimezone
      primaryDomain {
        url
      }
    }
  }
`;

const ARTICLE_FALLBACK_AUTHOR = "Editorial Team";

export type ShopifyBlog = {
  id: string;
  handle: string;
  title: string;
};

/**
 * Blogs and articles sit behind `write_content` (or `write_online_store_pages`),
 * which the product/inventory scopes don't cover. Shopify answers with a plain
 * "Access denied" that means nothing to a merchant, so it is detected here and
 * translated wherever it surfaces.
 *   docs: https://shopify.dev/docs/api/admin-graphql/latest/mutations/articleCreate
 */
export const SHOPIFY_CONTENT_SCOPE_HINT =
  "This store's Shopify app is missing the blog permissions. In Shopify admin open Settings › Apps and sales channels › Develop apps › your app › Configuration, enable read_content and write_content, then reinstall the app.";

export function isShopifyAccessDenied(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : String(error ?? "");
  return /access denied|not approved to access|requires.*access scope/i.test(
    message
  );
}

type BlogsPageData = {
  blogs: {
    edges: Array<{ node: { id: string; title: string; handle: string } }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

/** Every blog on the store, paginated. Used to offer the writer a category. */
export async function fetchShopifyBlogs(params: {
  integration: IntegrationRecord;
}): Promise<ShopifyBlog[]> {
  const blogs: ShopifyBlog[] = [];
  let after: string | null = null;

  for (let page = 0; page < 10; page += 1) {
    const res: Awaited<ReturnType<typeof shopifyGraphQL<BlogsPageData>>> =
      await shopifyGraphQL<BlogsPageData>({
        integration: params.integration,
        query: BLOGS_QUERY,
        variables: { first: 50, after },
        options: { estimatedCost: 10, tag: "blogs" },
      });

    if (res.errors.length > 0) {
      throw new Error(res.errors[0].message);
    }

    for (const edge of res.data?.blogs?.edges ?? []) {
      if (edge.node?.id) {
        blogs.push({
          id: edge.node.id,
          title: edge.node.title ?? "",
          handle: edge.node.handle ?? "",
        });
      }
    }

    const pageInfo = res.data?.blogs?.pageInfo;
    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
    after = pageInfo.endCursor;
  }

  return blogs;
}

/**
 * The store's timezone (so scheduled times land in the shopper's day) and its
 * customer-facing domain, which is what a storefront link must point at — the
 * admin `base_url` is not always the domain shoppers see.
 */
export async function fetchShopInfo(params: {
  integration: IntegrationRecord;
}): Promise<{
  ianaTimezone: string | null;
  storeUrl: string | null;
  storeName: string | null;
}> {
  try {
    const res = await shopifyGraphQL<{
      shop: {
        name: string | null;
        ianaTimezone: string | null;
        primaryDomain: { url: string | null } | null;
      };
    }>({
      integration: params.integration,
      query: SHOP_INFO_QUERY,
      variables: {},
      options: { estimatedCost: 2, tag: "shopInfo" },
    });
    return {
      ianaTimezone: res.data?.shop?.ianaTimezone ?? null,
      storeUrl: res.data?.shop?.primaryDomain?.url ?? null,
      storeName: res.data?.shop?.name ?? null,
    };
  } catch {
    return { ianaTimezone: null, storeUrl: null, storeName: null };
  }
}

/**
 * A store with no blog cannot receive articles at all, so one is created on
 * demand rather than failing the sync.
 */
export async function ensureShopifyBlog(params: {
  integration: IntegrationRecord;
  title?: string;
}): Promise<ShopifyBlog> {
  const existing = await fetchShopifyBlogs({ integration: params.integration });
  if (existing.length > 0) {
    const wanted = (params.title ?? "").trim().toLowerCase();
    if (wanted) {
      const match = existing.find(
        (blog) => blog.title.trim().toLowerCase() === wanted
      );
      if (match) return match;
    }
    return existing[0];
  }

  const res = await shopifyGraphQL<{
    blogCreate: {
      blog: { id: string; title: string; handle: string } | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>({
    integration: params.integration,
    query: BLOG_CREATE,
    variables: { blog: { title: params.title?.trim() || "News" } },
    options: { estimatedCost: 10, tag: "blogCreate" },
  });

  const userErrors = res.data?.blogCreate?.userErrors ?? [];
  if (userErrors.length > 0) throw new Error(userErrors[0].message);

  const blog = res.data?.blogCreate?.blog;
  if (!blog?.id) throw new Error("Shopify did not return the created blog");
  return { id: blog.id, title: blog.title ?? "", handle: blog.handle ?? "" };
}

/**
 * Creates an article scheduled to appear at `publishDate`. Shopify rejects
 * `isPublished: true` alongside a future date (INVALID_PUBLISH_DATE); the
 * scheduled state is `isPublished: false` plus the future date, and Shopify
 * flips it live on its own without any cron on our side.
 *
 * SEO title and description are written afterwards as the two global metafields
 * Shopify themes read for meta tags — they are not fields on the article.
 */
export async function createShopifyArticle(params: {
  integration: IntegrationRecord;
  blogId: string;
  title: string;
  bodyHtml: string;
  summary?: string;
  author?: string;
  publishDate: string;
  seoTitle?: string;
  seoDescription?: string;
  tags?: string[];
  image?: { url: string; altText?: string };
}): Promise<{ id: string; handle: string; seoApplied: boolean }> {
  const res = await shopifyGraphQL<{
    articleCreate: {
      article: { id: string; handle: string } | null;
      userErrors: Array<{ code?: string; field: string[] | null; message: string }>;
    };
  }>({
    integration: params.integration,
    query: ARTICLE_CREATE,
    variables: {
      article: {
        blogId: params.blogId,
        title: params.title,
        body: params.bodyHtml,
        summary: params.summary || undefined,
        // Shopify rejects the whole mutation when author is absent, so a byline
        // is always sent (the store name reads better than a generic default).
        author: { name: params.author?.trim() || ARTICLE_FALLBACK_AUTHOR },
        isPublished: false,
        publishDate: params.publishDate,
        tags: params.tags?.length ? params.tags : undefined,
        image: params.image?.url
          ? { url: params.image.url, altText: params.image.altText || params.title }
          : undefined,
      },
    },
    options: { estimatedCost: 15, tag: "articleCreate" },
  });

  if (res.errors.length > 0) throw new Error(res.errors[0].message);

  const userErrors = res.data?.articleCreate?.userErrors ?? [];
  if (userErrors.length > 0) throw new Error(userErrors[0].message);

  const article = res.data?.articleCreate?.article;
  if (!article?.id) throw new Error("Shopify did not return the created article");

  const seoApplied = await applyArticleSeo({
    integration: params.integration,
    articleId: article.id,
    seoTitle: params.seoTitle,
    seoDescription: params.seoDescription,
  });

  return { id: article.id, handle: article.handle ?? "", seoApplied };
}

/** Never throws: a live article with default meta tags beats a failed sync. */
async function applyArticleSeo(params: {
  integration: IntegrationRecord;
  articleId: string;
  seoTitle?: string;
  seoDescription?: string;
}): Promise<boolean> {
  const metafields: Array<{
    ownerId: string;
    namespace: string;
    key: string;
    type: string;
    value: string;
  }> = [];

  if (params.seoTitle?.trim()) {
    metafields.push({
      ownerId: params.articleId,
      namespace: "global",
      key: "title_tag",
      type: "single_line_text_field",
      value: params.seoTitle.trim(),
    });
  }
  if (params.seoDescription?.trim()) {
    metafields.push({
      ownerId: params.articleId,
      namespace: "global",
      key: "description_tag",
      type: "single_line_text_field",
      value: params.seoDescription.trim(),
    });
  }
  if (metafields.length === 0) return false;

  try {
    const res = await shopifyGraphQL<{
      metafieldsSet: { userErrors: Array<{ field: string[] | null; message: string }> };
    }>({
      integration: params.integration,
      query: METAFIELDS_SET,
      variables: { metafields },
      options: { estimatedCost: 10, tag: "metafieldsSet" },
    });
    if (res.errors.length > 0) return false;
    return (res.data?.metafieldsSet?.userErrors ?? []).length === 0;
  } catch {
    return false;
  }
}
