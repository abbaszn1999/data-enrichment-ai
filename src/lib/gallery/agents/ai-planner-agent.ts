import {
  calculateOpenAiWebSearchCost,
  type AiCallCost,
} from "@/lib/ai-pricing";
import { resolveScrapingModel } from "@/lib/gallery/agents/scraping-shared";
import {
  buildPlannerJsonClosing,
  buildPlannerProductImageIntro,
  buildPlannerResponseSchema,
  buildPlannerUserPrompt,
  galleryPlanFingerprint,
} from "@/lib/gallery/agents/planner-prompts";
import type { AiReferenceImage } from "@/lib/gallery/agents/ai-shared";
import { galleryLog, galleryWarn } from "@/lib/gallery/log";
import { loadGallerySkill } from "@/lib/gallery/skill-loader";
import type { GalleryRow, GalleryWorksheetJson } from "@/lib/gallery/types";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export type GalleryShotBrief = {
  specClaim: string;
  visualBrief: string;
  alt: string;
};

export type GalleryPlannerPlan = {
  fingerprint: string;
  main?: GalleryShotBrief;
  gallery: Array<GalleryShotBrief & { index: number }>;
  notes?: string;
};

type OpenAiResponse = {
  status?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  usage?: unknown;
  error?: { message?: string };
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

function normalizeBrief(raw: unknown): GalleryShotBrief | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const visualBrief = String(record.visualBrief || "").trim();
  const specClaim = String(record.specClaim || "").trim();
  const alt = String(record.alt || "").trim();
  if (!visualBrief) return null;
  return {
    visualBrief: visualBrief.slice(0, 4_000),
    specClaim: specClaim.slice(0, 300),
    alt: (alt || "Product image").slice(0, 300),
  };
}

function normalizeGallery(
  raw: unknown,
  galleryCount: number
): Array<GalleryShotBrief & { index: number }> {
  const list = Array.isArray(raw) ? raw : [];
  const briefs: Array<GalleryShotBrief & { index: number }> = [];
  const seen = new Set<number>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const brief = normalizeBrief(record);
    const index = Number(record.index);
    if (!brief) continue;
    if (!Number.isInteger(index) || index < 1 || index > galleryCount) continue;
    if (seen.has(index)) continue;
    seen.add(index);
    briefs.push({ ...brief, index });
  }
  return briefs.sort((a, b) => a.index - b.index);
}

function toPlannerImagePart(image: AiReferenceImage): Record<string, unknown> | null {
  if (image.buffer && image.buffer.length > 0) {
    return {
      type: "input_image",
      image_url: `data:${image.contentType || "image/jpeg"};base64,${image.buffer.toString("base64")}`,
      detail: "high",
    };
  }
  if (image.uri && /^https?:\/\//i.test(image.uri)) {
    return {
      type: "input_image",
      image_url: image.uri,
      detail: "high",
    };
  }
  return null;
}

export function readStoredGalleryPlan(
  row: Pick<GalleryRow, "sourceMeta">,
  fingerprint: string,
  galleryCount: number,
  needMain: boolean
): GalleryPlannerPlan | null {
  const stored = row.sourceMeta?.plan;
  if (!stored || typeof stored !== "object") return null;
  const record = stored as Partial<GalleryPlannerPlan>;
  if (record.fingerprint !== fingerprint) return null;
  const gallery = Array.isArray(record.gallery) ? record.gallery : [];
  if (gallery.length !== galleryCount) return null;
  if (gallery.some((item) => !item?.visualBrief)) return null;
  if (needMain && !record.main?.visualBrief) return null;
  return {
    fingerprint,
    main: record.main,
    gallery: gallery.map((item, index) => ({
      index: item.index || index + 1,
      specClaim: String(item.specClaim || ""),
      visualBrief: String(item.visualBrief || ""),
      alt: String(item.alt || ""),
    })),
    notes: record.notes,
  };
}

