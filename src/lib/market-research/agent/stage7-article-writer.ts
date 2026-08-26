/**
 * Stage 7 article writer — OpenAI Sol with hosted web_search.
 *
 * One article per request, so a single slow or failed article never holds the
 * batch hostage. Images are grounded the same way Sync Pro grounds product
 * photos: the model may only reference URLs the tool actually returned, and it
 * places them through numbered placeholders rather than writing raw <img> tags,
 * so an invented URL cannot reach the published page.
 */

import {
  calculateOpenAiWebSearchCost,
  type AiCallCost,
} from "@/lib/ai-pricing";
import {
  collectToolImages,
  countWebSearchCalls,
  looksLikeDirectImageUrl,
  parseJsonObject,
  responseOutputText,
} from "@/lib/enrich/parse";
import { requireOpenAiApiKey, OPENAI_RESPONSES_URL } from "@/lib/enrich/openai";
import { escapeHtml } from "@/lib/html-escape";
import type { OpenAiResponse } from "@/lib/enrich/types";
import type {
  ArticleLinkTarget,
  StrategyArticleType,
  StoreBlog,
} from "@/components/market-research/workspace-data";

export const ARTICLE_WRITER_MODEL = "gpt-5.6-sol" as const;

/** Hard ceiling the user set: the model chooses how many, never more than this. */
export const MAX_ARTICLE_IMAGES = 5;

const TYPE_BRIEF: Record<StrategyArticleType, string> = {
  guide:
    "A practical guide: explain how to choose or use the subject, in the order a buyer actually decides.",
  comparison:
    "A comparison: put the named options side by side on the criteria that change the decision, and say who each one suits.",
  faq:
    "A direct answer piece: answer the question in the first paragraph, then cover the follow-up questions a reader will have next.",
  roundup:
    "A curated roundup: present the options as a short ranked list, each with what it is best for.",
};

export interface ArticleWriteInput {
  articleId: string;
  title: string;
  keyword: string;
  type: StrategyArticleType;
  linksOut: ArticleLinkTarget[];
  storeName?: string;
  /** Blogs available on the store; the writer picks one or answers "none". */
  blogs?: StoreBlog[];
}

export interface ArticleWriteResult {
  articleId: string;
  seoTitle: string;
  seoDescription: string;
  blogTitle: string;
  bodyHtml: string;
  images: Array<{ url: string; alt: string }>;
  /** Cover image for the store's article listing, chosen in the same call. */
  featuredImage?: { url: string; alt: string };
  cost: AiCallCost | null;
}

type RawArticle = {
  seoTitle?: unknown;
  seoDescription?: unknown;
  blogTitle?: unknown;
  bodyHtml?: unknown;
  images?: unknown;
  featuredImage?: unknown;
};

async function postResponses(body: Record<string, unknown>): Promise<OpenAiResponse> {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  const apiKey = requireOpenAiApiKey();

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(280_000),
  });

  const rawText = await response.text();
  let parsed: OpenAiResponse;
  try {
    parsed = JSON.parse(rawText) as OpenAiResponse;
  } catch {
    throw new Error(`Article writer returned invalid JSON (${response.status})`);
  }
  if (!response.ok) {
    throw new Error(
      parsed.error?.message || `Article writer failed (${response.status})`
    );
  }
  if (parsed.status && parsed.status !== "completed") {
    throw new Error(`Article writer ended with status ${parsed.status}`);
  }
  return parsed;
}

