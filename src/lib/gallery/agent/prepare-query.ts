import { requireGeminiApiKey } from "@/lib/sync/agent/ai-utils";
import { calculateCallCost, type AiCallCost } from "@/lib/ai-pricing";
import {
  galleryError,
  galleryLog,
  galleryVerboseLog,
} from "@/lib/gallery/log";
import { parseImageUrls } from "@/lib/gallery/image-urls";

export const GALLERY_AGENT_MODEL = "gemini-3.6-flash";

const GALLERY_PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    searchQuery: { type: "string" },
    queryVariants: {
      type: "array",
      items: { type: "string" },
      maxItems: 1,
    },
    productIdentity: { type: "string" },
    hasUsableOriginalImage: { type: "boolean" },
    needMain: { type: "boolean" },
    needGallery: { type: "boolean" },
    angleHints: { type: "array", items: { type: "string" }, maxItems: 6 },
    officialDomainHints: {
      type: "array",
      items: { type: "string" },
      maxItems: 4,
    },
    sufficient: { type: "boolean" },
    notes: { type: "string" },
  },
  required: [
    "searchQuery",
    "queryVariants",
    "productIdentity",
    "hasUsableOriginalImage",
    "needMain",
    "needGallery",
    "angleHints",
    "officialDomainHints",
    "sufficient",
  ],
} as const;

export type GalleryAgentPlan = {
  searchQuery: string;
  queryVariants: string[];
  productIdentity: string;
  hasUsableOriginalImage: boolean;
  needMain: boolean;
  needGallery: boolean;
  angleHints: string[];
  officialDomainHints: string[];
  sufficient: boolean;
  notes?: string;
};

export type GalleryAgentResult = {
  plan: GalleryAgentPlan;
  cost: AiCallCost | null;
  rawText?: string;
};

export type GalleryCandidateForRanking = {
  imageUrl: string;
  title: string;
  sourceDomain: string;
  /** Prefer inline bytes so Gemini does not need to fetch remote URLs. */
  inline?: { data: string; mimeType: string };
};

export type GalleryCandidateRankResult = {
  selectedIndices: number[];
  cost: AiCallCost | null;
  latencyMs: number;
};

type AgentInput = {
  rowData: Record<string, string>;
  selectedColumns: string[];
  originalImageColumn: string | null;
  imagesPerRow: number;
  provider: "scraping" | "ai";
};

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFallbackQuery(rowData: Record<string, string>, selectedColumns: string[]): string {
  return selectedColumns
    .map((col) => stripHtml(String(rowData[col] ?? "").trim()))
    .filter(Boolean)
    .join(" ")
    .trim()
    .slice(0, 120);
}

function detectOriginalImage(
  rowData: Record<string, string>,
  originalImageColumn: string | null
): { hasColumn: boolean; value: string; values: string[]; usable: boolean } {
  const hasColumn = !!originalImageColumn;
  const raw = hasColumn ? String(rowData[originalImageColumn!] ?? "").trim() : "";
  const values = parseImageUrls(raw);
  return {
    hasColumn,
    value: values[0] ?? "",
    values,
    usable: values.length > 0,
  };
}

function parseAgentJson(text: string): Partial<GalleryAgentPlan> | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as Partial<GalleryAgentPlan>;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Partial<GalleryAgentPlan>;
    } catch {
      return null;
    }
  }
}

