import {
  calculateOpenAiWebSearchCost,
  type AiCallCost,
} from "@/lib/ai-pricing";
import {
  buildDescriptionBrandColorsBlock,
  buildDescriptionBrandGuideBlock,
  buildDescriptionJsonClosing,
  buildDescriptionLogoBlock,
  buildDescriptionProductImageIntro,
  buildDescriptionResponseSchema,
  buildDescriptionUserPrompt,
  DEFAULT_DESCRIPTION_SYSTEM_PROMPT,
} from "@/lib/visualizer/agents/prompts";
import { visualizerLog, visualizerWarn } from "@/lib/visualizer/log";
import {
  resolveVisualizerDescriptionModel,
  type VisualizerBrandSettings,
  type VisualizerImagePlaceholder,
  type VisualizerImagesSettings,
  type VisualizerLayoutId,
  type VisualizerTier,
} from "@/lib/visualizer/types";
import {
  clampVisualizerImageCount,
  VISUALIZER_MAX_IMAGES,
} from "@/lib/visualizer/layouts";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

type OpenAiResponse = {
  status?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  usage?: unknown;
  error?: { message?: string };
};

export type DescriptionAgentResult = {
  description: string;
  imagePlaceholders: VisualizerImagePlaceholder[];
  notes?: string;
  cost: AiCallCost;
  model: string;
};

export type DescriptionReferenceImage = {
  buffer: Buffer;
  contentType: string;
};

function requireOpenAiApiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OpenAI is not configured");
  return key;
}

function responseText(body: OpenAiResponse): string {
  for (const item of body.output ?? []) {
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && part.text) return part.text;
    }
  }
  return "";
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as Record<
          string,
          unknown
        >;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizePlaceholders(
  raw: unknown,
  imageCount: number,
  description: string
): VisualizerImagePlaceholder[] {
  const maxItems = Math.min(
    VISUALIZER_MAX_IMAGES,
    Math.max(1, Math.floor(imageCount) || 1)
  );
  const list = Array.isArray(raw) ? raw : [];
  const placeholders: VisualizerImagePlaceholder[] = [];
  const seen = new Set<number>();

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const index = Number(record.index);
    if (!Number.isInteger(index) || index < 1 || index > maxItems) continue;
    if (seen.has(index)) continue;
    const visualBrief = String(record.visualBrief || "").trim();
    const alt = String(record.alt || "").trim();
    if (!visualBrief) continue;
    seen.add(index);
    placeholders.push({
      index,
      visualBrief: visualBrief.slice(0, 4_000),
      alt: (alt || `Product visual ${index}`).slice(0, 300),
      storagePath: null,
    });
  }

  return placeholders
    .filter((item) =>
      description.includes(`[imageplaceholder-${item.index}]`)
    )
    .sort((a, b) => a.index - b.index)
    .slice(0, maxItems);
}

function toDataUrl(image: DescriptionReferenceImage): string {
  const mime = image.contentType || "image/jpeg";
  return `data:${mime};base64,${image.buffer.toString("base64")}`;
}

function pushText(
  content: Array<Record<string, unknown>>,
  text: string
): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  content.push({ type: "input_text", text: trimmed });
}

function pushImage(
  content: Array<Record<string, unknown>>,
  image: DescriptionReferenceImage
): void {
  content.push({
    type: "input_image",
    image_url: toDataUrl(image),
    detail: "high",
  });
}

function pushImageFromProduct(
  content: Array<Record<string, unknown>>,
  productImage: { url: string; buffer?: Buffer; contentType?: string }
): void {
  content.push({
    type: "input_image",
    image_url: productImage.buffer
      ? `data:${productImage.contentType || "image/jpeg"};base64,${productImage.buffer.toString("base64")}`
      : productImage.url,
    detail: "high",
  });
}

/**
 * Ordered multimodal content:
 * system+main → (product intro + product image) → brand colors (manual mode) →
 * (logo text+image) → (guide text+image) → JSON closing.
 * Logo / brand-guide prompt sections are omitted when no image bytes.
 * Manual hex palette is only sent when includeBrandColors is true.
 */
