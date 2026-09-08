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
  ArticleSkuTarget,
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
  /** Verified product pages the article may link to; optional, capped at 5. */
  skuLinks?: ArticleSkuTarget[];
  storeName?: string;
  /** The storefront's real domain, so the model knows what "our website" is. */
  storeUrl?: string;
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

/**
 * AI writing tells that make copy read as machine-generated. Banned outright
 * rather than merely discouraged, because a soft "avoid if possible" rule is
 * exactly the kind of instruction a model quietly ignores under pressure.
 */
const BANNED_PHRASES = [
  "in today's fast-paced world",
  "in today's digital age",
  "delve into",
  "delve",
  "moreover",
  "furthermore",
  "it's important to note",
  "it is important to note",
  "when it comes to",
  "unlock",
  "elevate your",
  "game-changer",
  "game changer",
  "in conclusion",
  "in summary",
  "at the end of the day",
  "look no further",
  "we've got you covered",
];

function buildPrompt(input: ArticleWriteInput): string {
  const blogList = (input.blogs ?? [])
    .map((blog) => blog.title)
    .filter(Boolean);
  const skuLinks = input.skuLinks ?? [];
  const term = input.keyword;
  const hasAnyLinks = input.linksOut.length > 0 || skuLinks.length > 0;

  return [
    `Write one publish-ready, SEO-optimized article for the store "${
      input.storeName || "our store"
    }"${input.storeUrl ? ` (${input.storeUrl})` : ""}.`,
    "",
    `Title: ${input.title}`,
    `Target search term: ${term}`,
    `Format: ${TYPE_BRIEF[input.type]}`,
    "",
    "Voice — write like an experienced, opinionated writer in this niche, not an AI:",
    `- Ban these phrases and any close variant of them, anywhere in the article: ${BANNED_PHRASES.map(
      (phrase) => `"${phrase}"`
    ).join(", ")}.`,
    "- Vary sentence length and structure; do not start consecutive sentences the same way.",
    '- Address the reader as "you". Prefer concrete specifics (sizes, materials, numbers, named use cases) over vague adjectives like "great" or "amazing".',
    "- No closing paragraph that just restates the introduction — end on the last genuinely useful point instead.",
    "- No emoji, no filler rhetorical questions, no title-case headings.",
    "",
    "SEO term placement — checked automatically after writing, follow exactly:",
    `- The exact term "${term}" must appear in seoTitle, in seoDescription, within the first 100 words of the body, and in at least one — not every — <h2>.`,
    `- Use the exact term or a close natural variant 3 to 6 times total across the whole body. Never more than once per sentence, never in every paragraph.`,
    "",
    "Structure:",
    "- Return the body as clean HTML using only <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <em>, <a>, and <table>.",
    "- Do not include an <h1>: the theme renders the title.",
    "- Answer the query in the opening paragraph — no throat-clearing introduction.",
    "- One <h2> per real subtopic, in sentence case, never just the keyword repeated. Use <h3> for items within a section.",
    "- Paragraphs of 2 to 4 sentences. Include at least one <ul>, <ol>, or <table> so the page is scannable, not a wall of text.",
    input.type === "comparison"
      ? "- Include a <table> comparing the named options on the criteria that actually change a buyer's decision."
      : "",
    input.type === "roundup"
      ? '- Give each pick its own <h3> plus one short "best for" line.'
      : "",
    input.type === "faq"
      ? "- Phrase each <h2> as the question itself, answered in its first sentence."
      : "",
    "- 1000 to 1500 words. Specific and verifiable; if you are unsure of a fact, leave it out.",
    "- Never mention that this was written by an AI and never invent store policies, prices, or stock.",
    "",
    "Collection links — this is a hard requirement:",
    input.linksOut.length > 0 ? "" : "- None supplied; do not add any collection links.",
    ...input.linksOut.map(
      (link, index) =>
        `- Link ${index + 1}: place <a href="${link.url}">${link.anchor}</a> once, inside a sentence where a reader would genuinely want to browse ${link.collectionName} next.`
    ),
    "",
    skuLinks.length > 0
      ? "Product links — optional, only where one specific product is the honest answer:"
      : "",
    ...skuLinks.map(
      (sku) =>
        `- You may place <a href="${sku.url}">${sku.anchor}</a> once, only in a sentence where "${sku.productName}" is genuinely the product being discussed.`
    ),
    hasAnyLinks
      ? [
          "",
          "Link placement rules, for both collection and product links:",
          "- Use these exact href values verbatim. Never write any other URL, path, or slug — no external links at all.",
          "- Never place two links in the same sentence, and never link in the article's first or last sentence.",
          '- Anchor text must describe what the reader will find — never "click here", "this page", or a bare URL.',
          "- Use each URL at most once, even if it would fit naturally in more than one place.",
        ].join("\n")
      : "",
    "",
    `Images — at most ${MAX_ARTICLE_IMAGES}, and only as many as genuinely help:`,
    "- Use web_search image results to find them. Copy each url exactly from a web_search image_result.image_url.",
    "- Do NOT write <img> tags. Instead put a placeholder on its own line where the image belongs: [[IMAGE_1]], [[IMAGE_2]], and so on.",
    "- Every placeholder in the body must have a matching entry in images, and every entry must be used once.",
    `- Write alt text that describes what the image shows. At least one image's alt text must naturally include "${term}".`,
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
    "SEO fields:",
    `- seoTitle: under 60 characters, leads with or naturally includes "${term}" — not a copy of the article title.`,
    `- seoDescription: 140 to 155 characters, includes "${term}", describes the payoff of reading, no quotes.`,
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

/**
 * Drops any href the planner did not authorise, keeping the anchor text.
 * Takes a flat, already-combined list of allowed hrefs so the same guard
 * covers collection links and product (SKU) links alike — a link surviving
 * this pass is guaranteed to be one of ours, invented URLs are stripped.
 */
export function stripUnauthorizedLinks(
  bodyHtml: string,
  allowedHrefs: string[]
): string {
  const allowed = new Set(allowedHrefs);
  return bodyHtml.replace(
    /<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (match, href: string, text: string) =>
      allowed.has(href.trim()) ? match : text
  );
}

/**
 * Deterministic SEO enforcement, applied right before `writeArticle` returns.
 * The prompt asks the model to place the target term in specific places, but
 * a prompt rule is a request, not a guarantee — these are the checks. Each is
 * a no-op when the term is already present.
 */
export function ensureTermInSeoTitle(
  rawTitle: string,
  term: string,
  maxLength = 60
): string {
  const title = (rawTitle || "").replace(/\s+/g, " ").trim();
  const cleanTerm = (term || "").trim();
  if (!cleanTerm) return title.slice(0, maxLength);
  if (title.toLowerCase().includes(cleanTerm.toLowerCase())) {
    return title.slice(0, maxLength);
  }
  // Term-led rebuild: the exact term first, then as much of the original
  // title as still fits, so the term is never at risk of being clamped off.
  const combined = title ? `${cleanTerm} \u2013 ${title}` : cleanTerm;
  return combined.slice(0, maxLength).trim();
}

export function ensureTermInSeoDescription(
  rawDescription: string,
  term: string,
  maxLength = 160
): string {
  const description = (rawDescription || "").replace(/\s+/g, " ").trim();
  const cleanTerm = (term || "").trim();
  if (!cleanTerm) return description.slice(0, maxLength);
  if (description.toLowerCase().includes(cleanTerm.toLowerCase())) {
    return description.slice(0, maxLength);
  }
  const combined = description
    ? `${cleanTerm}: ${description}`
    : cleanTerm;
  return combined.slice(0, maxLength).trim();
}

/**
 * If none of the placed images' alt text mentions the term, blends it into
 * the first image's alt so at least one does. Leaves every other image
 * untouched, and is a no-op when nothing needs to change.
 */
export function ensureTermInAltText<T extends { alt: string }>(
  images: T[],
  term: string
): T[] {
  const cleanTerm = (term || "").trim();
  if (!cleanTerm || images.length === 0) return images;
  if (
    images.some((image) => image.alt.toLowerCase().includes(cleanTerm.toLowerCase()))
  ) {
    return images;
  }
  return images.map((image, index) =>
    index === 0
      ? { ...image, alt: `${image.alt} \u2014 ${cleanTerm}`.trim() }
      : image
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

  const allowedHrefs = [
    ...input.linksOut.map((link) => link.url),
    ...(input.skuLinks ?? []).map((sku) => sku.url),
  ];
  const linked = stripUnauthorizedLinks(parsed.bodyHtml, allowedHrefs);
  const { html: renderedHtml, used: renderedImages } = renderImages(
    linked,
    grounded
  );

  // The SEO term must land in a published image's alt, not merely a
  // candidate that never made it into the body — so this runs after
  // rendering, against `used`, and patches the one alt attribute it touches
  // directly in the HTML rather than re-rendering from scratch.
  const termedImages = ensureTermInAltText(renderedImages, input.keyword);
  let html = renderedHtml;
  if (
    termedImages.length > 0 &&
    termedImages[0].alt !== renderedImages[0]?.alt
  ) {
    html = html.replace(
      `alt="${escapeHtml(renderedImages[0].alt)}"`,
      `alt="${escapeHtml(termedImages[0].alt)}"`
    );
  }
  const used = termedImages;

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

  const seoTitle = ensureTermInSeoTitle(
    clampText(parsed.seoTitle, 60, input.title),
    input.keyword,
    60
  );
  const seoDescription = ensureTermInSeoDescription(
    clampText(parsed.seoDescription, 160, input.title),
    input.keyword,
    160
  );

  return {
    articleId: input.articleId,
    seoTitle,
    seoDescription,
    blogTitle: pickBlogTitle(parsed.blogTitle, input.blogs),
    bodyHtml: html,
    images: used,
    featuredImage,
    cost,
  };
}