function normalizePlan(
  partial: Partial<GalleryAgentPlan> | null,
  input: AgentInput,
  original: ReturnType<typeof detectOriginalImage>
): GalleryAgentPlan {
  const fallbackQuery = buildFallbackQuery(input.rowData, input.selectedColumns);
  const searchQuery = stripHtml(String(partial?.searchQuery || fallbackQuery))
    .trim()
    .slice(0, 120);
  const variants = Array.isArray(partial?.queryVariants)
    ? partial!.queryVariants
        .map((v) => stripHtml(String(v)).trim().slice(0, 120))
        .filter(Boolean)
        .slice(0, 1)
    : [];

  // File availability is factual state and must never be delegated to model
  // output. The model only plans how to satisfy the deterministic requirement.
  // Selecting an original-image column is an explicit instruction that this
  // worksheet column owns the main image. Never create a replacement in the
  // generated Main Image result column, even when a particular cell is empty
  // or its URL cannot be fetched.
  const needMain = !input.originalImageColumn;
  // The selected worksheet image is a main-image reference only. Gallery
  // images are always sourced by the agent and never inherited from the sheet.
  const needGallery = input.imagesPerRow > 1;

  // With a usable original, text search is optional — Google Lens drives gallery.
  const sufficient =
    typeof partial?.sufficient === "boolean"
      ? partial.sufficient || original.usable
      : !!(searchQuery || original.usable);

  return {
    searchQuery,
    queryVariants: variants,
    productIdentity: String(partial?.productIdentity || "").trim(),
    hasUsableOriginalImage: original.usable,
    needMain,
    needGallery,
    angleHints: Array.isArray(partial?.angleHints)
      ? partial!.angleHints.map((v) => String(v).trim()).filter(Boolean).slice(0, 6)
      : needMain
        ? ["front", "angle", "detail"]
        : ["side", "detail", "lifestyle", "packaging"],
    officialDomainHints: Array.isArray(partial?.officialDomainHints)
      ? partial.officialDomainHints
          .map((value) =>
            String(value)
              .trim()
              .toLowerCase()
              .replace(/^https?:\/\//, "")
              .replace(/^www\./, "")
              .split("/")[0]
          )
          .filter(Boolean)
          .slice(0, 4)
      : [],
    sufficient,
    notes: partial?.notes ? String(partial.notes) : undefined,
  };
}

/**
 * Gallery row agent: decides strategy + crafts Google Images search query.
 * Uses Gemini Interactions API (gemini-3.6-flash) with generateContent fallback.
 */
export async function planGalleryGoogleRow(input: AgentInput): Promise<GalleryAgentResult> {
  const selected = input.selectedColumns.length
    ? input.selectedColumns
    : Object.keys(input.rowData);
  const focusedData: Record<string, string> = {};
  for (const col of selected) {
    const value = stripHtml(String(input.rowData[col] ?? "").trim());
    if (value) focusedData[col] = value.slice(0, 500);
  }
  const populatedColumns = Object.keys(focusedData);

  const original = detectOriginalImage(input.rowData, input.originalImageColumn);

  const system = [
    "You are the Products Gallery agent for ecommerce image sourcing via SerpApi Google Images + Google Lens (visual_matches).",
    "Given one product row, decide the image strategy and craft a SHORT clean English product query.",
    "Never invent brand/model details that are not in the row data.",
    "Never include HTML, URLs, CSS, prices, or long descriptions in searchQuery — brand + product name + model/SKU only, max ~12 words.",
    "If an original product image is attached, inspect it visually, do NOT replace it, and treat Google Lens visual_matches as the gallery source.",
    "If there is no usable original image, plan one short Google Images query to find the main hero image; gallery will then come from Google Lens visual_matches on that main.",
    "Gallery images must always be newly sourced; never count extra worksheet image URLs as gallery output.",
    "Return JSON only.",
  ].join(" ");

  const userPrompt = {
    provider: input.provider,
    imagesNeeded: input.imagesPerRow,
    originalImageColumn: input.originalImageColumn,
    originalImagePresent: original.hasColumn,
    existingImageCount: original.usable ? 1 : 0,
    originalImageValuePreview: original.value ? original.value.slice(0, 120) : "",
    originalImageUsableHeuristic: original.usable,
    selectedColumns: populatedColumns,
    productRow: focusedData,
    requiredJsonSchema: {
      sufficient:
        "boolean — true if row data OR a usable original image is enough to proceed",
      searchQuery:
        "string — short clean English Google Images query (brand + name + model). Optional refine hint when an original image exists.",
      queryVariants:
        "string[] — 0-1 alternate short query only when no original image (different angle wording)",
      productIdentity: "string — short identity summary",
      hasUsableOriginalImage: "boolean",
      needMain: "boolean — true if we must find/create a main image",
      needGallery: "boolean",
      angleHints: "string[] — e.g. front, side, back, detail, on-model, lifestyle",
      officialDomainHints:
        "string[] — official brand/manufacturer domains only when confidently known; otherwise []",
      notes: "string — optional short note",
    },
  };

  const inputText = `${system}\n\nTASK:\n${JSON.stringify(userPrompt, null, 2)}\n\nRespond with JSON only.`;
  const interactionInput: Array<Record<string, unknown>> = [];
  if (original.usable) {
    interactionInput.push({
      type: "image",
      uri: original.value,
      mime_type: mimeTypeFromUrl(original.value),
      resolution: "high",
    });
  }
  interactionInput.push({ type: "text", text: inputText });

  galleryLog("agent", `Planning row with ${GALLERY_AGENT_MODEL}`, {
    provider: input.provider,
    imagesNeeded: input.imagesPerRow,
    originalImageColumn: input.originalImageColumn,
    originalImageUsable: original.usable,
    originalImageSentToGemini: original.usable,
    originalImageUri: original.usable ? original.value : undefined,
    selectedColumns: populatedColumns,
    productRow: focusedData,
  });
  galleryVerboseLog("agent:request", "Full prompt sent to Gemini", {
    model: GALLERY_AGENT_MODEL,
    inputText,
    imageInput: original.usable
      ? { uri: original.value, mimeType: mimeTypeFromUrl(original.value) }
      : null,
  });

  let rawText = "";
  let usage: unknown = null;
  let transport: "interactions" | "generateContent" | "none" = "none";

  try {
    const apiKey = requireGeminiApiKey();
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { timeout: 45_000 },
    });
    galleryLog(
      "agent:interactions",
      original.usable
        ? "Calling Interactions API with original product image…"
        : "Calling Interactions API without an original image…"
    );
    const interaction = await ai.interactions.create({
      model: GALLERY_AGENT_MODEL,
      input: interactionInput,
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: GALLERY_PLAN_SCHEMA,
      },
      store: false,
    });
    if (interaction.status !== "completed") {
      throw new Error(`Interactions request ended with status ${interaction.status}`);
    }
    rawText = interaction.output_text || "";
    usage = interaction.usage || null;
    transport = "interactions";
    galleryVerboseLog("agent:interactions:response", "Interactions model reply", {
      id: interaction.id,
      status: interaction.status,
      outputText: rawText,
      usage,
    });
  } catch (err: unknown) {
    galleryError("agent:interactions", "Interactions request failed — falling back", err);
  }

  if (!rawText) {
    try {
      galleryLog("agent:generateContent", "Calling generateContent fallback…");
      const apiKey = requireGeminiApiKey();
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { timeout: 45_000 },
      });
      const response = await ai.models.generateContent({
        model: GALLERY_AGENT_MODEL,
        contents: inputText,
        config: { responseMimeType: "application/json" },
      });
      rawText = response.text || "";
      usage = response.usageMetadata || null;
      transport = "generateContent";
      galleryVerboseLog("agent:generateContent:response", "Fallback model reply", {
        outputText: rawText,
        usage,
      });
    } catch (err: unknown) {
      galleryError("agent:generateContent", "Fallback failed", err);
    }
  }

  const parsed = rawText ? parseAgentJson(rawText) : null;
  const plan = normalizePlan(parsed, { ...input, selectedColumns: selected }, original);
  const cost = usage
    ? calculateCallCost(GALLERY_AGENT_MODEL, usage, false)
    : null;

  galleryLog("agent:plan", "Normalized agent plan", {
    transport,
    parsedOk: !!parsed,
    plan,
    cost: cost
      ? { totalCost: cost.totalCost, tokens: cost.usage.totalTokens }
      : null,
  });

  return { plan, cost, rawText: rawText || undefined };
}

