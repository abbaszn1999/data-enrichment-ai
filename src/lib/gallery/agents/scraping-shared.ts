import {
  calculateOpenAiWebSearchCost,
  type AiCallCost,
} from "@/lib/ai-pricing";
import type { SerperImageCandidate } from "@/lib/gallery/agent/filters";
import { galleryLog, galleryWarn } from "@/lib/gallery/log";
import type { GalleryScrapingSettings } from "@/lib/gallery/types";

/** Fixed server-side model — never exposed in the UI. */
export const GALLERY_SCRAPING_MODEL = "gpt-5.6";

export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export type OpenAiImageCandidate = SerperImageCandidate & {
  canonicalUrl: string;
  thumbnailUrl?: string;
};

export type IndexedImageResults = {
  candidates: OpenAiImageCandidate[];
  byUrl: Map<string, OpenAiImageCandidate>;
};

type OpenAiImageResult = {
  type?: string;
  image_url?: string;
  thumbnail_url?: string;
  source_website_url?: string;
  caption?: string;
};

export type OpenAiResponse = {
  status?: string;
  output?: Array<{
    type?: string;
    results?: OpenAiImageResult[];
    action?: { results?: OpenAiImageResult[] };
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  usage?: unknown;
  error?: { message?: string };
};

export function requireOpenAiApiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error("AI image search is not configured");
  }
  return key;
}

export function buildFocusedRow(
  rowData: Record<string, string>,
  selectedColumns: string[]
): Record<string, string> {
  const selected = selectedColumns.length ? selectedColumns : Object.keys(rowData);
  const focused: Record<string, string> = {};
  for (const column of selected) {
    const value = String(rowData[column] ?? "").trim();
    if (value) focused[column] = value.slice(0, 700);
  }
  return focused;
}

export function sourcePolicyInstruction(settings: GalleryScrapingSettings): string {
  switch (settings.sourcePolicy) {
    case "official-only":
      return "Use only official brand or manufacturer product images.";
    case "prefer-official":
      return "Prefer official brand/manufacturer images, then reputable retailers.";
    default:
      return "Images from reputable brand and ecommerce sources are acceptable.";
  }
}

export function candidatePoolSize(
  settings: GalleryScrapingSettings,
  requestedImages: number
): number {
  const base = Math.max(1, requestedImages);
  switch (settings.searchDepth) {
    case "low":
      return Math.min(20, Math.max(8, base + 5));
    case "high":
      return Math.min(50, Math.max(20, base * 4));
    default:
      return Math.min(36, Math.max(14, base * 3));
  }
}

