/**
 * Sync Pro image backend — OpenAI Sol + hosted web_search (images only).
 * Fast mode must NOT use this module (Serper stays in ai-helpers).
 * Text research (Globe) always uses Gemini grounding — not this file.
 */

import {
  calculateOpenAiWebSearchCost,
  costToCredits,
  type AiCallCost,
} from "@/lib/ai-pricing";
import {
  collectToolImages,
  countWebSearchCalls,
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
      responseId: parsedId(parsed),
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
  // Identity-only search query. Short hints (e.g. "white background") stay as
  // Extra instruction — never concatenate raw user chat into the search focus.
  const query = identity;

  if (!query) {
    console.warn("[Sync Pro OpenAI] image search skipped — empty query");
    return null;
  }

  const prompt = [
    "Find ONE high-quality packshot / product image for this exact ecommerce product.",
    "Prefer official brand or reputable retailer images on a clean background.",
    "Use web_search with image results. Do not invent URLs.",
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
            required: ["notes"],
            properties: {
              notes: {
                type: "string",
                description: "Brief note on what was found",
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

    const best = images[0];
    if (!best?.imageUrl) {
      console.log("[Sync Pro OpenAI] image search found no direct image_url", {
        query: query.slice(0, 120),
        searchCallCount,
        toolImageCount: images.length,
        responseId: parsedId(body),
      });
      return null;
    }

    console.log("[Sync Pro OpenAI] image search success", {
      imageUrl: best.imageUrl.slice(0, 120),
      searchCallCount,
      totalCost: cost.totalCost,
      responseId: parsedId(body),
    });

    return {
      imageUrl: best.imageUrl,
      pageUrl: best.pageUrl || best.imageUrl,
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