function mimeTypeFromUrl(url: string): string {
  const path = url.toLowerCase().split("?")[0];
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

export async function rankGalleryCandidates(input: {
  productIdentity: string;
  originalImageUrl?: string;
  originalInline?: { data: string; mimeType: string };
  candidates: GalleryCandidateForRanking[];
  limit: number;
  matchStrictness?: "strict";
  purpose?: "main" | "gallery";
}): Promise<GalleryCandidateRankResult> {
  const startedAt = Date.now();
  const candidates = input.candidates.slice(0, 8);
  if (candidates.length === 0) {
    return { selectedIndices: [], cost: null, latencyMs: 0 };
  }
  const purpose = input.purpose ?? "gallery";
  const prompt = [
    "You validate ecommerce product images.",
    `Product identity: ${input.productIdentity || "Use the candidate titles and exact model identifiers."}`,
    input.originalImageUrl
      ? "The first image is the trusted original product reference."
      : input.originalInline
        ? "The first image is the trusted original product reference."
        : "No trusted image is available; rely on exact brand/model/SKU identifiers in the product identity and candidate metadata.",
    "Select only candidates showing the exact same product, brand, model, variant and SKU when those identifiers are available. Reject similar, generic, accessory, compatible, alternate-color, or neighboring-model products.",
    "If exact identity cannot be established with high confidence, return an empty list. Never guess or fall back to a close match.",
    purpose === "main"
      ? "Choose at most one clean hero/packshot image suitable as the Main image."
      : "Prefer a diverse set of useful angles (front, side, back, detail, packaging, lifestyle).",
    purpose === "gallery"
      ? "Never select near-duplicates of the Main/original image or of each other. Every selected image must add a genuinely different angle or detail."
      : "",
    `Return at most ${Math.max(1, input.limit)} candidate indices in best order. Return [] if none are confidently valid.`,
    `Candidates: ${JSON.stringify(
      candidates.map((candidate, index) => ({
        index,
        title: candidate.title,
        domain: candidate.sourceDomain,
      }))
    )}`,
  ].join("\n");

  const contents: Array<Record<string, unknown>> = [];
  if (input.originalImageUrl) {
    contents.push({
      type: "image",
      uri: input.originalImageUrl,
      mime_type: mimeTypeFromUrl(input.originalImageUrl),
      resolution: "high",
    });
  }
  if (input.originalInline) {
    // Prefer inline original over URI when both are provided.
    const first = contents[0];
    if (first?.type === "image" && first.uri) {
      contents.shift();
    }
    contents.unshift({
      type: "image",
      data: input.originalInline.data,
      mime_type: input.originalInline.mimeType,
    });
  }
  for (const candidate of candidates) {
    if (candidate.inline?.data) {
      contents.push({
        type: "image",
        data: candidate.inline.data,
        mime_type: candidate.inline.mimeType || "image/jpeg",
      });
    } else {
      contents.push({
        type: "image",
        uri: candidate.imageUrl,
        mime_type: mimeTypeFromUrl(candidate.imageUrl),
        resolution: "high",
      });
    }
  }
  contents.push({ type: "text", text: prompt });

  try {
    const apiKey = requireGeminiApiKey();
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { timeout: 45_000 },
    });
    galleryLog("agent:vision", "Validating product identity and angle diversity", {
      candidateCount: candidates.length,
      hasOriginalReference: !!(input.originalImageUrl || input.originalInline),
      originalImageSentFirst: !!(input.originalImageUrl || input.originalInline),
      inlineCandidateCount: candidates.filter((c) => !!c.inline?.data).length,
      totalImagesSentToGemini:
        candidates.length + (input.originalImageUrl || input.originalInline ? 1 : 0),
      matchStrictness: "strict",
      purpose,
    });
    const interaction = await ai.interactions.create({
      model: GALLERY_AGENT_MODEL,
      input: contents,
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            selectedIndices: {
              type: "array",
              items: { type: "integer", minimum: 0, maximum: candidates.length - 1 },
              maxItems: Math.max(1, input.limit),
            },
          },
          required: ["selectedIndices"],
        },
      },
      store: false,
    });
    if (interaction.status !== "completed") {
      throw new Error(`Vision validation ended with status ${interaction.status}`);
    }
    const cost = interaction.usage
      ? calculateCallCost(GALLERY_AGENT_MODEL, interaction.usage, false)
      : null;
    let parsed: { selectedIndices?: unknown[] };
    try {
      parsed = JSON.parse(interaction.output_text || "{}") as {
        selectedIndices?: unknown[];
      };
    } catch (error) {
      galleryError("agent:vision", "Vision response was not valid JSON", error);
      return { selectedIndices: [], cost, latencyMs: Date.now() - startedAt };
    }
    const selectedIndices = [
      ...new Set(
        (parsed.selectedIndices ?? [])
          .map(Number)
          .filter(
            (index) =>
              Number.isInteger(index) && index >= 0 && index < candidates.length
          )
      ),
    ].slice(0, Math.max(1, input.limit));
    galleryLog("agent:vision:result", "Candidate validation completed", {
      selectedIndices,
      requestedLimit: input.limit,
      usage: interaction.usage,
    });
    return {
      selectedIndices,
      cost,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    galleryError(
      "agent:vision",
      "Candidate validation failed; rejecting unverified candidates",
      error
    );
    return {
      selectedIndices: [],
      cost: null,
      latencyMs: Date.now() - startedAt,
    };
  }
}