export async function planGalleryImages(params: {
  worksheet: GalleryWorksheetJson;
  row: GalleryRow;
  galleryCount: number;
  needMain: boolean;
  productImage?: AiReferenceImage | null;
  hasSceneReference: boolean;
  hasLogo: boolean;
  hasBrandGuide: boolean;
}): Promise<{ plan: GalleryPlannerPlan; cost: AiCallCost | null; model: string }> {
  const galleryCount = Math.min(
    8,
    Math.max(1, Math.floor(params.galleryCount) || 1)
  );
  const fingerprint = galleryPlanFingerprint({
    galleryCount,
    needMain: params.needMain,
    instructions: params.worksheet.settings.ai.instructions || "",
    style: params.worksheet.settings.ai.style || "studio",
    scene: params.hasSceneReference,
    branding: params.worksheet.settings.ai.brandingEnabled,
  });

  const reused = readStoredGalleryPlan(
    params.row,
    fingerprint,
    galleryCount,
    params.needMain
  );
  if (reused) {
    galleryLog("ai-planner", "Reusing stored Gallery plan", {
      rowId: params.row.id,
      galleryCount,
      needMain: params.needMain,
    });
    return {
      plan: reused,
      cost: null,
      model: "cached",
    };
  }

  const apiKey = requireOpenAiApiKey();
  const model = resolveScrapingModel(params.worksheet.settings.ai.tier);
  const skill = await loadGallerySkill("planner");
  const prompt = buildPlannerUserPrompt({
    worksheet: params.worksheet,
    row: params.row,
    galleryCount,
    needMain: params.needMain,
    hasProductImage: !!params.productImage,
    hasSceneReference: params.hasSceneReference,
    hasLogo: params.hasLogo,
    hasBrandGuide: params.hasBrandGuide,
  });

  const content: Array<Record<string, unknown>> = [
    { type: "input_text", text: prompt },
  ];
  if (params.productImage) {
    const imagePart = toPlannerImagePart(params.productImage);
    if (imagePart) {
      content.push({
        type: "input_text",
        text: buildPlannerProductImageIntro(),
      });
      content.push(imagePart);
    }
  }
  content.push({
    type: "input_text",
    text: buildPlannerJsonClosing(params.needMain, galleryCount),
  });

  galleryLog("ai-planner", "Planning Gallery briefs", {
    rowId: params.row.id,
    model,
    galleryCount,
    needMain: params.needMain,
    hasProductImage: !!params.productImage,
    thinking: skill.frontmatter.thinking,
  });

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions: skill.instructions,
      reasoning: { effort: skill.frontmatter.thinking },
      input: [{ role: "user", content }],
      text: {
        format: {
          type: "json_schema",
          name: "gallery_plan",
          strict: true,
          schema: buildPlannerResponseSchema({
            galleryCount,
            needMain: params.needMain,
          }),
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
    throw new Error(`Gallery planner returned invalid JSON (${response.status})`);
  }
  if (!response.ok) {
    throw new Error(
      body.error?.message || `Gallery planner failed (${response.status})`
    );
  }
  if (body.status && body.status !== "completed") {
    throw new Error(`Gallery planner ended with status ${body.status}`);
  }

  const parsed = parseJsonObject(responseText(body));
  if (!parsed) {
    galleryWarn("ai-planner", "Could not parse planner JSON");
    throw new Error("Gallery planner returned an unreadable response");
  }

  const gallery = normalizeGallery(parsed.gallery, galleryCount);
  if (gallery.length !== galleryCount) {
    throw new Error(
      `Gallery planner returned ${gallery.length} briefs; expected ${galleryCount}`
    );
  }

  let main: GalleryShotBrief | undefined;
  if (params.needMain) {
    const normalized = normalizeBrief(parsed.main);
    if (!normalized) {
      throw new Error("Gallery planner did not return a Main brief");
    }
    main = normalized;
  }

  return {
    plan: {
      fingerprint,
      main,
      gallery,
      notes: parsed.notes ? String(parsed.notes) : undefined,
    },
    cost: calculateOpenAiWebSearchCost(model, body.usage, 0),
    model,
  };
}
