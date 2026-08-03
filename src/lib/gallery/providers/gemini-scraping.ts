import { GoogleGenAI } from "@google/genai";
import {
  calculateGroundedCallCost,
  type AiCallCost,
} from "@/lib/ai-pricing";
import type { SerperImageCandidate } from "@/lib/gallery/agent/filters";
import { filterSerperCandidates } from "@/lib/gallery/agent/filters";
import { galleryLog, galleryWarn } from "@/lib/gallery/log";
import { requireGeminiApiKey } from "@/lib/sync/agent/ai-utils";
import type { GalleryScrapingSettings } from "@/lib/gallery/types";

/** Fixed server-side model — never exposed in the UI. */
export const GALLERY_SCRAPING_MODEL = "gemini-3.6-flash";

/** Soft target for the single gallery sourcing request. */
const MAX_BILLABLE_SEARCH_QUERIES = 3;

const GALLERY_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    productIdentity: { type: "string" },
    officialDomainHints: {
      type: "array",
      items: { type: "string" },
      maxItems: 4,
    },
    images: {
      type: "array",
      maxItems: 16,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          imageUrl: { type: "string" },
          pageUrl: { type: "string" },
          title: { type: "string" },
          angle: { type: "string" },
        },
        required: ["imageUrl", "pageUrl", "title", "angle"],
      },
    },
    notes: { type: "string" },
  },
  required: ["productIdentity", "officialDomainHints", "images"],
} as const;

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function looksLikeImageUrl(url: string): boolean {
  if (!isHttpUrl(url)) return false;
  const lower = url.toLowerCase();
  if (/\.(jpe?g|png|webp|gif|avif|bmp)(\?|#|$)/i.test(lower)) return true;
  if (
    /\/(images?|img|media|cdn|static|assets|product|catalog|photos?)\//i.test(
      lower
    )
  ) {
    return true;
  }
  return !/\.(html?|php|aspx?)(\?|#|$)/i.test(lower);
}

function candidatePoolSize(
  settings: GalleryScrapingSettings,
  needed: number
): number {
  const base = Math.max(needed, 1);
  switch (settings.searchDepth) {
    case "low":
      return Math.min(16, Math.max(4, base * 2));
    case "high":
      return Math.min(16, Math.max(10, base * 4));
    default:
      return Math.min(16, Math.max(6, base * 3));
  }
}

function sourcePolicyInstruction(settings: GalleryScrapingSettings): string {
  switch (settings.sourcePolicy) {
    case "official-only":
      return "Only use official brand or manufacturer product pages.";
    case "prefer-official":
      return "Prefer official brand or manufacturer pages; other reputable retailers are acceptable when needed.";
    default:
      return "Any reputable ecommerce or brand page is acceptable.";
  }
}

function buildFocusedRow(
  rowData: Record<string, string>,
  selectedColumns: string[]
): Record<string, string> {
  const selected = selectedColumns.length
    ? selectedColumns
    : Object.keys(rowData);
  const focused: Record<string, string> = {};
  for (const col of selected) {
    const value = String(rowData[col] ?? "").trim();
    if (value) focused[col] = value.slice(0, 500);
  }
  return focused;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function countSearchQueries(steps: unknown): {
  observed: number;
  inferred: number;
} {
  if (!Array.isArray(steps)) return { observed: 0, inferred: 0 };
  let observed = 0;
  let inferred = 0;
  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    const typed = step as {
      type?: string;
      arguments?: { queries?: unknown };
    };
    if (typed.type !== "google_search_call") continue;
    const queries = typed.arguments?.queries;
    if (Array.isArray(queries) && queries.length > 0) {
      observed += queries.filter(
        (q) => typeof q === "string" && q.trim().length > 0
      ).length;
    } else {
      inferred += 1;
    }
  }
  return { observed, inferred };
}

function normalizeDomainHints(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) =>
      String(value)
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split("/")[0]
    )
    .filter(Boolean)
    .slice(0, 4);
}