function buildPrompt(input: ArticleWriteInput): string {
  const blogList = (input.blogs ?? [])
    .map((blog) => blog.title)
    .filter(Boolean);

  return [
    `Write one publish-ready article for the store "${input.storeName || "our store"}".`,
    "",
    `Title: ${input.title}`,
    `Target search query: ${input.keyword}`,
    `Format: ${TYPE_BRIEF[input.type]}`,
    "",
    "Body rules:",
    "- Return the body as clean HTML using only <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <em>, <a>, and <table>.",
    "- Do not include an <h1>: the theme renders the title.",
    "- Answer the query in the opening paragraph. No throat-clearing introduction.",
    "- 900 to 1400 words. Specific and verifiable; if you are unsure of a fact, leave it out.",
    "- Never mention that this was written by an AI and never invent store policies, prices, or stock.",
    "",
    "Internal links — this is a hard requirement:",
    blogList.length > 0 || input.linksOut.length > 0 ? "" : "- None supplied; do not add any links.",
    ...input.linksOut.map(
      (link, index) =>
        `- Link ${index + 1}: place <a href="${link.url}">${link.anchor}</a> once, inside a sentence where a reader would genuinely want to browse ${link.collectionName}.`
    ),
    input.linksOut.length > 0
      ? '- Use these exact href values verbatim. Never write any other URL, path, or slug — no external links at all.'
      : "",
    "",
    `Images — at most ${MAX_ARTICLE_IMAGES}, and only as many as genuinely help:`,
    "- Use web_search image results to find them. Copy each url exactly from a web_search image_result.image_url.",
    "- Do NOT write <img> tags. Instead put a placeholder on its own line where the image belongs: [[IMAGE_1]], [[IMAGE_2]], and so on.",
    "- Every placeholder in the body must have a matching entry in images, and every entry must be used once.",
    "- Write alt text that describes what the image shows, not the keyword.",
    "- If no result is genuinely useful, return an empty images list and no placeholders.",
    "",
    "Featured image — the cover shown on the blog listing:",
    "- Pick one wide, high quality web_search image that represents the whole subject, not a detail from one section.",
    "- Copy the url exactly from a web_search image_result.image_url. It may repeat one of the body images.",
    "- Leave the url empty only if no search result is usable.",
    "",
    "Blog category:",
    blogList.length > 0
      ? `- Choose the single best fit from these store blogs, copied exactly: ${blogList.join(" | ")}. If none fits the subject, answer "none".`
      : '- The store has no blogs, so answer "none".',
    "",
    "SEO:",
    "- seoTitle: under 60 characters, includes the subject, not a copy of the article title.",
    "- seoDescription: 140 to 155 characters, describes the payoff of reading, no quotes.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * Swaps [[IMAGE_n]] placeholders for figures built from grounded URLs. Any
 * placeholder without a verified image is removed rather than left visible.
 */
function renderImages(
  bodyHtml: string,
  candidates: Array<{ url: string; alt: string }>
): { html: string; used: Array<{ url: string; alt: string }> } {
  const used: Array<{ url: string; alt: string }> = [];

  const html = bodyHtml.replace(/\[\[IMAGE_(\d+)\]\]/g, (_match, raw) => {
    const index = Number(raw) - 1;
    const image = candidates[index];
    if (!image) return "";
    if (!used.some((entry) => entry.url === image.url)) used.push(image);
    return `<figure><img src="${escapeHtml(image.url)}" alt="${escapeHtml(
      image.alt
    )}" loading="lazy" /></figure>`;
  });

  return { html: html.replace(/\n{3,}/g, "\n\n").trim(), used };
}

/** Drops any href the planner did not authorise, keeping the anchor text. */
function stripUnauthorizedLinks(
  bodyHtml: string,
  allowed: ArticleLinkTarget[]
): string {
  const allowedHrefs = new Set(allowed.map((link) => link.url));
  return bodyHtml.replace(
    /<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (match, href: string, text: string) =>
      allowedHrefs.has(href.trim()) ? match : text
  );
}

function pickBlogTitle(raw: unknown, blogs: StoreBlog[] | undefined): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value || value.toLowerCase() === "none") return "none";
  const match = (blogs ?? []).find(
    (blog) => blog.title.trim().toLowerCase() === value.toLowerCase()
  );
  return match ? match.title : "none";
}

function clampText(raw: unknown, max: number, fallback: string): string {
  const value = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!value) return fallback.slice(0, max);
  return value.slice(0, max);
}