export function buildDescriptionInputContent(params: {
  prompt: string;
  productImage?: { url: string; buffer?: Buffer; contentType?: string };
  brandingEnabled?: boolean;
  /** Manual colors mode only — never with Upload image brand-guide. */
  includeBrandColors?: boolean;
  brandColors?: string[];
  brandFallbackColors?: string[];
  logoImage?: DescriptionReferenceImage | null;
  brandGuideImage?: DescriptionReferenceImage | null;
}): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [];

  pushText(
    content,
    `${DEFAULT_DESCRIPTION_SYSTEM_PROMPT}\n\n${params.prompt}`
  );

  if (params.productImage) {
    pushText(content, buildDescriptionProductImageIntro());
    pushImageFromProduct(content, params.productImage);
  }

  if (params.brandingEnabled && params.includeBrandColors) {
    const colors =
      params.brandColors?.length
        ? params.brandColors
        : params.brandFallbackColors || ["#111827", "#2563EB", "#F59E0B"];
    pushText(content, buildDescriptionBrandColorsBlock(colors));
  }

  if (params.logoImage) {
    pushText(content, buildDescriptionLogoBlock());
    pushImage(content, params.logoImage);
  }

  if (params.brandGuideImage) {
    pushText(content, buildDescriptionBrandGuideBlock());
    pushImage(content, params.brandGuideImage);
  }

  pushText(content, buildDescriptionJsonClosing());
  return content;
}

export async function generateProductDescription(params: {
  product: Record<string, string>;
  tier: VisualizerTier;
  brand: VisualizerBrandSettings;
  layoutId: VisualizerLayoutId;
  imageCount: number;
  customInstructions?: string;
  productImage?: { url: string; buffer?: Buffer; contentType?: string };
  images?: Pick<
    VisualizerImagesSettings,
    | "brandingEnabled"
    | "brandGuideMode"
    | "brandColors"
    | "logoPath"
    | "brandGuidePath"
  >;
  logoImage?: DescriptionReferenceImage | null;
  brandGuideImage?: DescriptionReferenceImage | null;
}): Promise<DescriptionAgentResult> {
  const apiKey = requireOpenAiApiKey();
  const model = resolveVisualizerDescriptionModel(params.tier);
  const imageCount = clampVisualizerImageCount(
    params.layoutId,
    params.imageCount
  );
  const brandingEnabled = params.images?.brandingEnabled === true;
  const brandGuideMode = params.images?.brandGuideMode ?? "colors";
  const includeManualBrandColors =
    brandingEnabled && brandGuideMode === "colors";
  const logoImage = brandingEnabled ? params.logoImage || null : null;
  const brandGuideImage =
    brandingEnabled && brandGuideMode === "image"
      ? params.brandGuideImage || null
      : null;

  const prompt = buildDescriptionUserPrompt({
    product: params.product,
    layoutId: params.layoutId,
    imageCount,
    brand: params.brand,
    customInstructions: params.customInstructions,
    includeManualBrandColors,
  });

  const content = buildDescriptionInputContent({
    prompt,
    productImage: params.productImage,
    brandingEnabled,
    includeBrandColors: includeManualBrandColors,
    brandColors: params.images?.brandColors,
    brandFallbackColors: [
      params.brand.colorPrimary,
      params.brand.colorSecondary,
      "#F59E0B",
    ],
    logoImage,
    brandGuideImage,
  });

  visualizerLog("description-agent", "Starting description generation", {
    model,
    hasProductImage: !!params.productImage,
    brandingEnabled,
    brandGuideMode,
    includeManualBrandColors,
    hasLogoImage: !!logoImage,
    hasBrandGuideImage: !!brandGuideImage,
    contentParts: content.length,
    layoutId: params.layoutId,
    imageCount,
  });

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      reasoning: { effort: "medium" },
      input: [{ role: "user", content }],
      text: {
        format: {
          type: "json_schema",
          name: "visualizer_description",
          strict: true,
          schema: buildDescriptionResponseSchema(imageCount),
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
    throw new Error(`Description agent returned invalid JSON (${response.status})`);
  }
  if (!response.ok) {
    throw new Error(
      body.error?.message || `Description agent failed (${response.status})`
    );
  }
  if (body.status && body.status !== "completed") {
    throw new Error(`Description agent ended with status ${body.status}`);
  }

  const parsed = parseJsonObject(responseText(body));
  if (!parsed) {
    visualizerWarn("description-agent", "Could not parse description JSON");
    throw new Error("Description agent returned an unreadable response");
  }

  const description = String(parsed.description || "").trim();
  if (!description) {
    throw new Error("Description agent returned an empty description");
  }

  const imagePlaceholders = normalizePlaceholders(
    parsed.imagePlaceholders,
    imageCount,
    description
  );
  const cost = calculateOpenAiWebSearchCost(model, body.usage, 0);

  return {
    description,
    imagePlaceholders,
    notes: parsed.notes ? String(parsed.notes) : undefined,
    cost,
    model,
  };
}