function toCandidates(
  images: unknown,
  settings: GalleryScrapingSettings,
  officialDomainHints: string[],
  blockedUrls: string[],
  pool: number
): SerperImageCandidate[] {
  const blocked = new Set(
    blockedUrls.map((u) => u.trim().toLowerCase()).filter(Boolean)
  );
  const raw: SerperImageCandidate[] = [];
  if (!Array.isArray(images)) return [];
  for (const item of images) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const imageUrl = String(row.imageUrl || "").trim();
    if (!looksLikeImageUrl(imageUrl)) continue;
    if (blocked.has(imageUrl.toLowerCase())) continue;
    const pageUrl = String(row.pageUrl || "").trim() || imageUrl;
    const angle = String(row.angle || "").trim();
    const title = String(row.title || angle || "product image").slice(0, 200);
    raw.push({
      imageUrl,
      pageUrl,
      title: angle ? `${title} (${angle})` : title,
      width: 0,
      height: 0,
      sourceDomain: hostnameOf(pageUrl || imageUrl),
    });
  }
  return filterSerperCandidates(raw, settings, officialDomainHints).slice(
    0,
    pool
  );
}

export type GalleryScrapingResult = {
  productIdentity: string;
  officialDomainHints: string[];
  candidates: SerperImageCandidate[];
  cost: AiCallCost | null;
  searchQueryCount: number;
  observedSearchQueryCount: number;
  inferredSearchQueryCount: number;
  latencyMs: number;
  notes?: string;
  stage: "main" | "gallery";
};

async function runGroundedScrape(params: {
  stage: "main" | "gallery";
  input: Array<Record<string, unknown>>;
  schema: typeof GALLERY_RESULT_SCHEMA;
  settings: GalleryScrapingSettings;
  pool: number;
  blockedUrls: string[];
}): Promise<GalleryScrapingResult> {
  const startedAt = Date.now();
  galleryLog("scraping", `Starting grounded scrape (${params.stage})`, {
    model: GALLERY_SCRAPING_MODEL,
    stage: params.stage,
    pool: params.pool,
    searchDepth: params.settings.searchDepth,
  });

  const apiKey = requireGeminiApiKey();
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { timeout: 120_000 },
  });

  const interaction = await ai.interactions.create({
    model: GALLERY_SCRAPING_MODEL,
    input: params.input,
    tools: [{ type: "google_search" }, { type: "url_context" }],
    response_format: {
      type: "text",
      mime_type: "application/json",
      schema: params.schema,
    },
    store: false,
  });

  if (interaction.status !== "completed") {
    throw new Error(
      `Scraping (${params.stage}) ended with status ${interaction.status}`
    );
  }

  const rawText = interaction.output_text || "";
  const queryCounts = countSearchQueries(interaction.steps);
  const rawQueryCount = queryCounts.observed + queryCounts.inferred;
  if (rawQueryCount > MAX_BILLABLE_SEARCH_QUERIES) {
    galleryWarn("scraping", "Model ran many search queries (costly)", {
      rawQueryCount,
      observedQueryCount: queryCounts.observed,
      inferredQueryCount: queryCounts.inferred,
      softTargetMax: MAX_BILLABLE_SEARCH_QUERIES,
    });
  }
  const cost = calculateGroundedCallCost(
    GALLERY_SCRAPING_MODEL,
    interaction.usage,
    rawQueryCount
  );

  const parsed = parseJsonObject(rawText);
  if (!parsed) {
    galleryWarn("scraping", `Could not parse ${params.stage} scrape JSON`, {
      preview: rawText.slice(0, 400),
    });
    return {
      productIdentity: "",
      officialDomainHints: [],
      candidates: [],
      cost,
      searchQueryCount: rawQueryCount,
      observedSearchQueryCount: queryCounts.observed,
      inferredSearchQueryCount: queryCounts.inferred,
      latencyMs: Date.now() - startedAt,
      stage: params.stage,
    };
  }

  const officialDomainHints = normalizeDomainHints(parsed.officialDomainHints);
  const candidates = toCandidates(
    parsed.images,
    params.settings,
    officialDomainHints,
    params.blockedUrls,
    params.pool
  );

  galleryLog("scraping:done", `Scrape (${params.stage}) returned candidates`, {
    candidateCount: candidates.length,
    searchQueryCount: rawQueryCount,
    observedSearchQueryCount: queryCounts.observed,
    inferredSearchQueryCount: queryCounts.inferred,
    latencyMs: Date.now() - startedAt,
    productIdentity: parsed.productIdentity,
  });

  return {
    productIdentity: String(parsed.productIdentity || "").trim(),
    officialDomainHints,
    candidates,
    cost,
    searchQueryCount: rawQueryCount,
    observedSearchQueryCount: queryCounts.observed,
    inferredSearchQueryCount: queryCounts.inferred,
    latencyMs: Date.now() - startedAt,
    notes: parsed.notes ? String(parsed.notes) : undefined,
    stage: params.stage,
  };
}