export function parseJsonObject(text: string): Record<string, unknown> | null {
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

export function responseText(response: OpenAiResponse): string {
  return (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text")
    .map((content) => content.text ?? "")
    .join("\n");
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function urlKey(value: string): string {
  return value.trim().replaceAll("&amp;", "&").toLowerCase();
}

/** Host + pathname only — ignores query/hash CDN variants (&width=, ?v=, etc.). */
export function urlPathKey(value: string): string {
  try {
    const url = new URL(value.trim().replaceAll("&amp;", "&"));
    return `${url.protocol}//${url.hostname.toLowerCase()}${decodeURIComponent(url.pathname)}`.toLowerCase();
  } catch {
    return urlKey(value);
  }
}

function registerUrlAliases(
  byUrl: Map<string, OpenAiImageCandidate>,
  alias: string,
  candidate: OpenAiImageCandidate
) {
  if (!/^https:\/\//i.test(alias)) return;
  const normalized = alias.trim().replaceAll("&amp;", "&");
  const entry = { ...candidate, imageUrl: normalized };
  byUrl.set(urlKey(normalized), entry);
  const pathOnly = urlPathKey(normalized);
  // Prefer keeping an existing exact full-URL entry; path key is a fallback index.
  if (!byUrl.has(pathOnly)) {
    byUrl.set(pathOnly, entry);
  }
}

export function collectImageResults(response: OpenAiResponse): IndexedImageResults {
  const seen = new Set<string>();
  const images: OpenAiImageCandidate[] = [];
  const byUrl = new Map<string, OpenAiImageCandidate>();
  for (const output of response.output ?? []) {
    if (output.type !== "web_search_call") continue;
    const results = output.results ?? output.action?.results ?? [];
    for (const result of results) {
      if (result.type !== "image_result") continue;
      const canonicalUrl = String(result.image_url || "").trim();
      const thumbnailUrl = String(result.thumbnail_url || "").trim();
      const imageUrl = canonicalUrl || thumbnailUrl;
      if (!/^https:\/\//i.test(imageUrl)) continue;
      const key = urlKey(imageUrl);
      if (seen.has(key)) continue;
      seen.add(key);
      const pageUrl = String(result.source_website_url || "").trim();
      const candidate = {
        imageUrl,
        canonicalUrl: canonicalUrl || imageUrl,
        thumbnailUrl: /^https:\/\//i.test(thumbnailUrl) ? thumbnailUrl : undefined,
        pageUrl: /^https?:\/\//i.test(pageUrl) ? pageUrl : imageUrl,
        title: String(result.caption || "Product image").slice(0, 300),
        width: 0,
        height: 0,
        sourceDomain: hostnameOf(pageUrl || imageUrl),
      };
      images.push(candidate);
      for (const alias of [canonicalUrl, thumbnailUrl]) {
        registerUrlAliases(byUrl, alias, candidate);
      }
    }
  }
  return { candidates: images, byUrl };
}

export function resolveSelectedImageUrl(
  rawUrl: string,
  byUrl: Map<string, OpenAiImageCandidate>,
  allCandidates: OpenAiImageCandidate[] = []
): OpenAiImageCandidate | null {
  const normalized = String(rawUrl || "").trim().replaceAll("&amp;", "&");
  if (!normalized) return null;
  const exact = byUrl.get(urlKey(normalized));
  if (exact) {
    // Prefer the model-selected URL when it is only a query-string variant of a
    // verified search hit (common CDN params like width= / v=).
    if (urlPathKey(exact.imageUrl) === urlPathKey(normalized)) {
      return { ...exact, imageUrl: normalized };
    }
    return exact;
  }
  const byPath = byUrl.get(urlPathKey(normalized));
  if (byPath) {
    return {
      ...byPath,
      imageUrl: /^https:\/\//i.test(normalized) ? normalized : byPath.imageUrl,
    };
  }
  // Last resort: same host as a verified image-search hit. Models often rewrite
  // CDN query params or pick a sibling asset URL on the same shop CDN.
  if (!/^https:\/\//i.test(normalized)) return null;
  let selectedHost = "";
  try {
    selectedHost = new URL(normalized).hostname.toLowerCase();
  } catch {
    return null;
  }
  const hostMatch = allCandidates.find((candidate) => {
    const hosts = [
      hostnameOf(candidate.imageUrl),
      hostnameOf(candidate.canonicalUrl),
      hostnameOf(candidate.thumbnailUrl || ""),
      candidate.sourceDomain,
    ];
    return hosts.includes(selectedHost);
  });
  if (!hostMatch) return null;
  return {
    ...hostMatch,
    imageUrl: normalized,
    canonicalUrl: normalized,
  };
}

export function selectedCandidates(
  urls: unknown,
  byUrl: Map<string, OpenAiImageCandidate>,
  limit: number,
  allCandidates: OpenAiImageCandidate[] = []
): OpenAiImageCandidate[] {
  if (limit <= 0 || !Array.isArray(urls)) return [];
  const selected: OpenAiImageCandidate[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    const candidate = resolveSelectedImageUrl(
      String(raw || ""),
      byUrl,
      allCandidates
    );
    const candidateKey = candidate ? urlPathKey(candidate.imageUrl) : "";
    if (!candidate || seen.has(candidateKey)) continue;
    seen.add(candidateKey);
    selected.push(candidate);
    if (selected.length >= limit) break;
  }
  return selected;
}

export async function runOpenAiWebImageSearch(params: {
  agent: "scraping-main" | "scraping-gallery";
  prompt: string;
  schemaName: string;
  schema: Record<string, unknown>;
  maxResults: number;
  searchDepth: GalleryScrapingSettings["searchDepth"];
  mainImage?: { buffer?: Buffer; contentType?: string; url: string };
}): Promise<{
  selection: Record<string, unknown> | null;
  indexedImages: IndexedImageResults;
  allImageResults: OpenAiImageCandidate[];
  cost: AiCallCost;
  searchCallCount: number;
}> {
  const apiKey = requireOpenAiApiKey();
  const content: Array<Record<string, unknown>> = [
    { type: "input_text", text: params.prompt },
  ];
  if (params.mainImage) {
    content.unshift({
      type: "input_image",
      image_url: params.mainImage.buffer
        ? `data:${params.mainImage.contentType || "image/jpeg"};base64,${params.mainImage.buffer.toString("base64")}`
        : params.mainImage.url,
      detail: "high",
    });
  }

  galleryLog("openai:scraping", `Starting ${params.agent} OpenAI image search`, {
    model: GALLERY_SCRAPING_MODEL,
    agent: params.agent,
    maxResults: params.maxResults,
    searchDepth: params.searchDepth,
    hasMainAttachment: !!params.mainImage,
  });

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GALLERY_SCRAPING_MODEL,
      reasoning: { effort: "low" },
      tools: [
        {
          type: "web_search",
          search_content_types: ["image", "text"],
          image_settings: {
            max_results: params.maxResults,
            caption: true,
          },
          external_web_access: true,
        },
      ],
      tool_choice: "required",
      include: ["web_search_call.results"],
      input: [{ role: "user", content }],
      text: {
        format: {
          type: "json_schema",
          name: params.schemaName,
          strict: true,
          schema: params.schema,
        },
      },
      store: true,
    }),
    signal: AbortSignal.timeout(180_000),
  });

  const rawText = await response.text();
  let body: OpenAiResponse;
  try {
    body = JSON.parse(rawText) as OpenAiResponse;
  } catch {
    throw new Error(`OpenAI image search returned invalid JSON (${response.status})`);
  }
  if (!response.ok) {
    throw new Error(
      body.error?.message || `OpenAI image search failed (${response.status})`
    );
  }
  if (body.status && body.status !== "completed") {
    throw new Error(`OpenAI image search ended with status ${body.status}`);
  }

  const indexedImages = collectImageResults(body);
  const selection = parseJsonObject(responseText(body));
  const searchCallCount = (body.output ?? []).filter(
    (item) => item.type === "web_search_call"
  ).length;
  const cost = calculateOpenAiWebSearchCost(
    GALLERY_SCRAPING_MODEL,
    body.usage,
    searchCallCount
  );

  if (!selection) {
    galleryWarn("openai:scraping", `Could not parse ${params.agent} selection`, {
      imageResultCount: indexedImages.candidates.length,
      searchCallCount,
    });
  }

  return {
    selection,
    indexedImages,
    allImageResults: indexedImages.candidates,
    cost,
    searchCallCount,
  };
}
