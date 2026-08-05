import {
  calculateOpenAiWebSearchCost,
  type AiCallCost,
} from "@/lib/ai-pricing";
import type { SerperImageCandidate } from "@/lib/gallery/agent/filters";
import { galleryLog, galleryWarn } from "@/lib/gallery/log";
import type { GalleryScrapingSettings } from "@/lib/gallery/types";

export type ScrapingModelId = "gpt-5.6-terra" | "gpt-5.6-sol";

/** Standard → Terra, Premium → Sol (official OpenAI model IDs). */
export const GALLERY_SCRAPING_MODELS = {
  standard: "gpt-5.6-terra",
  premium: "gpt-5.6-sol",
} as const satisfies Record<"standard" | "premium", ScrapingModelId>;

export function resolveScrapingModel(
  tier: GalleryScrapingSettings["tier"] | undefined
): ScrapingModelId {
  return tier === "premium"
    ? GALLERY_SCRAPING_MODELS.premium
    : GALLERY_SCRAPING_MODELS.standard;
}

/** @deprecated Prefer resolveScrapingModel(settings.tier). Defaults to Standard/Terra. */
export const GALLERY_SCRAPING_MODEL = GALLERY_SCRAPING_MODELS.standard;

export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export type OpenAiImageCandidate = SerperImageCandidate & {
  canonicalUrl: string;
  thumbnailUrl?: string;
};

export type IndexedImageResults = {
  candidates: OpenAiImageCandidate[];
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

export function collectImageResults(response: OpenAiResponse): IndexedImageResults {
  const seen = new Set<string>();
  const images: OpenAiImageCandidate[] = [];
  for (const output of response.output ?? []) {
    if (output.type !== "web_search_call") continue;
    const results = output.results ?? output.action?.results ?? [];
    for (const result of results) {
      if (result.type !== "image_result") continue;
      const canonicalUrl = String(result.image_url || "").trim();
      const thumbnailUrl = String(result.thumbnail_url || "").trim();
      const imageUrl = canonicalUrl || thumbnailUrl;
      if (!/^https:\/\//i.test(imageUrl)) continue;
      const key = imageUrl.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const pageUrl = String(result.source_website_url || "").trim();
      images.push({
        imageUrl,
        canonicalUrl: canonicalUrl || imageUrl,
        thumbnailUrl: /^https:\/\//i.test(thumbnailUrl) ? thumbnailUrl : undefined,
        pageUrl: /^https?:\/\//i.test(pageUrl) ? pageUrl : imageUrl,
        title: String(result.caption || "Product image").slice(0, 300),
        width: 0,
        height: 0,
        sourceDomain: hostnameOf(pageUrl || imageUrl),
      });
    }
  }
  return { candidates: images };
}

/**
 * Trust the model's selected URLs directly (no verification against the raw
 * search-result list). The model sees the attached Main image and its own
 * search results, so its picks are used as-is; only basic cleanup (trim,
 * https-only, de-dupe) is applied here.
 */
export function selectedCandidates(
  urls: unknown,
  limit: number
): OpenAiImageCandidate[] {
  if (limit <= 0 || !Array.isArray(urls)) return [];
  const selected: OpenAiImageCandidate[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    const imageUrl = String(raw || "").trim().replaceAll("&amp;", "&");
    if (!/^https:\/\//i.test(imageUrl)) continue;
    const key = imageUrl.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push({
      imageUrl,
      canonicalUrl: imageUrl,
      pageUrl: imageUrl,
      title: "Product image",
      width: 0,
      height: 0,
      sourceDomain: hostnameOf(imageUrl),
    });
    if (selected.length >= limit) break;
  }
  return selected;
}

export type ScrapingMainImageAttachment = {
  buffer?: Buffer;
  contentType?: string;
  url: string;
};

export async function runOpenAiWebImageSearch(params: {
  agent: "scraping-main" | "scraping-gallery";
  prompt: string;
  schemaName: string;
  schema: Record<string, unknown>;
  maxResults: number;
  searchDepth: GalleryScrapingSettings["searchDepth"];
  model?: ScrapingModelId;
  /** @deprecated Prefer `mainImages` — kept for single-image callers. */
  mainImage?: ScrapingMainImageAttachment;
  mainImages?: ScrapingMainImageAttachment[];
}): Promise<{
  selection: Record<string, unknown> | null;
  indexedImages: IndexedImageResults;
  allImageResults: OpenAiImageCandidate[];
  cost: AiCallCost;
  searchCallCount: number;
}> {
  const apiKey = requireOpenAiApiKey();
  const model = params.model || GALLERY_SCRAPING_MODEL;
  const mainAttachments =
    params.mainImages && params.mainImages.length > 0
      ? params.mainImages
      : params.mainImage
        ? [params.mainImage]
        : [];
  const content: Array<Record<string, unknown>> = [
    { type: "input_text", text: params.prompt },
  ];
  // Attach Main images first (all of them) so the model can visually compare.
  for (let index = mainAttachments.length - 1; index >= 0; index -= 1) {
    const attachment = mainAttachments[index]!;
    content.unshift({
      type: "input_image",
      image_url: attachment.buffer
        ? `data:${attachment.contentType || "image/jpeg"};base64,${attachment.buffer.toString("base64")}`
        : attachment.url,
      detail: "high",
    });
  }

  galleryLog("openai:scraping", `Starting ${params.agent} OpenAI image search`, {
    model,
    agent: params.agent,
    maxResults: params.maxResults,
    searchDepth: params.searchDepth,
    hasMainAttachment: mainAttachments.length > 0,
    mainAttachmentCount: mainAttachments.length,
  });

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
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
    model,
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