/**
 * Stage 2 — find gallery angles for the SAME product as the attached Main image.
 * Main is sent as inline base64 so Gemini can visually compare.
 */
export async function scrapeGalleryProductImages(params: {
  rowData: Record<string, string>;
  selectedColumns: string[];
  settings: GalleryScrapingSettings;
  mainImage: { buffer: Buffer; contentType: string };
  mainImageUrl?: string;
  galleryCount: number;
}): Promise<GalleryScrapingResult> {
  const focused = buildFocusedRow(params.rowData, params.selectedColumns);
  const custom = params.settings.instructions.trim();
  const needed = Math.max(1, params.galleryCount);
  const pool = candidatePoolSize(params.settings, needed);
  const mime =
    params.mainImage.contentType === "image/png" ||
    params.mainImage.contentType === "image/webp"
      ? params.mainImage.contentType
      : "image/jpeg";

  const prompt = [
    "STAGE 2 — GALLERY IMAGES ONLY.",
    "The attached image is the trusted MAIN product photo. Gallery images must be the SAME exact product.",
    "Use ONE focused Google Search query for this exact product. Inspect at most two strong product pages with URL context, then extract DIRECT gallery / carousel image URLs.",
    "Return ONLY real https image file URLs (CDN/media), never HTML page URLs as imageUrl.",
    "Do not invent or fabricate image URLs.",
    `Collect at least ${pool} distinct gallery candidates when possible (over-fetch for filtering).`,
    "Order images by confidence: exact visual/product match first, then the strongest distinct angles. The application will keep the first downloadable results up to the requested count.",
    "CRITICAL: Every returned image must show a DIFFERENT angle or detail than the attached Main image AND from each other (front, side, back, detail, packaging, lifestyle).",
    "REJECT near-duplicates of the Main image (same crop, same composition, resized copies, color variants of the same shot).",
    "If you cannot find distinct gallery angles for this exact product, return an empty images array.",
    sourcePolicyInstruction(params.settings),
    custom
      ? `CUSTOMER INSTRUCTIONS — mandatory unless unsafe: ${custom}`
      : "",
    `Worksheet product data:\n${JSON.stringify(focused, null, 2)}`,
    params.mainImageUrl
      ? `Do not return this Main URL as a gallery candidate: ${params.mainImageUrl}`
      : "",
    "For each image include a short angle label (e.g. side, back, detail).",
    "Respond with JSON only matching the schema.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return runGroundedScrape({
    stage: "gallery",
    input: [
      {
        type: "image",
        data: params.mainImage.buffer.toString("base64"),
        mime_type: mime,
      },
      { type: "text", text: prompt },
    ],
    schema: GALLERY_RESULT_SCHEMA,
    settings: params.settings,
    pool,
    blockedUrls: params.mainImageUrl ? [params.mainImageUrl] : [],
  });
}
