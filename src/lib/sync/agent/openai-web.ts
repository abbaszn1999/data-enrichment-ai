/**
 * Sync Pro image backend — OpenAI Sol + hosted web_search (images only).
 * Fast mode must NOT use this module (Serper stays in ai-helpers).
 * Text research (Globe) always uses Gemini grounding — not this file.
 *
 * Precision-first: model must select a URL from the tool image pool or abstain.
 * Never fall back to the first tool image when the model declines.
 */

import {
  calculateOpenAiWebSearchCost,
  costToCredits,
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
import type { OpenAiResponse } from "@/lib/enrich/types";
import type { SyncBillingTracker } from "./ai-utils";

export const SYNC_PRO_OPENAI_MODEL = "gpt-5.6-sol" as const;

function trackCost(
  tracker: SyncBillingTracker | undefined,
  cost: AiCallCost | null | undefined
) {
  if (!tracker || !cost) return;
  tracker.totalCost += cost.totalCost;
  tracker.totalTokens += cost.usage.totalTokens;
  tracker.totalCredits += costToCredits(cost.totalCost);
}

function parsedId(body: OpenAiResponse): string | undefined {
  return (body as { id?: string }).id;
}

async function postResponses(body: Record<string, unknown>): Promise<OpenAiResponse> {
  const hasKey = Boolean(process.env.OPENAI_API_KEY?.trim());
  console.log("[Sync Pro OpenAI] POST /v1/responses", {
    model: body.model,
    store: body.store,
    toolChoice: body.tool_choice,
    hasOpenAiKey: hasKey,
  });
  if (!hasKey) {
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
    signal: AbortSignal.timeout(180_000),
  });

  const rawText = await response.text();
  let parsed: OpenAiResponse;
  try {
    parsed = JSON.parse(rawText) as OpenAiResponse;
  } catch {
    console.error("[Sync Pro OpenAI] invalid JSON response", {
      status: response.status,
      bodyPreview: rawText.slice(0, 400),
    });
    throw new Error(`OpenAI Sync web returned invalid JSON (${response.status})`);
  }
  if (!response.ok) {
    console.error("[Sync Pro OpenAI] API error", {
      status: response.status,
      message: parsed.error?.message,
      bodyPreview: rawText.slice(0, 400),
    });
    throw new Error(
      parsed.error?.message || `OpenAI Sync web failed (${response.status})`
    );
  }
  if (parsed.status && parsed.status !== "completed") {
    console.error("[Sync Pro OpenAI] incomplete status", {
      status: parsed.status,
      responseId: parsedId(body),
    });
    throw new Error(`OpenAI Sync web ended with status ${parsed.status}`);
  }
  console.log("[Sync Pro OpenAI] response ok", {
    status: parsed.status ?? "completed",
    responseId: parsedId(parsed),
    searchCalls: countWebSearchCalls(parsed),
  });
  return parsed;
}

export type SyncImageSelection = {
  status: "found" | "no_confident_match";
  selectedImageUrl: string | null;
  notes: string;
};

/** Parse Sol structured output. Exported for unit tests. */
export function parseSyncImageSelection(raw: unknown): SyncImageSelection | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const status = rec.status === "found" ? "found" : "no_confident_match";
  let selectedImageUrl: string | null = null;
  if (typeof rec.selectedImageUrl === "string") {
    const trimmed = rec.selectedImageUrl.trim();
    selectedImageUrl = trimmed.length > 0 ? trimmed : null;
  } else if (rec.selectedImageUrl == null) {
    selectedImageUrl = null;
  } else {
    selectedImageUrl = null;
  }
  const notes = typeof rec.notes === "string" ? rec.notes : "";
  return { status, selectedImageUrl, notes };
}

/**
 * Ground model selection against the tool image pool.
 * Returns null when abstaining or when the URL is not a tool image_url.
 * Exported for unit tests.
 */
export function resolveGroundedImageSelection(params: {
  selection: SyncImageSelection | null;
  toolImages: Array<{ imageUrl: string; pageUrl?: string }>;
}): { imageUrl: string; pageUrl: string } | null {
  const { selection, toolImages } = params;
  if (!selection || selection.status !== "found") {
    console.log("[Sync Pro OpenAI] abstained", {
      abstained: true,
      status: selection?.status ?? "missing_selection",
      notes: selection?.notes?.slice(0, 160),
    });
    return null;
  }

  const url = selection.selectedImageUrl;
  if (!url || !looksLikeDirectImageUrl(url)) {
    console.log("[Sync Pro OpenAI] abstained", {
      abstained: true,
      reason: !url ? "null_or_empty_url" : "not_direct_image_url",
    });
    return null;
  }

  const key = url.toLowerCase();
  const matched = toolImages.find((img) => img.imageUrl.toLowerCase() === key);
  if (!matched) {
    console.log("[Sync Pro OpenAI] abstained", {
      abstained: true,
      reason: "url_not_in_tool_pool",
      selectedPreview: url.slice(0, 120),
      poolSize: toolImages.length,
    });
    return null;
  }

  return {
    imageUrl: matched.imageUrl,
    pageUrl: matched.pageUrl || matched.imageUrl,
  };
}