export async function writeArticle(
  input: ArticleWriteInput
): Promise<ArticleWriteResult> {
  const body = await postResponses({
    model: ARTICLE_WRITER_MODEL,
    reasoning: { effort: "high" },
    tools: [
      {
        type: "web_search",
        search_context_size: "high",
        external_web_access: true,
        search_content_types: ["image", "text"],
        image_settings: {
          max_results: MAX_ARTICLE_IMAGES * 3,
          caption: true,
        },
      },
    ],
    include: ["web_search_call.results"],
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: buildPrompt(input) }],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "store_article",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: [
            "seoTitle",
            "seoDescription",
            "blogTitle",
            "bodyHtml",
            "images",
            "featuredImage",
          ],
          properties: {
            seoTitle: { type: "string", description: "Meta title, under 60 characters" },
            seoDescription: {
              type: "string",
              description: "Meta description, 140-155 characters",
            },
            blogTitle: {
              type: "string",
              description: 'Exact store blog title, or "none"',
            },
            bodyHtml: {
              type: "string",
              description:
                "Article body as HTML with [[IMAGE_n]] placeholders, no <h1>, no <img>",
            },
            images: {
              type: "array",
              maxItems: MAX_ARTICLE_IMAGES,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["url", "alt"],
                properties: {
                  url: {
                    type: "string",
                    description: "Exact image_result.image_url from web_search",
                  },
                  alt: { type: "string", description: "Descriptive alt text" },
                },
              },
              description:
                "Images in placeholder order: entry 1 is [[IMAGE_1]]",
            },
            featuredImage: {
              type: "object",
              additionalProperties: false,
              required: ["url", "alt"],
              properties: {
                url: {
                  type: "string",
                  description:
                    "Exact image_result.image_url for the cover, or an empty string",
                },
                alt: { type: "string", description: "Descriptive alt text" },
              },
              description: "Cover image shown on the blog listing",
            },
          },
        },
      },
    },
    store: true,
  });

  const parsed = parseJsonObject(responseOutputText(body)) as RawArticle | null;
  if (!parsed || typeof parsed.bodyHtml !== "string" || !parsed.bodyHtml.trim()) {
    throw new Error("The writer returned no article body");
  }

  const toolImages = collectToolImages(body);
  const pool = new Map(
    toolImages.map((image) => [image.imageUrl.toLowerCase(), image.imageUrl])
  );

  // Only URLs the search tool actually returned survive.
  const grounded: Array<{ url: string; alt: string }> = [];
  if (Array.isArray(parsed.images)) {
    for (const raw of parsed.images.slice(0, MAX_ARTICLE_IMAGES)) {
      if (!raw || typeof raw !== "object") continue;
      const record = raw as { url?: unknown; alt?: unknown };
      const url = typeof record.url === "string" ? record.url.trim() : "";
      if (!url || !looksLikeDirectImageUrl(url)) continue;
      const verified = pool.get(url.toLowerCase());
      if (!verified) continue;
      if (grounded.some((entry) => entry.url === verified)) continue;
      grounded.push({
        url: verified,
        alt: typeof record.alt === "string" ? record.alt.trim() : input.title,
      });
    }
  }

  const linked = stripUnauthorizedLinks(parsed.bodyHtml, input.linksOut);
  const { html, used } = renderImages(linked, grounded);

  // The cover goes through the same gate: a url the tool never returned would
  // be a broken image on the blog listing.
  let featuredImage: { url: string; alt: string } | undefined;
  const rawFeatured = parsed.featuredImage as
    | { url?: unknown; alt?: unknown }
    | undefined;
  const featuredUrl =
    rawFeatured && typeof rawFeatured.url === "string"
      ? rawFeatured.url.trim()
      : "";
  if (featuredUrl && looksLikeDirectImageUrl(featuredUrl)) {
    const verified = pool.get(featuredUrl.toLowerCase());
    if (verified) {
      featuredImage = {
        url: verified,
        alt:
          typeof rawFeatured?.alt === "string" && rawFeatured.alt.trim()
            ? rawFeatured.alt.trim()
            : input.title,
      };
    }
  }
  // Rather than ship a coverless post, fall back to the first body image.
  if (!featuredImage && used.length > 0) featuredImage = used[0];

  const searchCalls = countWebSearchCalls(body);
  const cost = calculateOpenAiWebSearchCost(
    ARTICLE_WRITER_MODEL,
    body.usage,
    searchCalls
  );

  return {
    articleId: input.articleId,
    seoTitle: clampText(parsed.seoTitle, 60, input.title),
    seoDescription: clampText(parsed.seoDescription, 160, input.title),
    blogTitle: pickBlogTitle(parsed.blogTitle, input.blogs),
    bodyHtml: html,
    images: used,
    featuredImage,
    cost,
  };
}