/**
 * One product image via OpenAI Sol web_search (image results). No Serper.
 * Used only when Sync mode === "pro" for sync_images_search.
 */
export async function searchImagesWithOpenAiWeb(params: {
  title: string;
  vendor?: string;
  productType?: string;
  tags?: string;
  instruction: string;
  billingTracker?: SyncBillingTracker;
}): Promise<{
  imageUrl: string;
  pageUrl: string;
  query: string;
  cost: AiCallCost;
} | null> {
  const identity = [
    params.title,
    params.vendor,
    params.productType,
    params.tags,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const hint = String(params.instruction ?? "").trim();
  const query = identity;

  if (!query) {
    console.warn("[Sync Pro OpenAI] image search skipped — empty query");
    return null;
  }

  const prompt = [
    "Find ONE useful ecommerce product image for this product.",
    "Use web_search with image results. Do not invent URLs.",
    'When status is "found", selectedImageUrl MUST be copied exactly from a web_search image_result.image_url.',
    "Prefer a clear product photo that matches the product type and name as closely as possible.",
    'Set status to "no_confident_match" and selectedImageUrl to null only if results are clearly unrelated',
    "(wrong category, people-only shots, logos, or otherwise unusable).",
    "Do not abstain merely because there is no official brand page or perfect exact-name packshot.",
    "",
    `Search focus: ${query}`,
    hint ? `Extra instruction: ${hint}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  console.log("[Sync Pro OpenAI] searchImagesWithOpenAiWeb starting", {
    model: SYNC_PRO_OPENAI_MODEL,
    store: true,
    query: query.slice(0, 160),
    title: params.title.slice(0, 80),
  });

  try {
    const body = await postResponses({
      model: SYNC_PRO_OPENAI_MODEL,
      reasoning: { effort: "high" },
      tools: [
        {
          type: "web_search",
          search_context_size: "high",
          external_web_access: true,
          search_content_types: ["image", "text"],
          image_settings: {
            max_results: 3,
            caption: true,
          },
        },
      ],
      tool_choice: "required",
      include: ["web_search_call.results"],
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "sync_product_image",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["status", "selectedImageUrl", "notes"],
            properties: {
              status: {
                type: "string",
                enum: ["found", "no_confident_match"],
                description:
                  "found when selectedImageUrl is a tool image_url that reasonably matches the product; no_confident_match only if results are clearly unrelated",
              },
              selectedImageUrl: {
                type: ["string", "null"],
                description:
                  "Exact image_result.image_url from web_search, or null when abstaining",
              },
              notes: {
                type: "string",
                description: "Brief note on match quality or why abstaining",
              },
            },
          },
        },
      },
      store: true,
    });

    const images = collectToolImages(body);
    const searchCallCount = countWebSearchCalls(body);
    const cost = calculateOpenAiWebSearchCost(
      SYNC_PRO_OPENAI_MODEL,
      body.usage,
      searchCallCount
    );
    trackCost(params.billingTracker, cost);

    const selection = parseSyncImageSelection(parseJsonObject(responseOutputText(body)));
    const grounded = resolveGroundedImageSelection({
      selection,
      toolImages: images,
    });

    if (!grounded) {
      console.log("[Sync Pro OpenAI] image search abstained or ungrounded", {
        query: query.slice(0, 120),
        searchCallCount,
        toolImageCount: images.length,
        status: selection?.status,
        responseId: parsedId(body),
        abstained: true,
      });
      return null;
    }

    console.log("[Sync Pro OpenAI] image search success", {
      imageUrl: grounded.imageUrl.slice(0, 120),
      searchCallCount,
      totalCost: cost.totalCost,
      responseId: parsedId(body),
    });

    return {
      imageUrl: grounded.imageUrl,
      pageUrl: grounded.pageUrl,
      query,
      cost,
    };
  } catch (err) {
    console.error("[Sync Pro OpenAI] searchImagesWithOpenAiWeb FAILED", {
      query: query.slice(0, 120),
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
